import { test, expect } from '@playwright/test';
import { ACESFilmicToneMapping, NeutralToneMapping, CineonToneMapping, ShaderMaterial, SRGBColorSpace } from 'three';
import { HdrOutput } from '../dist/rendering/HdrOutput.js';
import { applyHdrToneMapping } from '../dist/rendering/HdrToneMapping.js';

function fixture({ official = true, gpu, rejectBuffer = false, initialFormat = 0x8058, gpuContext = null } = {}) {
    const query = Object.assign(new EventTarget(), { matches: true });
    const canvas = new EventTarget();
    const elements = [];
    const calls = [];
    let lost = false;
    const gl = {
        RGBA8: 0x8058, RGBA16F: 0x881a, drawingBufferFormat: initialFormat,
        drawingBufferWidth: 32, drawingBufferHeight: 32, drawingBufferColorSpace: 'srgb',
        getExtension: () => ({}), isContextLost: () => lost,
        drawingBufferStorage(format) { calls.push(format); if (!rejectBuffer || format !== this.RGBA16F) this.drawingBufferFormat = format; },
        ...(official ? { drawingBufferToneMapping({mode}) { calls.push(mode); } } : {}),
    };
    canvas.ownerDocument = {
        defaultView: { matchMedia: () => query, navigator: { platform: 'MacIntel', gpu } },
        body: {appendChild: c => elements.push(c)},
        createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() { elements.splice(elements.indexOf(this), 1); }, getContext() { return gpuContext; } }),
    };
    const renderer = { getContext: () => gl, domElement: canvas, outputColorSpace: SRGBColorSpace };
    const hdr = new HdrOutput(renderer);
    return { hdr, renderer, gl, calls, query, canvas, elements, setLost: value => { lost = value; } };
}

test('disabled controller is inert; enabling, resize and disposal restore original storage', () => {
    const f = fixture({initialFormat: 0x8c43});
    f.hdr.update();
    expect(f.calls).toEqual([]);
    f.hdr.enabled = true; f.hdr.update();
    expect(f.hdr.route).toBe('official');
    expect(f.hdr.targetHeadroom).toBe(4);
    f.gl.drawingBufferFormat = f.gl.RGBA8; f.hdr.update();
    expect(f.gl.drawingBufferFormat).toBe(f.gl.RGBA16F);
    f.hdr.dispose(); f.hdr.dispose();
    expect(f.gl.drawingBufferFormat).toBe(0x8c43);
    expect(f.hdr.route).toBe('sdr');
});

test('unsupported, rejected and throwing APIs fall back to SDR', () => {
    for (const kind of ['missing', 'rejected', 'throwing', 'toneMapping']) {
        const f = fixture({ rejectBuffer: kind === 'rejected' });
        if (kind === 'missing') delete f.gl.drawingBufferStorage;
        if (kind === 'throwing') f.gl.drawingBufferStorage = () => { throw new Error('unsupported'); };
        if (kind === 'toneMapping') f.gl.drawingBufferToneMapping = () => { throw new Error('unsupported'); };
        f.hdr.enabled = true;
        expect(() => f.hdr.update()).not.toThrow();
        expect(f.hdr.route).toBe('sdr'); expect(f.hdr.targetHeadroom).toBe(1);
        f.hdr.dispose();
    }
});

test('headroom validation, display changes and shared-renderer ownership', () => {
    const f = fixture(); f.hdr.enabled = true; f.hdr.update();
    for (const n of [NaN, Infinity, -1, 0.5]) expect(() => { f.hdr.headroom = n; }).toThrow();
    f.hdr.headroom = 2; expect(f.hdr.targetHeadroom).toBe(2);
    const other = new HdrOutput(f.renderer);
    expect(() => { other.enabled = true; }).toThrow(/owner/);
    f.query.matches = false; f.query.dispatchEvent(new Event('change')); f.hdr.update();
    expect(f.hdr.targetHeadroom).toBe(1);
    f.hdr.enabled = false;
    expect(f.gl.drawingBufferFormat).toBe(f.gl.RGBA8);
    other.enabled = true; other.update(); other.dispose(); f.hdr.dispose();
});

