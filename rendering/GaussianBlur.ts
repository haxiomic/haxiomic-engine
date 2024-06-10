import { LinearFilter, Texture, WebGLRenderTarget, WebGLRenderer } from "three";
import RenderTargetStore from "./RenderTargetStore";
import Blur1D from "../materials/Blur1D";
import { Rendering } from "./Rendering";

export function gaussianBlur(
	renderer: WebGLRenderer,
	renderTargetStore: RenderTargetStore,
	texture: Texture,
	target: WebGLRenderTarget | null,
	width: number,
	height: number,
	kernel: number,
	truncationSigma: number = 0.5,
	cacheId: string | null = null,
) {
	if (cacheId == null) {
		cacheId = `${texture.uuid}_${truncationSigma}`;
	}

	let ctx = renderer.getContext();

	let textureOptions = {
		width: width,
		height: height,
		filtering: LinearFilter,
		type: texture.type,
	}

	let blurX = Blur1D.get(ctx, kernel, truncationSigma, 1, 0, texture, width, height);
	
	let blurredMaskX = renderTargetStore.getRenderTarget(`${cacheId}_blur2D_x`, textureOptions);

	Rendering.shaderPass(renderer, {
		target: blurredMaskX,
		restoreGlobalState: true,
		shader: blurX,
	});

	let result = target ?? renderTargetStore.getRenderTarget(`${cacheId}_blur2D_xy`, textureOptions);

	let blurY = Blur1D.get(ctx, kernel, truncationSigma, 0, 1, blurredMaskX.texture, width, height);

	Rendering.shaderPass(renderer, {
		target: result,
		restoreGlobalState: true,
		shader: blurY,
	});

	return result;
}