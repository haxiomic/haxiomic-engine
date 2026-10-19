import { Texture, Uniform, Vector2, Vector4, WebGLRenderer } from "three";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";

/**
 * Internal to the pyramid blur (`PyramidGaussianBlur.ts`), bloom (`PyramidBloom.ts`) and anti-aliased mip chain
 * (`BlurredMipmapChain.ts`): shared shaders and planning. Not a stable API.
 *
 * Variances (in texel² of the level the filter runs at):
 * - [1,3,3,1]/8 downsample: 0.75 fine texels² per axis
 * - [1,5,10,10,5,1]/32 downsample: 1.25 fine texels² per axis
 * - cubic B-spline reconstruction: 1/3 coarse texels²
 */

export type PyramidDownsampleFilter = 'box' | 'binomial4' | 'binomial6';
export type PyramidUpsampleFilter = 'bilinear' | 'bspline';

/** Pyramid shape options (the defaults are the tuned design; other values are for experiments) */
export type PyramidTuning = {
	/** see `PyramidGaussianBlurOptions.minCoreSigma` @default 3 */
	minCoreSigma?: number,
	/** @default 'binomial4' */
	downsampleFilter?: PyramidDownsampleFilter,
	/** Filter used for the final downsample into the core level (it dominates aliasing). @default same as downsampleFilter */
	lastDownsampleFilter?: PyramidDownsampleFilter,
	/** @default 'bspline' */
	upsampleFilter?: PyramidUpsampleFilter,
	/** Force a specific pyramid depth */
	forceLevel?: number,
}

export const downsampleVariance: Record<PyramidDownsampleFilter, number> = {
	// 2x2 box: [1,1]/2 per axis → variance 0.25 fine texels²
	box: 0.25,
	binomial4: 0.75,
	binomial6: 1.25,
};

export const upsampleVariance: Record<PyramidUpsampleFilter, number> = {
	// tent: 1/6 coarse texels², cubic B-spline: 1/3
	bilinear: 1 / 6,
	bspline: 1 / 3,
};

export type PyramidPlan = {
	level: number,
	/** σ of the separable Gaussian run at `level`, in texels of that level */
	coreSigma: number,
	/** Number of downsample passes performed with each filter */
	downsampleFilters: PyramidDownsampleFilter[],
	upsampleFilter: PyramidUpsampleFilter,
}

/**
 * Determine pyramid depth and core σ for a target σ (in source pixels)
 */
export function planPyramidBlur(sigma: number, options: PyramidTuning = {}): PyramidPlan {
	const minCoreSigma = options.minCoreSigma ?? 3;
	const downsampleFilter = options.downsampleFilter ?? 'binomial4';
	const lastDownsampleFilter = options.lastDownsampleFilter ?? downsampleFilter;
	const upsampleFilter = options.upsampleFilter ?? 'bspline';

	const levelVariance = (level: number) => {
		// accumulated variance in level-`level` texels² of downsample chain + reconstruction
		if (level === 0) return 0;
		let v = 0;
		for (let j = 1; j <= level; j++) {
			const filter = j === level ? lastDownsampleFilter : downsampleFilter;
			// variance in fine texels of level j-1, converted to level `level` texels
			v += downsampleVariance[filter] * Math.pow(4, j - 1 - level);
		}
		return v + upsampleVariance[upsampleFilter];
	}

	let level = options.forceLevel ?? Math.max(0, Math.floor(Math.log2(Math.max(sigma, 1e-6) / minCoreSigma)));
	// ensure positive core variance (only relevant when forcing a level or for tiny minCoreSigma)
	while (level > 0 && Math.pow(sigma / Math.pow(2, level), 2) - levelVariance(level) <= 0.25) {
		level--;
	}

	const scale = Math.pow(2, level);
	const coreVariance = Math.pow(sigma / scale, 2) - levelVariance(level);
	const coreSigma = Math.sqrt(Math.max(coreVariance, 0));

	const downsampleFilters: PyramidDownsampleFilter[] = [];
	for (let j = 1; j <= level; j++) {
		downsampleFilters.push(j === level ? lastDownsampleFilter : downsampleFilter);
	}

	return { level, coreSigma, downsampleFilters, upsampleFilter };
}

/**
 * Snapshot render target, mip level, cube face & viewport, returning a function that restores them. (Like engine
 * `gaussianBlur`, which restores state after each pass, but without overwriting a caller's `Rendering.saveGlobalState`.)
 */
