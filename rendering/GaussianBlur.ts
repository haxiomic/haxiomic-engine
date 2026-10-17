import { ClampToEdgeWrapping, LinearFilter, Texture, WebGLRenderTarget, WebGLRenderer, Wrapping } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import Blur1D from "../materials/Blur1D.js";
import { Rendering } from "./Rendering.js";
import { gaussianBlur as pyramidGaussianBlurCompat } from "./PyramidGaussianBlur.js";

/**
 * Gaussian blur with σ = truncationSigma · (N - 1) / 2 pixels, where N is `kernel` (rounded as `Blur1D` does)
 *
 * With `ClampToEdgeWrapping` (the default) this uses `pyramidGaussianBlur()`: cost is ~constant with respect to σ and the
 * result is shift-invariant, so small HDR highlights do not shimmer as they move. The kernel is an untruncated Gaussian;
 * `truncationSigma` only sets σ. Other wrap modes use `separableGaussianBlur()`, the previous full-resolution
 * implementation, which truncates the kernel at ±σ / truncationSigma and handles repeat/mirror borders exactly.
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
	// the pyramid's border handling is exact for clamp-to-edge only
	if (wrap !== ClampToEdgeWrapping) {
		return separableGaussianBlur(renderer, renderTargetStore, texture, kernel, truncationSigma, wrap, target, cacheId);
	}
	return pyramidGaussianBlurCompat(renderer, renderTargetStore, texture, kernel, truncationSigma, wrap, target, cacheId);
}

/**
 * Previous `gaussianBlur()` implementation: two full-resolution `Blur1D` passes. Cost grows linearly with `kernel`
 */
export function separableGaussianBlur(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	kernel: number,
	truncationSigma: number = 0.5,
	wrap: Wrapping = ClampToEdgeWrapping,
	target: WebGLRenderTarget | null = null,
	cacheId: string | null = null,
) {
	if (cacheId == null) {
		cacheId = `${texture.uuid}_${truncationSigma}`;
	}

	let ctx = renderer.getContext();

	let image = texture.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
	let sourceData = texture.source.data as { width?: number; height?: number };
	let textureWidth: number = image.width ?? sourceData.width ?? image.videoWidth!;
	let textureHeight: number = image.height ?? sourceData.height ?? image.videoHeight!;

	let textureOptions: RenderTargetStoreOptions = {
		magFilter: LinearFilter,
		type: texture.type,
		wrapS: wrap,
		wrapT: wrap,
	}

	let blurX = Blur1D.get(ctx, kernel, truncationSigma, 1, 0, texture, textureWidth, textureHeight);

	let blurredMaskX = renderTargetStore.getRenderTarget(`${cacheId}_blur2D_x`, textureWidth, textureHeight, textureOptions);

	Rendering.shaderMaterialPass(renderer, {
		target: blurredMaskX,
		restoreGlobalState: true,
		shader: blurX,
	});

	let result = target ?? renderTargetStore.getRenderTarget(`${cacheId}_blur2D_xy`, textureWidth, textureHeight, textureOptions);

	let blurY = Blur1D.get(ctx, kernel, truncationSigma, 0, 1, blurredMaskX.texture, textureWidth, textureHeight);

	Rendering.shaderMaterialPass(renderer, {
		target: result,
		restoreGlobalState: true,
		shader: blurY,
	});

	return result;
}