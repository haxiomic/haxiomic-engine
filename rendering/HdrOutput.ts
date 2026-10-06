import { SRGBColorSpace, type WebGLRenderer } from 'three';

export type HdrOutputRoute = 'sdr' | 'official' | 'compositor-trigger';
export type HdrOutputOptions = {
    enabled?: boolean;
    /** Unsupported Chromium/macOS behaviour affecting all float canvases in the window. */
    allowCompositorTrigger?: boolean;
    /** Peak in multiples of SDR white. 'auto' guesses 4 on HDR displays. */
    headroom?: number | 'auto';
    /** Request a frame, including after asynchronous route and display changes. */
    onChange?: () => void;
};

type HdrContext = WebGL2RenderingContext & {
    drawingBufferStorage?: (format: GLenum, width: GLsizei, height: GLsizei) => void;
    readonly drawingBufferFormat?: GLenum;
    drawingBufferToneMapping?: (options: { mode: 'standard' | 'extended' }) => void;
};
// Minimal structural types avoid requiring consumers to install WebGPU typings.
type Device = {
    destroy(): void;
    lost: Promise<unknown>;
    createCommandEncoder(): { beginRenderPass(options: unknown): { end(): void }; finish(): unknown };
    queue: { submit(commands: unknown[]): void };
};
type Gpu = { requestAdapter(): Promise<{ requestDevice(): Promise<Device> } | null> };
type GpuContext = { configure(options: unknown): void; unconfigure(): void; getCurrentTexture(): { createView(): unknown } };
type Trigger = { canvas: HTMLCanvasElement; device: Device; context: GpuContext };

const owners = new WeakMap<WebGLRenderer, HdrOutput>();

/**
 * Opt-in HDR presentation for one renderer. Call update() after resizing and
 * before rendering the final canvas pass. This configures presentation only:
 * your pipeline must preserve and encode values above SDR white itself.
 * Use applyHdrToneMapping for an ACES/Neutral final linear-sRGB shader pass.
 * One controller owns the whole renderer, including all shared-canvas panes.
 */
export class HdrOutput {
    onChange?: () => void;
    private _enabled = false;
    private _allowCompositorTrigger = false;
    private _headroom: number | 'auto' = 'auto';
    private _route: HdrOutputRoute = 'sdr';
    private query: MediaQueryList | null = null;
    private savedFormat: GLenum | null = null;
    private resolved = false;
    private generation = 0;
    private trigger: Trigger | null = null;
    private disposed = false;
    private listening = false;

    constructor(readonly renderer: WebGLRenderer, options: HdrOutputOptions = {}) {
        this.headroom = options.headroom ?? 'auto';
        this._allowCompositorTrigger = options.allowCompositorTrigger ?? false;
        this.enabled = options.enabled ?? false;
        this.onChange = options.onChange;
    }

    get enabled(): boolean { return this._enabled; }
    set enabled(value: boolean) {
        if (value === this._enabled) return;
        if (this.disposed) throw new Error('HdrOutput has been disposed');
        if (value) {
            const owner = owners.get(this.renderer);
            if (owner && owner !== this) throw new Error('HDR output already has an owner for this renderer');
            owners.set(this.renderer, this);
        }
        this._enabled = value;
        if (!value) {
            this.restore();
            this.stopListening();
            owners.delete(this.renderer);
        }
        this.onChange?.();
    }

    get allowCompositorTrigger(): boolean { return this._allowCompositorTrigger; }
    set allowCompositorTrigger(value: boolean) {
        if (value === this._allowCompositorTrigger) return;
        this._allowCompositorTrigger = value;
        this.invalidate();
    }

    get headroom(): number | 'auto' { return this._headroom; }
    set headroom(value: number | 'auto') {
        if (value !== 'auto' && (!Number.isFinite(value) || value < 1)) {
            throw new RangeError('HDR headroom must be auto or a finite number at least 1');
        }
        if (value === this._headroom) return;
        this._headroom = value;
        this.onChange?.();
    }

    /** Selected presentation route, not proof of physical HDR luminance. */
    get route(): HdrOutputRoute { return this._route; }
    get displaySupportsHdr(): boolean { return this.query?.matches ?? false; }
    get targetHeadroom(): number {
        if (!this.enabled || this.route === 'sdr' || !this.displaySupportsHdr) return 1;
        return this.headroom === 'auto' ? 4 : this.headroom;
    }

