import { test, expect } from '@playwright/test'

/* FrameMonitor in PhysicallyBasedViewer's dev mode */
test.describe('frame monitor', () => {
    let errors
    test.beforeEach(async ({ page }) => {
        errors = []
        page.on('pageerror', e => errors.push(String(e)))
        await page.goto('/tests/frame-monitor.html')
        await page.waitForFunction(() => window.ready === true)
    })
    test.afterEach(() => expect(errors).toEqual([]))

    const framesMeasured = page => page.evaluate(() => window.viewer.dev.frameMonitor.history.length)
    const waitFrames = (page, n) => page.evaluate(n => new Promise(resolve => {
        const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
    }), n)

    test('sits at the top of the DevUI panel, replacing the stats.js overlay', async ({ page }) => {
        const layout = await page.evaluate(() => {
            const root = window.DevUI.ui
            return {
                firstFolder: root.folders[0]._title,
                inFirstFolder: root.folders[0].$children.contains(document.querySelector('.frame-monitor')),
                open: !root.folders[0]._closed,
                overlays: document.querySelectorAll('body > .frame-monitor').length,
                // stats.js mounts a fixed canvas container straight into the body
                statsJs: [...document.body.children].some(el => el.style.cssText.includes('position: fixed') && el.querySelector('canvas')),
                statsAlias: window.viewer.dev.stats === window.viewer.dev.frameMonitor,
            }
        })
        expect(layout).toEqual({ firstFolder: 'Frame monitor', inFirstFolder: true, open: true, overlays: 0, statsJs: false, statsAlias: true })
    })

    test('reports frame rate, and draw calls summed over every render call in the frame', async ({ page }) => {
        await page.waitForFunction(() => window.monitorText().fps !== '–', null, { timeout: 5000 })
        // let a full refresh window pass with a steady scene
        await page.waitForTimeout(700)
        const r = await page.evaluate(() => ({
            text: window.monitorText(),
            expected: window.lastFrameCounts,
            lastRenderCalls: window.viewer.renderer.info.render.calls,
            info: { geometries: window.viewer.renderer.info.memory.geometries, textures: window.viewer.renderer.info.memory.textures, programs: window.viewer.renderer.info.programs.length },
        }))
        expect(Number(r.text.fps)).toBeGreaterThan(0)
        expect(r.text.frame).toMatch(/^\d+\.\d ms$/)
        expect(r.text.cpu).toMatch(/^\d+\.\d\d ms$/)
        expect(r.text.gpu).toMatch(/^(n\/a|\d+\.\d\d ms)$/)

        expect(r.expected.renders).toBeGreaterThan(1)
        // renderer.info alone only shows the last render call (the full-screen copy)
        expect(r.lastRenderCalls).toBeLessThan(r.expected.calls)
        expect(Number(r.text.calls)).toBe(r.expected.calls)
        expect(Number(r.text.triangles)).toBe(r.expected.triangles)
        expect(Number(r.text.geometries)).toBe(r.info.geometries)
        expect(Number(r.text.textures)).toBe(r.info.textures)
        expect(Number(r.text.programs)).toBe(r.info.programs)
    })

    test('keeps renderer.info behaving as before', async ({ page }) => {
        await waitFrames(page, 5)
        const info = await page.evaluate(() => {
            const info = window.viewer.renderer.info
            return { autoReset: info.autoReset, calls: info.render.calls }
        })
        // still reset per render call: the last render is the one full-screen triangle
        expect(info).toEqual({ autoReset: true, calls: 1 })
    })

    test('measures once per frame when the loop calls update() as well', async ({ page }) => {
        await page.evaluate(() => {
            const monitor = window.viewer.dev.frameMonitor
            window.viewer.events.frameUpdate.addListener(() => monitor.update())
        })
        const before = await framesMeasured(page)
        const frames = await page.evaluate(() => new Promise(resolve => {
            let n = 0
            const step = () => (++n >= 30 ? resolve(n) : requestAnimationFrame(step))
            requestAnimationFrame(step)
        }))
        const measured = (await framesMeasured(page)) - before
        expect(measured).toBeGreaterThanOrEqual(frames - 2)
        expect(measured).toBeLessThanOrEqual(frames + 2)
    })

    test('stops measuring while the panel is hidden or the folder is closed', async ({ page }) => {
        const pausedWhile = async (hide, show) => {
            await page.evaluate(hide)
            await waitFrames(page, 3)
            const a = await framesMeasured(page)
            await waitFrames(page, 10)
            const b = await framesMeasured(page)
            await page.evaluate(show)
            await waitFrames(page, 10)
            const c = await framesMeasured(page)
            return { paused: b === a, resumed: c > b }
        }
        // the history is capped, so start from an empty one
        await page.evaluate(() => { window.viewer.dev.frameMonitor.history.length = 0 })
        expect(await pausedWhile(() => window.DevUI.ui.hide(), () => window.DevUI.ui.show())).toEqual({ paused: true, resumed: true })
        await page.evaluate(() => { window.viewer.dev.frameMonitor.history.length = 0 })
        expect(await pausedWhile(() => window.DevUI.ui.folders[0].close(), () => window.DevUI.ui.folders[0].open())).toEqual({ paused: true, resumed: true })
    })

    test('s toggles the folder, h the whole panel', async ({ page }) => {
        const closed = () => page.evaluate(() => window.DevUI.ui.folders[0]._closed)
        // the viewer's shortcuts only act on keys sent to the body; clicking the canvas focuses it
        await page.evaluate(() => document.activeElement?.blur())
        await page.keyboard.press('s')
        expect(await closed()).toBe(true)
        await page.keyboard.press('s')
        expect(await closed()).toBe(false)
        await page.keyboard.press('h')
        expect(await page.evaluate(() => window.DevUI.ui._hidden)).toBe(true)
    })

    test('dispose restores renderer.info and removes the monitor', async ({ page }) => {
        const r = await page.evaluate(async () => {
            const { renderer, dev } = window.viewer
            const patched = renderer.info.update
            dev.frameMonitor.dispose()
            await new Promise(requestAnimationFrame)
            return {
                restored: renderer.info.update !== patched,
                removed: document.querySelector('.frame-monitor') == null,
            }
        })
        expect(r).toEqual({ restored: true, removed: true })
    })
})
