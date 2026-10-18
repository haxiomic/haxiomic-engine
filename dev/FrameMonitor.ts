import { WebGLRenderer } from 'three';

export type FrameMonitorOptions = {
	/** Element to mount into, e.g. a DevUI folder's `$children`. Default: a fixed overlay in the top-left corner */
	container?: HTMLElement,
	/** Measuring pauses while this returns false (e.g. DevUI hidden or the folder closed). Default: always visible */
	isVisible?: () => boolean,
	/** Frames kept in the graph. Default 120 */
	historyLength?: number,
	/** How often the numbers refresh, in ms. Default 500 */
	refreshInterval_ms?: number,
};

type FrameSample = {
	interval_ms: number,
	cpu_ms: number,
	gpu_ms: number,
};

type TimerQueryExt = {
	TIME_ELAPSED_EXT: number,
	GPU_DISJOINT_EXT: number,
};

// one TIME_ELAPSED query may be active per context, so monitors sharing a renderer take turns
const activeTimerQuery = new WeakMap<WebGL2RenderingContext, FrameMonitor>();

const CPU_COLOR = '#1a9fd6';
const GPU_COLOR = '#d9741a';
const MAX_PENDING_QUERIES = 8;

/**
 * Frame monitor for a three.js WebGLRenderer: FPS, frame time, CPU and GPU time, draw calls and live resources
 *
 * Call `update()` once at the start of each frame. The frame is closed when the current task ends (a microtask), so the CPU and GPU
 * times cover everything rendered in that frame callback, across every pass and render target.
 *
 * - **frame**: time between `update()` calls; **worst** is the longest frame in the refresh window
 * - **CPU**: time from `update()` to the end of the frame callback (JS + GL command submission)
 * - **GPU**: `EXT_disjoint_timer_query_webgl2` TIME_ELAPSED over the same commands, read back a few frames later. Shows `n/a` where the
 *   extension is unavailable (Safari, Firefox). Other code must not run its own TIME_ELAPSED query inside the frame while this is visible
 * - **calls / triangles / lines / points**: summed over every `renderer.render()` in the frame (`renderer.info` resets per render call by default)
 * - **geometries / textures / programs**: live counts from `renderer.info`
 *
 * Nothing is measured while `isVisible()` is false.
 */
export class FrameMonitor {

	readonly dom: HTMLElement;

	protected readonly renderer: WebGLRenderer;
	protected readonly gl: WebGL2RenderingContext;
	protected readonly timerExt: TimerQueryExt | null;
	protected readonly isVisible: () => boolean;
	protected readonly historyLength: number;
	protected readonly refreshInterval_ms: number;
	protected readonly ownsDom: boolean;

	protected readonly canvas: HTMLCanvasElement;
	protected readonly context2d: CanvasRenderingContext2D;
	protected readonly fields: Record<string, HTMLElement> = {};

	protected history: FrameSample[] = [];
	protected windowSamples: FrameSample[] = [];
	protected windowCounters = { calls: 0, triangles: 0, lines: 0, points: 0, frames: 0 };
	protected lastWindowTime_ms = NaN;

	protected frameOpen = false;
	protected disposed = false;
	protected frameStart_ms = NaN;
	protected lastFrameStart_ms = NaN;
	protected frameCounters = { calls: 0, triangles: 0, lines: 0, points: 0 };
	protected frameQuery: WebGLQuery | null = null;
	protected pendingQueries: { query: WebGLQuery, sample: FrameSample }[] = [];
	protected queryPool: WebGLQuery[] = [];

	protected readonly originalInfoUpdate: WebGLRenderer['info']['update'];

