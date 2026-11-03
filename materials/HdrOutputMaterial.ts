import { ACESFilmicToneMapping, DoubleSide, NeutralToneMapping, Texture, Uniform } from 'three';
import { premultipliedAlphaGlsl } from '../rendering/DisplayTransform.js';
import { hdrToneMappingGlsl } from '../rendering/HdrToneMapping.js';
import { ShaderMaterial } from './ShaderMaterial.js';

export type HdrToneMapping = typeof ACESFilmicToneMapping | typeof NeutralToneMapping;
export type HdrOutputMaterialOptions = {
    /** Unclipped linear-sRGB texture, normally from a HalfFloatType target. */
    source?: Texture | null;
    toneMapping?: HdrToneMapping;
    exposure?: number;
    headroom?: number;
    /**
     * The source holds premultiplied alpha, as three's render targets do: the curve and encoding apply to
     * un-premultiplied colour, premultiplied again after. Opaque pixels and pixels with alpha 0 are unaffected.
     * `false` transforms the stored colour as it is, as does `material.premultipliedAlpha = true` (three then
     * premultiplies the output). Construction only. @default true
     */
    premultipliedSource?: boolean;
};

/**
 * Explicit final canvas pass: linear sRGB texture -> tone curve -> extended sRGB.
 * Owns its tone mapping and exposure; renderer.toneMapping is not applied.
 * Set headroom from HdrOutput.targetHeadroom after updating the controller.
 * Use only with an sRGB canvas. At headroom 1 the curves match SDR ACES/Neutral.
 * Shader source stays fixed as settings change. Clone/copy use three's normal
 * uniform semantics; rebind render-target textures after cloning.
 * Partially transparent pixels are transformed un-premultiplied (see `premultipliedSource`).
 */
export class HdrOutputMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>;
    exposure: Uniform<number>;
    headroom: Uniform<number>;
    toneCurve: Uniform<number>;
}> {
    /** Whether the curve and encoding apply to un-premultiplied colour (constructor option) */
    get premultipliedSource(): boolean { return this.defines.PREMULTIPLIED_SOURCE === 1; }

    constructor(options: HdrOutputMaterialOptions = {}) {
        const premultipliedSource = options.premultipliedSource ?? true;
        super({
            uniforms: {
                source: new Uniform<Texture | null>(options.source ?? null),
                exposure: new Uniform(1),
                headroom: new Uniform(1),
                toneCurve: new Uniform(0),
            },
            defines: {
                PREMULTIPLIED_SOURCE: premultipliedSource ? 1 : 0,
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = position.xy * 0.5 + 0.5;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D source;
                uniform float exposure;
                uniform float headroom;
                uniform int toneCurve;
                varying vec2 vUv;
                ${hdrToneMappingGlsl}
                ${premultipliedAlphaGlsl}
                void main() {
                    vec4 pixel = texture2D(source, vUv);
                    #if PREMULTIPLIED_SOURCE && !defined( PREMULTIPLIED_ALPHA )
                    vec3 linear = unpremultiplyColor(pixel) * exposure;
                    #else
                    vec3 linear = pixel.rgb * exposure;
                    #endif
                    vec3 mapped = toneCurve == 1
                        ? hdrNeutralToneMapping(linear, headroom)
                        : hdrAcesToneMapping(linear, headroom);
                    vec3 encoded = hdrLinearToSrgb(mapped);
                    #if PREMULTIPLIED_SOURCE && !defined( PREMULTIPLIED_ALPHA )
                    encoded = premultiplyColor(encoded, pixel);
                    #endif
                    gl_FragColor = vec4(encoded, pixel.a);
                }
            `,
            toneMapped: false,
            side: DoubleSide,
            depthWrite: false,
            depthTest: false,
        });
        this.toneMapping = options.toneMapping ?? ACESFilmicToneMapping;
        this.exposure = options.exposure ?? 1;
        this.headroom = options.headroom ?? 1;
    }

    get source(): Texture | null { return this.uniforms.source.value; }
    set source(value: Texture | null) { this.uniforms.source.value = value; }

    get toneMapping(): HdrToneMapping {
        return this.uniforms.toneCurve.value === 1 ? NeutralToneMapping : ACESFilmicToneMapping;
    }
    set toneMapping(value: HdrToneMapping) {
        if (value !== ACESFilmicToneMapping && value !== NeutralToneMapping) {
            throw new RangeError('HDR output supports ACES or Neutral tone mapping');
        }
        this.uniforms.toneCurve.value = value === NeutralToneMapping ? 1 : 0;
    }

    get exposure(): number { return this.uniforms.exposure.value; }
    set exposure(value: number) {
        if (!Number.isFinite(value) || value < 0) throw new RangeError('Exposure must be finite and nonnegative');
        this.uniforms.exposure.value = value;
    }

    get headroom(): number { return this.uniforms.headroom.value; }
    set headroom(value: number) {
        if (!Number.isFinite(value) || value < 1) throw new RangeError('HDR headroom must be finite and at least 1');
        this.uniforms.headroom.value = value;
    }
}
