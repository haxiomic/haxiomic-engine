import { RenderTargetOptions, Texture, Uniform, WebGLRenderer, WebGLRenderTarget } from "three";
import { Rendering } from "./Rendering";

export class DualRenderTarget {

    readonly uniform: Uniform<Texture>;

    _width: number;
    _height: number;

    get width() {
        return this._width;
    }
    get height() {
        return this._height;
    }

    options: RenderTargetOptions;

    a: WebGLRenderTarget;
    b: WebGLRenderTarget;

    constructor(private renderer: WebGLRenderer, width: number, height: number, options: RenderTargetOptions) {
        this.options = options;
        this.a = new WebGLRenderTarget(width, height, options);
        this.b = new WebGLRenderTarget(width, height, options);
        this.uniform = new Uniform(this.b.texture);
        this._width = width;
        this._height = height;
    }

    setOptions(newOptions: RenderTargetOptions) {
        this.options = {...this.options, ...newOptions};
        // recreate the render targets
        this.resize(this.width, this.height);
    }

    resize(newWidth: number, newHeight: number) {
        var aNew = new WebGLRenderTarget(newWidth, newHeight, this.options);
        var bNew = new WebGLRenderTarget(newWidth, newHeight, this.options);

        // copy content to new texture (following whatever filtering params the textures use)
        Rendering.saveGlobalState(this.renderer);
        Rendering.blit(this.renderer, {
            restoreGlobalState: false,
            source: this.a.texture,
            target: aNew,
        });
        Rendering.blit(this.renderer, {
            restoreGlobalState: false,
            source: this.b.texture,
            target: bNew,
        });
        Rendering.restoreGlobalState(this.renderer);

        this.a.dispose();
        this.b.dispose();

        this.a = aNew;
        this.b = bNew;

        this.uniform.value = this.b.texture;

        this._width = newWidth;
        this._height = newHeight;
    }

    swap() {
        var t = this.a;
        this.a = this.b;
        this.b = t;
        this.uniform.value = this.b.texture;
    }

    getWriteRenderTarget() {
        return this.a;
    }

    getReadRenderTarget() {
        return this.b;
    }

    getRenderTarget() {
        return this.a;
    }

    getTexture() {
        return this.b.texture;
    }

}