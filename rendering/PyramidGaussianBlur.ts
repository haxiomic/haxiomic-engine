import { ClampToEdgeWrapping, LinearFilter, Texture, Uniform, Vector2, Vector4, WebGLRenderTarget, WebGLRenderer, Wrapping } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import Blur1D from "../materials/Blur1D.js";
import { Rendering } from "./Rendering.js";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";

/**
 * Fast, shift-invariant Gaussian blur using an anti-aliased image pyramid.
 *
 * 1. Downsample by 2x repeatedly with a binomial [1,3,3,1] filter (4 bilinear taps). Its response cos³(ω/2) has a
 *    triple zero at the aliasing frequency, so small HDR highlights do not shimmer as they move.
 * 2. Apply an exact separable Gaussian at the coarsest level, sized so the variance of all stages adds up to σ².
 * 3. Reconstruct directly to full resolution with a cubic B-spline (4 bilinear taps), which is C² smooth (no bilinear
 *    grid / Mach-band artifacts) and whose spectrum has zeros at the coarse sampling replicas.
 *
 * Cost is ~constant with respect to σ: one 4-tap pass at half resolution, a few tiny passes, then one 4-tap pass at
 * full resolution.
 *
 * Variances (in texel² of the level the filter runs at):
 * - [1,3,3,1]/8 downsample: 0.75 fine texels² per axis
 * - [1,5,10,10,5,1]/32 downsample: 1.25 fine texels² per axis
 * - cubic B-spline reconstruction: 1/3 coarse texels²
 */

export type PyramidDownsampleFilter = 'box' | 'binomial4' | 'binomial6';
export type PyramidUpsampleFilter = 'bilinear' | 'bspline';
/**
 * How the blur treats pixels beyond the image edge.
 *
 * Both clamp modes repeat the image's edge outward, which suits most images (they are rarely surrounded by black).
 * They differ only in what is repeated:
 * - 'clampToEdge': the single outermost pixel row, as classic clamp-to-edge and the separable `gaussianBlur()` do
 * - 'clampPerLevel': each pyramid level repeats its own edge texel, as the `generateBlurredMipmaps()` chain does, so a
 *   wide blur repeats a σ-scale band of edge content rather than just the outer pixel row
 *
 * - 'normalize': opt-in alternative. Only pixels inside the image are averaged (normalized convolution), so nothing is
 *   repeated and wide blurs converge to the in-frame mean
 */
export type PyramidBorder = 'clampToEdge' | 'clampPerLevel' | 'normalize';

