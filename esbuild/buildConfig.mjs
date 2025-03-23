// @ts-check

import * as esbuild from 'esbuild';
import glslPlugin from './glsl-minify-plugin.mjs';
import inlineWorkerPlugin from './inline-worker-plugin.mjs';
import compileTimePlugin from './compile-time.mjs';

/** @type {esbuild.BuildOptions} */
export const buildConfig = {
  plugins: [
    glslPlugin({ minify: false }),
    compileTimePlugin(),
  ],
  // alias our fork of three (@haxiomic/three-dev) to 'three'
  alias: {
    'three': 'three',
  },
};

// Add inline worker plugin
// we do this after so we can use same settings for compiling inline workers
buildConfig.plugins?.push(inlineWorkerPlugin({
  ...buildConfig,
  plugins: [...buildConfig.plugins], // avoid cycles
}));