	constructor(renderer: WebGLRenderer, options: FrameMonitorOptions = {}) {
		this.renderer = renderer;
		this.gl = renderer.getContext() as WebGL2RenderingContext;
		this.timerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
		this.isVisible = options.isVisible ?? (() => true);
		this.historyLength = options.historyLength ?? 120;
		this.refreshInterval_ms = options.refreshInterval_ms ?? 500;

		// count draws from every render call in the frame without changing info.autoReset, which callers may rely on
		const info = renderer.info;
		const originalInfoUpdate = this.originalInfoUpdate = info.update;
		const counters = this.frameCounters;
		info.update = function (this: typeof info, ...args: Parameters<typeof info.update>) {
			const { calls, triangles, lines, points } = info.render;
			originalInfoUpdate.apply(info, args);
			counters.calls += info.render.calls - calls;
			counters.triangles += info.render.triangles - triangles;
			counters.lines += info.render.lines - lines;
			counters.points += info.render.points - points;
		};

		const dom = this.dom = document.createElement('div');
		dom.className = 'frame-monitor';
		dom.innerHTML = `
			<style>
				.frame-monitor { font-family: var(--font-family-mono, monospace); font-size: 11px; line-height: 1.5; color: var(--text-color, #ebebeb); padding: 4px var(--padding, 4px) 6px; font-variant-numeric: tabular-nums; }
				.frame-monitor.overlay { position: fixed; top: 0; left: 0; z-index: 10000; width: 240px; background: #1f1f1fe6; }
				.frame-monitor dl { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 0 8px; margin: 0 0 4px; }
				.frame-monitor dt { color: #9a9a9a; }
				.frame-monitor dd { margin: 0; text-align: right; }
				.frame-monitor .swatch { display: inline-block; width: 8px; height: 2px; vertical-align: middle; margin-right: 4px; }
				.frame-monitor canvas { display: block; width: 100%; height: 56px; }
			</style>
			<dl>
				<dt>fps</dt><dd data-field="fps">–</dd>
				<dt>frame</dt><dd data-field="frame">–</dd>
				<dt>worst</dt><dd data-field="worst">–</dd>
				<dt>heap</dt><dd data-field="heap">–</dd>
				<dt><span class="swatch" style="background:${CPU_COLOR}"></span>CPU</dt><dd data-field="cpu">–</dd>
				<dt><span class="swatch" style="background:${GPU_COLOR}"></span>GPU</dt><dd data-field="gpu">–</dd>
				<dt>calls</dt><dd data-field="calls">–</dd>
				<dt>tris</dt><dd data-field="triangles">–</dd>
				<dt>lines</dt><dd data-field="lines">–</dd>
				<dt>points</dt><dd data-field="points">–</dd>
				<dt>geom</dt><dd data-field="geometries">–</dd>
				<dt>tex</dt><dd data-field="textures">–</dd>
				<dt>progs</dt><dd data-field="programs">–</dd>
			</dl>
			<canvas aria-label="Frame time graph: grey bars are frame intervals, lines are CPU and GPU time; guides at 60 and 30 fps"></canvas>
		`;
		for (const el of Array.from(dom.querySelectorAll<HTMLElement>('[data-field]'))) {
			this.fields[el.dataset.field!] = el;
		}
		this.canvas = dom.querySelector('canvas')!;
		this.context2d = this.canvas.getContext('2d')!;

		this.ownsDom = options.container == null;
		if (options.container) {
			options.container.appendChild(dom);
		} else {
			dom.classList.add('overlay');
			document.body.appendChild(dom);
		}
	}

