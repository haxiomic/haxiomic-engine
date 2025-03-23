import { ClampToEdgeWrapping, LinearFilter, Texture, WebGLRenderTarget, WebGLRenderer, Wrapping } from "three";
import RenderTargetStore, { RenderTargetStoreOptions } from "./RenderTargetStore.js";
import Blur1D from "../materials/Blur1D.js";
import { Rendering } from "./Rendering.js";

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
	if (cacheId == null) {
		cacheId = `${texture.uuid}_${truncationSigma}`;
	}

	let ctx = renderer.getContext();

	let textureWidth: number = texture.image.width ?? texture.source.data.width ?? texture.image.videoWidth;
	let textureHeight: number = texture.image.height ?? texture.source.data.height ?? texture.image.videoHeight;

	let textureOptions: RenderTargetStoreOptions = {
		magFilter: LinearFilter,
		type: texture.type,
		wrapS: wrap,
		wrapT: wrap,
	}

	let blurX = Blur1D.get(ctx, kernel, truncationSigma, 1, 0, texture, textureWidth, textureHeight);
	
	let blurredMaskX = renderTargetStore.getRenderTarget(`${cacheId}_blur2D_x`, textureWidth, textureHeight, textureOptions);

	Rendering.shaderPass(renderer, {
		target: blurredMaskX,
		restoreGlobalState: true,
		shader: blurX,
	});

	let result = target ?? renderTargetStore.getRenderTarget(`${cacheId}_blur2D_xy`, textureWidth, textureHeight, textureOptions);

	let blurY = Blur1D.get(ctx, kernel, truncationSigma, 0, 1, blurredMaskX.texture, textureWidth, textureHeight);

	Rendering.shaderPass(renderer, {
		target: result,
		restoreGlobalState: true,
		shader: blurY,
	});

	return result;
}