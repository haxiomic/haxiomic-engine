import { ClampToEdgeWrapping, LinearFilter, Texture, WebGLRenderTarget, WebGLRenderer, Wrapping } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import Blur1D from "../materials/Blur1D.js";
import { Rendering } from "./Rendering.js";
import { pyramidGaussianBlur, sigmaFromKernel } from "./PyramidGaussianBlur.js";

/**
 * Gaussian blur with σ = truncationSigma · (N − 1) / 2 pixels (N = `kernel`, rounded as Blur1D does), via
 * `pyramidGaussianBlur()`: cost roughly constant in σ, and shift-invariant. The kernel is untruncated, so
 * `truncationSigma` only sets σ. For a σ in pixels or a fraction of the image, call `pyramidGaussianBlur()` directly.
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
 * The previous `gaussianBlur()`: two full-resolution Blur1D passes with the kernel truncated at ±σ / truncationSigma.
 * Cost grows linearly with `kernel`. For callers that rely on the truncated kernel's look
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