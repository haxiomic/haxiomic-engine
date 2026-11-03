import { test, expect } from '@playwright/test'

/* Rendering.renderPass's clear (rendering/Rendering.ts), when the pass clears colour and depth, is three's own:
   autoClear for the render() call, so it lands after three's shadow maps and transmission pass, in the scene's render
   pass. Otherwise, and with a texture background, it's made before render(), as it was, so code rendering from inside
   the scene sees autoClear off. Either way a colour background clears the pass's buffers. Each case is compared exactly
   with three's own clear, and with the clear renderPass made before (render() after it), to pin what changed. */

test.describe.configure({ mode: 'parallel' })

const TARGETS = ['canvas', 'msaa', 'plain']
const FLAGS = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1]]
    .flatMap(([c, d, s]) => (c ? [1, 0.5] : [1]).map(alpha => ({ color: !!c, depth: !!d, stencil: !!s, alpha })))
const SCENES = {
    'shadows': {},
    'no shadows': { shadows: false },
    'a texture background': { background: 'texture' },
    'an equirect background, orthographic camera': { background: 'equirect', ortho: true },
    'a colour background': { background: 'color' },
    'a colour background, the app clearing no stencil': { background: 'color', appAutoClear: [true, true, false] },
    'glass': { transmission: true },
    'glass, no shadows': { transmission: true, shadows: false },
    'an object rendering a target of its own': { paint: true },
    "the scene's own onBeforeRender drawing into the target": { sceneDraws: true },
}

/** a texture background: the clear is made before render(), as it was (three's would use the clear colour its shadow map
    left set, where the background doesn't cover the view) */
const textureBackground = spec => spec.background === 'texture' || spec.background === 'equirect'

/** three makes the clear: the pass clears colour and depth, and there's no texture background */
const threeClears = spec => !textureBackground(spec) && spec.color && spec.depth

/** where renderPass's result differs from the clear it made before render() */
function changed(spec) {
    if (textureBackground(spec)) return false
    // three clears for a colour background with autoClearColor/Depth/Stencil: the app's before, the pass's now
    if (spec.background === 'color') {
        const [c, d, s] = spec.appAutoClear ?? [true, true, true]
        return spec.color !== c || (d && !spec.depth) || (s && !spec.stencil)
    }
    // otherwise the clear is made before render(), as it was
    if (!threeClears(spec)) return false
    // glass sees the clear colour behind it, as in three, not what three's shadow map left in GL state
    if (spec.transmission) return spec.shadows !== false && spec.alpha === 1
    // an object's own render() from onBeforeRender sees autoClear on, with the pass's buffers
    if (spec.paint) return true
    // the scene's onBeforeRender runs before three's clear, so what it draws into the target is cleared
    if (spec.sceneDraws) return true
    return false
}

const compare = (page, spec) => page.evaluate(spec => window.compare(spec), spec)
const any = d => d.colour !== 0 || d.depth !== 0 || d.stencil !== 0 || d.paint !== 0

let errors
test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto('/tests/render-pass-clear.html')
    await page.waitForFunction(() => window.ready === true)
})
test.afterEach(() => expect(errors).toEqual([]))

for (const target of TARGETS) {
    test(`${target}: the clear is three's own when the pass clears colour and depth, a colour background's clear is the pass's buffers, and it differs from before only as documented`, async ({ page }) => {
        const wrong = []
        for (const [name, scene] of Object.entries(SCENES)) for (const flags of FLAGS) {
            const spec = { ...scene, ...flags, target }
            const r = await compare(page, spec)
            const what = `${name}, ${JSON.stringify(flags)}`
            if (threeClears(spec) && (any(r.asThree) || JSON.stringify(r.seen.renderPass) !== JSON.stringify(r.seen.three))) wrong.push(`${what}: not three's clear ${JSON.stringify(r.asThree)}`)
            // made before render() with the pass's buffers for three's background clear: the same pixels as three's
            if (!threeClears(spec) && spec.background === 'color' && any(r.asThree)) wrong.push(`${what}: background clear not the pass's buffers ${JSON.stringify(r.asThree)}`)
            if (any(r.asBefore) !== changed(spec)) wrong.push(`${what}: ${changed(spec) ? 'same as' : 'differs from'} before ${JSON.stringify(r.asBefore)}`)
            if (!r.restored || r.threw) wrong.push(`${what}: renderer not put back, or threw ${r.threw}`)
        }
        expect(wrong).toEqual([])
    })
}

