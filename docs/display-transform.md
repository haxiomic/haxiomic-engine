# Display transform and premultiplied alpha

What three renders into a render target is **premultiplied**: NormalBlending over a transparent clear leaves `c · a`, and MSAA resolves average premultiplied samples. Tone mapping and the sRGB encode are non-linear, so applied to `c · a` they brighten every partially covered pixel: antialiased edges, translucent surfaces, a fading background drawn over a transparent canvas all read lighter than their colour. The transform has to see the surface colour `c`: un-premultiply, transform, premultiply again. A premultiplied canvas (three's default) then composites the result correctly over the page.

Do every blend, overlay and filter on linear premultiplied colour, and apply the display transform once, last.

## GLSL chunks

`rendering/DisplayTransform` exports two strings to compose into your own shaders. Each has an include guard.

- `premultipliedAlphaGlsl`
  - `float premultipliedCoverage(vec4 c)`: alpha clamped to [0, 1].
  - `vec3 unpremultiplyColor(vec4 c)`: the colour divided by its alpha, limited to 65504 (the half-float maximum) so a bright colour at a tiny alpha stays finite.
  - `vec3 premultiplyColor(vec3 transformed, vec4 c)`: a colour transformed from `unpremultiplyColor(c)`, multiplied by `c`'s alpha again.
- `displayTransformGlsl`, which includes the above:
  - `vec3 displayCurve(vec3 linear)`: three's `toneMapping()` (with exposure) when the program has a tone mapping, three's `linearToOutputTexel()` (the renderer's output colour space on the canvas, the target texture's colour space in a render target), then an optional grade.
  - `vec4 displayTransform(vec4 premultipliedLinear)`: un-premultiply, `displayCurve()`, premultiply.
  - `vec4 displayTransformEmissive(vec4 premultipliedLinear, vec3 emission)`: the same with light added that has no coverage of its own, such as bloom (see below).

```ts
import { displayTransformGlsl } from 'haxiomic-engine/rendering/DisplayTransform';

const present = new ShaderMaterial({
    uniforms: { scene: { value: sceneTarget.texture }, overlay: { value: overlayTarget.texture } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D scene;
        uniform sampler2D overlay;
        varying vec2 vUv;
        ${displayTransformGlsl}
        void main() {
            vec4 o = texture2D(overlay, vUv);
            // the over operator on premultiplied colour, in linear
            vec4 c = o + (1.0 - o.a) * texture2D(scene, vUv);
            gl_FragColor = displayTransform(c);
        }
    `,
});
Rendering.shaderMaterialPass(renderer, { shader: present, target: null, toneMapping: ACESFilmicToneMapping, restoreGlobalState: true });
```

A grade on the encoded colour: `#define DISPLAY_COLOR_GRADE` and declare `vec3 displayColorGrade(vec3 c)` before the chunk. A curve of your own: `premultiplyColor(curve(unpremultiplyColor(c)), c)`.

### Conventions

- **Opaque pixels are unchanged.** A pixel with alpha 1, or above 1, is transformed exactly as it would be without un-premultiplying.
- **Alpha 0 is used as it is.** A pixel with alpha 0 and colour is light without coverage, or data whose alpha channel is unused. The transform applies to its colour unscaled. As alpha shrinks towards 0 a colour of fixed brightness fades with it, so the result jumps at exactly 0; content whose colour and alpha fade together (blurred or antialiased) does not see it.
- **Alpha passes through.**
- **Not with `material.premultipliedAlpha = true`.** That setting makes three premultiply the shader's output itself; the materials below then transform the stored colour as it is, as before.

### Light without coverage

Light added over a pixel, such as bloom, is not part of the surface's coverage: a glow over a transparent area should still add light to what is behind it. Mixed into the premultiplied colour, it would be un-premultiplied with the surface and mostly disappear. Keep it separate as `E` (colour only) and use `displayTransformEmissive(premultiplied, E)`, which presents `a · D(c / a + E) + (1 − a) · D(E)`, where `D` is `displayCurve()`. Where alpha is 0 or at least 1 it equals the transform of `premultiplied.rgb + E`.

## Bloom accumulation

`rendering/BloomAccumulation` exports the mip chain bloom of `BloomMipmapsMaterial` as GLSL:

- `bloomAccumulationGlsl({ minLod, maxLod, falloff, smoothLevels?, name? })`: `vec4 <name>(sampler2D mipmapSource, vec2 vUv)` with the weights baked in, pairs of levels read with one trilinear fetch (needs `LinearMipmapLinearFilter`). Rebuild the shader when the range or falloff changes.
- `bloomAccumulationDynamicGlsl({ smoothLevels?, name? })`: `vec4 <name>(sampler2D mipmapSource, vec2 vUv, float firstLod, float endLod, float falloff)`.
- `bloomLodRange(texture, minLod)`: the level range for a chain built with `generateBlurredMipmaps()`.
- `bloomBSplineGlsl`: `sampleLevelBSpline()`, included by the above when `smoothLevels` is set. It is guarded, but a shader that already declares its own `sampleLevelBSpline` should not include it.

```ts
const { minLod, maxLod } = bloomLodRange(chainTarget.texture, 1);
const fragmentShader = `
    uniform sampler2D chain;
    varying vec2 vUv;
    ${bloomAccumulationGlsl({ minLod, maxLod, falloff: -0.138 })}
    ${displayTransformGlsl}
    void main() {
        vec4 bloom = bloomAccumulation(chain, vUv) * 0.05;
        gl_FragColor = displayTransformEmissive(texture2D(chain, vUv), bloom.rgb);
    }
`;
```

## Materials and passes

| | Premultiplied handling | Default |
|---|---|---|
| `BloomMipmapsMaterial` | tone mapping, encoding and the colour grade apply to un-premultiplied colour; the bloom is light without coverage (`displayTransformEmissive`) | on; `premultipliedSource: false` transforms the stored colour |
| `HdrOutputMaterial` | the tone curve and extended sRGB encode apply to un-premultiplied colour | on; `premultipliedSource: false` transforms the stored colour |
| `Rendering.blit` with `applyOutputColorSpace` or `toneMapping` | the transform applies to un-premultiplied colour | off; pass `premultipliedSource: true` |
| `Rendering.blit` without a transform (a raw copy) | none: values are copied exactly | — |
| `CopyMaterial` | as `blit` with a transform; coverage is read after the swizzle | off; `new CopyMaterial(swizzle, { premultipliedSource: true })` |

Where it is on, a pixel whose source alpha is 0, 1 or more comes out bit-identical to the transform of the stored colour, bloom included. Only partially transparent pixels change.
