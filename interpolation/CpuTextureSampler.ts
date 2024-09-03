export enum WrapMode {
    REPEAT,
    CLAMP,
}

export class CpuTextureSampler {
    width: number;
    height: number;
    pixels: ArrayLike<number>;
    wrapS: WrapMode;
    wrapT: WrapMode;
    channels: number;

    constructor(tightlyPackedPixels: ArrayLike<number>, width: number, height: number, channels: number, wrapS = WrapMode.CLAMP, wrapT = WrapMode.CLAMP) {
        this.pixels = tightlyPackedPixels;
        this.width = width;
        this.height = height;
        this.channels = channels;
        this.wrapS = wrapS;
        this.wrapT = wrapT;
    }

    sampleNearest(uvX: number, uvY: number): number[] {
        const i = Math.floor(uvX * this.width);
        const j = Math.floor(uvY * this.height);
        return this.getPixel(i, j);
    }

    sampleNearestChannel(uvX: number, uvY: number, channel: number): number {
        const i = Math.floor(uvX * this.width);
        const j = Math.floor(uvY * this.height);
        return this.getPixelChannel(i, j, channel);
    }

    sampleLinear(uvX: number, uvY: number): number[] {
        const x = uvX * this.width - 0.5;
        const y = uvY * this.height - 0.5;
        const i = Math.floor(x);
        const j = Math.floor(y);

        const fx = x - i;
        const fy = y - j;

        const tl = this.getPixel(i, j);
        const tr = this.getPixel(i + 1, j);
        const bl = this.getPixel(i, j + 1);
        const br = this.getPixel(i + 1, j + 1);

        const result = new Array(this.channels);
        for (let c = 0; c < this.channels; c++) {
            const topRow = tl[c] * (1.0 - fx) + tr[c] * fx;
            const bottomRow = bl[c] * (1.0 - fx) + br[c] * fx;
            result[c] = bottomRow * fy + topRow * (1.0 - fy);
        }

        return result;
    }

    sampleLinearChannel(uvX: number, uvY: number, channel: number): number {
        const x = uvX * this.width - 0.5;
        const y = uvY * this.height - 0.5;
        const i = Math.floor(x);
        const j = Math.floor(y);

        const fx = x - i;
        const fy = y - j;

        const tl = this.getPixelChannel(i, j, channel);
        const tr = this.getPixelChannel(i + 1, j, channel);
        const bl = this.getPixelChannel(i, j + 1, channel);
        const br = this.getPixelChannel(i + 1, j + 1, channel);

        const topRow = tl * (1.0 - fx) + tr * fx;
        const bottomRow = bl * (1.0 - fx) + br * fx;
        return bottomRow * fy + topRow * (1.0 - fy);
    }

    sampleBicubic(uvX: number, uvY: number) {
        const x = uvX * this.width + 0.5;
        const y = uvY * this.height + 0.5;
        const i = Math.floor(x);
        const j = Math.floor(y);

        const fx = x - i;
        const fy = y - j;

        const result = new Array(this.channels).fill(0);

        for (let c = 0; c < this.channels; c++) {
            let sum = 0;
            for (let m = -1; m <= 2; m++) {
                for (let n = -1; n <= 2; n++) {
                    const pixel = this.getPixel(i + m - 1, j + n - 1)[c];
                    const weight = this.cubicKernel(m - fx) * this.cubicKernel(fy - n);
                    sum += pixel * weight;
                }
            }
            result[c] = sum;
        }

        return result;
    }

    sampleBicubicChannel(uvX: number, uvY: number, channel: number): number {
        const x = uvX * this.width + 0.5;
        const y = uvY * this.height + 0.5;
        const i = Math.floor(x);
        const j = Math.floor(y);

        const fx = x - i;
        const fy = y - j;

        let sum = 0;
        for (let m = -1; m <= 2; m++) {
            for (let n = -1; n <= 2; n++) {
                const pixel = this.getPixelChannel(i + m - 1, j + n - 1, channel);
                const weight = this.cubicKernel(m - fx) * this.cubicKernel(fy - n);
                sum += pixel * weight;
            }
        }

        return sum;
    }

    private cubicKernel(x: number) {
        x = Math.abs(x);
        if (x <= 1) {
            return (1.5 * x - 2.5) * x * x + 1;
        } else if (x < 2) {
            return ((-0.5 * x + 2.5) * x - 4) * x + 2;
        } else {
            return 0;
        }
    }

