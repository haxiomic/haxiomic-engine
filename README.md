# Haxiomic-Engine

A collection of useful code, mainly for 3D graphics with three.js

This is a typescript-only library

**Usage**

Install dependency
`npm install https://github.com/haxiomic/haxiomic-engine`

Build with esbuild. The library includes config to enable plugins: glsl import, inline workers and compile-time code execution


**build.mjs**
```js
#!/usr/bin/env node
// @ts-check
import { build } from 'esbuild';
import { buildConfig } from 'haxiomic-engine/esbuild/buildConfig.mjs';

// standalone viewer
await build({
    ...buildConfig,
    bundle: true,
    entryPoints: ['./src/main.ts'],
    outfile: 'dist/main.js'
});
```

Add `/// <reference types="haxiomic-engine" />` to your project so that .glsl and inline-worker! imports will pass type-check