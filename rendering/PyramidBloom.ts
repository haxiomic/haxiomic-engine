import { ClampToEdgeWrapping, LinearFilter, Texture, Uniform, Vector2, WebGLRenderTarget, WebGLRenderer, Wrapping } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import Blur1D from "../materials/Blur1D.js";
import { Rendering } from "./Rendering.js";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";
import { mipmapCount } from "../math/Math.js";
import { DEFAULT_CORE_TRUNCATION, DownsampleMaterial, GaussianTapsMaterial, LEVEL_PADDING, bsplineGLSL, defaultCoreLinearSampling, downsampleVariance, fullscreenVertexShader, getTextureSize, snapshotRendererState } from "./PyramidGaussianBlur.js";

/**
 * Multi-scale bloom: Σ weightᵢ · Gaussian(σᵢ) of the source, evaluated with one shared anti-aliased pyramid.
 *
 * Each term gets an exact core Gaussian at the coarsest level that keeps its core σ ≥ `minCoreSigma`, then terms are
 * accumulated coarse-to-fine through a cascade of 2x cubic B-spline upsamples. The variance added by downsampling and
 * by every upsample a term passes through is subtracted from its core σ, so each term is a Gaussian of exactly σᵢ.
 *
 * Shift-invariant like `pyramidGaussianBlur()`: small HDR highlights do not shimmer as they move.
 */
export type BloomTerm = { sigma: number, weight: number };

export type PyramidBloomOptions = {
	/** Smallest core σ in texels of its pyramid level, as `PyramidGaussianBlurOptions.minCoreSigma`. @default 3 */
	minCoreSigma?: number,
	/** Restore the renderer's render target & viewport afterwards. @default true */
	restoreGlobalState?: boolean,
	wrap?: Wrapping,
	target?: WebGLRenderTarget | null,
	cacheId?: string | null,
}

/** Variance (in level-k texels²) added by k binomial downsamples and k cascaded 2x B-spline upsamples */
function cascadeVariance(k: number) {
	let v = 0;
	for (let j = 1; j <= k; j++) {
		v += downsampleVariance.binomial4 * Math.pow(4, j - 1 - k);
		v += (1 / 3) * Math.pow(4, j - k);
	}
	return v;
}

/** Maximum number of terms evaluated at the same pyramid level */
const MAX_TERMS_PER_LEVEL = 4;

export function planPyramidBloom(terms: BloomTerm[], minCoreSigma = 3) {
	const planned: { level: number, coreSigma: number, weight: number, sigma: number }[] = [];
	for (const term of terms) {
		if (term.weight === 0) continue;
		let level = Math.max(0, Math.floor(Math.log2(Math.max(term.sigma, 1e-6) / minCoreSigma)));
		const coreVariance = (k: number) => Math.pow(term.sigma / Math.pow(2, k), 2) - cascadeVariance(k);
		while (level > 0 && coreVariance(level) < minCoreSigma * minCoreSigma) level--;
		if (planned.filter(p => p.level === level).length >= MAX_TERMS_PER_LEVEL) {
			throw new Error(`pyramidBloom: more than ${MAX_TERMS_PER_LEVEL} terms at level ${level}`);
		}
		planned.push({ level, coreSigma: Math.sqrt(Math.max(coreVariance(level), 0)), weight: term.weight, sigma: term.sigma });
	}
	return planned;
}

