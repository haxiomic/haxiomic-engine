import { RenderTargetOptions, WebGLRenderTarget } from "three";
import { mod } from "../math/Math.js";

export class RenderTargetRing {

    targets: WebGLRenderTarget[] = [];
    writeIndex: number = 0;

    get width() {
        return this.targets[0].width;
    }
    get height() {
        return this.targets[0].height;
    }
    get count() {
        return this.targets.length;
    }

    constructor(arrayOptions: { width: number, height: number, count: number}, textureOptions: RenderTargetOptions) {
        for (let i = 0; i < arrayOptions.count; i++) {
            this.targets.push(new WebGLRenderTarget(arrayOptions.width, arrayOptions.height, textureOptions));
        }
    }

    next() {
        this.writeIndex = (this.writeIndex + 1) % this.targets.length;
    }

    getNthTarget(n: number) {
        let i = mod(this.writeIndex + n, this.targets.length);
        return this.targets[i];
    }

    getReadTarget() {
        let readIndex = mod(this.writeIndex - 1, this.targets.length);
        return this.targets[readIndex];
    }

    getWriteTarget() {
        return this.targets[this.writeIndex];
    }

    resize(newWidth: number, newHeight: number) {
        for (let target of this.targets) {
            target.setSize(newWidth, newHeight);
        }
    }

}