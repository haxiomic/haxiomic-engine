export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
    if (x <= edge0) {
        return 0;
    } else if (x >= edge1) {
        return 1;
    }
    let t = (x - edge0) / (edge1 - edge0);
    t = t * t * (3 - 2 * t);
    return t;
}

export function clamp(v: number, min: number, max: number) {
	return v < min ? min : (v > max ? max : v);
}

export function fract(x: number) { 
	return x - Math.floor(x);
}

export function mod(a: number, b: number) {
    return ((a % b) + b) % b;
}

export function mipmapCount(width: number, height: number) {
    return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export function mipmapDimension(widthOrHeight: number, level: number) {
    return Math.max(1, widthOrHeight >> level)
}