test('context restoration reconfigures and colour-space changes fail closed', () => {
    const f = fixture(); f.hdr.enabled = true; f.hdr.update();
    f.setLost(true); f.canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(f.hdr.route).toBe('sdr');
    f.setLost(false); f.gl.drawingBufferFormat = f.gl.RGBA8;
    f.canvas.dispatchEvent(new Event('webglcontextrestored')); f.hdr.update();
    expect(f.hdr.route).toBe('official');
    f.renderer.outputColorSpace = 'display-p3'; f.hdr.update();
    expect(f.hdr.targetHeadroom).toBe(1); expect(f.gl.drawingBufferFormat).toBe(f.gl.RGBA8);
    f.hdr.dispose();
});

test('asynchronous trigger cancellation and partial failures destroy devices and remove canvases', async () => {
    let resolveDevice;
    let destroyed = 0;
    const device = {destroy() { destroyed++; }};
    const gpu = {requestAdapter: async () => ({requestDevice: () => new Promise(r => { resolveDevice = r; })})};
    const f = fixture({official: false, gpu});
    f.hdr.enabled = true; f.hdr.allowCompositorTrigger = true; f.hdr.update();
    await Promise.resolve(); f.hdr.enabled = false;
    resolveDevice(device); await Promise.resolve();
    expect(destroyed).toBe(1); expect(f.elements).toHaveLength(0); expect(f.hdr.route).toBe('sdr');
    const g = fixture({official: false, gpu: {requestAdapter: async () => ({ requestDevice: async () => device })}});
    g.hdr.enabled = true; g.hdr.allowCompositorTrigger = true; g.hdr.update();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(destroyed).toBe(2); expect(g.elements).toHaveLength(0); expect(g.hdr.route).toBe('sdr');
    g.hdr.dispose(); f.hdr.dispose();
});

test('shader remains untouched for SDR; HDR patches once and restores the SDR branch', () => {
    const material = new ShaderMaterial({fragmentShader: 'void main() { gl_FragColor = vec4(1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
    const original = material.fragmentShader;
    applyHdrToneMapping(material, ACESFilmicToneMapping, 1);
    expect(material.fragmentShader).toBe(original);
    applyHdrToneMapping(material, ACESFilmicToneMapping, 4);
    const version = material.version;
    applyHdrToneMapping(material, NeutralToneMapping, 2);
    expect(material.version).toBe(version); expect(material.uniforms.displayToneCurve.value).toBe(1);
    applyHdrToneMapping(material, CineonToneMapping, 4);
    expect(material.uniforms.displayHdr.value).toBe(false);
    applyHdrToneMapping(material, ACESFilmicToneMapping, 1);
    expect(material.uniforms.displayHdr.value).toBe(false);
    expect(() => applyHdrToneMapping(new ShaderMaterial(), ACESFilmicToneMapping, 4)).toThrow(/chunks/);
});

test('browser default and float buffer resize/disable', async ({page}) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/tests/hdr-output.html');
    await page.waitForFunction(() => window.ready);
    const state = () => page.evaluate(() => {
        const {hdr, renderer} = window.hdrDemo;
        return {route: hdr.route, headroom: hdr.targetHeadroom, format: renderer.getContext().drawingBufferFormat};
    });
    expect((await state()).route).toBe('sdr');
    await page.check('#enabled');
    const supported = await page.evaluate(() => typeof window.hdrDemo.renderer.getContext().drawingBufferStorage === 'function');
    if (supported) {
        expect((await state()).format).toBe(0x881a);
        await page.evaluate(() => { const {renderer, draw} = window.hdrDemo; renderer.setSize(360, 120, false); draw(); });
        expect((await state()).format).toBe(0x881a);
    }
    await page.uncheck('#enabled');
    expect((await state()).format).toBe(0x8058);
    expect(errors).toEqual([]);
});

test('official HDR route renders extended values for ACES and Neutral', async () => {
    test.skip(!process.env.HDR_CHROME_EXECUTABLE, 'Set HDR_CHROME_EXECUTABLE to a Chrome build exposing WebGLToneMapping');
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({executablePath: process.env.HDR_CHROME_EXECUTABLE,
        args: ['--enable-blink-features=WebGLToneMapping', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]});
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.addInitScript(() => {
            const original = window.matchMedia.bind(window);
            window.matchMedia = q => {
                const result = original(q);
                if (q === '(dynamic-range: high)') Object.defineProperty(result, 'matches', {get: () => true});
                return result;
            };
        });
        await page.goto('http://localhost:5177/tests/hdr-output.html');
        await page.waitForFunction(() => window.ready);
        await page.check('#enabled');
        expect(await page.evaluate(() => window.hdrDemo.hdr.route)).toBe('official');
        for (const curve of ['aces', 'neutral']) {
            await page.selectOption('#curve', curve);
            for (const headroom of [1, 2, 4]) {
                await page.fill('#headroom', String(headroom));
                await page.locator('#headroom').dispatchEvent('change');
                const values = await page.evaluate(() => {
                    const {renderer, material, draw} = window.hdrDemo;
                    const gl = renderer.getContext();
                    const values = [];
                    for (const level of [0, 0.18, 0.5, 1, 2, 4, 16, 100]) {
                        material.uniforms.level.value = level; draw();
                        const pixel = new Float32Array(4);
                        gl.readPixels(100, 180, 1, 1, gl.RGBA, gl.FLOAT, pixel);
                        values.push(pixel[0]);
                    }
                    return values;
                });
                expect(values.every(Number.isFinite)).toBe(true);
                expect(values.every(v => v >= 0 && v <= 1.055 * Math.pow(headroom, 1 / 2.4) - 0.055 + 0.01)).toBe(true);
                for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 0.001);
                if (headroom > 1) expect(values.at(-1)).toBeGreaterThan(1.01);
            }
        }
        await page.evaluate(() => { const {renderer, draw} = window.hdrDemo; renderer.setSize(360, 120, false); draw(); });
        expect(await page.evaluate(() => window.hdrDemo.renderer.getContext().drawingBufferFormat)).toBe(0x881a);
        await page.uncheck('#enabled');
        expect(await page.evaluate(() => window.hdrDemo.renderer.getContext().drawingBufferFormat)).toBe(0x8058);
        expect(errors).toEqual([]);
    } finally { await browser.close(); }
});


