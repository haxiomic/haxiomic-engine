import { ClampToEdgeWrapping, LinearFilter, Texture, Uniform, Vector2, WebGLRenderTarget, WebGLRenderer } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import { Rendering } from "./Rendering.js";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";
import { PyramidBorder } from "./PyramidGaussianBlur.js";
import { DEFAULT_CORE_TRUNCATION, DownsampleMaterial, GaussianTapsMaterial, LEVEL_PADDING, borderGLSL, bsplineGLSL, defaultCoreLinearSampling, downsampleVariance, fullscreenVertexShader, getTextureSize, snapshotRendererState } from "./PyramidInternals.js";

/** One Gaussian of a bloom: σ in pixels, and its weight in the sum */
export type BloomTerm = { sigma: number, weight: number };

export type PyramidBloomOptions = {
	/**
	 * - 'high': ≈ 0.01% shift variance (no visible flicker even on strong HDR bloom)
	 * - 'balanced': ≈ 0.4% (≈ 0.2 8-bit levels on a strong bloom, invisible) at about a third of the cost when the
	 *   finest term is under ~6 px; then about the cost of the mip chain bloom
	 * @default 'high'
	 */
	quality?: BloomQuality,
	/**
	 * See `PyramidBorder`. 'clampPerLevel' (the default) is closest to the mip chain bloom; 'clampToEdge' darkens corners
	 * of dark-edged frames slightly; 'normalize' brightens them slightly.
	 * @default 'clampPerLevel'
	 */
	border?: PyramidBorder,
	/** Render into this target instead of a cached one */
	target?: WebGLRenderTarget | null,
	/** Key for the cached intermediate and result targets @default texture.uuid */
	cacheId?: string | null,
	/** Restore the renderer's render target & viewport afterwards @default true */
	restoreGlobalState?: boolean,
	/**
	 * Advanced, overrides `quality`. Smallest core σ in texels of its level, optionally per term (index in σ order);
	 * lower is cheaper but less shift-invariant. Terms under 2·minCoreSigma px run at full resolution. @default 3
	 */
	minCoreSigma?: MinCoreSigma,
	/** Advanced, overrides `quality`. Truncation of the core Gaussians, in σ @default 5 */
	coreTruncation?: number,
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

type MinCoreSigma = number | ((term: BloomTerm, index: number) => number);
export type BloomQuality = 'high' | 'balanced';

const qualityPresets: Record<BloomQuality, { minCoreSigma: MinCoreSigma, coreTruncation: number }> = {
	high: { minCoreSigma: 3, coreTruncation: DEFAULT_CORE_TRUNCATION },
	// the finest term carries the bloom peak but runs at full resolution unless allowed a smaller core σ
	balanced: { minCoreSigma: (_term, index) => index === 0 ? 1.5 : 2, coreTruncation: 4 },
};

function planPyramidBloom(terms: BloomTerm[], minCoreSigmaOption: MinCoreSigma = 3) {
	const planned: { level: number, coreSigma: number, weight: number, sigma: number }[] = [];
	const ordered = terms.slice().sort((a, b) => a.sigma - b.sigma);
	for (const term of terms) {
		if (term.weight === 0) continue;
		const minCoreSigma = typeof minCoreSigmaOption === 'function' ? minCoreSigmaOption(term, ordered.indexOf(term)) : minCoreSigmaOption;
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

/**
 * Σ weight · Gaussian(σ) of the source over any set of terms, sharing one anti-aliased pyramid: each term costs one small
 * exact blur at its own level, so even 10+ terms cost about as much as one `pyramidGaussianBlur()`. Shift-invariant.
 * Use for custom weightings (glows, light scattering); for bloom, `generatePyramidBloom()` picks the terms.
 */
export function pyramidBloom(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	terms: BloomTerm[],
	options: PyramidBloomOptions = {},
) {
	const wrap = ClampToEdgeWrapping;
	const cacheId = options.cacheId ?? `${texture.uuid}_pyramidBloom`;
	const border = options.border ?? 'clampPerLevel';
	const padding = wrap === ClampToEdgeWrapping && border !== 'clampPerLevel' ? LEVEL_PADDING : 0;
	const normalize = border === 'normalize' && wrap === ClampToEdgeWrapping;
	const { width: sourceWidth, height: sourceHeight } = getTextureSize(texture);

	const textureOptions: RenderTargetStoreOptions = {
		magFilter: LinearFilter,
		minFilter: LinearFilter,
		type: texture.type,
		wrapS: wrap,
		wrapT: wrap,
	}

	const preset = qualityPresets[options.quality ?? 'high'];
	const coreTruncation = options.coreTruncation ?? preset.coreTruncation;
	const plan = planPyramidBloom(terms, options.minCoreSigma ?? preset.minCoreSigma);
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
		const shader = DownsampleMaterial.get('binomial4', { zeroOutside: normalize && j === 1 });
		shader.uniforms.source.value = input.texture;
		shader.uniforms.sourceInvSize.value.set(1 / input.width, 1 / input.height);
		shader.uniforms.sourceSize.value.set(input.width, input.height);
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
		// ('normalize' at full resolution: read zero outside the image, which needs texel-centred taps)
		const zeroOutside = normalize && k === 0;
		const termTaps: Vector2[][] = [];
		const termSources: Texture[] = [];
		levelTerms.forEach((term, i) => {
			const taps = GaussianTapsMaterial.computeTaps(term.coreSigma, coreTruncation, !zeroOutside && defaultCoreLinearSampling(k));
			const tmp = renderTargetStore.getRenderTarget(`${cacheId}_bloom_x_${k}_${i}`, level.width, level.height, textureOptions);
			const blurX = GaussianTapsMaterial.get(taps.length, 'x', { zeroOutside });
			blurX.setTaps(taps);
			blurX.uniforms.source.value = level.texture;
			blurX.uniforms.sourceInvSize.value.set(1 / level.width, 1 / level.height);
			blurX.uniforms.sourceSize.value.set(level.width, level.height);
			blurX.uniforms.direction.value.set(1, 0);
			Rendering.shaderMaterialPass(renderer, { target: tmp, shader: blurX, restoreGlobalState: false });
			for (const t of taps) t.y *= term.weight;
			termTaps.push(taps);
			termSources.push(tmp.texture);
		});

		const tapCount = Math.max(0, ...termTaps.map(t => t.length));
		const shader = CascadeMaterial.get(termTaps.length, tapCount, accumulated != null, { zeroOutside, normalize });
		shader.uniforms.sourceInvSize.value.set(1 / level.width, 1 / level.height);
		shader.uniforms.sourceSize.value.set(level.width, level.height);
		termSources.forEach((source, i) => {
			shader.uniforms.sources.value[i] = source;
			shader.uniforms.termSigma.value[i] = levelTerms[i].sigma;
			shader.setTaps(i, termTaps[i]);
		});
		if (normalize) {
			// level k texel centre (padded) → source pixels: (gl_FragCoord - padding) · 2^k
			const outPadding = k === 0 ? 0 : padding;
			const pxPerTexelX = k === 0 ? sourceWidth / target.width : Math.pow(2, k);
			const pxPerTexelY = k === 0 ? sourceHeight / target.height : Math.pow(2, k);
			shader.uniforms.normImageSize.value.set(sourceWidth, sourceHeight);
			shader.uniforms.normPxScale.value.set(pxPerTexelX, pxPerTexelY);
			shader.uniforms.normPxOffset.value.set(-outPadding * pxPerTexelX, -outPadding * pxPerTexelY);
		}
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
	/** See `PyramidBloomOptions.minCoreSigma` */
	minCoreSigma?: MinCoreSigma,
	/** See `PyramidBloomOptions.coreTruncation` */
	coreTruncation?: number,
	/** See `PyramidBloomOptions.quality` @default 'high' */
	quality?: BloomQuality,
	/** See `PyramidBloomOptions.border` @default 'clampPerLevel' */
	border?: PyramidBorder,
	restoreGlobalState?: boolean,
	target?: WebGLRenderTarget | null,
	renderTargetStore?: RenderTargetStore,
};

/**
 * Defaults for `generatePyramidBloom()`: the engine's mip bloom (default options) as it looks at 1920×1080. Its levels
 * 2-9 match to within ~1%; its level 1 is ~13% narrower than a strict doubling.
 */
const DEFAULT_BLOOM_RADIUS = 0.0073;
const DEFAULT_BLOOM_LEVELS = 9;

/**
 * Bloom: Σ levelᵢ · i^-bloomFalloff, where level i is a Gaussian with σ = radius · 2^(i−1) image heights. The same at
 * any resolution, aspect ratio or DPR, and shift-invariant, so small HDR highlights don't flicker as they move. Pass the
 * result to `BloomMipmapsMaterial` as `bloomSource`.
 *
 * Cost (RTX 5070): with `quality: 'balanced'` about that of the mip chain bloom (+0.1 ms per frame at 4K in apps);
 * 'high' adds ~1 ms at 4K when the finest level is only a few pixels. The defaults look like the mip bloom with
 * default options at 1080p; for other mip bloom settings fit `radius` once (e.g. 0.00226 for a 0.0173 kernel with
 * truncationSigma 0.567, 9 levels).
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

function renderBloom(renderer: WebGLRenderer, options: BloomOutputOptions, terms: BloomTerm[], key: string) {
	const source = options.source;
	const texture = source instanceof WebGLRenderTarget ? source.texture : source;
	const store = options.renderTargetStore ?? (source instanceof WebGLRenderTarget
		? RenderTargetStore.getStoreForRenderTarget(source)
		: RenderTargetStore.getStoreForRenderer(renderer));
	return pyramidBloom(renderer, store, texture, terms, {
		minCoreSigma: options.minCoreSigma,
		coreTruncation: options.coreTruncation,
		quality: options.quality,
		border: options.border,
		restoreGlobalState: options.restoreGlobalState,
		target: options.target,
		cacheId: `${texture.uuid}_${key}`,
	});
}

/**
 * y-direction Gaussian taps (pre-weighted) for each term at this level + optional B-spline upsample of the coarser
 * accumulation
 */
class CascadeMaterial extends ShaderMaterial<{
	sources: Uniform<(Texture | null)[]>,
	sourceInvSize: Uniform<Vector2>,
	/** level size in texels, for zeroOutside */
	sourceSize: Uniform<Vector2>,
	taps: Uniform<Vector2[]>,
	/** σ of each term in source pixels, for normalize */
	termSigma: Uniform<number[]>,
	normImageSize: Uniform<Vector2>,
	/** source pixel position = gl_FragCoord.xy * normPxScale + normPxOffset */
	normPxScale: Uniform<Vector2>,
	normPxOffset: Uniform<Vector2>,
	addSource: Uniform<Texture | null>,
	addInvSize: Uniform<Vector2>,
	addScale: Uniform<Vector2>,
	addOffset: Uniform<number>,
}> {

	static instances = new Map<string, CascadeMaterial>();

	/**
	 * @param flags.zeroOutside taps outside the level read zero (full resolution 'normalize', texel-centred taps only)
	 * @param flags.normalize divide each term by its blurred inside-mask
	 */
	static get(termCount: number, tapCount: number, add: boolean, flags: { zeroOutside?: boolean, normalize?: boolean } = {}) {
		const key = `${termCount}_${tapCount}_${add}_${!!flags.zeroOutside}_${!!flags.normalize}`;
		let instance = CascadeMaterial.instances.get(key);
		if (!instance) {
			instance = new CascadeMaterial(termCount, tapCount, add, !!flags.zeroOutside, !!flags.normalize);
			CascadeMaterial.instances.set(key, instance);
		}
		return instance;
	}

	tapCount: number;

	constructor(termCount: number, tapCount: number, add: boolean, zeroOutside: boolean, normalize: boolean) {
		// unrolled with constant indices (sampler arrays require them, and it is faster)
		const termLoops: string[] = [];
		for (let t = 0; t < termCount; t++) {
			termLoops.push('term = vec4(0.0);');
			for (let i = 0; i < tapCount; i++) {
				const k = t * tapCount + i;
				termLoops.push(zeroOutside
					? `tc = c + vec2(0.0, taps[${k}].x); term += textureLod(sources[${t}], tc * sourceInvSize, 0.0) * (taps[${k}].y * insideTexels(tc, sourceSize));`
					: `term += textureLod(sources[${t}], (c + vec2(0.0, taps[${k}].x)) * sourceInvSize, 0.0) * taps[${k}].y;`);
			}
			termLoops.push(normalize
				? `result += term / insideMaskBlur(px, normImageSize, termSigma[${t}]);`
				: 'result += term;');
		}

		super({
			uniforms: {
				sources: new Uniform(new Array(Math.max(termCount, 1)).fill(null)),
				sourceInvSize: new Uniform(new Vector2()),
				sourceSize: new Uniform(new Vector2()),
				taps: new Uniform(new Array(Math.max(termCount * tapCount, 1)).fill(null).map(() => new Vector2())),
				termSigma: new Uniform(new Array(Math.max(termCount, 1)).fill(1)),
				normImageSize: new Uniform(new Vector2(1, 1)),
				normPxScale: new Uniform(new Vector2(1, 1)),
				normPxOffset: new Uniform(new Vector2()),
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
				uniform float termSigma[TERM_COUNT];
				#endif
				uniform vec2 sourceInvSize;
				uniform vec2 sourceSize;
				uniform vec2 normImageSize;
				uniform vec2 normPxScale;
				uniform vec2 normPxOffset;
				uniform sampler2D addSource;
				uniform vec2 addInvSize;
				uniform vec2 addScale;
				uniform float addOffset;

				${bsplineGLSL}
				${borderGLSL}

				void main() {
					vec2 c = gl_FragCoord.xy;
					vec2 px = c * normPxScale + normPxOffset;
					vec2 tc;
					vec4 term;
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