export function snapshotRendererState(renderer: WebGLRenderer) {
	const target = renderer.getRenderTarget();
	const cubeFace = renderer.getActiveCubeFace();
	const mipmapLevel = renderer.getActiveMipmapLevel();
	const viewport = renderer.getViewport(new Vector4());
	return () => {
		renderer.setRenderTarget(target, cubeFace, mipmapLevel);
		renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
	};
}

/**
 * Core taps are merged into bilinear fetches only at full resolution. (Merging at level 1 saves ~0.03 ms at 1080p but
 * raises worst-case shift variance from ~0.12% to ~0.6% of peak.)
 */
export function defaultCoreLinearSampling(level: number) {
	return level === 0;
}

export function getTextureSize(texture: Texture) {
	const image = texture.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
	const sourceData = texture.source.data as { width?: number; height?: number };
	return {
		width: (image.width ?? sourceData.width ?? image.videoWidth!) as number,
		height: (image.height ?? sourceData.height ?? image.videoHeight!) as number,
	};
}

export const fullscreenVertexShader = /*glsl*/`
	void main() {
		gl_Position = vec4(position, 1.0);
	}
`;

/**
 * GLSL for the 'normalize' border mode: zero outside the image, and the blur of the image's inside-mask
 * M(p) = ∫ G_σ over [0, size], a product of erf terms per axis. Dividing a zero-extended blur by M is normalized
 * convolution: the blur only averages pixels inside the image.
 */
export const borderGLSL = /*glsl*/`
	// 1 inside [0, size) (texel units), 0 outside
	float insideTexels(vec2 t, vec2 size) {
		return float(all(greaterThanEqual(t, vec2(0.0))) && all(lessThan(t, size)));
	}
	vec2 erf2(vec2 x) {
		// Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
		vec2 s = sign(x);
		x = abs(x);
		vec2 k = 1.0 / (1.0 + 0.3275911 * x);
		vec2 y = 1.0 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * exp(-x * x);
		return s * y;
	}
	// fraction of a normalized Gaussian of σ (px) centred at p (px) that lies inside the image [0, size] (px)
	float insideMaskBlur(vec2 p, vec2 size, float sigma) {
		float k = 1.0 / (sigma * 1.41421356);
		vec2 m = 0.5 * (erf2((size - p) * k) + erf2(p * k));
		return max(m.x * m.y, 1e-6);
	}
`;

/** Core Gaussian truncation in σ, see `PyramidGaussianBlurOptions.coreTruncation` */
export const DEFAULT_CORE_TRUNCATION = 5;

/** Texels of padding around each pyramid level (clamp-to-edge only), see `pyramidGaussianBlur()` */
export const LEVEL_PADDING = 3;

/** How reads beyond the source are wrapped: 'clamp' leaves it to the sampler; the others wrap texel indices */
export type WrapMode = 'clamp' | 'repeat' | 'mirror';

/**
 * GLSL `wrapTexel(t, size)`: texel-centre coordinate of texel floor(t) after wrapping its index into [0, size), as
 * RepeatWrapping / MirroredRepeatWrapping do (mirror duplicates the edge texel: -1 → 0)
 */
function wrapGLSL(wrap: WrapMode) {
	if (wrap === 'repeat') return /*glsl*/`
		vec2 wrapTexel(vec2 t, vec2 size) { return mod(floor(t), size) + 0.5; }
	`;
	if (wrap === 'mirror') return /*glsl*/`
		vec2 wrapTexel(vec2 t, vec2 size) {
			vec2 m = mod(floor(t), 2.0 * size);
			return mix(m, 2.0 * size - 1.0 - m, step(size, m)) + 0.5;
		}
	`;
	return '';
}

/**
 * Cubic B-spline sampling with 4 bilinear taps (Sigg & Hadwiger 2005). `p` is in texel units (texel i has its center
 * at i + 0.5)
 */
export const bsplineGLSL = /*glsl*/`
	vec4 sampleBSpline(sampler2D tex, vec2 p, vec2 invSize) {
		vec2 tc = p - 0.5;
		vec2 base = floor(tc);
		vec2 f = tc - base;
		vec2 f2 = f * f;
		vec2 f3 = f2 * f;
		vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
		vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
		vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
		vec2 w3 = f3 / 6.0;
		vec2 g0 = w0 + w1;
		vec2 g1 = w2 + w3;
		vec2 h0 = (base - 0.5 + w1 / g0) * invSize;
		vec2 h1 = (base + 1.5 + w3 / g1) * invSize;
		return
			g0.y * (g0.x * textureLod(tex, vec2(h0.x, h0.y), 0.0) + g1.x * textureLod(tex, vec2(h1.x, h0.y), 0.0)) +
			g1.y * (g0.x * textureLod(tex, vec2(h0.x, h1.y), 0.0) + g1.x * textureLod(tex, vec2(h1.x, h1.y), 0.0));
	}
`;

