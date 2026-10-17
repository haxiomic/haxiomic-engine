import { test, expect } from '@playwright/test'

/* gaussianBlur (pyramid) and generatePyramidBloom, against an exact float64 Gaussian on the GPU of the test machine */
test.describe('gaussian blur & pyramid bloom', () => {
    test.beforeEach(async ({ page }) => {
        const errors = []
        page.on('pageerror', e => errors.push(String(e)))
        await page.goto('/tests/blur.html')
        await page.waitForFunction(() => window.ready !== undefined)
        const ready = await page.evaluate(() => window.ready)
        test.skip(ready !== true, 'float render targets with linear filtering are unavailable')
        expect(errors).toEqual([])
    })

    test('gaussianBlur matches an exact Gaussian', async ({ page }) => {
        const rows = await page.evaluate(() => window.blurAccuracy())
        for (const r of rows) {
            // the previous separable implementation is ~5-13% off here (it truncates the kernel at 2σ)
            expect(r.error, `kernel ${r.kernel} (σ ${r.sigma})`).toBeLessThan(0.005)
        }
    })

    test('gaussianBlur is shift-invariant', async ({ page }) => {
        // deviation of a single pixel's blur as it moves, relative to peak. A box-filtered mip chain is ~10-20%
        expect(await page.evaluate(() => window.blurShiftVariance())).toBeLessThan(0.003)
    })

    test('gaussianBlur keeps the drop-in contract', async ({ page }) => {
        expect(await page.evaluate(() => window.blurContract())).toEqual({
            repeatWrapUsesSeparable: true,
            restored: true,
            sameSizeAsInput: true,
            sameTypeAsLegacy: true,
            returnsTarget: true,
            cacheIdsSeparate: true,
        })
    })

    test('generatePyramidBloom and its legacy shim are shift-invariant', async ({ page }) => {
        // the mipmap chain bloom is ~85% here
        expect(await page.evaluate(() => window.bloomShiftVariance('pyramid'))).toBeLessThan(0.003)
        expect(await page.evaluate(() => window.bloomShiftVariance('shim'))).toBeLessThan(0.003)
        // cheaper preset: documented as ≈ 0.4% of peak
        expect(await page.evaluate(() => window.bloomShiftVariance('balanced'))).toBeLessThan(0.008)
    })

    test('generateBlurredMipmaps antiAliased removes the shimmer and keeps the look', async ({ page }) => {
        // the default chain is 83-93% at both. Kernels of 9.3 px (a 0.0173 kernel at 1080p) and 16 px: measured
        // 1.4% and 0.14%. (Much smaller kernels leave the levels under a texel of blur, which no decimated level can
        // represent shift-invariantly: 9% at 4 px.)
        expect(await page.evaluate(() => window.bloomShiftVariance('antiAliased', 0.0727))).toBeLessThan(0.025)
        expect(await page.evaluate(() => window.bloomShiftVariance('antiAliased', 0.125))).toBeLessThan(0.004)
        const r = await page.evaluate(() => window.antiAliasedMipsParity())
        // smooth input, where the default chain does not alias: same blur per level
        for (const [i, e] of r.errors.entries()) expect(e, `level ${i + 1}`).toBeLessThan(0.03)
        expect(r.legacyDeterministic).toBe(true)
        expect(r.swizzleError).toBeLessThan(1e-3)
    })

    test('generatePyramidBloom is resolution independent', async ({ page }) => {
        expect(await page.evaluate(() => window.bloomResolutionIndependence())).toBeLessThan(0.01)
    })

    test('generatePyramidBloomLegacy looks the same as the mipmap chain bloom', async ({ page }) => {
        // smooth input, where the mipmap chain does not alias: same σ per level and same weights
        expect(await page.evaluate(() => window.bloomParity())).toBeLessThan(0.03)
    })
})
