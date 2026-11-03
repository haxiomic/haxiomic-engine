import { test, expect } from '@playwright/test'

/* Rendering.renderPass and its helpers (rendering/Rendering.ts) do as their options say */

const JUNK = [204, 153, 51, 153]

let errors
test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto('/tests/render-pass.html')
    await page.waitForFunction(() => window.ready === true)
})
test.afterEach(() => expect(errors).toEqual([]))

test('blit clears the target only with clear: true', async ({ page }) => {
    const rightHalf = clear => page.evaluate(clear => window.cases.blitRightHalf(clear), clear)
    expect(await rightHalf(true)).toEqual([0, 0, 0, 0])
    expect(await rightHalf(false)).toEqual(JUNK)
    expect(await rightHalf(undefined)).toEqual(JUNK)
})

test("a pass run from inside another's render() leaves the outer pass's restore as it should be", async ({ page }) => {
    // the outer pass puts back what was there before it, not what the inner pass found
    expect(await page.evaluate(() => window.cases.nestedRestore())).toEqual({ target: null, viewport: [1, 2, 3, 4], clearColor: '00ff00', clearAlpha: 0.5 })
})
