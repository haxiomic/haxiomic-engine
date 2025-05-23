// @ts-check

import esbuild from 'esbuild';
import findCacheDir from 'find-cache-dir';
import path from 'path';

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

        let result = await import(importPath);
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

let cacheDir = findCacheDir({
    name: 'esbuild-plugin-compile-time',
    create: true,
}) ?? path.resolve(__dirname, '.cache');

/**
 * If the compile time script is typescript, we use esbuild to compile it first
 * 
 * @param {string} workerPath path to the worker script
 * @param {esbuild.BuildOptions} initialConfig esbuild config for the initial build
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling .ts to .js
 */
async function buildScript(workerPath, initialConfig, extraConfig) {
    let scriptNameParts = path.basename(workerPath).split('.');
    scriptNameParts.pop();
    scriptNameParts.push('mjs');
    let scriptName = scriptNameParts.join('.');
    let bundlePath = path.resolve(cacheDir, scriptName);

    await esbuild.build({
        // defaults
        target: 'es2017',
        format: 'esm',

        ...initialConfig,

        // exclude self from plugins to avoid cycle
		plugins: initialConfig.plugins?.filter(plugin => plugin.name !== pluginName),

        ...extraConfig,

        // required
        globalName: undefined,
        outfile: bundlePath,
        outdir: undefined,
        entryPoints: [workerPath],
        platform: 'node',
        bundle: true,
    });

    return bundlePath;
}

export default compileTimePlugin;