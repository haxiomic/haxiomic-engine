import { test, expect } from '@playwright/test'

/* Display transform of premultiplied colour (rendering/DisplayTransform.ts), BloomMipmapsMaterial, HdrOutputMaterial,
   Rendering.blit and the bloom accumulation chunks, read back on the GPU of the test machine */

const encode = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
/** three's ACESFilmicToneMapping at exposure 1 */
function aces(rgb) {
    const v = rgb.map(x => x / 0.6)
    const inM = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]]
    const outM = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]]
    const mul = (m, x) => [0, 1, 2].map(r => m[0][r] * x[0] + m[1][r] * x[1] + m[2][r] * x[2])
    const fit = x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081)
    return mul(outM, mul(inM, v).map(fit)).map(x => Math.min(1, Math.max(0, x)))
}
/** encode(T(c)) · a on 0..255, alpha a */
const presented = (c, a, toneMapping) => [...(toneMapping === 'aces' ? aces(c) : c).map(x => encode(x) * a * 255), a * 255]
/** the previous result: encode(T(c · a)) */
const transformedAsStored = (c, a, toneMapping) => [...(toneMapping === 'aces' ? aces(c.map(x => x * a)) : c.map(x => x * a)).map(x => encode(x) * 255), a * 255]
const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])))

test.describe('display transform of premultiplied colour', () => {
    test.beforeEach(async ({ page }) => {
        const errors = []
        page.on('pageerror', e => errors.push(String(e)))
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
        await page.goto('/tests/display-transform.html')
        await page.waitForFunction(() => window.ready !== undefined)
        const ready = await page.evaluate(() => window.ready)
        test.skip(ready !== true, 'float render targets with linear filtering are unavailable')
        expect(errors).toEqual([])
    })

    test('opaque pixels are bit-identical to the transform of the stored colour', async ({ page }) => {
        // the float readback goes through tone mapping and the encode, so its comparison means something
        const path = await page.evaluate(() => window.floatPathTransforms())
        expect(path.tonemapped && path.encoded).toBe(true)
        expect(maxDiff(path.cell0.slice(0, 3), [0.2, 0.5, 0.8].map(encode))).toBeLessThan(1e-4)
        const rows = await page.evaluate(() => window.opaqueBitIdentical())
        expect(rows.length).toBe(32)
        for (const r of rows) {
            const what = `${r.toneMapping}, grade ${r.grade}, baked ${r.bakeUniforms}, smooth ${r.smoothLevels}`
            expect(r.float, `${what}: float`).toBe(0)
            expect(r.canvas, `${what}: canvas`).toBe(0)
        }
        expect(await page.evaluate(() => window.hdrOpaqueBitIdentical())).toEqual([
            { toneMapping: 4, headroom: 1, float: 0 }, { toneMapping: 4, headroom: 3, float: 0 },
            { toneMapping: 7, headroom: 1, float: 0 }, { toneMapping: 7, headroom: 3, float: 0 },
        ])
    })

    test('pixels with alpha 0 are transformed as stored', async ({ page }) => {
        expect(await page.evaluate(() => window.zeroAlphaUnchanged())).toBe(0)
    })

    test('bloom is added light: a glow over translucent pixels keeps its brightness', async ({ page }) => {
        const ratios = await page.evaluate(() => window.glowOverTranslucent())
        expect(ratios.length, 'cells lit by the glow').toBeGreaterThan(0)
        // taking coverage from the bloomed alpha would leave a few percent of the glow
        for (const r of ratios) expect(r).toBeGreaterThan(0.8)
    })

    test('a bright colour at a tiny alpha stays finite', async ({ page }) => {
        expect(await page.evaluate(() => window.finiteAtTinyAlpha())).toBe(true)
    })

    test('with material.premultipliedAlpha, the stored colour is transformed as it is', async ({ page }) => {
        expect(await page.evaluate(() => window.premultipliedAlphaMaterialUnchanged())).toBe(0)
    })

    test('a flat colour at 50% coverage presents encode(T(c)) · 0.5', async ({ page }) => {
        const c = [0.2, 0.5, 0.8]
        for (const toneMapping of ['none', 'aces']) {
            const r = await page.evaluate(([c, t]) => window.partialCoverage(c, 0.5, t), [c, toneMapping])
            const want = presented(c, 0.5, toneMapping)
            const before = transformedAsStored(c, 0.5, toneMapping)
            // 8-bit canvas: rounding at the store
            expect(maxDiff(r.bloom, want), `bloom ${toneMapping}: ${r.bloom} vs ${want.map(Math.round)}`).toBeLessThanOrEqual(1)
            expect(maxDiff(r.custom, want), `displayTransform ${toneMapping}: ${r.custom}`).toBeLessThanOrEqual(1)
            // and well away from what the stored-colour transform gave
            expect(maxDiff(r.bloom, before)).toBeGreaterThan(10)
            if (r.hdr) expect(maxDiff(r.hdr, want), `HDR output at headroom 1: ${r.hdr}`).toBeLessThanOrEqual(1)
        }
    })

    test('Rendering.blit: raw copies exact; the transform un-premultiplies only when asked', async ({ page }) => {
        const r = await page.evaluate(() => window.blitContract())
        expect(r.rawExact).toBe(true)
        // [opaque, 50%, alpha 0]: opaque and alpha 0 agree either way
        expect(r.premultiplied[0]).toEqual(r.asStored[0])
        expect(r.premultiplied[2]).toEqual(r.asStored[2])
        const c = [0.2, 0.5, 0.8]
        expect(maxDiff(r.asStored[1], transformedAsStored(c, 0.5, 'aces'))).toBeLessThanOrEqual(1)
        expect(maxDiff(r.premultiplied[1], presented(c, 0.5, 'aces'))).toBeLessThanOrEqual(1)
    })

    test('bloom accumulation chunks match the material', async ({ page }) => {
        const rows = await page.evaluate(() => window.accumulationParity())
        for (const r of rows) {
            expect(r.levels, 'the chain has levels to sum').toBeGreaterThan(2)
            expect(r.diff, `smooth ${r.smoothLevels}, baked ${r.bakeUniforms} (peak ${r.peak})`).toBeLessThanOrEqual(1e-6 * r.peak)
        }
    })
})
