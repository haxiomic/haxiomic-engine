# Display transform and premultiplied alpha

What three renders into a render target is **premultiplied**: NormalBlending over a transparent clear leaves `c · a`, and MSAA resolves average premultiplied samples. Tone mapping and the sRGB encode are non-linear, so applied to `c · a` they brighten every partially covered pixel: antialiased edges, translucent surfaces, a fading background drawn over a transparent canvas all read lighter than their colour. The transform has to see the surface colour `c`: un-premultiply, transform, premultiply again. A premultiplied canvas (three's default) then composites the result correctly over the page.

Do every blend, overlay and filter on linear premultiplied colour, and apply the display transform once, last.

## GLSL chunks

`rendering/DisplayTransform` exports two strings to compose into your own shaders. Each has an include guard.

- `premultipliedAlphaGlsl`
  - `float premultipliedCoverage(vec4 c)`: alpha clamped to [0, 1].
  - `vec3 unpremultiplyColor(vec4 c)`: the colour divided by its coverage.
  - `vec3 premultiplyColor(vec3 transformed, vec4 c)`: a colour transformed from `unpremultiplyColor(c)`, multiplied by `c`'s coverage again.
- `displayTransformGlsl`: `vec4 displayTransform(vec4 premultipliedLinear)`, which un-premultiplies, applies three's `toneMapping()` (with exposure) when the program has a tone mapping, encodes with three's `linearToOutputTexel()`, optionally applies a grade, and premultiplies.

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

- **Opaque pixels are unchanged.** Coverage is alpha clamped to [0, 1], so a pixel with alpha 1, or above 1 (bloom adds blurred alpha), divides and multiplies by exactly 1.
- **Alpha 0 is used as it is.** A pixel with alpha 0 and colour is light without coverage, or data whose alpha channel is unused. The transform applies to its colour unscaled, as it would without un-premultiplying.
- **Alpha passes through.**

### Not representable

Light over partial coverage (a glow over a translucent edge) cannot be told apart from the surface colour in a single premultiplied value; un-premultiplying treats all of it as surface. To keep it, carry the emission `E` separately (colour only) and present `a · D(c / a + E) + (1 − a) · D(E)`, where `D` is the transform without the premultiply.

## Bloom accumulation

`rendering/BloomAccumulation` exports the mip chain bloom of `BloomMipmapsMaterial` as GLSL:

- `bloomAccumulationGlsl({ minLod, maxLod, falloff, smoothLevels?, name? })`: `vec4 <name>(sampler2D mipmapSource, vec2 vUv)` with the weights baked in, pairs of levels read with one trilinear fetch (needs `LinearMipmapLinearFilter`). Rebuild the shader when the range or falloff changes.
- `bloomAccumulationDynamicGlsl({ smoothLevels?, name? })`: `vec4 <name>(sampler2D mipmapSource, vec2 vUv, float firstLod, float endLod, float falloff)`.
- `bloomLodRange(texture, minLod)`: the level range for a chain built with `generateBlurredMipmaps()`.

```ts
const { minLod, maxLod } = bloomLodRange(chainTarget.texture, 1);
const fragmentShader = `
    uniform sampler2D chain;
    varying vec2 vUv;
    ${bloomAccumulationGlsl({ minLod, maxLod, falloff: -0.138 })}
    ${displayTransformGlsl}
    void main() {
        gl_FragColor = displayTransform(texture2D(chain, vUv) + bloomAccumulation(chain, vUv) * 0.05);
    }
`;
```

## Materials and passes

| | Premultiplied handling | Default |
|---|---|---|
| `BloomMipmapsMaterial` | tone mapping, encoding and the colour grade apply to un-premultiplied colour | on; `premultipliedSource: false` transforms the stored colour |
| `HdrOutputMaterial` | the tone curve and extended sRGB encode apply to un-premultiplied colour | on; `premultipliedSource: false` transforms the stored colour |
| `Rendering.blit` with `applyOutputColorSpace` or `toneMapping` | the transform applies to un-premultiplied colour | off; pass `premultipliedSource: true` |
| `Rendering.blit` without a transform (a raw copy) | none: values are copied exactly | — |
| `CopyMaterial` | as `blit` with a transform | off; `new CopyMaterial(swizzle, { premultipliedSource: true })` |

Where it is on, a pixel whose alpha (for bloom, after the bloom term is added) is 0, 1 or more comes out bit-identical to the transform of the stored colour. Only partially transparent pixels change.