test("the clear lands after the shadow map, in the scene's render pass; before, it came first", async ({ page }) => {
    for (const target of TARGETS) {
        const r = await compare(page, { target, color: true, depth: true, stencil: true })
        // the clears of the pass's target before and after the first draw to another target
        expect(r.placement, target).toEqual({ renderPass: { before: 0, after: 1 }, before: { before: 1, after: 0 } })
    }
})

test("code rendering from inside the scene sees autoClear on, with the pass's buffers, only when the pass clears colour and depth", async ({ page }) => {
    const both = await compare(page, { paint: true, paintRenders: 3, target: 'canvas', color: true, depth: true, stencil: false })
    expect(both.seen.before).toEqual(Array(3).fill({ autoClear: false, color: true, depth: true, stencil: true }))
    expect(both.seen.renderPass).toEqual(Array(3).fill({ autoClear: true, color: true, depth: true, stencil: false }))
    // its own target is cleared by its render() now: one dot, not three
    expect(both.asBefore.paint).toBeGreaterThan(0)

    // a partial clear: autoClear off, as before (the buffers are the pass's, for a colour background's clear)
    const colourOnly = await compare(page, { paint: true, paintRenders: 3, target: 'canvas', color: true, depth: false, stencil: false })
    expect(colourOnly.seen.renderPass).toEqual(Array(3).fill({ autoClear: false, color: true, depth: false, stencil: false }))
    expect(colourOnly.asBefore.paint).toBe(0)
})

test("an object rendering its own target as three's Reflector does keeps nothing from last frame, whatever the pass clears", async ({ page }) => {
    // it clears the target itself only when autoClear is off: with autoClear on for a partial clear, three's clear of its
    // target would be the pass's buffers, and keep last frame's colour or depth
    for (const flags of [...FLAGS, { color: false, depth: false, stencil: false }]) {
        expect(await page.evaluate(f => window.reflectorLike(f), flags), JSON.stringify(flags)).toEqual({ staleColour: false, farHidden: false })
    }
})

test("the scene's own onBeforeRender runs before the clear: what it draws into the target is cleared", async ({ page }) => {
    const r = await compare(page, { sceneDraws: true, target: 'plain', color: true, depth: true, stencil: false })
    expect(r.asBefore.colour).toBeGreaterThan(0)
    expect(r.asThree).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
})

test('over a colour background, only the buffers the pass names are cleared', async ({ page }) => {
    // an earlier pass's depth over the left half: before, three's background clear (the app's buffers) cleared it anyway
    const r = await compare(page, { background: 'color', depthOccluder: true, target: 'msaa', color: true, depth: false, stencil: false })
    expect(r.asBefore.depth).toBeGreaterThan(0)
    expect(r.asThree).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
})

test("with a texture background three doesn't see, the clear colour is the pass's, not what three's shadow map left set", async ({ page }) => {
    const r = await compare(page, { background: 'equirect', ortho: true, target: 'plain', color: true, depth: true, stencil: true })
    // three's own clear there is white
    expect(r.asThree.colour).toBeGreaterThan(0)
    expect(r.asBefore).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
})

test('glass with shadows shows the clear colour behind it, as in three', async ({ page }) => {
    const flags = { target: 'msaa', color: true, depth: true, stencil: true }
    expect((await compare(page, { transmission: true, ...flags })).asBefore.colour).toBeGreaterThan(0)
    expect((await compare(page, { transmission: true, shadows: false, ...flags })).asBefore.colour).toBe(0)
})

test('a throw from inside render() leaves the renderer as it was', async ({ page }) => {
    for (const target of TARGETS) {
        const r = await compare(page, { throws: true, target, color: true, depth: false, stencil: true })
        expect(r.threw).toContain('a hook threw')
        expect(r.restored, target).toBe(true)
    }
})

test('the comparisons see each buffer cleared or left', async ({ page }) => {
    // junk where colour isn't cleared and nothing draws; the far plane only where depth is cleared; stencil 0 only where
    // it is cleared
    const seen = async (flags) => (await compare(page, { target: 'msaa', ...flags })).seenIn
    expect(await seen({ color: true, depth: true, stencil: true })).toMatchObject({ junk: 0, stencil0: 64 * 64 })
    expect((await seen({ color: true, depth: true, stencil: true })).far).toBeGreaterThan(0)
    expect(await seen({ color: false, depth: false, stencil: false })).toEqual({ junk: 64 * 64, far: 0, stencil0: 0 })
    const depthOnly = await seen({ color: false, depth: true, stencil: false })
    expect(depthOnly.junk).toBeGreaterThan(0)
    expect(depthOnly.far).toBeGreaterThan(0)
})
