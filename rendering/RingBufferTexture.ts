import {
    ClampToEdgeWrapping,
    DataTexture,
    LinearFilter,
    MagnificationTextureFilter,
    NoColorSpace,
    PixelFormat,
    RepeatWrapping,
    TextureDataType,
    TypedArray,
    Uniform,
    UVMapping,
    WebGLRenderer
} from "three";
import { getChannelCount, getTypedArrayConstructor, normalizedToTextureValue, TextureDataTypeToArray, TextureDataTypeToConstructor } from "../utils/TextureUtils.js";
import { mod } from "../math/Math.js";

export type RingBufferTextureOptions<T extends TextureDataType = TextureDataType> = {
    rowWidth: number,
    /** aka history count / number of rows / texture height */
    rowCount: number,
    format: PixelFormat,
    type: T,
    filtering?: MagnificationTextureFilter,
    data?: ArrayBufferView | null,
    /** -1 means write upward; +1 means write downward */
    writeDirection?: -1 | 1,
};

/**
 * RingBufferTexture
 *
 * Write data incrementally as rows into a texture; when full we overwrite the oldest data.
 * Reading requires passing the write pointer (as a UV Y offset) to the shader.
 */
export class RingBufferTexture<T extends TextureDataType = TextureDataType> extends DataTexture {

    // represents the row we are currently writing to for the next frame
    writeRowIndex: number = 0;

    readIndexUniform: { value: number };
    readUVOffsetYUniform: { value: number };

    dataConstructor: TextureDataTypeToConstructor<T>;

    dataType: T;

    get data(): TextureDataTypeToArray<T> {
        return this.image.data as TextureDataTypeToArray<T>;
    }

    // direction we are writing in, -1 means we are writing up and +ve reads go into the past
    writeDirection: -1 | 1;

    readonly rowWidth: number;
    readonly rowCount: number;

    readonly channelCount: number;

    constructor({
        data,
        rowWidth,
        rowCount,
        format,
        type,
        filtering = LinearFilter,
        writeDirection = -1,
    }: RingBufferTextureOptions<T>) {
        const channelCount = getChannelCount(format);
        const dataConstructor = getTypedArrayConstructor(type);

        super(
            data ?? new dataConstructor(rowWidth * rowCount * channelCount),
            rowWidth,
            rowCount,
            format,
            type,
            UVMapping,
            ClampToEdgeWrapping,
            RepeatWrapping,
            filtering,
            filtering,
            0,
            NoColorSpace
        );

        this.rowWidth = rowWidth;
        this.rowCount = rowCount;
        this.writeDirection = writeDirection;
        this.channelCount = channelCount;
        this.dataType = type;
        this.dataConstructor = dataConstructor;

        this.flipY = false;
        this.generateMipmaps = false;
        this.needsUpdate = true;
        // be explicit to avoid row alignment issues for odd widths/byte sizes
        this.unpackAlignment = 1;

        const _instance = this;
        this.readIndexUniform = {
            get value() {
                return _instance.writeRowIndex - _instance.writeDirection;
            },
        };

        this.readUVOffsetYUniform = {
            get value() {
                return (_instance.writeRowIndex - _instance.writeDirection) / _instance.rowCount;
            },
        };
    }

    /**
     * Write a single row into the texture (in-place, no staging textures)
     */
    writeRow(data: ArrayLike<number> | TextureDataTypeToArray<T>) {
        // copy row into the CPU-side buffer at the correct offset
        const elementCount = this.rowWidth * this.channelCount;  // elements per row
        const start = this.writeRowIndex * elementCount;         // element offset (NOT bytes)

        if (data.length !== elementCount) {
            throw new Error(`RingBufferTexture: writeRow data length (${data.length}) does not match row size (${elementCount})`);
        }

        (this.image.data as TypedArray).set(data, start);

        // mark just this as needs update
        let needsUpdateRange = true;
        for (let updateRange of this.updateRanges) {
            if (updateRange.start === start && updateRange.count === elementCount) {
                needsUpdateRange = false;
                break;
            }
        }
        if (needsUpdateRange) {
            this.addUpdateRange(start, elementCount); // counts are in elements
        }

        // trigger the upload on next render
        this.needsUpdate = true;

        // advance the ring pointer
        this.writeRowIndex = mod(this.writeRowIndex + this.writeDirection, this.rowCount);
    }

    /**
     * Write normalized [0,1] data into the texture
     */
    writeRowWithNormalizedData(data: ArrayLike<number>) {
        const dataTextureValues = new Array<number>(data.length);
        for (let i = 0; i < data.length; i++) {
            dataTextureValues[i] = normalizedToTextureValue(data[i], this.dataType);
        }
        this.writeRow(dataTextureValues);
    }

    getShader<T extends string>(samplerName: T): {
        /**
        * Add these uniforms to your ShaderMaterial uniforms object
        * uniforms: { ...ringBufferTexture.getShader('mySampler').uniforms  }
        */
        uniforms: Record<T | `${T}_readUVOffsetY`, Uniform<any>>,
        /**
        * Add this GLSL code to your shader (e.g. vertexShader or fragmentShader)
        */
        glsl: string,
        /**
        * Call this function in your shader to read the texture as a ring buffer
        * Signature: `vec4 readRingBuffer_<samplerName>(vec2(x, historyFraction));`
        * where x ranges from 0 to 1 across the row, and historyFraction is 0 for the most recent row,
        * For example:
        * ```glsl
        *   float historyFraction = 0.5; // halfway back in time
        *   ${ringBufferTexture.getShader('mySampler').readRingBufferFn}(vec2(0.5, historyFraction));
        * ```
        */
        readRingBufferFn: string,
        samplerName: T,
    } {
        return {
            /**
             * Add these uniforms to your ShaderMaterial uniforms object
             * uniforms: { ...ringBufferTexture.getShader('mySampler').uniforms  }
             */
            uniforms: {
                [samplerName]: new Uniform(this),
                [`${samplerName}_readUVOffsetY`]: this.readUVOffsetYUniform,
            } as any,
            glsl: /* glsl */`
                uniform sampler2D ${samplerName};
                uniform float ${samplerName}_readUVOffsetY;

                const float ${samplerName}_rowWidth = ${this.rowWidth.toFixed(1)};
                const float ${samplerName}_rowCount = ${this.rowCount.toFixed(1)};

                vec4 readRingBuffer_${samplerName}(vec2 uv) {
                // Use fract() so this is robust even if Y repeat is clamped on NPOT textures
                return texture2D(${samplerName}, vec2(
                    uv.x,
                    fract(${samplerName}_readUVOffsetY + uv.y)
                ));
                }
            `,
            readRingBufferFn: `readRingBuffer_${samplerName}`,
            samplerName,
        };
    }

    dispose() {
        super.dispose();
    }
}