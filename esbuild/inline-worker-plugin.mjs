// @ts-check

// adapted from https://github.com/mitschabaude/esbuild-plugin-inline-worker
import esbuild from 'esbuild';
import findCacheDir from 'find-cache-dir';
import fs from 'fs';
import path from 'path';

export {inlineWorkerPlugin as default};

const pluginName = 'esbuild-plugin-inline-worker';

/**
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling the worker .ts to .js
 * @returns {esbuild.Plugin}
 */
function inlineWorkerPlugin(extraConfig = {}) {
	return {
		name: pluginName,
		/** @param {esbuild.PluginBuild} build */
		setup(build) {
			// handle resolving import 'inline-worker!*' and import '*.worker.js'
			// we also support worker-loader! prefix for compatibility with webpack
			build.onResolve({filter: /^worker-loader!|^inline-worker!|\.worker\.(js|jsx|ts|tsx)$/}, async args => {
				// remove loader prefix and mark the namespace so we can handle it in onLoad
				let filePath = args.path.replace(/^worker-loader!|^inline-worker!/, '');
				let resolved = await build.resolve(filePath, {
					importer: args.importer,
					kind: args.kind,
					namespace: args.namespace,
					resolveDir: args.resolveDir,
					with: args.with,
					pluginData: args.pluginData,
				});
				resolved.namespace = 'inline-loader';
				return resolved;
			});
			
			build.onLoad({
					filter: /.*/,
					namespace: 'inline-loader',
				},
				async ({path: workerPath}) => {
					console.log('inline-worker-plugin loading', workerPath);

					let workerCode = await buildWorker(workerPath, build.initialOptions, extraConfig);
					return {
						contents: `
							let scriptText = ${JSON.stringify(workerCode)};
							let blob = new Blob([scriptText], {type: 'text/javascript'});
							let url = URL.createObjectURL(blob);

							export default class InlineWorker extends (typeof Worker === "function" ? Worker : null) {
								constructor() {
									super(url);
								}
							}
						`,
						loader: 'js',
					};
				}
			);
		},
	};
}

let cacheDir = findCacheDir({
	name: 'esbuild-plugin-inline-worker',
	create: true,
}) ?? path.resolve(__dirname, '.cache');

/**
 * 
 * @param {string} workerPath path to the worker script
 * @param {esbuild.BuildOptions} initialConfig esbuild config for the initial build
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling .ts to .js
 * @returns 
 */
async function buildWorker(workerPath, initialConfig, extraConfig) {
	let scriptNameParts = path.basename(workerPath).split('.');
	scriptNameParts.pop();
	scriptNameParts.push('js');
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
		bundle: true,
		entryPoints: [workerPath],
		outfile: bundlePath,
		outdir: undefined,
	});

	return fs.promises.readFile(bundlePath, {encoding: 'utf-8'});
}