    update(): void {
        if (!this.enabled || this.disposed) return;
        const gl = this.renderer.getContext() as HdrContext;
        if (gl.isContextLost()) return;
        this.startListening();
        // The companion shader assumes extended sRGB, so fail closed on a
        // consumer colour-space change rather than displaying wrong colours.
        if (this.renderer.outputColorSpace !== SRGBColorSpace || gl.drawingBufferColorSpace !== 'srgb') {
            if (this.savedFormat !== null) this.restore();
            return;
        }
        if (this.resolved) {
            if (this.savedFormat !== null && gl.drawingBufferFormat !== gl.RGBA16F) {
                try { this.applyBuffer(gl); } catch { this.restore(); this.resolved = true; }
            }
            return;
        }
        this.resolved = true;
        if (typeof gl.drawingBufferStorage !== 'function' || !gl.getExtension('EXT_color_buffer_float')) return;
        // Re-evaluating a route must retain the pre-HDR format, rather than
        // capturing our own RGBA16F allocation as the restore destination.
        if (this.savedFormat === null) this.savedFormat = gl.drawingBufferFormat ?? gl.RGBA8;
        try {
            this.applyBuffer(gl);
            if (gl.drawingBufferFormat !== gl.RGBA16F) throw new Error('Float drawing buffer rejected');
            if (typeof gl.drawingBufferToneMapping === 'function') {
                gl.drawingBufferToneMapping({ mode: 'extended' });
                this._route = 'official';
                return;
            }
        } catch {
            this.restore();
            this.resolved = true;
            return;
        }
        const win = this.renderer.domElement.ownerDocument.defaultView;
        const gpu = (win?.navigator as unknown as { gpu?: Gpu } | undefined)?.gpu;
        const mac = /Mac/.test(win?.navigator.platform ?? '');
        if (!this.allowCompositorTrigger || !this.displaySupportsHdr || !mac || !gpu) return;
        const generation = this.generation;
        void this.addTrigger(gpu, generation);
    }

    dispose(): void {
        if (this.disposed) return;
        this.enabled = false;
        this.restore();
        this.stopListening();
        this.disposed = true;
        this.onChange = undefined;
    }

    private applyBuffer(gl: HdrContext): void {
        gl.drawingBufferStorage!(gl.RGBA16F, gl.drawingBufferWidth, gl.drawingBufferHeight);
        if (gl.drawingBufferFormat !== gl.RGBA16F) throw new Error('Float drawing buffer rejected');
        if (this.route === 'official') gl.drawingBufferToneMapping!({ mode: 'extended' });
    }

    private startListening(): void {
        if (this.listening) return;
        this.query = this.renderer.domElement.ownerDocument.defaultView?.matchMedia('(dynamic-range: high)') ?? null;
        this.query?.addEventListener('change', this.invalidate);
        this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
        this.renderer.domElement.addEventListener('webglcontextrestored', this.invalidate);
        this.listening = true;
    }

    private stopListening(): void {
        this.query?.removeEventListener('change', this.invalidate);
        this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
        this.renderer.domElement.removeEventListener('webglcontextrestored', this.invalidate);
        this.query = null;
        this.listening = false;
    }

    private onContextLost = (): void => {
        // The restored context starts with new storage; do not restore stale state.
        this.savedFormat = null;
        this.invalidate();
    };

    private invalidate = (): void => {
        ++this.generation;
        this.removeTrigger();
        this._route = 'sdr';
        this.resolved = false;
        this.onChange?.();
    };

    private restore(): void {
        const gl = this.renderer.getContext() as HdrContext;
        if (this.savedFormat !== null && !gl.isContextLost()) {
            try { gl.drawingBufferToneMapping?.({ mode: 'standard' }); } catch { /* Unavailable context API. */ }
            try { gl.drawingBufferStorage?.(this.savedFormat, gl.drawingBufferWidth, gl.drawingBufferHeight); } catch { /* Lost context. */ }
        }
        this.savedFormat = null;
        this.invalidate();
    }

    private async addTrigger(gpu: Gpu, generation: number): Promise<void> {
        let device: Device | undefined;
        let canvas: HTMLCanvasElement | undefined;
        let context: GpuContext | null = null;
        try {
            const adapter = await gpu.requestAdapter();
            if (!adapter || generation !== this.generation) return;
            device = await adapter.requestDevice();
            if (generation !== this.generation) { device.destroy(); return; }
            const doc = this.renderer.domElement.ownerDocument;
            canvas = doc.createElement('canvas');
            canvas.width = canvas.height = 4;
            canvas.dataset.haxiomicHdrTrigger = '';
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText = 'position:fixed;right:0;bottom:0;width:4px;height:4px;pointer-events:none';
            doc.body.appendChild(canvas);
            context = canvas.getContext('webgpu') as unknown as GpuContext | null;
            if (!context) throw new Error('WebGPU canvas unavailable');
            context.configure({ device, format: 'rgba16float', toneMapping: { mode: 'extended' }, alphaMode: 'opaque' });
            const encoder = device.createCommandEncoder();
            encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
                loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }).end();
            device.queue.submit([encoder.finish()]);
            const trigger = this.trigger = { canvas, device, context };
            this._route = 'compositor-trigger';
            void device.lost.then(() => {
                if (this.trigger !== trigger) return;
                this.removeTrigger();
                this._route = 'sdr';
                this.onChange?.();
            });
            this.onChange?.();
        } catch {
            try { context?.unconfigure(); } catch { /* Partial configuration. */ }
            canvas?.remove();
            device?.destroy();
        }
    }

    private removeTrigger(): void {
        const trigger = this.trigger;
        this.trigger = null;
        if (!trigger) return;
        try { trigger.context.unconfigure(); } catch { /* Device may already be lost. */ }
        trigger.canvas.remove();
        trigger.device.destroy();
    }
}
