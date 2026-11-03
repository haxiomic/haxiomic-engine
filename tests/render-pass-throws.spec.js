import { test, expect } from '@playwright/test'

/* Rendering.renderPass (rendering/Rendering.ts) puts back everything it changes, whichever of its steps throws */

let errors
test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto('/tests/render-pass-throws.html')
    await page.waitForFunction(() => window.ready === true)
})
test.afterEach(() => expect(errors).toEqual([]))

const CASES = {
    perObject: ['viewport', 'override', 'layers', 'render'],
    global: ['viewport', 'layers', 'render'],
    meshGlobal: ['viewport', 'layers', 'render'],
}
for (const [override, throwAts] of Object.entries(CASES)) for (const throwAt of throwAts) {
    test(`a ${override} override material, a throw at the ${throwAt}: everything is put back`, async ({ page }) => {
        const r = await page.evaluate(([o, t]) => window.throwing(o, t), [override, throwAt])
        expect(r).toEqual({ threw: `throws at ${throwAt}`, changed: [] })
    })
}
