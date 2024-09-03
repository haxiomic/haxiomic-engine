/**
 * Deterministic random (to use in place of Math.random())
 * Source: https://stackoverflow.com/a/47593316
 */
export class Xoshiro128 {

	seedA: number = 0;
	seedB: number = 0;
	seedC: number = 0;
	seedD: number = 0;

	constructor() {
		this.resetSeed();
	}

	resetSeed(input: string = "hello-random") {
		let seedGen = this.xmur3StringHasher(input);
		this.seedA = seedGen();
		this.seedB = seedGen();
		this.seedC = seedGen();
		this.seedD = seedGen();
	}

	random() {
		let t = this.seedA << 9, r = this.seedA * 5; r = (r << 7 | r >>> 25) * 9;
		this.seedC ^= this.seedA; this.seedD ^= this.seedB;
		this.seedB ^= this.seedC; this.seedA ^= this.seedD; this.seedC ^= t;
		this.seedD = this.seedD << 11 | this.seedD >>> 21;
		return (r >>> 0) / 4294967296;
	}

	private xmur3StringHasher(str: string) {
		let h = 1779033703 ^ str.length;
		for(let i = 0; i < str.length; i++)
			h = Math.imul(h ^ str.charCodeAt(i), 3432918353),
			h = h << 13 | h >>> 19;
		return function() {
			h = Math.imul(h ^ h >>> 16, 2246822507);
			h = Math.imul(h ^ h >>> 13, 3266489909);
			return (h ^= h >>> 16) >>> 0;
		}
	}
	
}