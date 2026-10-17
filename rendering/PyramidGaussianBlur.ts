import { ClampToEdgeWrapping, LinearFilter, MirroredRepeatWrapping, RepeatWrapping, Texture, WebGLRenderTarget, WebGLRenderer, Wrapping } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import Blur1D from "../materials/Blur1D.js";
import { Rendering } from "./Rendering.js";
import { DEFAULT_CORE_TRUNCATION, DownsampleMaterial, GaussianTapsMaterial, LEVEL_PADDING, UpsampleMaterial, WrapMode, defaultCoreLinearSampling, getTextureSize, planPyramidBlur, snapshotRendererState } from "./PyramidInternals.js";

/**
 * How the blur treats pixels beyond the image edge, with `ClampToEdgeWrapping`:
 * - 'clampToEdge': repeats the outermost pixel row, as classic clamp-to-edge does
 * - 'clampPerLevel': each pyramid level repeats its own edge texel, as `generateBlurredMipmaps()` does, so wide blurs
 *   repeat a σ-scale band of edge content. Slightly cheaper (no level padding)
 * - 'normalize': averages only pixels inside the image, so wide blurs converge to the in-frame mean
 */
export type PyramidBorder = 'clampToEdge' | 'clampPerLevel' | 'normalize';

export type PyramidGaussianBlurOptions = {
	/** @default 'clampToEdge' */
	border?: PyramidBorder,
	/**
	 * Edge wrapping of the source and result. Repeat and mirror pad each level with wrapped content, so they cost more
	 * as σ grows relative to the image (about (1 + 10σ / size)² of the clamp cost at the first level). @default ClampToEdgeWrapping
	 */
	wrap?: Wrapping,
	/** Render into this target instead of a cached one */
	target?: WebGLRenderTarget | null,
	/** Key for the cached intermediate and result targets @default texture.uuid */
	cacheId?: string | null,
	/** Restore the renderer's render target & viewport afterwards @default true */
	restoreGlobalState?: boolean,
	/**
	 * Advanced. Smallest σ, in texels, of the exact Gaussian run at the coarsest level. Lower is cheaper but less
	 * shift-invariant: worst-case flicker ≈ 0.4% of peak at 2, 0.12% at 3. @default 3
	 */
	minCoreSigma?: number,
	/** Advanced. Truncation of that Gaussian, in σ: 4 is cheaper; 5 hides the cut-off even around HDR highlights. @default 5 */
	coreTruncation?: number,
}

/**
 * Gaussian blur with σ in pixels, as an anti-aliased image pyramid: downsample by 2× (binomial [1,3,3,1]), an exact
 * Gaussian at the coarsest level where its σ ≥ `minCoreSigma`, then one cubic B-spline upsample to full resolution.
 *
 * Use for any blur from a few pixels up to the image size. Cost is roughly constant in σ (1080p: ≈0.06 ms at σ = 16,
 * 4K: ≈0.16 ms at σ = 128, RTX 5070) and the result is shift-invariant, so moving highlights don't shimmer. Below
 * σ ≈ 6 px it runs at full resolution and costs about as much as a separable blur. Pass a fraction of the image size
 * as σ for a resolution-independent blur.
 */
