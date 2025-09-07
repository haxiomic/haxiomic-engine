import { NamedConsole } from "../NamedConsole.js";

/**
 * 5-band EQ frequency analysis optimized for music visualization
 * Provides both array access and named properties for clarity
 */
export interface FrequencyBands extends ReadonlyArray<number> {
  readonly length: 5;
  readonly [0]: number; // Bass: 20-200Hz
  readonly [1]: number; // Low-Mid: 200-500Hz  
  readonly [2]: number; // Mid: 500-2000Hz
  readonly [3]: number; // High-Mid: 2000-6000Hz
  readonly [4]: number; // Treble: 6000Hz+
  readonly bass: number;
  readonly lowMid: number;
  readonly mid: number;
  readonly highMid: number;
  readonly treble: number;
}

export interface AudioAnalyzerData {
  frequencyData: Uint8Array;
  timeData: Uint8Array;
  volume: number;
  bassLevel: number;
  midLevel: number;
  trebleLevel: number;
  averageFrequency: number;
  sampleRate: number;
  // Enhanced frequency band analysis
  musicFrequencyBands: FrequencyBands; // 5-band EQ optimized for music
  frequencyPeaks: FrequencyBands; // Peak levels in each band
}

export interface FrequencyBandDefinition {
  name: string;
  minFreq: number;
  maxFreq: number;
  startBin: number;
  endBin: number;
}

const console = new NamedConsole('AudioAnalyzer');

/**
 * Music-optimized audio analyzer that wraps an existing AnalyserNode
 * Provides 5-band EQ analysis and enhanced frequency band processing
 */
export class AudioAnalyzer {
  private analyser: AnalyserNode;
  
  // Analysis data buffers
  private frequencyData: Uint8Array<ArrayBuffer>;
  private timeData: Uint8Array<ArrayBuffer>;
  
  // Configuration (read from the actual AnalyserNode, don't store duplicates)
  
  // Frequency range indices for bass/mid/treble analysis
  private bassRange: [number, number] = [0, 0];
  private midRange: [number, number] = [0, 0];
  private trebleRange: [number, number] = [0, 0];
  
  // Enhanced frequency band definitions for music
  private musicFrequencyBands: FrequencyBandDefinition[] = [];
  private previousBandValues: number[] = [];
  
  // Static flag to log frequency mapping only once across all instances
  private static hasLoggedBandMapping = false;

  // Noise gate threshold in dBFS (values below are treated as silence)
  private readonly noiseGateDb = -70;

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    
    // Tighten analyser dB window so near-silence maps closer to 0
    this.analyser.minDecibels = -75;
    this.analyser.maxDecibels = -10;
    
    // Initialize data buffers
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    
    // Calculate frequency ranges (approximate)
    this.calculateFrequencyRanges();
    
    // Setup music frequency bands
    this.setupMusicFrequencyBands();
    
