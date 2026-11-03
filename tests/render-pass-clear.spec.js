import { test, expect } from '@playwright/test'

/* Rendering.renderPass's clear (rendering/Rendering.ts) is three's own: autoClear for the render() call, so it lands
   after three's shadow maps and transmission pass, in the scene's render pass. Each case is compared exactly with
   three's own clear, and with the clear renderPass made before (render() after it), to pin what changed. */

test.describe.configure({ mode: 'parallel' })

const TARGETS = ['canvas', 'msaa', 'plain']
const FLAGS = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1]]
    .flatMap(([c, d, s]) => (c ? [1, 0.5] : [1]).map(alpha => ({ color: !!c, depth: !!d, stencil: !!s, alpha })))
const SCENES = {
    'shadows': {},
    'no shadows': { shadows: false },
    'a texture background': { background: 'texture' },
    'a colour background': { background: 'color' },
    'a colour background, the app clearing no stencil': { background: 'color', appAutoClear: [true, true, false] },
    'glass': { transmission: true },
    'glass, no shadows': { transmission: true, shadows: false },
    'an object rendering a target of its own': { paint: true },
}

/** where renderPass's result differs from the clear it made before render() */
function changed(spec) {
    // three clears for a colour background with autoClearColor/Depth/Stencil: the app's before, the pass's now
    if (spec.background === 'color') {
        const [c, d, s] = spec.appAutoClear ?? [true, true, true]
        return spec.color !== c || (d && !spec.depth) || (s && !spec.stencil)
    }
    // glass sees the clear colour behind it, as in three, not what three's shadow map left in GL state (where the glass
    // is drawn: depth cleared)
    if (spec.transmission) return spec.shadows !== false && spec.color && spec.depth && spec.alpha === 1
    // an object's own render() from onBeforeRender sees autoClear on, with the pass's buffers
    if (spec.paint) return spec.color
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
    test(`${target}: the clear is three's own, and differs from the one made before render() only as documented`, async ({ page }) => {
        const wrong = []
        for (const [name, scene] of Object.entries(SCENES)) for (const flags of FLAGS) {
            const spec = { ...scene, ...flags, target }
            const r = await compare(page, spec)
            const what = `${name}, ${JSON.stringify(flags)}`
            if (any(r.asThree) || JSON.stringify(r.seen.renderPass) !== JSON.stringify(r.seen.three)) wrong.push(`${what}: not three's clear ${JSON.stringify(r.asThree)}`)
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

test('code rendering from inside the scene sees autoClear on, with the pass\'s buffers', async ({ page }) => {
    const r = await compare(page, { paint: true, paintRenders: 3, target: 'canvas', color: true, depth: false, stencil: false })
    expect(r.seen.before).toEqual(Array(3).fill({ autoClear: false, color: true, depth: true, stencil: true }))
    expect(r.seen.renderPass).toEqual(Array(3).fill({ autoClear: true, color: true, depth: false, stencil: false }))
    // its own target is cleared by its render() now: one dot, not three
    expect(r.asBefore.paint).toBeGreaterThan(0)
})

test('over a colour background, only the buffers the pass names are cleared', async ({ page }) => {
    // an earlier pass's depth over the left half: before, three's background clear (the app's buffers) cleared it anyway
    const r = await compare(page, { background: 'color', depthOccluder: true, target: 'msaa', color: true, depth: false, stencil: false })
    expect(r.asBefore.depth).toBeGreaterThan(0)
    expect(r.asThree).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
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
