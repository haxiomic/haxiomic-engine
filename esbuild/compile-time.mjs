// @ts-check

import esbuild from 'esbuild';
import findCacheDir from 'find-cache-dir';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const pluginName = 'esbuild-plugin-compile-time';

/**
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling .ts to .js
 * @returns {esbuild.Plugin}
 */
const compileTimePlugin = (extraConfig = {}) => ({
  name: pluginName,
  setup(build) {

    build.onLoad({ filter: /\.(compiletime|compile-time)\.(js|mjs|ts)$/i }, async (args) => {
        let importPath = args.path;
        if (args.path.endsWith('.ts')) {
            importPath = await buildScript(args.path, build.initialOptions, extraConfig);
        }

        // An absolute path is not an import specifier on Windows (`C:\...`): use a file URL
        let result = await import(pathToFileURL(importPath).href);
        let generatedJs = /*js*/`
            const result = ${JSON.stringify(result)};
        `;

        for (let key in result) {
            if (key === 'default') {
                generatedJs += `export default result.default;\n`;
            } else {
                generatedJs += `export const ${key} = result.${key};\n`;
            }
        }

        return ({
            contents: generatedJs,
            loader: 'js',
        });
    });
  },
});

// Inside the project, so packages the compiled script leaves external still resolve
let cacheDir = findCacheDir({
    name: 'esbuild-plugin-compile-time',
    create: true,
}) ?? fs.mkdtempSync(path.join(os.tmpdir(), 'esbuild-plugin-compile-time-'));

/**
 * If the compile time script is typescript, we use esbuild to compile it first
 *
 * The compiled module is named by its content: builds running at the same time
 * (or a parent build with `write: false`) do not share or clobber one file per
 * script name, same-named scripts in different folders do not collide, and an
 * edited script is imported afresh rather than from Node's module cache.
 *
 * @param {string} scriptPath path to the compile time script
 * @param {esbuild.BuildOptions} initialConfig esbuild config for the initial build
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling .ts to .js
 * @returns {Promise<string>} path of the compiled module
 */
async function buildScript(scriptPath, initialConfig, extraConfig) {
    let scriptNameParts = path.basename(scriptPath).split('.');
    scriptNameParts.pop();
    let scriptName = scriptNameParts.join('.');

    let result = await esbuild.build({
        // defaults
        target: 'es2017',
        format: 'esm',

        ...initialConfig,

        // exclude self from plugins to avoid cycle
		plugins: initialConfig.plugins?.filter(plugin => plugin.name !== pluginName),

        ...extraConfig,

        // required
        globalName: undefined,
        // names the output; nothing is written there
        outfile: path.join(path.dirname(scriptPath), `${scriptName}.mjs`),
        outdir: undefined,
        entryPoints: [scriptPath],
        platform: 'node',
        bundle: true,
        write: false,
    });

    let output = result.outputFiles.find(file => file.path.endsWith('.mjs'));
    if (output == null) {
        throw new Error(`${pluginName}: no output for ${scriptPath}`);
    }

    let hash = createHash('sha256').update(output.contents).digest('hex').slice(0, 16);
    let modulePath = path.join(cacheDir, `${scriptName}.${hash}.mjs`);
    if (!fs.existsSync(modulePath)) {
        // write then rename, so a concurrent build never imports a partial file
        let partial = `${modulePath}.${randomUUID()}.partial`;
        await fs.promises.writeFile(partial, output.contents);
        try {
            await fs.promises.rename(partial, modulePath);
        } catch (error) {
            // another build wrote the same content first
            await fs.promises.rm(partial, { force: true });
            if (!fs.existsSync(modulePath)) throw error;
        }
    }
    return modulePath;
}

export default compileTimePlugin;
