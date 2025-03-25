// @ts-check

// adapted from https://github.com/mitschabaude/esbuild-plugin-inline-worker
import esbuild from 'esbuild';
import findCacheDir from 'find-cache-dir';
import fs from 'fs';
import path from 'path';

export {inlineWorkerPlugin as default};

/**
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling the worker .ts to .js
 * @returns {esbuild.Plugin}
 */
function inlineWorkerPlugin(extraConfig) {
	return {
		name: 'esbuild-plugin-inline-worker',
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
					let workerCode = await buildWorker(workerPath, extraConfig);
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

async function buildWorker(workerPath, extraConfig) {
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
	}

	await esbuild.build({
		entryPoints: [workerPath],
		bundle: true,
		minify: true,
		outfile: bundlePath,
		target: 'es2017',
		format: 'esm',
		...extraConfig,
	});

	return fs.promises.readFile(bundlePath, {encoding: 'utf-8'});
}