export function pyramidBloom(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	terms: BloomTerm[],
	options: PyramidBloomOptions = {},
) {
	const wrap = options.wrap ?? ClampToEdgeWrapping;
	const cacheId = options.cacheId ?? `${texture.uuid}_pyramidBloom`;
	const padding = wrap === ClampToEdgeWrapping ? LEVEL_PADDING : 0;
	const { width: sourceWidth, height: sourceHeight } = getTextureSize(texture);

	const textureOptions: RenderTargetStoreOptions = {
		magFilter: LinearFilter,
		minFilter: LinearFilter,
		type: texture.type,
		wrapS: wrap,
		wrapT: wrap,
	}

	const plan = planPyramidBloom(terms, options.minCoreSigma ?? 3);
	const restoreState = options.restoreGlobalState !== false ? snapshotRendererState(renderer) : null;
	const maxLevel = Math.max(0, ...plan.map(p => p.level));

	// downsample chain; levels[k] = { texture, width, height } (level 0 is the unpadded source)
	const levels = [{ texture, width: sourceWidth, height: sourceHeight }];
	let unpaddedWidth = sourceWidth, unpaddedHeight = sourceHeight;
	for (let j = 1; j <= maxLevel; j++) {
		unpaddedWidth = Math.ceil(unpaddedWidth / 2);
		unpaddedHeight = Math.ceil(unpaddedHeight / 2);
		const width = unpaddedWidth + 2 * padding, height = unpaddedHeight + 2 * padding;
		const levelTarget = renderTargetStore.getRenderTarget(`${cacheId}_bloom_down_${j}`, width, height, textureOptions);
		const input = levels[j - 1];
		const shader = DownsampleMaterial.get('binomial4');
		shader.uniforms.source.value = input.texture;
		shader.uniforms.sourceInvSize.value.set(1 / input.width, 1 / input.height);
		shader.uniforms.sourceOffset.value = (j === 1 ? 0 : padding) - 2 * padding;
		Rendering.shaderMaterialPass(renderer, { target: levelTarget, shader, restoreGlobalState: false });
		levels.push({ texture: levelTarget.texture, width, height });
	}

	const finalTarget = options.target ?? renderTargetStore.getRenderTarget(`${cacheId}_bloom_result`, sourceWidth, sourceHeight, textureOptions);

	// accumulate coarse → fine
	let accumulated: { texture: Texture, width: number, height: number } | null = null;
	for (let k = maxLevel; k >= 0; k--) {
		const level = levels[k];
		const target = k === 0 ? finalTarget : renderTargetStore.getRenderTarget(`${cacheId}_bloom_acc_${k}`, level.width, level.height, textureOptions);
		const levelTerms = plan.filter(p => p.level === k);
		if (levelTerms.length === 0 && !accumulated) continue;

		// x pass per term, y taps (pre-weighted) are applied in the cascade pass
		const termTaps: Vector2[][] = [];
		const termSources: Texture[] = [];
		levelTerms.forEach((term, i) => {
			const taps = GaussianTapsMaterial.computeTaps(term.coreSigma, DEFAULT_CORE_TRUNCATION, defaultCoreLinearSampling(k));
			const tmp = renderTargetStore.getRenderTarget(`${cacheId}_bloom_x_${k}_${i}`, level.width, level.height, textureOptions);
			const blurX = GaussianTapsMaterial.get(taps.length);
			blurX.setTaps(taps);
			blurX.uniforms.source.value = level.texture;
			blurX.uniforms.sourceInvSize.value.set(1 / level.width, 1 / level.height);
			blurX.uniforms.direction.value.set(1, 0);
			Rendering.shaderMaterialPass(renderer, { target: tmp, shader: blurX, restoreGlobalState: false });
			for (const t of taps) t.y *= term.weight;
			termTaps.push(taps);
			termSources.push(tmp.texture);
		});

		const tapCount = Math.max(0, ...termTaps.map(t => t.length));
		const shader = CascadeMaterial.get(termTaps.length, tapCount, accumulated != null);
		shader.uniforms.sourceInvSize.value.set(1 / level.width, 1 / level.height);
		termSources.forEach((source, i) => {
			shader.uniforms.sources.value[i] = source;
			shader.setTaps(i, termTaps[i]);
		});
		if (accumulated) {
			// output texel (padded, level k) → level k+1 padded texel coordinates
			const outPadding = k === 0 ? 0 : padding;
			const scaleX = k === 0 ? (sourceWidth / target.width) * 0.5 : 0.5;
			const scaleY = k === 0 ? (sourceHeight / target.height) * 0.5 : 0.5;
			shader.uniforms.addSource.value = accumulated.texture;
			shader.uniforms.addInvSize.value.set(1 / accumulated.width, 1 / accumulated.height);
			shader.uniforms.addScale.value.set(scaleX, scaleY);
			shader.uniforms.addOffset.value = padding - outPadding * 0.5;
		}
		Rendering.shaderMaterialPass(renderer, { target, shader, restoreGlobalState: false });
		accumulated = { texture: target.texture, width: level.width, height: level.height };
	}

	restoreState?.();
	return finalTarget;
}

