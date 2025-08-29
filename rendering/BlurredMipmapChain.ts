import Blur1D from "../materials/Blur1D.js";
import { RGBASwizzle, Swizzle } from "../materials/Swizzle.js";
import { mipmapCount } from "../math/Math.js";
import { Rendering } from "./Rendering.js";
import RenderTargetStore from "./RenderTargetStore.js";
import { LinearFilter, LinearMipmapNearestFilter, PixelFormat, WebGLRenderer, WebGLRenderTarget } from "three";

export function generateBlurredMipmaps(
    renderer: WebGLRenderer, 
    options: {
        target: WebGLRenderTarget,
        /** Blur radius in fractions of image height. Set at 1.0, a blur in the center would combine every pixel in the image */
        blurKernel_heightFraction: number,
        truncationSigma?: number,
        restoreGlobalState?: boolean,
        swizzle?: Swizzle,
    }
) {
    const target = options.target;
    const swizzle = options.swizzle;
    const blurKernel_heightFraction = options.blurKernel_heightFraction ?? 1/16;
    const blurKernel_pixels = blurKernel_heightFraction * target.height * .5;
    const truncationSigma = options.truncationSigma ?? 0.5;
    const restoreGlobalState = options.restoreGlobalState ?? true;

    // allocate mipmap chain if it doesn't exist
    if (target.texture.mipmaps == null) {
        target.texture.mipmaps = new Array(mipmapCount(target.width, target.height)).fill({});
    }

    // we'll need a ping-pong target to render x-blur pass
    const blurredMipsXPong = RenderTargetStore.getStoreForRenderTarget(target).getRenderTarget(
        'x-pass',
        Math.floor(target.width * 0.5), Math.floor(target.height * 0.5),
        {
            magFilter: LinearFilter,
            minFilter: LinearMipmapNearestFilter,
            type: target.texture.type,
            format: target.texture.format as PixelFormat,
            wrapS: target.texture.wrapS,
            wrapT: target.texture.wrapT,
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
            sourceMipmapLevel,
            swizzle
        );

        width = Math.floor(width * 0.5);
        height = Math.floor(height * 0.5);

        const blurredXMipmapLevel = i - 1;
        // console.log(`Blurring mipmap level ${i} ${width}x${height}, source mipmap level ${sourceMipmapLevel}, blurredXMipmapLevel ${blurredXMipmapLevel}`);

        Rendering.shaderMaterialPass(renderer, {
            target: blurredMipsXPong,
            targetMipmapLevel: blurredXMipmapLevel,
            shader: blurXShader,
            restoreGlobalState: false,
        });

        // render Y blur into the right mipmap level
        const blurYShader = Blur1D.get(
            gl, 
            blurKernel_pixels * .5,
            truncationSigma,
            0, 1,
            blurredMipsXPong.texture,
            width, height,
            blurredXMipmapLevel,
            swizzle
        );

        Rendering.shaderMaterialPass(renderer, {
            target: target,
            targetMipmapLevel: i,
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