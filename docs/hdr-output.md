# HDR canvas output

The engine provides two independent helpers:

- `HdrOutput` owns a renderer's drawing buffer and selects an HDR presentation route.
- `applyHdrToneMapping` extends an ACES or Khronos PBR Neutral final `ShaderMaterial` pass to a target peak, then encodes extended sRGB.

Both are opt-in. An unused/disabled controller changes no canvas state and attaches no listeners. The shader helper leaves a material unchanged until a supported HDR curve is requested.

```ts
import { HdrOutput } from 'haxiomic-engine/rendering/HdrOutput';
import { applyHdrToneMapping } from 'haxiomic-engine/rendering/HdrToneMapping';
import { ACESFilmicToneMapping, HalfFloatType, SRGBColorSpace } from 'three';

renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
const hdr = new HdrOutput(renderer, {
    enabled: true,
    headroom: 'auto',
    onChange: requestFrame,
    // Unsupported Chrome/macOS workaround: separate explicit opt-in.
    allowCompositorTrigger: false,
});

// Use HalfFloatType for scene and intermediate targets to preserve values > 1.
// Leave intermediate textures in linear working space. finalMaterial must
// output linear sRGB, with adjacent standard chunks at the end of main():
// #include <tonemapping_fragment>
// #include <colorspace_fragment>
function renderFrame() {
    // Resize first; update before drawing anything into the canvas.
    hdr.update();
    applyHdrToneMapping(finalMaterial, renderer.toneMapping, hdr.targetHeadroom);
    // Render your scene/postprocessing, ending in finalMaterial to the canvas.
}

// Disabling immediately restores the original drawing-buffer format.
// Update the shader before the next frame to select its SDR branch.
hdr.enabled = false;
hdr.dispose();
```

This is a presentation facility, not automatic HDR scene rendering. The engine's default `PhysicallyBasedViewer` render and three's ordinary material tone mapping still clamp highlights; custom render pipelines need an unclipped source and a final HDR pass. Call the shader helper with the actual tone mapping used by that pass. Apply it only to canvas output, not intermediate targets. Material changes after patching must retain the added declarations and output branch; cloning patched materials is unsupported.

## Presentation routes

| `route` | Mechanism | Support |
| --- | --- | --- |
| `official` | RGBA16F drawing buffer plus `drawingBufferToneMapping({mode: 'extended'})` | Feature-detected experimental WebGL API; Chrome's `WebGLToneMapping` flag enables the tested route |
| `compositor-trigger` | RGBA16F WebGL buffer plus a visible 4×4 black extended WebGPU canvas | Explicitly enabled, macOS only, HDR media query and WebGPU required; undocumented Chromium compositor behaviour |
| `sdr` | No usable HDR presentation route | Fallback; target headroom is 1 |

This feature does not establish HDR presentation support on Windows, Linux or other HDR panels. Successful float readback proves storage of values above 1, not display luminance. `route` reports configured APIs, not a measurement of the display. Verify physical HDR brightness on your target hardware.

The WebGPU trigger has a window-wide effect: other float canvases may also show unclamped values. Its canvas must be composited; hiding it with `display:none`, zero opacity or an occluding element can defeat the trigger. A browser update can remove this behaviour. Disabling/disposal removes the canvas, unconfigures its context and destroys its device. Device loss falls back to SDR; toggle HDR or the workaround to retry.

## Headroom and colour

`headroom` is `'auto'` or a finite number >= 1. Auto uses a guessed peak of 4 times SDR white while a route is configured and `(dynamic-range: high)` matches, otherwise 1. It does not measure panel capability. Set an explicit peak for your application or let the user adjust it. Moving between displays requests another frame and re-evaluates the route.

This first implementation supports extended sRGB only. `HdrOutput` fails closed if either three's output colour space or WebGL's drawing-buffer colour space changes away from sRGB. It deliberately leaves both colour-space settings alone. Rec.2020-linear and Display P3 need matching colour conversion and output shaders.

The shader helper supports `ACESFilmicToneMapping` and `NeutralToneMapping`. Other curves retain their ordinary three output. At headroom 1 it uses three's original shader chunks exactly. The HDR ACES extension blends the original fit into an extended shoulder; Neutral raises the compression peak. These are artistic extensions, not standardized HDR ACES transforms. The extension can change upper mid-tones and highlight colour. The original shadow and low-mid-tone behaviour is retained.

## Ownership and lifecycle

Use one active controller per renderer. A second active controller throws, including when multiple viewers share a renderer. Put the controller at the shared renderer owner and pass its headroom to each final pass. Dispose a controller before disposing its renderer. The controller assumes ownership of tone-mapping mode while enabled and restores `standard`; the experimental API exposes no prior mode getter. It restores the drawing-buffer format captured on activation.

Call `update()` after resizing and before the first canvas pass. It re-applies float storage if the renderer's resize reset it. WebGL context loss cancels pending trigger setup; restoration reconfigures on the next update. Unsupported or rejected APIs fall back to SDR. A float drawing buffer uses 8 bytes per pixel rather than RGBA8's 4, even if no presentation route is available.

## Demo and tests

```sh
npm run build
npm run test:demo
# Open http://localhost:5177/tests/hdr-output.html on an HDR display.
npm --prefix tests test -- hdr-output.spec.js
# Optional official-route readback test (macOS example):
HDR_CHROME_EXECUTABLE='/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' npm --prefix tests test -- hdr-output.spec.js
# Optional macOS Chrome Stable WebGPU-trigger integration test:
HDR_TEST_COMPOSITOR=1 npm --prefix tests test -- hdr-output.spec.js
```

The demo compares six scene levels with a fixed SDR-white bar. Enable HDR, then enable the compositor trigger only if you want to test the workaround. Browser tests use a forced HDR media query for deterministic code coverage; inspect real luminance by eye on an HDR screen.

References: [WebGL tone-mapping proposal](https://github.com/KhronosGroup/WebGL/pull/3668), [WebGL HDR explainer](https://github.com/ccameron-chromium/webgl-hdr/blob/master/EXPLAINER.md), [Chromium drawing buffer implementation](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/graphics/gpu/drawing_buffer.cc).