type BloomOutputOptions = {
	/** HDR scene */
	source: WebGLRenderTarget | Texture,
	/** Smallest core σ in texels of its pyramid level, see `PyramidGaussianBlurOptions.minCoreSigma` */
	minCoreSigma?: number,
	restoreGlobalState?: boolean,
	target?: WebGLRenderTarget | null,
	renderTargetStore?: RenderTargetStore,
};

/**
 * Defaults for `generatePyramidBloom()`: the engine's mip bloom (default options) as it looks at 1920×1080. Its levels
 * 2-9 match to within ~1%; its level 1 is ~13% narrower than a strict doubling.
 */
export const DEFAULT_BLOOM_RADIUS = 0.0073;
export const DEFAULT_BLOOM_LEVELS = 9;

/**
 * Multi-scale bloom term Σ levelᵢ · i^-bloomFalloff, where level i (1-based) is a Gaussian blur with σ = radius · 2^(i-1)
 * image heights. Resolution independent: the same at any resolution, aspect ratio or DPR.
 *
 * Pass the result to `BloomMipmapsMaterial` as `bloomSource`. The defaults reproduce the material's mip bloom (with
 * `generateBlurredMipmaps()` default options) as it looks at 1920×1080. For a 1:1 swap of an existing mip bloom setup
 * see `generatePyramidBloomLegacy()`.
 */
export function generatePyramidBloom(
	renderer: WebGLRenderer,
	options: BloomOutputOptions & {
		/** σ of the first (smallest) level, as a fraction of image height @default 0.0073 */
		radius?: number,
		/** Number of levels; each doubles σ @default 9 */
		levels?: number,
		/** Level i is weighted i^-bloomFalloff, as `BloomMipmapsMaterial` @default -0.138 */
		bloomFalloff?: number,
	},
): WebGLRenderTarget {
	const texture = options.source instanceof WebGLRenderTarget ? options.source.texture : options.source;
	const { height } = getTextureSize(texture);
	const radius = options.radius ?? DEFAULT_BLOOM_RADIUS;
	const falloff = options.bloomFalloff ?? -0.138;
	const terms: BloomTerm[] = [];
	for (let i = 1; i <= (options.levels ?? DEFAULT_BLOOM_LEVELS); i++) {
		terms.push({ sigma: radius * height * Math.pow(2, i - 1), weight: Math.pow(i, -falloff) });
	}
	return renderBloom(renderer, options, terms, 'generatePyramidBloom');
}

/**
 * Legacy shim: a 1:1 swap for the `generateBlurredMipmaps()` + `BloomMipmapsMaterial` mip bloom. Takes the same options
 * and reproduces the same bloom (each level's σ to within ~0.3%), without the mip chain's aliasing.
 *
 * Like the mip chain, the level count grows with resolution (mip count - 1 by default), so bloom gets hazier at higher
 * resolutions or DPR. Prefer `generatePyramidBloom()` for new code.
 *
 * Pass the result to `BloomMipmapsMaterial` as `bloomSource`. (`bloomFalloff`, `minLod` and `maxLod` are applied here
 * rather than by the material.)
 */
