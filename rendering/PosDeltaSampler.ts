import { NearestFilter, NoColorSpace, PixelFormat, RawShaderMaterial, Texture, Uniform, Vector2, WebGLRenderer } from "three";
import { DualRenderTarget } from "./DualRenderTarget.js";
import { Switch } from "../Functional.js";
import { Rendering } from "./Rendering.js";

export enum PosDeltaSamplerDataFormat {
    /**
        [ p q ]
        position = texture2D(uPosDelta, 0.5).xy
        lastPosition = texture2D(uPosDelta, 0.5).zw
    **/
    SinglePixel = 0,

    /**
        Use if position contains more than two values
        [ p, q ]
        position = texture2D(uPosDelta, vec2(0.25, 0.5));
        lastPosition = texture2D(uPosDelta, vec2(0.75, 0.5));
    **/
    DoublePixel = 1,
}

export class PosDeltaSampler {

    readonly uPosTexture = new Uniform<Texture>(new Texture());
    readonly dataFormat: PosDeltaSamplerDataFormat;

    protected readonly renderer: WebGLRenderer;
    protected readonly positionTexture: Texture;
    protected readonly renderTarget: DualRenderTarget;
    protected readonly shader: RawShaderMaterial;

    protected readonly uPointerUv = new Uniform(new Vector2());

    constructor(renderer: WebGLRenderer, positionTexture: Texture, dataFormat: PosDeltaSamplerDataFormat) {
        this.renderer = renderer;
        this.positionTexture = positionTexture;
        this.dataFormat = dataFormat;

        this.renderTarget = new DualRenderTarget(renderer, 2, 1, {
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            colorSpace: NoColorSpace,
            type: positionTexture.type,
            stencilBuffer: false,
            depthBuffer: false,
            anisotropy: 0,
            format: positionTexture.format as PixelFormat,
            generateMipmaps: false,
        });

        this.shader = new RawShaderMaterial({
            uniforms: {
                uPointerUv: this.uPointerUv,
                uPositionTexture: new Uniform(positionTexture),
                uLastFrameTexture: this.renderTarget.uniform,
            },
            vertexShader: /*glsl*/`
                attribute vec2 position;

                varying vec2 vUv;

                void main() {
                    vUv = position * 0.5 + 0.5;
                    gl_Position = vec4(position, 0., 1.);
                }
            `,
            fragmentShader: /*glsl*/`
                precision highp float;

                uniform vec2 uPointerUv;

                uniform sampler2D uLastFrameTexture;
                uniform sampler2D uPositionTexture;

                ${Switch(dataFormat, {
                    [PosDeltaSamplerDataFormat.DoublePixel]: 'varying vec2 vUv;',
                    default: ""
                })}

                void main() {
                    ${Switch(dataFormat, {
                        [PosDeltaSamplerDataFormat.SinglePixel]: /*glsl*/`
                            gl_FragColor = vec4(
                                texture2D(uPositionTexture, uPointerUv).xy,
                                texture2D(uLastFrameTexture, vec2(0.5)).xy
                            );
                        `,
                        [PosDeltaSamplerDataFormat.DoublePixel]: /*glsl*/`
                            if (vUv.x > 0.5) {
                                gl_FragColor = texture2D(uLastFrameTexture, vec2(0.25, 0.5));
                            } else {
                                gl_FragColor = texture2D(uPositionTexture, uPointerUv);
                            }
                        `,
                    })}
                }
            `,
        });
    }

    update(pointerUv: Vector2) {
        this.uPointerUv.value.copy(pointerUv);

        Rendering.shaderMaterialPass(this.renderer, {
            restoreGlobalState: true,
            target: this.renderTarget.getRenderTarget(),
            clearDepth: false,
            shader: this.shader,
        });

        this.renderTarget.swap();

        this.uPosTexture.value = this.renderTarget.getTexture();
    }

}