import { ClampToEdgeWrapping, DataTexture, Line, LinearFilter, MagnificationTextureFilter, NearestFilter, NoColorSpace, PixelFormat, RedFormat, RepeatWrapping, RGBAFormat, TextureDataType, Uniform, UnsignedByteType, UVMapping, Vector2, WebGLRenderer } from "three";

export type RingBufferTextureOptions = {
    rowWidth: number,
    /** aka history count / number of rows / texture height */
    rowCount: number,
    format: PixelFormat, 
    type: TextureDataType,
    filtering?: MagnificationTextureFilter,
    data?: ArrayBufferView | null,
    writeDirection?: -1 | 1,
}

/**
 * RingBufferTexture
 * 
 * Write data incrementally as rows into a texture, when the texture is full we start overwriting the oldest data
 * 
 * To read this texture we must pass the write pointer into the shader
 */
export class RingBufferTexture {

    // represents the row we are currently writing to for the next frame
    writeIndex: number = 0;

    readIndexUniform: { value: number };
    readUVOffsetYUniform: { value: number };

    texture: DataTexture;

    // direction  we are writing in, -1 means we are writing up and +ve reads go into the past
    writeDirection: -1 | 1;

    readonly rowWidth: number;
    readonly rowCount: number;

    constructor({
        data,
        rowWidth,
        rowCount,
        format,
        type,
        filtering = LinearFilter,
        writeDirection = -1,
    }: RingBufferTextureOptions) {
        this.rowWidth = rowWidth;
        this.rowCount = rowCount;
        this.writeDirection = writeDirection;

        this.texture = new DataTexture(
            data ?? new Uint8Array(rowWidth * rowCount),
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
        this.texture.flipY = false;
        this.texture.generateMipmaps = false;
        this.texture.needsUpdate = true;

        let _instance = this;
        this.readIndexUniform = {
            get value() {
                return _instance.writeIndex - _instance.writeDirection;
            },
        };

        this.readUVOffsetYUniform = {
            get value() {
                return (_instance.writeIndex - _instance.writeDirection) / _instance.rowCount;
            },
        };
    }

    /**
     * Write a row into the texture
     */
    write(renderer: WebGLRenderer, data: ArrayBufferView) {
        // upload data to the texture
        // create a new data texture for the row
        // use renderer copyTextureToTexture
        let rowData = new DataTexture(
            data,
            this.rowWidth,
            1,
            this.texture.format as PixelFormat,
            this.texture.type,
            UVMapping,
            ClampToEdgeWrapping,
            ClampToEdgeWrapping,
            NearestFilter,
            NearestFilter,
        );
        rowData.needsUpdate = true;
        rowData.flipY = false;
        rowData.generateMipmaps = false;

        let writePosition = new Vector2(
            0,
            this.writeIndex,
        );

        // ensure the texture is initialized
        renderer.initTexture(this.texture);

        // older three.js interface
        // renderer.copyTextureToTexture(
        //     writePosition,
        //     rowData,
        //     this.texture,
        //     0,
        // );

        // three r171 interface
        renderer.copyTextureToTexture(
            rowData,
            this.texture,
            null,
            writePosition
        );

        // increment the write row
        this.writeIndex = mod(this.writeIndex + this.writeDirection, this.rowCount);
    }

    getShader<T extends string>(samplerName: T): {
        uniforms: Record<
            T |
            `${T}_readUVOffsetY`
        , Uniform<any>>,
        glsl: string,
        readRingBufferFn: string,
        samplerName: T,
    } {
        return {
            uniforms: {
                [samplerName]: new Uniform(this.texture),
                [`${samplerName}_readUVOffsetY`]: this.readUVOffsetYUniform,
            } as any,
            glsl: /* glsl */`
                uniform sampler2D ${samplerName};
                uniform float ${samplerName}_readUVOffsetY;
                
                const float ${samplerName}_rowWidth = ${this.rowWidth.toFixed(1)};
                const float ${samplerName}_rowCount = ${this.rowCount.toFixed(1)};

                vec4 readRingBuffer_${samplerName}(vec2 uv) {
                    return texture2D(${samplerName}, vec2(
                        uv.x,
                        // repeat wrapping is already set on the texture so we don't need to wrap manually
                        ${samplerName}_readUVOffsetY + uv.y
                    ));
                }
            `,
            samplerName: samplerName,
            readRingBufferFn: `readRingBuffer_${samplerName}`,
        }
    }

    dispose() {
        this.texture.dispose();
    }

}

function mod(a: number, b: number) {
    return ((a % b) + b) % b;
}