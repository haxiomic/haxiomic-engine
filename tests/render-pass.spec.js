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

test('the viewport holds on a render target, shadow maps or not', async ({ page }) => {
    for (const shadows of [false, true]) {
        const r = await page.evaluate(shadows => window.cases.viewportOnTarget(shadows), shadows)
        // three binds the target again after drawing its shadow maps, applying the target's own viewport
        expect(r.drawn[0], `shadows ${shadows}`).toBeGreaterThanOrEqual(0)
        expect(r.drawn[1], `shadows ${shadows}`).toBeLessThan(32)
        expect(r.targetViewport).toEqual([0, 0, 64, 64])
    }
})

test('with clearColor: false the colour is kept, a colour background too; with a clear colour the background shows', async ({ page }) => {
    // nothing cleared at all, as when accumulating: three would clear for the background with the app's buffers
    for (const clearDepth of [false, true]) {
        const kept = await page.evaluate(clearDepth => window.cases.colourBackground(false, clearDepth), clearDepth)
        expect(kept, `clearDepth ${clearDepth}`).toEqual({ corner: JUNK, backgroundKept: true })
    }
    const cleared = await page.evaluate(() => window.cases.colourBackground({ rgb: 0xff0000, alpha: 0 }, true))
    // the background's colour, opaque, in place of the clear colour
    expect(cleared.corner).not.toEqual(JUNK)
    expect(cleared.corner[0]).toBeLessThan(20)
    expect(cleared.corner[3]).toBe(255)
    expect(cleared.backgroundKept).toBe(true)
})

const knownState = { target: null, viewport: [1, 2, 3, 4], clearColor: '00ff00', clearAlpha: 0.5 }

test('saveGlobalState nests: a helper that saves and restores inside a save leaves the outer restore intact', async ({ page }) => {
    // before, generateBlurredMipmaps saved into the same slot, and the outer restore put back the state it found
    expect(await page.evaluate(() => window.cases.nestedSave())).toEqual(knownState)
})

test('restoring a snapshot puts back its state, even when a save inside it was never restored', async ({ page }) => {
    expect(await page.evaluate(() => window.cases.unrestoredInnerSave())).toEqual(knownState)
})

test('passes inside a save leave it intact, restoring or not, throwing or not', async ({ page }) => {
    expect(await page.evaluate(() => window.cases.passesInsideSave())).toEqual(knownState)
})

test('restoreGlobalState() without a snapshot puts back the latest save, each time it is called', async ({ page }) => {
    // as before saves nested: restoring doesn't use a save up, and a save needn't be restored
    const other = { target: 'other', viewport: [0, 0, 8, 8], clearColor: 'ff0000', clearAlpha: 1 }
    expect(await page.evaluate(() => window.cases.latestSave())).toEqual({ first: other, second: other })
})

test('a snapshot keeps its state, whatever is saved after it', async ({ page }) => {
    expect(await page.evaluate(() => window.cases.snapshotKept())).toEqual(knownState)
})

test("a helper that throws before its restore leaves an app's save as it was", async ({ page }) => {
    // the engine's helpers take snapshots of their own, which they don't make the latest save
    expect(await page.evaluate(() => window.cases.throwingHelperInsideSave())).toEqual({ threw: 'a pass threw', state: knownState })
})

test('gaussianBlur and pyramidBloom put back the clear colour', async ({ page }) => {
    // their passes clear with shaderMaterialPass's default magenta
    expect(await page.evaluate(() => window.cases.blurClearColour())).toEqual({ afterBlur: ['00ff00', 0.5], afterBloom: ['00ff00', 0.5] })
})

const otherState = { target: 'other', viewport: [0, 0, 8, 8], clearColor: 'ff0000', clearAlpha: 1 }

test("every helper that restores its own state puts it back and leaves an app's save intact", async ({ page }) => {
    const states = await page.evaluate(() => window.cases.helpersInsideSave())
    for (const helper of ['mipmaps', 'antiAliasedMipmaps', 'gaussianBlur', 'pyramidBloom', 'fluidStep', 'dualTargetResize']) {
        expect(states[helper], helper).toEqual({ afterHelper: otherState, afterRestore: knownState })
    }
})

test("a cube target's face and mip level are put back by a helper, a restoring pass and a restore", async ({ page }) => {
    const bound = [true, 3, 1]
    expect(await page.evaluate(() => window.cases.cubeFaceAndMipLevel())).toEqual({ afterHelper: bound, afterPass: bound, afterRestore: bound, afterSnapshotRestore: bound })
})

test("restoreGlobalState() without a snapshot puts back the app's latest save, not a helper's; nothing before any save or after dispose()", async ({ page }) => {
    // before, the mip chains, the fluid step and DualRenderTarget.resize saved there too: a restore after one put back
    // the state from the helper's start; and before any save or after dispose() it bound the canvas with an empty viewport
    expect(await page.evaluate(() => window.cases.restoreWithoutSave())).toEqual({
        beforeAnySave: knownState,
        afterHelperAndPass: "the pass's target",
        afterHelperWithEarlierSave: otherState,
        afterDispose: knownState,
    })
})

test('a per-object override inside another on the same objects puts back the outer one, and the outer the originals', async ({ page }) => {
    // before, each object held one saved material: the inner pass overwrote the original with the outer override, and
    // the outer pass found none left to put back
    expect(await page.evaluate(() => window.cases.nestedPerObjectOverrides())).toEqual({
        during: ['inner', 'inner'],
        afterInner: ['outer', 'outer'],
        after: ['original', 'original'],
    })
})

test('an object the override function moves later in the scene, so it is overridden twice, gets its own material back', async ({ page }) => {
    // put back last first: first to last, the first override was the last written
    expect(await page.evaluate(() => window.cases.overrideVisitedTwice())).toEqual({ visitedTwice: true, restored: [true, true] })
})
