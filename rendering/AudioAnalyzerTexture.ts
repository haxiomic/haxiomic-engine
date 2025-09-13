import {
    MagnificationTextureFilter,
    NearestFilter,
    PixelFormat,
    RGBAFormat,
    TextureDataType,
    UnsignedByteType
} from "three";
import { AudioAnalyzerData } from "../audio/AudioAnalyzer.js";
import { normalizedToTextureValue, TextureDataTypeToArray } from "../TextureUtils.js";
import { RingBufferTexture } from "./RingBufferTexture.js";

export type AudioAnalyzerTextureOptions<T extends TextureDataType = TextureDataType> = {
    /** Function to get current audio data */
    getAudioData: () => AudioAnalyzerData | null;
    /** Update rate in Hz (default: 60) */
    updateRate_hz?: number;
    /** Number of frequency bands (default: 5) */
    frequencyBands?: number;
    /** History buffer size (default: 128) */
    historySize?: number;
    /** Texture format (default: RGBAFormat) */
    format?: PixelFormat;
    /** Texture data type (default: UnsignedByteType) */
    type?: T;
    /** Texture filtering (default: NearestFilter) */
    filtering?: MagnificationTextureFilter;
};

/**
 * AudioAnalyzerTexture
 *
 * Specialized RingBufferTexture for audio visualization that automatically
 * updates with frequency band data at a specified rate.
 */
export class AudioAnalyzerTexture<T extends TextureDataType = TextureDataType> extends RingBufferTexture<T> {
    private getAudioData: () => AudioAnalyzerData | null;
    private updateInterval_ms: number;
    private intervalHandle: number | null = null;
    private audioUpdateRowBuffer: TextureDataTypeToArray<T>;
    
    constructor({
        getAudioData,
        updateRate_hz: updateRate = 60,
        frequencyBands = 5,
        historySize = 128,
        format = RGBAFormat,
        type = UnsignedByteType as T,
        filtering = NearestFilter,
    }: AudioAnalyzerTextureOptions<T>) {
        super({
            format,
            type,
            rowWidth: frequencyBands,
            rowCount: historySize,
            filtering,
        });
        
        this.getAudioData = getAudioData;
        this.updateInterval_ms = 1000 / updateRate;
        
        // Create buffer for row updates
        this.audioUpdateRowBuffer = new this.dataConstructor(
            this.rowWidth * this.channelCount
        ) as TextureDataTypeToArray<T>;

        this.start();
    }
    
    /**
     * Start automatically updating the texture with audio data
     */
    start(): void {
        if (this.intervalHandle !== null) {
            return; // Already running
        }
        
        this.intervalHandle = setInterval(() => {
            this.update();
        }, this.updateInterval_ms) as unknown as number;
    }
    
    /**
     * Stop automatic updates
     */
    stop(): void {
        if (this.intervalHandle !== null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    
    /**
     * Manually update the texture with current audio data
     */
    update(): void {
        // Clear the buffer
        this.audioUpdateRowBuffer.fill(0);
        
        // Get current audio data
        const audioData = this.getAudioData();
        
        if (audioData && audioData.musicFrequencyBands) {
            // Fill buffer with frequency band data
            for (let i = 0; i < Math.min(this.rowWidth, audioData.musicFrequencyBands.length); i++) {
                const audioValue = audioData.musicFrequencyBands[i]; // 0 to 1
                const textureValue = normalizedToTextureValue(
                    audioValue * audioValue, 
                    this.dataType
                );
                
                const bufferIndex = i * this.channelCount;
                
                // Fill all channels with the same value
                for (let c = 0; c < this.channelCount; c++) {
                    this.audioUpdateRowBuffer[bufferIndex + c] = textureValue;
                }
            }
        }
        
        // Write the row to the texture
        this.writeRow(this.audioUpdateRowBuffer);
    }
    
    /**
     * Check if the texture is currently auto-updating
     */
    get isRunning(): boolean {
        return this.intervalHandle !== null;
    }
    
    dispose = () => {
        this.stop();
        super.dispose();
    }
}