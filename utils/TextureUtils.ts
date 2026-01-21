import {
    AlphaFormat,
    ByteType,
    FloatType,
    HalfFloatType,
    IntType,
    PixelFormat,
    RedFormat,
    RGBAFormat,
    RGBFormat,
    RGFormat,
    ShortType,
    TextureDataType,
    UnsignedByteType,
    UnsignedInt248Type,
    UnsignedInt5999Type,
    UnsignedIntType,
    UnsignedShort4444Type,
    UnsignedShort5551Type,
    UnsignedShortType
} from "three";

export function getChannelCount(format: PixelFormat): number {
    switch (format) {
        case RedFormat:
        case AlphaFormat:
            return 1;
        case RGFormat:
            return 2;
        case RGBFormat:
            return 3;
        case RGBAFormat:
            return 4;
        default:
            return 4; // RGBA as safe default
    }
}

// Create a type mapping from TextureDataType to the corresponding TypedArray type
export type TextureDataTypeToArray<T extends TextureDataType> = 
    T extends typeof UnsignedByteType ? Uint8Array :
    T extends typeof ByteType ? Int8Array :
    T extends typeof ShortType ? Int16Array :
    T extends typeof UnsignedShortType ? Uint16Array :
    T extends typeof UnsignedShort4444Type ? Uint16Array :
    T extends typeof UnsignedShort5551Type ? Uint16Array :
    T extends typeof IntType ? Int32Array :
    T extends typeof UnsignedIntType ? Uint32Array :
    T extends typeof UnsignedInt248Type ? Uint32Array :
    T extends typeof UnsignedInt5999Type ? Uint32Array :
    T extends typeof FloatType ? Float32Array :
    T extends typeof HalfFloatType ? Uint16Array :
    Uint8Array; // fallback

export type TextureDataTypeToConstructor<T extends TextureDataType> = 
    T extends typeof UnsignedByteType ? typeof Uint8Array :
    T extends typeof ByteType ? typeof Int8Array :
    T extends typeof ShortType ? typeof Int16Array :
    T extends typeof UnsignedShortType ? typeof Uint16Array :
    T extends typeof UnsignedShort4444Type ? typeof Uint16Array :
    T extends typeof UnsignedShort5551Type ? typeof Uint16Array :
    T extends typeof IntType ? typeof Int32Array :
    T extends typeof UnsignedIntType ? typeof Uint32Array :
    T extends typeof UnsignedInt248Type ? typeof Uint32Array :
    T extends typeof UnsignedInt5999Type ? typeof Uint32Array :
    T extends typeof FloatType ? typeof Float32Array :
    T extends typeof HalfFloatType ? typeof Uint16Array :
    typeof Uint8Array;

export function getTypedArrayConstructor<T extends TextureDataType>(
    type: T
): TextureDataTypeToConstructor<T> {
    switch (type) {
        case UnsignedByteType:
            return Uint8Array as TextureDataTypeToConstructor<T>;
        
        case ByteType:
            return Int8Array as TextureDataTypeToConstructor<T>;
        
        case ShortType:
            return Int16Array as TextureDataTypeToConstructor<T>;
        
        case UnsignedShortType:
        case UnsignedShort4444Type:
        case UnsignedShort5551Type:
            return Uint16Array as TextureDataTypeToConstructor<T>;
        
        case IntType:
            return Int32Array as TextureDataTypeToConstructor<T>;
        
        case UnsignedIntType:
        case UnsignedInt248Type:
        case UnsignedInt5999Type:
            return Uint32Array as TextureDataTypeToConstructor<T>;
        
        case FloatType:
            return Float32Array as TextureDataTypeToConstructor<T>;
        
        case HalfFloatType:
            return Uint16Array as TextureDataTypeToConstructor<T>;
        
        default:
            return Uint8Array as TextureDataTypeToConstructor<T>;
    }
}

/**
 * Convert a normalized value [0,1] to the backing type's range
 */
export function normalizedToTextureValue<T extends TextureDataType>(
    normalized: number, 
    type: T
): number {
    // Clamp to [0,1]
    const clamped = Math.max(0, Math.min(1, normalized));
    
    switch (type) {
        case FloatType:
        case HalfFloatType:
            // Float types stay in [0,1] range
            return clamped;
            
        case UnsignedByteType:
            return Math.round(clamped * 255);
            
        case ByteType:
            // Map [0,1] to [-128,127]
            return Math.round(clamped * 255 - 128);
            
        case ShortType:
            // Map [0,1] to [-32768,32767]
            return Math.round(clamped * 65535 - 32768);
            
        case UnsignedShortType:
        case UnsignedShort4444Type:
        case UnsignedShort5551Type:
            return Math.round(clamped * 65535);
            
        case IntType:
            // Map [0,1] to [-2147483648,2147483647]
            return Math.round(clamped * 4294967295 - 2147483648);
            
        case UnsignedIntType:
        case UnsignedInt248Type:
        case UnsignedInt5999Type:
            return Math.round(clamped * 4294967295);
            
        default:
            return Math.round(clamped * 255);
    }
}

/**
 * Convert a texture value in the backing type's range to normalized [0,1]
 */
export function textureValueToNormalized<T extends TextureDataType>(
    value: number,
    type: T
): number {
    switch (type) {
        case FloatType:
        case HalfFloatType:
            // Float types are already in [0,1] range
            return Math.max(0, Math.min(1, value));
            
        case UnsignedByteType:
            return value / 255;
            
        case ByteType:
            // Map [-128,127] to [0,1]
            return (value + 128) / 255;
            
        case ShortType:
            // Map [-32768,32767] to [0,1]
            return (value + 32768) / 65535;
            
        case UnsignedShortType:
        case UnsignedShort4444Type:
        case UnsignedShort5551Type:
            return value / 65535;
            
        case IntType:
            // Map [-2147483648,2147483647] to [0,1]
            return (value + 2147483648) / 4294967295;
            
        case UnsignedIntType:
        case UnsignedInt248Type:
        case UnsignedInt5999Type:
            return value / 4294967295;
            
        default:
            return value / 255;
    }
}

// Optional: Create typed array conversion utilities
export function normalizedArrayToTextureArray<T extends TextureDataType>(
    normalizedArray: number[] | Float32Array,
    type: T
): TextureDataTypeToArray<T> {
    const Constructor = getTypedArrayConstructor(type);
    const result = new Constructor(normalizedArray.length);
    
    for (let i = 0; i < normalizedArray.length; i++) {
        result[i] = normalizedToTextureValue(normalizedArray[i], type);
    }
    
    return result as TextureDataTypeToArray<T>;
}

export function textureArrayToNormalizedArray<T extends TextureDataType>(
    textureArray: TextureDataTypeToArray<T>,
    type: T
): Float32Array {
    const result = new Float32Array(textureArray.length);
    
    for (let i = 0; i < textureArray.length; i++) {
        result[i] = textureValueToNormalized(textureArray[i], type);
    }
    
    return result;
}