// @ts-check

// adapted from https://github.com/mitschabaude/esbuild-plugin-inline-worker
import esbuild from 'esbuild';
import path from 'path';

export {inlineWorkerPlugin as default};

const pluginName = 'esbuild-plugin-inline-worker';

/** Marks the plugin's own re-resolve of a worker path, so it is not handled again. */
const resolving = Symbol(pluginName);

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
				// A '*.worker.*' path still matches this filter after the prefix is
				// removed: our own resolve of it must fall through to the default
				// resolver, or this callback calls itself forever.
				if (args.pluginData?.[resolving]) return undefined;
				// remove loader prefix and mark the namespace so we can handle it in onLoad
				let filePath = args.path.replace(/^worker-loader!|^inline-worker!/, '');
				let resolved = await build.resolve(filePath, {
					importer: args.importer,
					kind: args.kind,
					namespace: args.namespace,
					resolveDir: args.resolveDir,
					with: args.with,
					pluginData: {...args.pluginData, [resolving]: true},
				});
				if (resolved.errors.length > 0) return {errors: resolved.errors, warnings: resolved.warnings};
				resolved.namespace = 'inline-loader';
				resolved.pluginData = args.pluginData;
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

/**
 * Bundle a worker in memory and return its code.
 *
 * The bundle is never written to disk: builds running at the same time (or a
 * parent build with `write: false`) would otherwise share, and read back, one
 * cache file per worker name.
 *
 * @param {string} workerPath path to the worker script
 * @param {esbuild.BuildOptions} initialConfig esbuild config for the initial build
 * @param {esbuild.BuildOptions} extraConfig esbuild config for compiling .ts to .js
 * @returns {Promise<string>}
 */
async function buildWorker(workerPath, initialConfig, extraConfig) {
	let scriptNameParts = path.basename(workerPath).split('.');
	scriptNameParts.pop();
	scriptNameParts.push('js');
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
		bundle: true,
		entryPoints: [workerPath],
		// names the output (and any source map); nothing is written there
		outfile: path.join(path.dirname(workerPath), scriptName),
		outdir: undefined,
		write: false,
	});

	let output = result.outputFiles.find(file => file.path.endsWith('.js'));
	if (output == null) {
		throw new Error(`${pluginName}: no JavaScript output for ${workerPath}`);
	}
	return output.text;
}
