import esbuild from 'esbuild';
import findCacheDir from 'find-cache-dir';
import path from 'path';

/**
 * @param {*} esbuildConfig esbuild config for compiling .ts to .js
 */
const compileTimePlugin = (esbuildConfig = {}) => ({
  name: 'compile-time',
  setup(build) {

    // handle resolving import 'inline-worker!*' and import '*.worker.js'
    // we also support worker-loader! prefix for compatibility with webpack
    build.onResolve({filter: /\.(compiletime|compile-time)\.(js|mjs|ts)$/}, args => {
        // remove loader prefix and mark the namespace so we can handle it in onLoad
        let resolveDir = args.resolveDir ?? path.dirname(args.importer);
        return {
            path: path.isAbsolute(args.path) ? args.path : path.join(resolveDir, args.path),
            namespace: 'compile-time',
        }
    });

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
});

/**
 * If the compile time script is typescript, we use esbuild to compile it first
 */
async function buildScript(workerPath, extraConfig) {
    let scriptNameParts = path.basename(workerPath).split('.');
    scriptNameParts.pop();
    scriptNameParts.push('js');
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