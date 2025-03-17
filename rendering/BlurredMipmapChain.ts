import Blur1D from "@haxiomic-engine/materials/Blur1D";
import { Rendering } from "@haxiomic-engine/rendering/Rendering";
import RenderTargetStore from "@haxiomic-engine/rendering/RenderTargetStore";
import { LinearFilter, LinearMipmapNearestFilter, Vector4, WebGLRenderer, WebGLRenderTarget } from "three";

export function generateBlurredMipmaps(
    renderer: WebGLRenderer, 
    options: {
        target: WebGLRenderTarget,
        /** Blur radius in fractions of image height. Set at 1.0, a blur in the center would combine every pixel in the image */
        blurKernel_heightFraction: number,
        truncationSigma?: number,
        restoreGlobalState?: boolean,
    }
) {
    const target = options.target;
    const blurKernel_heightFraction = options.blurKernel_heightFraction ?? 1/16;
    const blurKernel_pixels = blurKernel_heightFraction * target.height * .5;
    const truncationSigma = options.truncationSigma ?? 0.5;
    const restoreGlobalState = options.restoreGlobalState ?? true;

    // allocate mipmap chain if it doesn't exist
    if (target.texture.mipmaps == null) {
        const mipmapCount = Math.floor(Math.log2(Math.max(target.width, target.height))) + 1;
        target.texture.mipmaps = new Array(mipmapCount).fill({});
    }

    // we'll need a ping-pong target to render x-blur pass
    let blurredMipsXPong = getRenderTargetStore(target).getRenderTarget(
        'x-pass',
        Math.floor(target.width * 0.5), Math.floor(target.height * 0.5),
        {
            magFilter: LinearFilter,
            minFilter: LinearMipmapNearestFilter,
            type: target.texture.type,
            format: target.texture.format,
            allocateMipmaps: true,
        }
    );

    const gl = renderer.getContext();

    if (restoreGlobalState) {
        Rendering.saveGlobalState(renderer);
    }

    const sourceTexture = target.texture;
    let width = target.width;
    let height = target.height;
    let sourceMipmapLevel = 0;

    // render blurred mips
    let i = 1;
    while (width > 1 && height > 1) {
        const blurXShader = Blur1D.get(
            gl, 
            blurKernel_pixels, 
            truncationSigma, 
            1, 0, 
            sourceTexture,
            width, height,
            sourceMipmapLevel
        );

        width = Math.floor(width * 0.5);
        height = Math.floor(height * 0.5);

        const blurredXMipmapLevel = i - 1;
        // console.log(`Blurring mipmap level ${i} ${width}x${height}, source mipmap level ${sourceMipmapLevel}, blurredXMipmapLevel ${blurredXMipmapLevel}`);

        Rendering.shaderPass(renderer, {
            target: blurredMipsXPong,
            targetMipmapLevel: blurredXMipmapLevel,
            shader: blurXShader,
            viewport: _viewport.set(0, 0, width, height),
            restoreGlobalState: false,
        });

        // render Y blur into the right mipmap level
        const blurYShader = Blur1D.get(
            gl, 
            blurKernel_pixels,
            truncationSigma,
            0, 1,
            blurredMipsXPong.texture,
            width, height,
            blurredXMipmapLevel
        );

        Rendering.shaderPass(renderer, {
            target: target,
            targetMipmapLevel: i,
            viewport: _viewport.set(0, 0, width, height),
            restoreGlobalState: false,
            shader: blurYShader,
        });

        // now the source becomes our last rendered texture and level
        sourceMipmapLevel = i;

        i++;
    }

    if (restoreGlobalState) {
        Rendering.restoreGlobalState(renderer);
    }
}

const storeSymbol = Symbol('generateBlurredMipmaps().RenderTargetStore');
function getRenderTargetStore(target: WebGLRenderTarget) {
    if ((target as any)[storeSymbol] == null) {
        const store = new RenderTargetStore();
        (target as any)[storeSymbol] = store;
        // dispose store when target is disposed
        target.addEventListener('dispose', () => {
            store.clearAndDispose();
        });
    }
    return (target as any)[storeSymbol] as RenderTargetStore;
}

const _viewport = new Vector4();