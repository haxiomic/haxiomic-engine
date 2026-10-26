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
 * - coverage is alpha clamped to [0, 1], and a pixel with alpha 1 or more (bloom adds blurred alpha) is opaque: it is
 *   transformed exactly as it would be without any of this;
 * - where alpha is 0 the colour is used as it is: it is light without coverage, or data whose alpha channel is unused,
 *   and the transform applies to it unscaled. A colour at a small alpha fades to 0 as alpha does, so the result jumps at
 *   exactly 0 for colour that keeps its brightness while its alpha vanishes; blurred content fades both together;
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
 * - `vec3 unpremultiplyColor(vec4 c)`: the colour divided by its coverage, limited to 65504 (the half-float maximum) so
 *   a bright colour at a tiny alpha stays finite; unchanged where alpha is 0 or at least 1;
 * - `vec3 premultiplyColor(vec3 transformed, vec4 c)`: multiply a colour transformed from `unpremultiplyColor(c)` by
 *   `c`'s coverage again; unchanged where alpha is 0 or at least 1.
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
    return c.a >= 1.0 || c.a <= 0.0 ? c.rgb : min(c.rgb / c.a, vec3(65504.0));
}
vec3 premultiplyColor(vec3 transformed, vec4 c) {
    return c.a >= 1.0 || c.a <= 0.0 ? transformed : transformed * c.a;
}
#endif
`;

/**
 * GLSL, building on `premultipliedAlphaGlsl`:
 * - `vec3 displayCurve(vec3 linear)`: tone map, encode and grade one straight colour;
 * - `vec4 displayTransform(vec4 premultipliedLinear)`: un-premultiply, `displayCurve()`, premultiply;
 * - `vec4 displayTransformEmissive(vec4 premultipliedLinear, vec3 emission)`: the same with light added that has no
 *   coverage of its own, such as bloom: `a · D(c / a + E) + (1 − a) · D(E)`, so a glow over a transparent or
 *   translucent area stays visible. Where alpha is 0 or at least 1 it equals `displayTransform()` of the colour plus
 *   the emission, at the original alpha.
 *
 * The curve:
 * - tone mapping is three's `toneMapping()`, with its exposure, present when the program has a tone mapping
 *   (`TONE_MAPPING` defined): a `ShaderMaterial` with `toneMapped: true` drawn to the canvas while
 *   `renderer.toneMapping` is set, or a pass given `toneMapping` (as `Rendering.shaderMaterialPass` does);
 * - the encode is three's `linearToOutputTexel()`: the renderer's output colour space on the canvas, the target
 *   texture's colour space in a render target;
 * - a colour grade on the encoded colour: define `DISPLAY_COLOR_GRADE` and declare `vec3 displayColorGrade(vec3)`
 *   before this chunk.
 *
 * Call it once per pixel, last, after every layer has been composited in linear premultiplied.
 */
export const displayTransformGlsl = /*glsl*/`
${premultipliedAlphaGlsl}
#ifndef DISPLAY_TRANSFORM_GLSL
#define DISPLAY_TRANSFORM_GLSL
vec3 displayCurve(vec3 c) {
    #ifdef TONE_MAPPING
    c = toneMapping(c);
    #endif
    c = linearToOutputTexel(vec4(c, 1.0)).rgb;
    #ifdef DISPLAY_COLOR_GRADE
    c = displayColorGrade(c);
    #endif
    return c;
}
vec4 displayTransform(vec4 premultipliedLinear) {
    vec3 c = displayCurve(unpremultiplyColor(premultipliedLinear));
    return vec4(premultiplyColor(c, premultipliedLinear), premultipliedLinear.a);
}
vec4 displayTransformEmissive(vec4 premultipliedLinear, vec3 emission) {
    float a = premultipliedLinear.a;
    if (a >= 1.0 || a <= 0.0) {
        return vec4(displayCurve(premultipliedLinear.rgb + emission), a);
    }
    vec3 surface = displayCurve(unpremultiplyColor(premultipliedLinear) + emission);
    return vec4(a * surface + (1.0 - a) * displayCurve(emission), a);
}
#endif
`;