export function generatePyramidBloomLegacy(
	renderer: WebGLRenderer,
	options: BloomOutputOptions & {
		/** As `generateBlurredMipmaps()` @default 1/16 */
		blurKernel_heightFraction?: number,
		/** As `generateBlurredMipmaps()` @default 0.5 */
		truncationSigma?: number,
		/** As `BloomMipmapsMaterial` @default -0.138 */
		bloomFalloff?: number,
		/** As `BloomMipmapsMaterial` @default 1 */
		minLod?: number,
		/** Exclusive, as `BloomMipmapsMaterial` @default mip count - 1 */
		maxLod?: number,
	},
): WebGLRenderTarget {
	const texture = options.source instanceof WebGLRenderTarget ? options.source.texture : options.source;
	const { width, height } = getTextureSize(texture);
	const terms = engineBloomTerms(width, height, {
		blurKernel_heightFraction: options.blurKernel_heightFraction,
		truncationSigma: options.truncationSigma,
		bloomFalloff: options.bloomFalloff,
		minLod: options.minLod,
		maxLod: options.maxLod,
	});
	return renderBloom(renderer, options, terms, 'generatePyramidBloomLegacy');
}

function renderBloom(renderer: WebGLRenderer, options: BloomOutputOptions, terms: BloomTerm[], key: string) {
	const source = options.source;
	const texture = source instanceof WebGLRenderTarget ? source.texture : source;
	const store = options.renderTargetStore ?? (source instanceof WebGLRenderTarget
		? RenderTargetStore.getStoreForRenderTarget(source)
		: RenderTargetStore.getStoreForRenderer(renderer));
	return pyramidBloom(renderer, store, texture, terms, {
		minCoreSigma: options.minCoreSigma,
		restoreGlobalState: options.restoreGlobalState,
		target: options.target,
		cacheId: `${texture.uuid}_${key}`,
	});
}

/**
 * Bloom terms matching haxiomic-engine `generateBlurredMipmaps()` + `BloomMipmapsMaterial`: the σ of each blurred mip
 * level as sampled by the material, and its weight i^-bloomFalloff. Use with `pyramidBloom()` for the same look without
 * the engine pyramid's aliasing.
 */
export function engineBloomTerms(
	width: number,
	height: number,
	options: {
		blurKernel_heightFraction?: number,
		truncationSigma?: number,
		bloomFalloff?: number,
		minLod?: number,
		/** Exclusive, default mipCount - 1 as BloomMipmapsMaterial (so the level count grows with resolution) */
		maxLod?: number,
	} = {},
): BloomTerm[] {
	const fraction = options.blurKernel_heightFraction ?? 1 / 16;
	const t = options.truncationSigma ?? 0.5;
	const falloff = options.bloomFalloff ?? -0.138;
	const minLod = options.minLod ?? 1;
	const maxLod = options.maxLod ?? mipmapCount(width, height) - 1;
	const kernelPixels = fraction * height * 0.5;

	// Blur1D truncates at ±1/t σ: variance of a truncated normal
	const b = 1 / t;
	const pdf = Math.exp(-b * b / 2) / Math.sqrt(2 * Math.PI);
	const truncatedFactor = 1 - (2 * b * pdf) / erf(b / Math.SQRT2);

	const sigmaTexels = (kernel: number) => t * (Blur1D.nearestBestKernel(kernel) - 1) / 2;
	const sx = sigmaTexels(kernelPixels), sy = sigmaTexels(kernelPixels * 0.5);

	const terms: BloomTerm[] = [];
	let variance = 0;
	for (let i = 1; i < maxLod; i++) {
		// x blur runs in level i-1 texels, y blur in level i texels
		variance += truncatedFactor * (sx * sx * Math.pow(4, i - 1) + sy * sy * Math.pow(4, i)) / 2;
		// the x pass renders at level i, sampling level i-1 between texels, and the y decimation is a 2-tap box:
		// together ≈ 0.5 level i-1 texels²
		variance += 0.5 * Math.pow(4, i - 1);
		if (i >= minLod) {
			// + bilinear magnification of level i (tent, variance 1/6 texel²)
			terms.push({ sigma: Math.sqrt(variance + Math.pow(4, i) / 6), weight: Math.pow(i, -falloff) });
		}
	}
	return terms;
}

