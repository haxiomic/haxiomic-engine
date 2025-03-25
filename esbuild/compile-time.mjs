// @ts-check

import esbuild from 'esbuild';
import findCacheDir from 'find-cache-dir';
import path from 'path';

/**
 * @param {esbuild.BuildOptions} esbuildConfig esbuild config for compiling .ts to .js
 * @returns {esbuild.Plugin}
 */
const compileTimePlugin = (esbuildConfig = {}) => ({
  name: 'compile-time',
  setup(build) {

    build.onLoad({ filter: /\.(compiletime|compile-time)\.(js|mjs|ts)$/ }, async (args) => {
        let importPath = args.path;
        if (args.path.endsWith('.ts')) {
            importPath = await buildScript(args.path, esbuildConfig);
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
 */
async function buildScript(workerPath, extraConfig) {
    let scriptNameParts = path.basename(workerPath).split('.');
    scriptNameParts.pop();
    scriptNameParts.push('mjs');
    let scriptName = scriptNameParts.join('.');
    let bundlePath = path.resolve(cacheDir, scriptName);

    if (extraConfig) {
        delete extraConfig.entryPoints;
        delete extraConfig.outfile;
        delete extraConfig.outdir;
        delete extraConfig.workerName;
        delete extraConfig.platform;
    }

    await esbuild.build({
        entryPoints: [workerPath],
        platform: 'node',
        bundle: true,
        minify: false,
        outfile: bundlePath,
        target: 'es2017',
        format: 'esm',
        ...extraConfig,
    });

    return bundlePath;
}

export default compileTimePlugin;