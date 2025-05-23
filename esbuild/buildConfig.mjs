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
    inlineWorkerPlugin({})
  ],
};