/**
 * The [1,3,3,1]/8 downsample of `DownsampleMaterial` ('binomial4', unpadded, clamped) as a GLSL function of the output
 * fragment: the same four bilinear taps, in the same order
 */
export const binomialDownsampleGLSL = /*glsl*/`
	vec4 binomialDownsample(sampler2D source, vec2 sourceInvSize) {
		vec2 c = gl_FragCoord.xy * 2.0;
		vec4 result = vec4(0.0);
		result += textureLod(source, (c + vec2(-0.75, -0.75)) * sourceInvSize, 0.0) * 0.25;
		result += textureLod(source, (c + vec2(0.75, -0.75)) * sourceInvSize, 0.0) * 0.25;
		result += textureLod(source, (c + vec2(-0.75, 0.75)) * sourceInvSize, 0.0) * 0.25;
		result += textureLod(source, (c + vec2(0.75, 0.75)) * sourceInvSize, 0.0) * 0.25;
		return result;
	}
`;

export class DownsampleMaterial extends ShaderMaterial<{
	source: Uniform<Texture | null>,
	sourceInvSize: Uniform<Vector2>,
	sourceOffset: Uniform<number>,
	/** source size in texels, used when reading outside the source as zero */
	sourceSize: Uniform<Vector2>,
}> {

	static instances = new Map<string, DownsampleMaterial>();

	/**
	 * @param flags.zeroOutside read outside the source as zero (first downsample of the 'normalize' border mode)
	 * @param flags.wrap read outside the source with wrapped texel indices (first downsample with repeat / mirror)
	 */
	static get(filter: PyramidDownsampleFilter, flags: { zeroOutside?: boolean, wrap?: WrapMode } = {}) {
		const zeroOutside = !!flags.zeroOutside, wrap = flags.wrap ?? 'clamp';
		const key = `${filter}_${zeroOutside}_${wrap}`;
		let instance = DownsampleMaterial.instances.get(key);
		if (!instance) {
			instance = new DownsampleMaterial(filter, zeroOutside, wrap);
			DownsampleMaterial.instances.set(key, instance);
		}
		return instance;
	}

	constructor(filter: PyramidDownsampleFilter, zeroOutside: boolean, wrap: WrapMode) {
		if ((zeroOutside || wrap !== 'clamp') && filter !== 'binomial4') {
			throw new Error(`DownsampleMaterial: zero-outside and wrapped reads are only implemented for 'binomial4'`);
		}
		// output texel center in fine texel units is 2 * gl_FragCoord.xy (the corner shared by 4 fine texels)
		// sample positions & weights per axis, using bilinear filtering to merge adjacent taps
		const taps1D: [number, number][] = {
			box: [[0, 1]],
			// [1,3,3,1]/8 at -1.5,-0.5,0.5,1.5 → bilinear taps at ±0.75
			binomial4: [[-0.75, 0.5], [0.75, 0.5]],
			// [1,5,10,10,5,1]/32 at -2.5..2.5 → taps at -5/3, 0, 5/3
			binomial6: [[-5 / 3, 6 / 32], [0, 20 / 32], [5 / 3, 6 / 32]],
		}[filter] as [number, number][];

		const samples: string[] = [];
		for (const [oy, wy] of taps1D) {
			for (const [ox, wx] of taps1D) {
				samples.push(`result += textureLod(source, (c + vec2(${glslFloat(ox)}, ${glslFloat(oy)})) * sourceInvSize, 0.0) * ${glslFloat(wx * wy)};`);
			}
		}

		// near or beyond the border bilinear taps would mix in clamped texels, so use the 16 texel-centre taps, with a
		// bounds test (zero outside) or wrapped indices
		const tap = zeroOutside
			? 'textureLod(source, t * sourceInvSize, 0.0) * insideTexels(t, sourceSize)'
			: 'textureLod(source, wrapTexel(t, sourceSize) * sourceInvSize, 0.0)';
		const borderPath = zeroOutside || wrap !== 'clamp' ? /*glsl*/`
			if (any(lessThan(c, vec2(2.0))) || any(greaterThan(c, sourceSize - 2.0))) {
				float w[4] = float[4](0.125, 0.375, 0.375, 0.125);
				for (int j = 0; j < 4; j++) {
					for (int i = 0; i < 4; i++) {
						vec2 t = c + vec2(float(i) - 1.5, float(j) - 1.5);
						result += ${tap} * (w[i] * w[j]);
					}
				}
				gl_FragColor = result;
				return;
			}
		` : '';

		super({
			uniforms: {
				source: new Uniform(null),
				sourceInvSize: new Uniform(new Vector2()),
				sourceOffset: new Uniform(0),
				sourceSize: new Uniform(new Vector2()),
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: /*glsl*/`
				uniform sampler2D source;
				uniform vec2 sourceInvSize;
				uniform vec2 sourceSize;
				// accounts for level padding: (source padding) - 2 * (output padding)
				uniform float sourceOffset;

				${borderGLSL}
				${wrapGLSL(wrap)}

				void main() {
					vec2 c = gl_FragCoord.xy * 2.0 + sourceOffset;
					vec4 result = vec4(0.0);
					${borderPath}
					${samples.join('\n')}
					gl_FragColor = result;
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
	}

}

/** Uniforms for dividing by the blurred inside-mask ('normalize' border mode) */
type NormalizeUniforms = {
	/** image size in pixels */
	normImageSize: Uniform<Vector2>,
	/** σ in pixels */
	normSigma: Uniform<number>,
	/** pixel position = gl_FragCoord.xy * normPxScale + normPxOffset */
	normPxScale: Uniform<Vector2>,
	normPxOffset: Uniform<Vector2>,
}

function normalizeUniforms(): NormalizeUniforms {
	return {
		normImageSize: new Uniform(new Vector2(1, 1)),
		normSigma: new Uniform(1),
		normPxScale: new Uniform(new Vector2(1, 1)),
		normPxOffset: new Uniform(new Vector2(0, 0)),
	};
}

const normalizeUniformsGLSL = /*glsl*/`
	uniform vec2 normImageSize;
	uniform float normSigma;
	uniform vec2 normPxScale;
	uniform vec2 normPxOffset;
`;

export class UpsampleMaterial extends ShaderMaterial<{
	source: Uniform<Texture | null>,
	sourceInvSize: Uniform<Vector2>,
	outToSource: Uniform<Vector2>,
	sourceOffset: Uniform<number>,
} & NormalizeUniforms> {

	static instances = new Map<string, UpsampleMaterial>();

	static get(filter: PyramidUpsampleFilter, normalize = false) {
		const key = `${filter}_${normalize}`;
		let instance = UpsampleMaterial.instances.get(key);
		if (!instance) {
			instance = new UpsampleMaterial(filter, normalize);
			UpsampleMaterial.instances.set(key, instance);
		}
		return instance;
	}

	constructor(filter: PyramidUpsampleFilter, normalize: boolean) {
		const body = filter === 'bilinear' ? /*glsl*/`
			gl_FragColor = textureLod(source, p * sourceInvSize, 0.0);
		` : /*glsl*/`
			gl_FragColor = sampleBSpline(source, p, sourceInvSize);
		`;

		super({
			uniforms: {
				source: new Uniform(null),
				sourceInvSize: new Uniform(new Vector2()),
				outToSource: new Uniform(new Vector2()),
				sourceOffset: new Uniform(0),
				...normalizeUniforms(),
			},
			defines: {
				NORMALIZE: normalize ? '1' : '0',
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: /*glsl*/`
				uniform sampler2D source;
				uniform vec2 sourceInvSize;
				uniform vec2 outToSource;
				// source level padding in texels
				uniform float sourceOffset;
				${normalizeUniformsGLSL}

				${bsplineGLSL}
				${borderGLSL}

				void main() {
					// position in source texel units
					vec2 p = gl_FragCoord.xy * outToSource + sourceOffset;
					${body}
					#if NORMALIZE
					gl_FragColor /= insideMaskBlur(gl_FragCoord.xy * normPxScale + normPxOffset, normImageSize, normSigma);
					#endif
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
	}

}

/**
 * Separable Gaussian with weights supplied by uniform, so σ can change continuously without recompiling
 */
export class GaussianTapsMaterial extends ShaderMaterial<{
	source: Uniform<Texture | null>,
	sourceInvSize: Uniform<Vector2>,
	direction: Uniform<Vector2>,
	taps: Uniform<Vector2[]>,
	/** source size in texels, for zeroOutside */
	sourceSize: Uniform<Vector2>,
} & NormalizeUniforms> {

	static instances = new Map<string, GaussianTapsMaterial>();

	/**
	 * @param flags.zeroOutside taps outside the source read zero (texel-centred taps only)
	 * @param flags.normalize divide the result by the blurred inside-mask
	 * @param flags.wrap taps wrap their texel index into the source (texel-centred taps only)
	 */
	static get(tapCount: number, key: string = 'x', flags: { zeroOutside?: boolean, normalize?: boolean, wrap?: WrapMode } = {}) {
		const wrap = flags.wrap ?? 'clamp';
		const id = `${tapCount}_${key}_${!!flags.zeroOutside}_${!!flags.normalize}_${wrap}`;
		let instance = GaussianTapsMaterial.instances.get(id);
		if (!instance) {
			instance = new GaussianTapsMaterial(tapCount, !!flags.zeroOutside, !!flags.normalize, wrap);
			GaussianTapsMaterial.instances.set(id, instance);
		}
		return instance;
	}

	/**
	 * Sampled Gaussian, truncated at `truncation` σ and normalized, optionally with adjacent taps merged into bilinear
	 * fetches. Returns [offset, weight] pairs.
	 */
	static computeTaps(sigma: number, truncation: number, linearSampling: boolean): Vector2[] {
		const radius = Math.max(1, Math.ceil(sigma * truncation));
		const weights: number[] = [];
		let total = 0;
		for (let i = 0; i <= radius; i++) {
			const w = sigma > 0 ? Math.exp(-(i * i) / (2 * sigma * sigma)) : (i === 0 ? 1 : 0);
			weights.push(w);
			total += i === 0 ? w : 2 * w;
		}
		const taps: Vector2[] = [new Vector2(0, weights[0] / total)];
		if (!linearSampling) {
			// texel-center taps: exact weights
			for (let i = 1; i <= radius; i++) {
				taps.push(new Vector2(i, weights[i] / total));
				taps.push(new Vector2(-i, weights[i] / total));
			}
		}
		else for (let i = 1; i <= radius; i += 2) {
			const a = weights[i];
			const b = i + 1 <= radius ? weights[i + 1] : 0;
			const w = a + b;
			const offset = w > 0 ? (i * a + (i + 1) * b) / w : i;
			taps.push(new Vector2(offset, w / total));
			taps.push(new Vector2(-offset, w / total));
		}
		return taps;
	}

	constructor(tapCount: number, zeroOutside: boolean, normalize: boolean, wrap: WrapMode = 'clamp') {
		// unrolled with constant indices: faster than a dynamic loop over the uniform array
		const samples: string[] = [];
		for (let i = 0; i < tapCount; i++) {
			samples.push(zeroOutside
				? `t = c + direction * taps[${i}].x; result += textureLod(source, t * sourceInvSize, 0.0) * (taps[${i}].y * insideTexels(t, sourceSize));`
				: wrap !== 'clamp'
				? `result += textureLod(source, wrapTexel(c + direction * taps[${i}].x, sourceSize) * sourceInvSize, 0.0) * taps[${i}].y;`
				: `result += textureLod(source, (c + direction * taps[${i}].x) * sourceInvSize, 0.0) * taps[${i}].y;`);
		}
		super({
			uniforms: {
				source: new Uniform(null),
				sourceInvSize: new Uniform(new Vector2()),
				direction: new Uniform(new Vector2(1, 0)),
				taps: new Uniform(new Array(tapCount).fill(null).map(() => new Vector2())),
				sourceSize: new Uniform(new Vector2()),
				...normalizeUniforms(),
			},
			defines: {
				TAP_COUNT: String(tapCount),
				NORMALIZE: normalize ? '1' : '0',
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: /*glsl*/`
				uniform sampler2D source;
				uniform vec2 sourceInvSize;
				uniform vec2 sourceSize;
				uniform vec2 direction;
				uniform vec2 taps[TAP_COUNT];
				${normalizeUniformsGLSL}

				${borderGLSL}
				${wrapGLSL(wrap)}

				void main() {
					vec2 c = gl_FragCoord.xy;
					vec2 t;
					vec4 result = vec4(0.0);
					${samples.join('\n')}
					#if NORMALIZE
					result /= insideMaskBlur(gl_FragCoord.xy * normPxScale + normPxOffset, normImageSize, normSigma);
					#endif
					gl_FragColor = result;
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
	}

	setTaps(taps: Vector2[]) {
		const dst = this.uniforms.taps.value;
		for (let i = 0; i < dst.length; i++) {
			if (i < taps.length) dst[i].copy(taps[i]);
			else dst[i].set(0, 0);
		}
	}

}

function glslFloat(f: number) {
	const s = f.toString();
	return s.includes('.') || s.includes('e') ? s : s + '.0';
}