export function pyramidGaussianBlur(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	sigma: number,
	options: PyramidGaussianBlurOptions = {},
) {
	const wrap = options.wrap ?? ClampToEdgeWrapping;
	const wrapMode: WrapMode = wrap === RepeatWrapping ? 'repeat' : wrap === MirroredRepeatWrapping ? 'mirror' : 'clamp';
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

	const plan = planPyramidBlur(sigma, { minCoreSigma: options.minCoreSigma });
	const restoreState = options.restoreGlobalState !== false ? snapshotRendererState(renderer) : null;

	const clamp = wrapMode === 'clamp';
	const normalize = clamp && options.border === 'normalize';
	// at full resolution, 'normalize' (zero outside) and wrapping read texel-centred taps
	const zeroOutside = normalize && plan.level === 0;
	const wrapTaps = !clamp && plan.level === 0;
	const coreTaps = GaussianTapsMaterial.computeTaps(plan.coreSigma, coreTruncation, !zeroOutside && !wrapTaps && defaultCoreLinearSampling(plan.level));

	// Texels of padding around each level (index = level; the source has none).
	// Clamp: the edge-replicated image is constant along the edge normal from ~2 texels outside the edge at every level,
	// so a few texels of padding make clamping coarse levels equivalent to clamping the source (and with 'normalize' the
	// zero-extended source likewise). Repeat / mirror: the first downsample reads the source with wrapped texel indices,
	// and each level is padded enough for the passes after it (core blur and upsample at the coarsest level, the next
	// downsample otherwise), so no level relies on hardware wrapping, which would not tile the image period at odd sizes
	const padding = new Array<number>(plan.level + 1).fill(0);
	if (clamp) {
		if (options.border !== 'clampPerLevel') padding.fill(LEVEL_PADDING, 1);
	} else if (plan.level > 0) {
		const coreRadius = Math.ceil(Math.max(...coreTaps.map(t => Math.abs(t.x)))) + 1;
		padding[plan.level] = coreRadius + 3;
		for (let j = plan.level - 1; j >= 1; j--) padding[j] = 2 * padding[j + 1] + 2;
	}

	// downsample chain
	let source = texture;
	let unpaddedWidth = sourceWidth;
	let unpaddedHeight = sourceHeight;
	let width = sourceWidth;
	let height = sourceHeight;
	for (let j = 1; j <= plan.level; j++) {
		unpaddedWidth = Math.ceil(unpaddedWidth / 2);
		unpaddedHeight = Math.ceil(unpaddedHeight / 2);
		const inputWidth = width, inputHeight = height;
		width = unpaddedWidth + 2 * padding[j];
		height = unpaddedHeight + 2 * padding[j];
		const levelTarget = renderTargetStore.getRenderTarget(`${cacheId}_pyramid_${j}`, width, height, textureOptions);
		// only reads of the source need special border handling; padded levels already hold the extended image
		const shader = DownsampleMaterial.get(plan.downsampleFilters[j - 1], {
			zeroOutside: normalize && j === 1,
			wrap: j === 1 ? wrapMode : 'clamp',
		});
		shader.uniforms.source.value = source;
		shader.uniforms.sourceInvSize.value.set(1 / inputWidth, 1 / inputHeight);
		shader.uniforms.sourceSize.value.set(inputWidth, inputHeight);
		shader.uniforms.sourceOffset.value = padding[j - 1] - 2 * padding[j];
		Rendering.shaderMaterialPass(renderer, {
			target: levelTarget,
			shader,
			restoreGlobalState: false,
		});
		source = levelTarget.texture;
	}

	// core separable gaussian at the coarsest level
	const finalTarget = options.target ?? renderTargetStore.getRenderTarget(`${cacheId}_pyramid_result`, sourceWidth, sourceHeight, textureOptions);
	const coreWrap = wrapTaps ? wrapMode : 'clamp';

	const coreX = renderTargetStore.getRenderTarget(`${cacheId}_pyramid_core_x`, width, height, textureOptions);
	const blurX = GaussianTapsMaterial.get(coreTaps.length, 'x', { zeroOutside, wrap: coreWrap });
	blurX.setTaps(coreTaps);
	blurX.uniforms.source.value = source;
	blurX.uniforms.sourceInvSize.value.set(1 / width, 1 / height);
	blurX.uniforms.sourceSize.value.set(width, height);
	blurX.uniforms.direction.value.set(1, 0);
	Rendering.shaderMaterialPass(renderer, { target: coreX, shader: blurX, restoreGlobalState: false });

	const coreXY = plan.level === 0 ? finalTarget : renderTargetStore.getRenderTarget(`${cacheId}_pyramid_core_xy`, width, height, textureOptions);
	const blurY = GaussianTapsMaterial.get(coreTaps.length, 'y', { zeroOutside, normalize: zeroOutside, wrap: coreWrap });
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
		upsample.uniforms.sourceOffset.value = padding[plan.level];
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

/** σ in pixels of `gaussianBlur(…, kernel, truncationSigma)`: truncationSigma · (N − 1) / 2, N rounded as Blur1D does */
export function sigmaFromKernel(kernel: number, truncationSigma: number = 0.5) {
	const N = Blur1D.nearestBestKernel(kernel);
	return truncationSigma * (N - 1) / 2;
}
