# Haxiomic-Engine

A collection of useful code, mainly for 3D graphics with three.js

**Usage**

Install dependency
`npm install https://github.com/haxiomic/haxiomic-engine`

Build with esbuild. The library includes config to enable plugins:
- glsl-import
- inline-workers 
- compile-time (executes code imported code at compile time)

**Building**
- `npm install`
- `npx tsc`

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