	/**
	 * Call once at the start of each frame. Further calls in the same task are ignored, so a loop and the viewer it drives can both call it
	 */
	update() {
		if (this.frameOpen || this.disposed) return;

		const now_ms = performance.now();
		this.collectQueries();

		if (!this.isVisible() || document.visibilityState !== 'visible') {
			this.lastFrameStart_ms = NaN;
			this.lastWindowTime_ms = NaN;
			return;
		}

		this.frameOpen = true;
		this.frameStart_ms = now_ms;
		this.frameCounters.calls = this.frameCounters.triangles = this.frameCounters.lines = this.frameCounters.points = 0;
		this.beginTimerQuery();
		queueMicrotask(this.endFrame);

		if (isNaN(this.lastWindowTime_ms)) this.lastWindowTime_ms = now_ms;
		if (now_ms - this.lastWindowTime_ms >= this.refreshInterval_ms) {
			this.refreshText();
			this.lastWindowTime_ms = now_ms;
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.renderer.info.update = this.originalInfoUpdate;
		if (activeTimerQuery.get(this.gl) === this) {
			if (this.timerExt && this.frameQuery) this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
			activeTimerQuery.delete(this.gl);
		}
		for (const query of [...this.queryPool, ...this.pendingQueries.map(p => p.query)]) {
			this.gl.deleteQuery(query);
		}
		if (this.frameQuery) this.gl.deleteQuery(this.frameQuery);
		this.queryPool = [];
		this.pendingQueries = [];
		this.frameQuery = null;
		this.dom.remove();
	}

	protected endFrame = () => {
		this.frameOpen = false;
		const end_ms = performance.now();

		const sample: FrameSample = {
			interval_ms: isNaN(this.lastFrameStart_ms) ? NaN : this.frameStart_ms - this.lastFrameStart_ms,
			cpu_ms: end_ms - this.frameStart_ms,
			gpu_ms: NaN,
		};
		this.lastFrameStart_ms = this.frameStart_ms;

		if (this.frameQuery && this.timerExt) {
			this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
			activeTimerQuery.delete(this.gl);
			this.pendingQueries.push({ query: this.frameQuery, sample });
			this.frameQuery = null;
		}

		this.history.push(sample);
		if (this.history.length > this.historyLength) this.history.shift();
		this.windowSamples.push(sample);

		const counters = this.windowCounters;
		counters.calls += this.frameCounters.calls;
		counters.triangles += this.frameCounters.triangles;
		counters.lines += this.frameCounters.lines;
		counters.points += this.frameCounters.points;
		counters.frames++;

		this.drawGraph();
	}

	protected beginTimerQuery() {
		const { gl, timerExt } = this;
		if (!timerExt || gl.isContextLost() || activeTimerQuery.has(gl)) return;
		if (this.pendingQueries.length >= MAX_PENDING_QUERIES) return;
		const query = this.queryPool.pop() ?? gl.createQuery();
		if (!query) return;
		gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
		activeTimerQuery.set(gl, this);
		this.frameQuery = query;
	}

	protected collectQueries() {
		const { gl, timerExt } = this;
		if (!timerExt || this.pendingQueries.length === 0) return;
		if (gl.isContextLost()) {
			this.pendingQueries = [];
			this.queryPool = [];
			return;
		}
		// queries complete in order
		while (this.pendingQueries.length > 0) {
			const { query, sample } = this.pendingQueries[0];
			if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
			this.pendingQueries.shift();
			this.queryPool.push(query);
			// a disjoint event (e.g. GPU frequency change or context switch) invalidates results in flight
			if (gl.getParameter(timerExt.GPU_DISJOINT_EXT)) {
				for (const pending of this.pendingQueries) this.queryPool.push(pending.query);
				this.pendingQueries = [];
				break;
			}
			const ns: number = gl.getQueryParameter(query, gl.QUERY_RESULT);
			sample.gpu_ms = ns / 1e6;
		}
	}

	protected refreshText() {
		const { fields, windowSamples, windowCounters: counters } = this;
		const info = this.renderer.info;

		const intervals = windowSamples.map(s => s.interval_ms).filter(isFinite);
		// GPU results arrive a few frames late, so average the latest ones in the history instead of this window
		const gpuTimes = this.history.map(s => s.gpu_ms).filter(isFinite).slice(-Math.max(windowSamples.length, 1));
		const meanInterval = mean(intervals);

		fields.fps.textContent = intervals.length ? (1000 / meanInterval).toFixed(0) : '–';
		fields.frame.textContent = intervals.length ? `${meanInterval.toFixed(1)} ms` : '–';
		fields.worst.textContent = intervals.length ? `${Math.max(...intervals).toFixed(1)} ms` : '–';
		fields.cpu.textContent = windowSamples.length ? `${mean(windowSamples.map(s => s.cpu_ms)).toFixed(2)} ms` : '–';
		fields.gpu.textContent = !this.timerExt ? 'n/a' : gpuTimes.length ? `${mean(gpuTimes).toFixed(2)} ms` : '–';

		const frames = Math.max(counters.frames, 1);
		fields.calls.textContent = formatCount(counters.calls / frames);
		fields.triangles.textContent = formatCount(counters.triangles / frames);
		fields.lines.textContent = formatCount(counters.lines / frames);
		fields.points.textContent = formatCount(counters.points / frames);
		fields.geometries.textContent = String(info.memory.geometries);
		fields.textures.textContent = String(info.memory.textures);
		fields.programs.textContent = String(info.programs?.length ?? 0);

		// Chrome only
		const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		fields.heap.textContent = memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/a';

		this.windowSamples = [];
		counters.calls = counters.triangles = counters.lines = counters.points = counters.frames = 0;
	}

	protected drawGraph() {
		const { canvas, context2d: ctx, history, historyLength } = this;

		const dpr = window.devicePixelRatio || 1;
		const width = Math.round(canvas.clientWidth * dpr);
		const height = Math.round(canvas.clientHeight * dpr);
		if (width === 0 || height === 0) return;
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}

		// 0–33 ms, growing to fit long frames
		let max_ms = 1000 / 30;
		for (const s of history) {
			max_ms = Math.max(max_ms, isFinite(s.interval_ms) ? s.interval_ms : 0, s.cpu_ms, isFinite(s.gpu_ms) ? s.gpu_ms : 0);
		}
		max_ms = Math.min(max_ms, 250);
		const y = (ms: number) => height - Math.min(ms / max_ms, 1) * (height - dpr);
		const step = width / historyLength;
		const x0 = width - history.length * step;

		ctx.clearRect(0, 0, width, height);

		// frame intervals
		ctx.fillStyle = '#4a4a4a';
		const barWidth = Math.max(step - dpr, dpr);
		history.forEach((s, i) => {
			if (!isFinite(s.interval_ms)) return;
			const top = y(s.interval_ms);
			ctx.fillRect(x0 + i * step, top, barWidth, height - top);
		});

		// 60 and 30 fps guides
		ctx.strokeStyle = '#8a8a8a';
		ctx.lineWidth = dpr;
		ctx.setLineDash([2 * dpr, 3 * dpr]);
		ctx.beginPath();
		for (const ms of [1000 / 60, 1000 / 30]) {
			if (ms > max_ms) continue;
			const gy = Math.round(y(ms)) + 0.5;
			ctx.moveTo(0, gy);
			ctx.lineTo(width, gy);
		}
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillStyle = '#9a9a9a';
		ctx.font = `${9 * dpr}px monospace`;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'top';
		for (const fps of [60, 30]) {
			const ms = 1000 / fps;
			if (ms > max_ms) continue;
			ctx.fillText(`${fps} fps`, width - 2 * dpr, Math.round(y(ms)) + 2 * dpr);
		}

		const line = (color: string, value: (s: FrameSample) => number) => {
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.5 * dpr;
			ctx.lineJoin = 'round';
			ctx.beginPath();
			let drawing = false;
			history.forEach((s, i) => {
				const v = value(s);
				if (!isFinite(v)) { drawing = false; return; }
				const px = x0 + (i + 0.5) * step;
				if (drawing) ctx.lineTo(px, y(v)); else ctx.moveTo(px, y(v));
				drawing = true;
			});
			ctx.stroke();
		};
		line(CPU_COLOR, s => s.cpu_ms);
		line(GPU_COLOR, s => s.gpu_ms);
	}

}

function mean(values: number[]) {
	let sum = 0;
	for (const v of values) sum += v;
	return values.length ? sum / values.length : NaN;
}

function formatCount(n: number) {
	if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
	return n.toFixed(0);
}