function erf(x: number) {
	// Abramowitz & Stegun 7.1.26
	const s = Math.sign(x);
	x = Math.abs(x);
	const k = 1 / (1 + 0.3275911 * x);
	const y = 1 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-x * x);
	return s * y;
}

/**
 * y-direction Gaussian taps (pre-weighted) for each term at this level + optional B-spline upsample of the coarser
 * accumulation
 */
class CascadeMaterial extends ShaderMaterial<{
	sources: Uniform<(Texture | null)[]>,
	sourceInvSize: Uniform<Vector2>,
	taps: Uniform<Vector2[]>,
	addSource: Uniform<Texture | null>,
	addInvSize: Uniform<Vector2>,
	addScale: Uniform<Vector2>,
	addOffset: Uniform<number>,
}> {

	static instances = new Map<string, CascadeMaterial>();

	static get(termCount: number, tapCount: number, add: boolean) {
		const key = `${termCount}_${tapCount}_${add}`;
		let instance = CascadeMaterial.instances.get(key);
		if (!instance) {
			instance = new CascadeMaterial(termCount, tapCount, add);
			CascadeMaterial.instances.set(key, instance);
		}
		return instance;
	}

	tapCount: number;

	constructor(termCount: number, tapCount: number, add: boolean) {
		// sampler arrays must be indexed by constants, so each term's loop is generated
		// unrolled with constant indices (sampler arrays require them, and it is faster)
		const termLoops: string[] = [];
		for (let t = 0; t < termCount; t++) {
			for (let i = 0; i < tapCount; i++) {
				const k = t * tapCount + i;
				termLoops.push(`result += textureLod(sources[${t}], (c + vec2(0.0, taps[${k}].x)) * sourceInvSize, 0.0) * taps[${k}].y;`);
			}
		}

		super({
			uniforms: {
				sources: new Uniform(new Array(Math.max(termCount, 1)).fill(null)),
				sourceInvSize: new Uniform(new Vector2()),
				taps: new Uniform(new Array(Math.max(termCount * tapCount, 1)).fill(null).map(() => new Vector2())),
				addSource: new Uniform(null),
				addInvSize: new Uniform(new Vector2()),
				addScale: new Uniform(new Vector2()),
				addOffset: new Uniform(0),
			},
			defines: {
				TERM_COUNT: String(termCount),
				TAP_COUNT: String(tapCount),
				ADD: add ? '1' : '0',
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: /*glsl*/`
				#if TERM_COUNT > 0
				uniform sampler2D sources[TERM_COUNT];
				uniform vec2 taps[TERM_COUNT * TAP_COUNT];
				#endif
				uniform vec2 sourceInvSize;
				uniform sampler2D addSource;
				uniform vec2 addInvSize;
				uniform vec2 addScale;
				uniform float addOffset;

				${bsplineGLSL}

				void main() {
					vec2 c = gl_FragCoord.xy;
					vec4 result = vec4(0.0);
					${termLoops.join('\n')}
					#if ADD
					result += sampleBSpline(addSource, c * addScale + addOffset, addInvSize);
					#endif
					gl_FragColor = result;
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
		this.tapCount = tapCount;
	}

	setTaps(term: number, taps: Vector2[]) {
		const dst = this.uniforms.taps.value;
		for (let i = 0; i < this.tapCount; i++) {
			const d = dst[term * this.tapCount + i];
			if (i < taps.length) d.copy(taps[i]);
			else d.set(0, 0);
		}
	}

}
