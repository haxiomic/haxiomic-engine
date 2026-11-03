import { test, expect } from '@playwright/test'

/* Rendering.renderPass's clear (rendering/Rendering.ts). A full clear with three's own buffers is three's: autoClear on
   for the render() call, so it lands after three's shadow maps and transmission pass, in the scene's render pass. Any
   other clear, and any with a texture background, is made before render() with autoClear off, as it always was. Each
   case is compared exactly with three's own clear, and with the clear renderPass made before, to pin what changed. */

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
    "three's Reflector, the box moving": { reflector: true, moveBox: true, renders: 3 },
}

/** a texture background: the clear is made before render(), as it was (three's would use the clear colour its shadow map
    left set, where the background doesn't cover the view) */
const textureBackground = spec => spec.background === 'texture' || spec.background === 'equirect'

/** whether three makes the clear: a full one, with the renderer's autoClearColor/Depth/Stencil as three sets them */
const threeClears = spec => spec.color && spec.depth && spec.stencil && !(spec.appAutoClear ?? []).includes(false) && !textureBackground(spec)

/** where renderPass's result differs from the clear it made before render() */
function changed(spec) {
    // a colour background with the colour kept: the scene has none for the call
    if (spec.background === 'color' && !spec.color) return true
    if (!threeClears(spec)) return false
    // glass sees the clear colour behind it, as in three, not what three's shadow map left set
    if (spec.transmission) return spec.shadows !== false && spec.alpha === 1
    // an object's own render() from onBeforeRender sees autoClear on, as in plain three, so it clears its target
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
    test(`${target}: a full clear is three's own, any other is made as before, and the result differs from before only as documented`, async ({ page }) => {
        const wrong = []
        for (const [name, scene] of Object.entries(SCENES)) for (const flags of FLAGS) {
            const spec = { ...scene, ...flags, target }
            const r = await compare(page, spec)
            const what = `${name}, ${JSON.stringify(flags)}`
            if (threeClears(spec) && (any(r.asThree) || JSON.stringify(r.seen.renderPass) !== JSON.stringify(r.seen.three))) wrong.push(`${what}: not three's clear ${JSON.stringify(r.asThree)}`)
            if (any(r.asBefore) !== changed(spec)) wrong.push(`${what}: ${changed(spec) ? 'same as' : 'differs from'} before ${JSON.stringify(r.asBefore)}`)
            if (!r.restored || r.threw) wrong.push(`${what}: renderer not put back, or threw ${r.threw}`)
        }
        expect(wrong).toEqual([])
    })
}

test("a full clear lands after the shadow map, in the scene's render pass; any other comes first, as before", async ({ page }) => {
    for (const target of TARGETS) {
        // the clears of the pass's target before and after the first draw to another target
        const full = await compare(page, { target, color: true, depth: true, stencil: true })
        expect(full.placement, target).toEqual({ renderPass: { before: 0, after: 1 }, before: { before: 1, after: 0 } })
        const partial = await compare(page, { target, color: true, depth: true, stencil: false })
        expect(partial.placement.renderPass, target).toEqual(partial.placement.before)
    }
})

test("three's Reflector, which clears its own target only with autoClear off, reflects as before whatever the pass clears", async ({ page }) => {
    for (const [c, d, s] of [[1, 1, 1], [1, 1, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1]]) {
        const r = await compare(page, { reflector: true, moveBox: true, renders: 3, target: 'msaa', color: !!c, depth: !!d, stencil: !!s })
        expect(r.asBefore, `c${c}d${d}s${s}`).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
    }
})

test('code rendering from inside the scene sees autoClear on during a full clear, as in plain three, and off otherwise, as before', async ({ page }) => {
    const full = await compare(page, { paint: true, paintRenders: 3, target: 'canvas', color: true, depth: true, stencil: true })
    expect(full.seen.before).toEqual(Array(3).fill({ autoClear: false, color: true, depth: true, stencil: true }))
    expect(full.seen.renderPass).toEqual(Array(3).fill({ autoClear: true, color: true, depth: true, stencil: true }))
    // its own target is cleared by its render() now: one dot, not three
    expect(full.asBefore.paint).toBeGreaterThan(0)
    const partial = await compare(page, { paint: true, paintRenders: 3, target: 'canvas', color: true, depth: false, stencil: false })
    expect(partial.seen.renderPass).toEqual(partial.seen.before)
    expect(partial.asBefore.paint).toBe(0)
})

test("with a full clear the scene's own onBeforeRender runs before it: what it draws into the target is cleared", async ({ page }) => {
    const r = await compare(page, { sceneDraws: true, target: 'plain', color: true, depth: true, stencil: true })
    expect(r.asBefore.colour).toBeGreaterThan(0)
    expect(r.asThree).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
})

test("over a colour background a partial clear is as before: three's background clear takes the renderer's buffers", async ({ page }) => {
    // an earlier pass's depth over the left half, cleared by three's background clear, as it always was
    const r = await compare(page, { background: 'color', depthOccluder: true, target: 'msaa', color: true, depth: false, stencil: false })
    expect(r.asBefore).toEqual({ colour: 0, depth: 0, stencil: 0, paint: 0 })
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
    for (const target of TARGETS) for (const depth of [false, true]) {
        const r = await compare(page, { throws: true, target, color: true, depth, stencil: true })
        expect(r.threw).toContain('a hook threw')
        expect(r.restored, `${target}, depth ${depth}`).toBe(true)
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