    console.log('🎵 AudioAnalyzer: Wrapped AnalyserNode for music analysis');
    console.log(`   Sample rate: ${this.analyser.context.sampleRate}Hz`);
    console.log(`   FFT size: ${this.analyser.fftSize}`);
    console.log(`   Frequency bins: ${this.analyser.frequencyBinCount}`);
    console.log(`   Smoothing: ${this.analyser.smoothingTimeConstant}`);
  }
  
  private calculateFrequencyRanges(): void {
    const sampleRate = this.analyser.context.sampleRate;
    const binCount = this.analyser.frequencyBinCount;
    const maxFreq = sampleRate / 2;
    
    // Define frequency boundaries
    const bassMax = 250; // Hz
    const midMax = 4000; // Hz
    
    // Calculate array indices for each range
    this.bassRange = [0, Math.floor((bassMax / maxFreq) * binCount)];
    this.midRange = [this.bassRange[1], Math.floor((midMax / maxFreq) * binCount)];
    this.trebleRange = [this.midRange[1], binCount];
  }
  
  private setupMusicFrequencyBands(): void {
    const sampleRate = this.analyser.context.sampleRate;
    const nyquist = sampleRate / 2;
    const binCount = this.analyser.frequencyBinCount;
    
    // Define music-optimized frequency bands (pushed down so upper bands activate earlier)
    const bands = [
      { name: 'Bass',     minFreq: 20,   maxFreq: 160  },
      { name: 'Low-Mid',  minFreq: 160,  maxFreq: 400  },
      { name: 'Mid',      minFreq: 400,  maxFreq: 1200 },
      { name: 'High-Mid', minFreq: 1200, maxFreq: 4000 },
      { name: 'Treble',   minFreq: 4000, maxFreq: nyquist }
    ];
    
    this.musicFrequencyBands = bands.map(band => {
      let startBin = Math.floor((band.minFreq / nyquist) * binCount);
      let endBin = Math.floor((band.maxFreq / nyquist) * binCount);
      
      // Clamp to valid bin range [0, binCount]
      startBin = Math.max(0, Math.min(startBin, binCount));
      endBin = Math.max(0, Math.min(endBin, binCount));
      
      // Ensure endBin > startBin for valid range
      if (endBin <= startBin) {
        endBin = Math.min(startBin + 1, binCount);
      }
      
      return {
        name: band.name,
        minFreq: band.minFreq,
        maxFreq: band.maxFreq,
        startBin,
        endBin
      };
    });
    
    // Initialize previous values for smoothing
    this.previousBandValues = new Array(this.musicFrequencyBands.length).fill(0);
    
    // Log mapping once across all instances
    if (!AudioAnalyzer.hasLoggedBandMapping) {
      console.log('🎛️ Music Frequency Band Mapping:');
      console.log(`Sample Rate: ${sampleRate}Hz, Nyquist: ${nyquist}Hz`);
      console.log(`FFT Bins: ${binCount}, Resolution: ${(nyquist / binCount).toFixed(1)}Hz/bin`);
      this.musicFrequencyBands.forEach((band, i) => {
        console.log(`${band.name}: ${band.minFreq}-${band.maxFreq}Hz (bins ${band.startBin}-${band.endBin})`);
      });
      AudioAnalyzer.hasLoggedBandMapping = true;
    }
  }

  private getNoiseGateByte(): number {
    const min = this.analyser.minDecibels;
    const max = this.analyser.maxDecibels;
    const gateDb = Math.min(Math.max(this.noiseGateDb, min), max - 0.0001);
    const n = (gateDb - min) / (max - min); // 0..1
    return Math.floor(n * 255);             // 0..255
  }
  
  
  /**
   * Get current audio analysis data
   */
  getAnalyzerData(): AudioAnalyzerData {
    // Update frequency and time domain data
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);
    
    // Calculate derived values
    const volume = this.calculateVolume();
    const bassLevel = this.calculateRangeLevel(this.bassRange);
    const midLevel = this.calculateRangeLevel(this.midRange);
    const trebleLevel = this.calculateRangeLevel(this.trebleRange);
    const averageFrequency = this.calculateAverageFrequency();
    
    // Calculate enhanced music frequency bands
    const musicBands = this.calculateMusicFrequencyBands();
    const frequencyPeaks = this.calculateFrequencyPeaks();

    return {
      frequencyData: new Uint8Array(this.frequencyData),
      timeData: new Uint8Array(this.timeData),
      volume,
      bassLevel,
      midLevel,
      trebleLevel,
      averageFrequency,
      sampleRate: this.analyser.context.sampleRate,
      musicFrequencyBands: musicBands,
      frequencyPeaks: frequencyPeaks
    };
  }
  
  private calculateVolume(): number {
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const amplitude = (this.timeData[i] - 128) / 128;
      sum += amplitude * amplitude;
    }
    return Math.sqrt(sum / this.timeData.length);
  }
  
  private calculateRangeLevel(range: [number, number]): number {
    let sum = 0;
    const [start, end] = range;
    
    // Guard against division by zero if band boundaries quantize to same bin
    if (end <= start) return 0;
    
    for (let i = start; i < end; i++) {
      sum += this.frequencyData[i];
    }
    return sum / (end - start) / 255; // Normalize to 0-1
  }
  
  private calculateAverageFrequency(): number {
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < this.frequencyData.length; i++) {
      const amplitude = this.frequencyData[i];
      weightedSum += i * amplitude;
      totalWeight += amplitude;
    }
    
    if (totalWeight === 0) return 0;
    
    // Convert bin index to frequency in Hz
    const avgBin = weightedSum / totalWeight;
    const nyquist = this.analyser.context.sampleRate / 2;
    return (avgBin * nyquist) / this.analyser.frequencyBinCount;
  }
  
  private calculateMusicFrequencyBands(): FrequencyBands {
    const smoothing = 0.6; // Time smoothing factor
    const gate = this.getNoiseGateByte();
    
    const values = this.musicFrequencyBands.map((band, i) => {
      // Use a gated, locally-averaged peak (3-bin window) to avoid width bias
      let peak = 0;
      for (let bin = band.startBin; bin < band.endBin; bin++) {
        if (bin < this.frequencyData.length) {
          const v0 = this.frequencyData[bin];
          const vL = bin > band.startBin ? this.frequencyData[bin - 1] : v0;
          const vR = bin + 1 < band.endBin ? this.frequencyData[bin + 1] : v0;

          const u0 = v0 <= gate ? 0 : (v0 - gate) / (255 - gate);
          const uL = vL <= gate ? 0 : (vL - gate) / (255 - gate);
          const uR = vR <= gate ? 0 : (vR - gate) / (255 - gate);

          const localAvg = (uL + u0 + uR) / 3;
          if (localAvg > peak) peak = localAvg;
        }
      }
      
      // Gentle gamma lift without exaggerating floor
      const gamma = 1 / 1.5;
      const currentValue = Math.pow(peak, gamma);
      
      // Apply time smoothing to reduce flicker
      const previousValue = this.previousBandValues[i] || 0;
      const smoothedValue = previousValue * smoothing + currentValue * (1 - smoothing);
      
      // Store for next frame
      this.previousBandValues[i] = smoothedValue;
      
      return smoothedValue;
    });
    
    return createFrequencyBands(values[0], values[1], values[2], values[3], values[4]);
  }
  
  private calculateFrequencyPeaks(): FrequencyBands {
    const gate = this.getNoiseGateByte();
    // Return gated maximum values (quick reaction but ignore floor)
    const values = this.musicFrequencyBands.map(band => {
      let maxValue = 0;
      for (let bin = band.startBin; bin < band.endBin; bin++) {
        if (bin < this.frequencyData.length) {
          const v = this.frequencyData[bin];
          if (v > gate) {
            const u = (v - gate) / (255 - gate);
            if (u > maxValue) maxValue = u;
          }
        }
      }
      return maxValue; // 0-1
    });
    
    return createFrequencyBands(values[0], values[1], values[2], values[3], values[4]);
  }
  
  
  /**
   * Get raw frequency data for custom processing
   */
  getFrequencyData(): Uint8Array {
    this.analyser.getByteFrequencyData(this.frequencyData);
    return new Uint8Array(this.frequencyData);
  }
  
  /**
   * Get raw time domain data for custom processing
   */
  getTimeData(): Uint8Array {
    this.analyser.getByteTimeDomainData(this.timeData);
    return new Uint8Array(this.timeData);
  }

  /**
   * Get raw frequency data reference (zero-GC for hot paths)
   * WARNING: Treat returned array as read-only! Do not modify.
   * The same array reference is returned each call and gets updated.
   */
  getFrequencyDataRef(): Uint8Array {
    this.analyser.getByteFrequencyData(this.frequencyData);
    return this.frequencyData;
  }
  
  /**
   * Get raw time domain data reference (zero-GC for hot paths)  
   * WARNING: Treat returned array as read-only! Do not modify.
   * The same array reference is returned each call and gets updated.
   */
  getTimeDataRef(): Uint8Array {
    this.analyser.getByteTimeDomainData(this.timeData);
    return this.timeData;
  }
  
  /**
   * Configure FFT size on the wrapped AnalyserNode (must be power of 2, between 32 and 32768)
   */
  setFFTSize(size: number): void {
    if (size < 32 || size > 32768 || (size & (size - 1)) !== 0) {
      throw new Error('FFT size must be a power of 2 between 32 and 32768');
    }
    
    this.analyser.fftSize = size;
    
    // Update buffers to match new FFT size
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    
    // Recalculate frequency ranges
    this.calculateFrequencyRanges();
    
    // Remap music frequency bands since bin count changed
    this.setupMusicFrequencyBands();
    
    // Reset smoothing state since frequency mapping changed
    this.previousBandValues = new Array(this.musicFrequencyBands.length).fill(0);
  }
  
  /**
   * Set smoothing time constant on the wrapped AnalyserNode (0.0 - 1.0)
   */
  setSmoothingTimeConstant(value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value));
    this.analyser.smoothingTimeConstant = clampedValue;
  }
  
  /**
   * Get the underlying AnalyserNode for direct access
   */
  getAnalyser(): AnalyserNode {
    return this.analyser;
  }
  
  /**
   * Clean up resources (minimal cleanup since we don't manage connections)
   */
  dispose(): void {
    // Clear any cached data
    this.previousBandValues = [];
    this.musicFrequencyBands = [];
  }
}


/**
 * Create a FrequencyBands object with both array access and named properties
 */
function createFrequencyBands(bass: number, lowMid: number, mid: number, highMid: number, treble: number): FrequencyBands {
  const bands = [bass, lowMid, mid, highMid, treble] as const;
  return Object.assign(bands, {
    bass,
    lowMid, 
    mid,
    highMid,
    treble
  }) as FrequencyBands;
}
