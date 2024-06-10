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