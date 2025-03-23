// @ts-check

import * as esbuild from 'esbuild';
import glslPlugin from './glsl-minify-plugin.mjs';
import inlineWorkerPlugin from './inline-worker-plugin.mjs';
import compileTimePlugin from './compile-time.mjs';

/**
 * Build with glsl, compile-time and inline worker plugins
 * 
 * @param {import('esbuild').BuildOptions & { devMode?: boolean }} buildOptions 
 * @returns 
 */
export function build({ devMode, ...buildOptions }) {
    const enableMinify = !devMode;

    /** @type {esbuild.BuildOptions} */
    const commonSettings = {
      minify: enableMinify,
      define: {
        Defines: JSON.stringify({
          DEBUG: devMode,
        }),
      },
      plugins: [
        glslPlugin({ minify: false }),
        compileTimePlugin(),
      ],
      // alias our fork of three (@haxiomic/three-dev) to 'three'
      alias: {
        'three': 'three',
      },
      platform: 'browser',
    };

    // Add inline worker plugin
    // we do this after so we can use same settings for compiling inline workers
    commonSettings.plugins?.push(inlineWorkerPlugin({
      ...commonSettings,
      plugins: [...commonSettings.plugins], // avoid cycles
    }));

    return esbuild.build({
        ...commonSettings,
        ...buildOptions,
    });
}