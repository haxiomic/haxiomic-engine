/**
 * GLSL for presenting premultiplied linear colour: the display transform and the alpha handling it needs.
 *
 * What three renders into a render target is premultiplied: NormalBlending over a transparent clear leaves `c · a`,
 * and MSAA resolves average premultiplied samples. Tone mapping and the sRGB encode are non-linear, so applied to
 * `c · a` they brighten every partially covered pixel (antialiased edges, translucent surfaces, a fading background).
 * They have to see the surface colour `c`: un-premultiply, transform, premultiply again. A premultiplied canvas (three's
 * default) then composites the result correctly over the page.
 *
 * The conventions, shared by everything here:
 * - coverage is alpha clamped to [0, 1], so alpha above 1 (bloom adds blurred alpha) counts as opaque and an opaque
 *   pixel transforms exactly as it did without any of this;
 * - where alpha is 0 the colour is used as it is: it is light without coverage, or data whose alpha channel is unused,
 *   and the transform applies to it unscaled;
 * - alpha itself passes through unchanged.
 *
 * Compose into your own shaders:
 *
 * ```ts
 * const material = new ShaderMaterial({
 *     uniforms: { scene: { value: target.texture } },
 *     vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
 *     fragmentShader: `
 *         uniform sampler2D scene;
 *         varying vec2 vUv;
 *         ${displayTransformGlsl}
 *         void main() { gl_FragColor = displayTransform(texture2D(scene, vUv)); }
 *     `,
 * })
 * ```
 *
 * Each chunk has an include guard, so composing several is safe.
 */

/**
 * GLSL helpers for transforming premultiplied colour:
 * - `float premultipliedCoverage(vec4 c)`: alpha clamped to [0, 1];
 * - `vec3 unpremultiplyColor(vec4 c)`: the colour divided by its coverage; unchanged where coverage is 0;
 * - `vec3 premultiplyColor(vec3 transformed, vec4 c)`: multiply a colour transformed from `unpremultiplyColor(c)` by
 *   `c`'s coverage again; unchanged where coverage is 0.
 *
 * For a curve of your own: `premultiplyColor(curve(unpremultiplyColor(c)), c)`.
 */
export const premultipliedAlphaGlsl = /*glsl*/`
#ifndef PREMULTIPLIED_ALPHA_GLSL
#define PREMULTIPLIED_ALPHA_GLSL
float premultipliedCoverage(vec4 c) {
    return clamp(c.a, 0.0, 1.0);
}
vec3 unpremultiplyColor(vec4 c) {
    float a = premultipliedCoverage(c);
    return a > 0.0 ? c.rgb / a : c.rgb;
}
vec3 premultiplyColor(vec3 transformed, vec4 c) {
    float a = premultipliedCoverage(c);
    return a > 0.0 ? transformed * a : transformed;
}
#endif
`;

/**
 * GLSL: `vec4 displayTransform(vec4 premultipliedLinear)`: un-premultiply, tone map, encode, premultiply.
 *
 * - Tone mapping is three's `toneMapping()`, with its exposure, present when the program has a tone mapping
 *   (`TONE_MAPPING` defined): a `ShaderMaterial` with `toneMapped: true` drawn to the canvas while
 *   `renderer.toneMapping` is set, or a pass given `toneMapping` (as `Rendering.shaderMaterialPass` does).
 * - The encode is three's `linearToOutputTexel()`: the renderer's output colour space on the canvas, linear into a
 *   render target.
 * - A colour grade on the encoded colour: define `DISPLAY_COLOR_GRADE` and declare `vec3 displayColorGrade(vec3)`
 *   before this chunk.
 *
 * Call it once per pixel, last, after every layer has been composited in linear premultiplied.
 */
export const displayTransformGlsl = /*glsl*/`
${premultipliedAlphaGlsl}
#ifndef DISPLAY_TRANSFORM_GLSL
#define DISPLAY_TRANSFORM_GLSL
vec4 displayTransform(vec4 premultipliedLinear) {
    vec3 c = unpremultiplyColor(premultipliedLinear);
    #ifdef TONE_MAPPING
    c = toneMapping(c);
    #endif
    c = linearToOutputTexel(vec4(c, 1.0)).rgb;
    #ifdef DISPLAY_COLOR_GRADE
    c = displayColorGrade(c);
    #endif
    return vec4(premultiplyColor(c, premultipliedLinear), premultipliedLinear.a);
}
#endif
`;