    sampleGaussian(uvX: number, uvY: number, kernelSize: number, sigma: number): number[] {
        const x = uvX * this.width;
        const y = uvY * this.height;
        const i = Math.floor(x);
        const j = Math.floor(y);

        const result = new Array(this.channels).fill(0);
        let weightSum = 0;

        // Ensure kernel size is odd
        kernelSize = Math.max(3, kernelSize | 1);
        const halfKernel = Math.floor(kernelSize / 2);

        for (let m = -halfKernel; m <= halfKernel; m++) {
            for (let n = -halfKernel; n <= halfKernel; n++) {
                const sampleX = i + m;
                const sampleY = j + n;
                const pixel = this.getPixel(sampleX, sampleY);
                const weight = this.gaussianWeight(m, n, sigma);

                for (let c = 0; c < this.channels; c++) {
                    result[c] += pixel[c] * weight;
                }
                weightSum += weight;
            }
        }

        // Normalize the result
        for (let c = 0; c < this.channels; c++) {
            result[c] /= weightSum;
        }

        return result;
    }

    sampleGaussianChannel(uvX: number, uvY: number, channel: number, kernelSize: number, sigma: number): number {
        const x = uvX * this.width;
        const y = uvY * this.height;
        const i = Math.floor(x);
        const j = Math.floor(y);

        let sum = 0;
        let weightSum = 0;

        // Ensure kernel size is odd
        kernelSize = Math.max(3, kernelSize | 1);
        const halfKernel = Math.floor(kernelSize / 2);

        for (let m = -halfKernel; m <= halfKernel; m++) {
            for (let n = -halfKernel; n <= halfKernel; n++) {
                const sampleX = i + m;
                const sampleY = j + n;
                const pixel = this.getPixelChannel(sampleX, sampleY, channel);
                const weight = this.gaussianWeight(m, n, sigma);

                sum += pixel * weight;
                weightSum += weight;
            }
        }

        // Normalize the result
        return sum / weightSum;
    }

    private gaussianWeight(x: number, y: number, sigma: number): number {
        const exponent = -(x * x + y * y) / (2 * sigma * sigma);
        return Math.exp(exponent) / (2 * Math.PI * sigma * sigma);
    }

    // Helper method to calculate suggested kernel size based on sigma and image dimensions
    static suggestKernelSize(sigma: number, imageDimension: number): number {
        // A common rule of thumb is to use a kernel size of about 6*sigma
        let kernelSize = Math.ceil(6 * sigma);
        
        // Ensure the kernel size is odd
        kernelSize = kernelSize % 2 === 0 ? kernelSize + 1 : kernelSize;
        
        // Limit the kernel size to a fraction of the image dimension (e.g., 1/4)
        const maxKernelSize = Math.floor(imageDimension / 4);
        kernelSize = Math.min(kernelSize, maxKernelSize);
        
        // Ensure a minimum kernel size of 3
        return Math.max(3, kernelSize);
    }

    getPixel(i: number, j: number): number[] {
        const { pixels, width, height, channels, wrapS, wrapT } = this;
        let i2 = this.wrapCoordinate(i, width, wrapS);
        let j2 = this.wrapCoordinate(j, height, wrapT);

        const baseIndex = (j2 * width + i2) * channels;
        const result = new Array(channels);
        for (let c = 0; c < channels; c++) {
            result[c] = pixels[baseIndex + c];
        }
        return result;
    }

    getPixelChannel(i: number, j: number, channel: number): number {
        const { pixels, width, height, channels, wrapS, wrapT } = this;
        let i2 = this.wrapCoordinate(i, width, wrapS);
        let j2 = this.wrapCoordinate(j, height, wrapT);

        const baseIndex = (j2 * width + i2) * channels;
        return pixels[baseIndex + channel];
    }

    private wrapCoordinate(coord: number, size: number, wrapMode: WrapMode): number {
        switch (wrapMode) {
            case WrapMode.REPEAT:
                return int32(mod(coord, size));
            case WrapMode.CLAMP:
                return coord < 0 ? 0 : (coord >= size ? size - 1 : coord);
            default:
                const exhaustiveCheck: never = wrapMode;
                return coord;
        }
    }
}

function mod(n: number, m: number) {
    return ((n % m) + m) % m;
}

function int32(x: number) {
    return x | 0;
}