export type PyramidGaussianBlurOptions = {
	/**
	 * Smallest Gaussian σ (in texels of the coarsest level) applied at the core level. The pyramid is descended until
	 * the remaining σ would fall below this. Higher = less aliasing & more expensive: worst-case shift variance (flicker)
	 * is ~0.4% of peak at 2 and ~0.12% at 3. Below 2·minCoreSigma pixels the blur runs at full resolution.
	 * @default 3
	 */
	minCoreSigma?: number,
	/** @default 'binomial4' */
	downsampleFilter?: PyramidDownsampleFilter,
	/** Filter used for the final downsample into the core level (it dominates aliasing). @default same as downsampleFilter */
	lastDownsampleFilter?: PyramidDownsampleFilter,
	/** @default 'bspline' */
	upsampleFilter?: PyramidUpsampleFilter,
	/**
	 * Gaussian truncation of the core kernel, in σ. At 4σ the cut-off (3e-4 of peak) is still visible as a crawling edge
	 * around bright highlights on dark backgrounds, because sRGB amplifies small values; 5σ removes it.
	 * @default 5
	 */
	coreTruncation?: number,
	/**
	 * Merge adjacent core taps into single bilinear fetches. Halves core fetches, but hardware bilinear weights have
	 * ~8 bits of precision, which makes the core kernel inexact (≈0.5% of peak) and, below full resolution, phase
	 * dependent (shift variance up to ≈0.6% of peak). The core runs at reduced resolution so exact taps are cheap.
	 * @default level === 0
	 */
	coreLinearSampling?: boolean,
	/** Restore the renderer's render target & viewport afterwards, as engine `gaussianBlur` does. @default true */
	restoreGlobalState?: boolean,
	/**
	 * Border handling with `ClampToEdgeWrapping`, see `PyramidBorder`. The default repeats the outermost pixel row, as the
	 * separable `gaussianBlur()` does.
	 * @default 'clampToEdge'
	 */
	border?: PyramidBorder,
	/** Force a specific pyramid depth (for testing) */
	forceLevel?: number,
	wrap?: Wrapping,
	target?: WebGLRenderTarget | null,
	cacheId?: string | null,
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
export function planPyramidBlur(sigma: number, options: PyramidGaussianBlurOptions = {}): PyramidPlan {
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
 * Pyramid gaussian blur with σ given in source pixels
 */
export function pyramidGaussianBlur(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	sigma: number,
	options: PyramidGaussianBlurOptions = {},
) {
	const wrap = options.wrap ?? ClampToEdgeWrapping;
	const cacheId = options.cacheId ?? `${texture.uuid}_pyramid`;
	const coreTruncation = options.coreTruncation ?? DEFAULT_CORE_TRUNCATION;

	const { width: sourceWidth, height: sourceHeight } = getTextureSize(texture);

	const textureOptions: RenderTargetStoreOptions = {
		magFilter: LinearFilter,
		minFilter: LinearFilter,
		type: texture.type,
		wrapS: wrap,
		wrapT: wrap,
	}

	const plan = planPyramidBlur(sigma, options);
	const restoreState = options.restoreGlobalState !== false ? snapshotRendererState(renderer) : null;

	// With clamp-to-edge, the edge-replicated image is constant along the edge normal from ~2 texels outside the edge at
	// every pyramid level. Padding each level by a few texels therefore makes clamping coarse levels equivalent to clamping
	// the source, so borders match a full-resolution clamped Gaussian
	// With 'normalize' the source is zero-extended instead (the same padding argument holds: zero beyond ~2 texels) and the
	// result is divided by the blurred inside-mask
	const padding = wrap === ClampToEdgeWrapping && options.border !== 'clampPerLevel' ? LEVEL_PADDING : 0;
	const normalize = options.border === 'normalize' && wrap === ClampToEdgeWrapping;

	// downsample chain
	let source = texture;
	let unpaddedWidth = sourceWidth;
	let unpaddedHeight = sourceHeight;
	let width = sourceWidth;
	let height = sourceHeight;
	let sourcePadding = 0;
	for (let j = 1; j <= plan.level; j++) {
		unpaddedWidth = Math.ceil(unpaddedWidth / 2);
		unpaddedHeight = Math.ceil(unpaddedHeight / 2);
		const inputWidth = width, inputHeight = height;
		width = unpaddedWidth + 2 * padding;
		height = unpaddedHeight + 2 * padding;
		const levelTarget = renderTargetStore.getRenderTarget(`${cacheId}_pyramid_${j}`, width, height, textureOptions);
		// only the unpadded source needs zero-outside reads; padded levels already hold zeros beyond the image
		const shader = DownsampleMaterial.get(plan.downsampleFilters[j - 1], normalize && j === 1);
		shader.uniforms.source.value = source;
		shader.uniforms.sourceInvSize.value.set(1 / inputWidth, 1 / inputHeight);
		shader.uniforms.sourceSize.value.set(inputWidth, inputHeight);
		shader.uniforms.sourceOffset.value = sourcePadding - 2 * padding;
		sourcePadding = padding;
		Rendering.shaderMaterialPass(renderer, {
			target: levelTarget,
			shader,
			restoreGlobalState: false,
		});
		source = levelTarget.texture;
	}

	// core separable gaussian at the coarsest level
	const finalTarget = options.target ?? renderTargetStore.getRenderTarget(`${cacheId}_pyramid_result`, sourceWidth, sourceHeight, textureOptions);
	// at full resolution in 'normalize' mode taps must read zero outside the image, which needs texel-centred taps
	const zeroOutside = normalize && plan.level === 0;
	const coreTaps = GaussianTapsMaterial.computeTaps(plan.coreSigma, coreTruncation, !zeroOutside && (options.coreLinearSampling ?? defaultCoreLinearSampling(plan.level)));

	const coreX = renderTargetStore.getRenderTarget(`${cacheId}_pyramid_core_x`, width, height, textureOptions);
	const blurX = GaussianTapsMaterial.get(coreTaps.length, 'x', { zeroOutside });
	blurX.setTaps(coreTaps);
	blurX.uniforms.source.value = source;
	blurX.uniforms.sourceInvSize.value.set(1 / width, 1 / height);
	blurX.uniforms.sourceSize.value.set(width, height);
	blurX.uniforms.direction.value.set(1, 0);
	Rendering.shaderMaterialPass(renderer, { target: coreX, shader: blurX, restoreGlobalState: false });

	const coreXY = plan.level === 0 ? finalTarget : renderTargetStore.getRenderTarget(`${cacheId}_pyramid_core_xy`, width, height, textureOptions);
	const blurY = GaussianTapsMaterial.get(coreTaps.length, 'y', { zeroOutside, normalize: zeroOutside });
	blurY.setTaps(coreTaps);
	blurY.uniforms.source.value = coreX.texture;
	blurY.uniforms.sourceInvSize.value.set(1 / width, 1 / height);
	blurY.uniforms.sourceSize.value.set(width, height);
	blurY.uniforms.direction.value.set(0, 1);
	if (zeroOutside) {
		blurY.uniforms.normImageSize.value.set(sourceWidth, sourceHeight);
		blurY.uniforms.normSigma.value = sigma;
		blurY.uniforms.normPxScale.value.set(1, 1);
		blurY.uniforms.normPxOffset.value.set(0, 0);
	}
	Rendering.shaderMaterialPass(renderer, { target: coreXY, shader: blurY, restoreGlobalState: false });

	// reconstruct to output resolution
	if (plan.level > 0) {
		const upsample = UpsampleMaterial.get(plan.upsampleFilter, normalize);
		const scale = 1 / Math.pow(2, plan.level);
		upsample.uniforms.source.value = coreXY.texture;
		upsample.uniforms.sourceInvSize.value.set(1 / width, 1 / height);
		upsample.uniforms.outToSource.value.set(
			(sourceWidth / finalTarget.width) * scale,
			(sourceHeight / finalTarget.height) * scale,
		);
		upsample.uniforms.sourceOffset.value = padding;
		if (normalize) {
			upsample.uniforms.normImageSize.value.set(sourceWidth, sourceHeight);
			upsample.uniforms.normSigma.value = sigma;
			upsample.uniforms.normPxScale.value.set(sourceWidth / finalTarget.width, sourceHeight / finalTarget.height);
			upsample.uniforms.normPxOffset.value.set(0, 0);
		}
		Rendering.shaderMaterialPass(renderer, { target: finalTarget, shader: upsample, restoreGlobalState: false });
	}

	restoreState?.();
	return finalTarget;
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
 * Drop-in replacement for haxiomic-engine `gaussianBlur()`
 *
 * σ is derived from `kernel` and `truncationSigma` exactly as Blur1D does: σ = truncationSigma · (N - 1) / 2. The result
 * is an untruncated Gaussian of that σ (Blur1D truncates at 1/truncationSigma σ)
 */
export function gaussianBlur(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	kernel: number,
	truncationSigma: number = 0.5,
	wrap: Wrapping = ClampToEdgeWrapping,
	target: WebGLRenderTarget | null = null,
	cacheId: string | null = null,
) {
	return pyramidGaussianBlur(renderer, renderTargetStore, texture, sigmaFromKernel(kernel, truncationSigma), {
		wrap,
		target,
		cacheId: cacheId ?? `${texture.uuid}_${truncationSigma}`,
	});
}

/**
 * Core taps are merged into bilinear fetches only at full resolution. (Merging at level 1 saves ~0.03 ms at 1080p but
 * raises worst-case shift variance from ~0.12% to ~0.6% of peak.)
 */
export function defaultCoreLinearSampling(level: number) {
	return level === 0;
}

/** σ (in pixels) used by haxiomic-engine Blur1D for a given kernel & truncationSigma */
export function sigmaFromKernel(kernel: number, truncationSigma: number = 0.5) {
	const N = Blur1D.nearestBestKernel(kernel);
	return truncationSigma * (N - 1) / 2;
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

export class DownsampleMaterial extends ShaderMaterial<{
	source: Uniform<Texture | null>,
	sourceInvSize: Uniform<Vector2>,
	sourceOffset: Uniform<number>,
	/** source size in texels, used when reading outside the source as zero */
	sourceSize: Uniform<Vector2>,
}> {

	static instances = new Map<string, DownsampleMaterial>();

	/**
	 * @param zeroOutside read outside the source as zero (for the first downsample of the 'normalize' border mode)
	 */
	static get(filter: PyramidDownsampleFilter, zeroOutside = false) {
		const key = `${filter}_${zeroOutside}`;
		let instance = DownsampleMaterial.instances.get(key);
		if (!instance) {
			instance = new DownsampleMaterial(filter, zeroOutside);
			DownsampleMaterial.instances.set(key, instance);
		}
		return instance;
	}

	constructor(filter: PyramidDownsampleFilter, zeroOutside: boolean) {
		if (zeroOutside && filter !== 'binomial4') {
			throw new Error(`DownsampleMaterial: zero-outside reads are only implemented for 'binomial4'`);
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

		// near the border bilinear taps would mix in clamped texels, so use the 16 texel-centre taps with a bounds test
		const borderPath = zeroOutside ? /*glsl*/`
			if (any(lessThan(c, vec2(2.0))) || any(greaterThan(c, sourceSize - 2.0))) {
				float w[4] = float[4](0.125, 0.375, 0.375, 0.125);
				for (int j = 0; j < 4; j++) {
					for (int i = 0; i < 4; i++) {
						vec2 t = c + vec2(float(i) - 1.5, float(j) - 1.5);
						result += textureLod(source, t * sourceInvSize, 0.0) * (w[i] * w[j] * insideTexels(t, sourceSize));
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

class UpsampleMaterial extends ShaderMaterial<{
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
	 */
	static get(tapCount: number, key: string = 'x', flags: { zeroOutside?: boolean, normalize?: boolean } = {}) {
		const id = `${tapCount}_${key}_${!!flags.zeroOutside}_${!!flags.normalize}`;
		let instance = GaussianTapsMaterial.instances.get(id);
		if (!instance) {
			instance = new GaussianTapsMaterial(tapCount, !!flags.zeroOutside, !!flags.normalize);
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

	constructor(tapCount: number, zeroOutside: boolean, normalize: boolean) {
		// unrolled with constant indices: faster than a dynamic loop over the uniform array
		const samples: string[] = [];
		for (let i = 0; i < tapCount; i++) {
			samples.push(zeroOutside
				? `t = c + direction * taps[${i}].x; result += textureLod(source, t * sourceInvSize, 0.0) * (taps[${i}].y * insideTexels(t, sourceSize));`
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