test('successful trigger cleans up on device loss and configuration errors', async () => {
    let loseDevice;
    let destroyed = 0, unconfigured = 0;
    const device = {
        destroy() { destroyed++; },
        lost: new Promise(r => { loseDevice = r; }),
        queue: {submit() {}},
        createCommandEncoder: () => ({ beginRenderPass: () => ({end() {}}), finish() {} }),
    };
    const gpu = {requestAdapter: async () => ({requestDevice: async () => device})};
    const context = {configure() {}, unconfigure() { unconfigured++; }, getCurrentTexture: () => ({createView() {}})};
    const f = fixture({official: false, gpu, gpuContext: context});
    f.hdr.enabled = true; f.hdr.allowCompositorTrigger = true; f.hdr.update();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.hdr.route).toBe('compositor-trigger'); expect(f.elements).toHaveLength(1);
    loseDevice({reason: 'unknown'}); await Promise.resolve();
    expect(f.hdr.route).toBe('sdr'); expect(f.elements).toHaveLength(0);
    expect(destroyed).toBe(1); expect(unconfigured).toBe(1); f.hdr.dispose();
    const g = fixture({official: false, gpu, gpuContext: {...context, configure() {throw new Error('configure failed');}}});
    g.hdr.enabled = true; g.hdr.allowCompositorTrigger = true; g.hdr.update();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(g.elements).toHaveLength(0); expect(destroyed).toBe(2); expect(unconfigured).toBe(2);
    g.hdr.dispose();
});

test('opt-in compositor trigger creates and removes its WebGPU canvas', async () => {
    test.skip(process.env.HDR_TEST_COMPOSITOR !== '1' || process.platform !== 'darwin', 'Opt-in macOS Chrome integration test');
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({channel: 'chrome', args: ['--use-angle=metal']});
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.addInitScript(() => {
            const original = window.matchMedia.bind(window);
            window.matchMedia = q => {
                const result = original(q);
                if (q === '(dynamic-range: high)') Object.defineProperty(result, 'matches', {get: () => true});
                return result;
            };
        });
        await page.goto('http://localhost:5177/tests/hdr-output.html');
        await page.waitForFunction(() => window.ready);
        await page.check('#enabled');
        expect(await page.evaluate(() => window.hdrDemo.hdr.route)).toBe('sdr');
        expect(await page.locator('[data-haxiomic-hdr-trigger]').count()).toBe(0);
        await page.check('#trigger');
        await page.waitForFunction(() => window.hdrDemo.hdr.route === 'compositor-trigger');
        expect(await page.locator('[data-haxiomic-hdr-trigger]').count()).toBe(1);
        await page.uncheck('#enabled');
        expect(await page.locator('[data-haxiomic-hdr-trigger]').count()).toBe(0);
        expect(await page.evaluate(() => window.hdrDemo.renderer.getContext().drawingBufferFormat)).toBe(0x8058);
        expect(errors).toEqual([]);
    } finally { await browser.close(); }
});
