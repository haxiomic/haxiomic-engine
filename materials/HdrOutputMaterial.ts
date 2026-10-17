import { ACESFilmicToneMapping, DoubleSide, NeutralToneMapping, Texture, Uniform } from 'three';
import { hdrToneMappingGlsl } from '../rendering/HdrToneMapping.js';
import { ShaderMaterial } from './ShaderMaterial.js';

export type HdrToneMapping = typeof ACESFilmicToneMapping | typeof NeutralToneMapping;
export type HdrOutputMaterialOptions = {
    /** Unclipped linear-sRGB texture, normally from a HalfFloatType target. */
    source?: Texture | null;
    toneMapping?: HdrToneMapping;
    exposure?: number;
    headroom?: number;
};

/**
 * Explicit final canvas pass: linear sRGB texture -> tone curve -> extended sRGB.
 * Owns its tone mapping and exposure; renderer.toneMapping is not applied.
 * Set headroom from HdrOutput.targetHeadroom after updating the controller.
 * Use only with an sRGB canvas. At headroom 1 the curves match SDR ACES/Neutral.
 * Shader source stays fixed as settings change. Clone/copy use three's normal
 * uniform semantics; rebind render-target textures after cloning.
 */
export class HdrOutputMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>;
    exposure: Uniform<number>;
    headroom: Uniform<number>;
    toneCurve: Uniform<number>;
}> {
    constructor(options: HdrOutputMaterialOptions = {}) {
        super({
            uniforms: {
                source: new Uniform<Texture | null>(options.source ?? null),
                exposure: new Uniform(1),
                headroom: new Uniform(1),
                toneCurve: new Uniform(0),
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
                void main() {
                    vec4 pixel = texture2D(source, vUv);
                    vec3 linear = pixel.rgb * exposure;
                    vec3 mapped = toneCurve == 1
                        ? hdrNeutralToneMapping(linear, headroom)
                        : hdrAcesToneMapping(linear, headroom);
                    gl_FragColor = vec4(hdrLinearToSrgb(mapped), pixel.a);
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
