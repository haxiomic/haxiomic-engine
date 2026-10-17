/**
 * Tests for the bloom level sum. Pure logic — no browser needed, but run by
 * the same runner as the DOM tests so `npm test` covers everything.
 */
import { test, expect } from '@playwright/test'

import { Texture } from 'three';
import { BloomMipmapsMaterial } from '../dist/materials/BloomMipmapsMaterial.js';
import { blurredMipmapTopLevel } from '../dist/rendering/BlurredMipmapChain.js';
import { mipmapCount } from '../dist/math/Math.js';

/** A render-target-like texture with an allocated mip chain, as initMipmapArray makes. */
function chain(width: number, height: number) {
    const texture = new Texture();
    texture.image = { width, height };
    texture.mipmaps = new Array(mipmapCount(width, height)).fill({});
    return texture;
}

function accumulate(material: BloomMipmapsMaterial, width: number, height: number) {
    material.uniforms.mipmapSource.value = chain(width, height);
    (material.onBeforeRender as () => void)();
    return String(material.defines.BLOOM_ACCUMULATION);
}

/** Every `textureLod(mipmapSource, vUv, lod) * weight` term of a baked sum. */
function terms(glsl: string) {
    return [...glsl.matchAll(/textureLod\(mipmapSource, vUv, ([\d.]+)\) \* ([\d.]+)/g)]
        .map(m => ({ lod: Number(m[1]), weight: Number(m[2]) }));
}

/** The generator before blurredMipmapTopLevel, to show the default is unchanged. */
function previousAccumulation(minLod: number, maxLod: number, bloomFalloff: number) {
    let glsl = '';
    let currentLod = minLod;
    for (; currentLod < maxLod - 1; currentLod += 2) {
        const W1 = Math.pow(Math.max(currentLod, 1e-6), -bloomFalloff);
        const W2 = Math.pow(Math.max(currentLod + 1, 1e-6), -bloomFalloff);
        const total = W1 + W2;
        glsl += `bloom += textureLod(mipmapSource, vUv, ${(currentLod + W2 / total).toFixed(5)}) * ${total.toFixed(5)};\n`;
    }
    if (currentLod < maxLod) {
        glsl += `bloom += textureLod(mipmapSource, vUv, ${currentLod.toFixed(1)}) * ${Math.pow(currentLod, -bloomFalloff).toFixed(5)};\n`;
    }
    return glsl.replace(/\n/g, '\\\n');
}

test('blurredMipmapTopLevel is the last level the chain renders', () => {
    // halves until either side reaches 1 pixel
    expect(blurredMipmapTopLevel(3840, 2160)).toBe(11);
    expect(blurredMipmapTopLevel(1600, 1000)).toBe(9);
    expect(blurredMipmapTopLevel(4096, 512)).toBe(9);
    expect(blurredMipmapTopLevel(1, 1)).toBe(0);
});

test('default sum is unchanged where the chain reaches every allocated level', () => {
    for (const [w, h] of [[3840, 2160], [1920, 1080], [3024, 1964], [7680, 4320]]) {
        const material = new BloomMipmapsMaterial({ bakeUniforms: true });
        material.uniforms.bloomFalloff.value = -0.476;
        const glsl = accumulate(material, w, h);
        expect(material.uniforms.maxLod!.value).toBe(mipmapCount(w, h) - 1);
        expect(glsl).toBe(previousAccumulation(1, mipmapCount(w, h) - 1, -0.476));
    }
});

test('a wide source never reads levels the chain does not render', () => {
    const material = new BloomMipmapsMaterial({ bakeUniforms: true });
    const glsl = accumulate(material, 4096, 512);
    const top = blurredMipmapTopLevel(4096, 512);
    for (const t of terms(glsl)) expect(t.lod).toBeLessThanOrEqual(top);
});

test('a fixed maxLod sums the same levels and weights at every resolution', () => {
    const totals = [[3840, 2160], [7680, 4320], [1600, 1000]].map(([w, h]) => {
        const material = new BloomMipmapsMaterial({ bakeUniforms: true, maxLod: 12 });
        material.uniforms.bloomFalloff.value = -0.476;
        const found = terms(accumulate(material, w, h));
        for (const t of found) expect(t.lod).toBeLessThanOrEqual(blurredMipmapTopLevel(w, h));
        return found.reduce((sum, t) => sum + t.weight, 0);
    });
    let expected = 0;
    for (let i = 1; i < 12; i++) expected += Math.pow(i, 0.476);
    for (const total of totals) expect(total).toBeCloseTo(expected, 3);
});

test('the dynamic (unbaked) sum clamps to the rendered top level in the shader', () => {
    const material = new BloomMipmapsMaterial({ bakeUniforms: false, maxLod: 12 });
    const glsl = accumulate(material, 3840, 2160);
    expect(glsl).toContain('min(i, BLOOM_TOP_LOD)');
    // derived from the texture in the shader, not a uniform to keep in sync
    expect(material.fragmentShader).toContain('#define BLOOM_TOP_LOD floor(log2(float(min(textureSize(mipmapSource, 0).x, textureSize(mipmapSource, 0).y))))');
    expect('topLod' in material.uniforms).toBe(false);
    expect(material.uniforms.maxLod!.value).toBe(12);
});

test('the shader top level matches blurredMipmapTopLevel', () => {
    for (const [w, h] of [[3840, 2160], [1600, 1000], [4096, 512], [7, 3], [2, 2]]) {
        expect(Math.floor(Math.log2(Math.min(w, h)))).toBe(blurredMipmapTopLevel(w, h));
    }
});
