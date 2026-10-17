/**
 * Tests for the inline worker esbuild plugin. Node only — no browser needed, but
 * run by the same runner as the DOM tests so `npm test` covers everything.
 */
import { test, expect } from '@playwright/test'

import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import inlineWorkerPlugin from '../esbuild/inline-worker-plugin.mjs';

/** A project whose entry inlines one worker, imported as `specifier`; the
 * worker reports a build-time variant. */
function fixture(specifier: string) {
    const dir = mkdtempSync(join(tmpdir(), 'inline-worker-'));
    writeFileSync(join(dir, 'job.worker.ts'), 'declare const __VARIANT__: string;\nself.postMessage(__VARIANT__);\n');
    writeFileSync(join(dir, 'main.ts'), `import JobWorker from '${specifier}';\nexport const worker = () => new JobWorker();\n`);
    return dir;
}

function variantBuild(dir: string, variant: string, extra: Record<string, unknown> = {}) {
    return build({
        entryPoints: [join(dir, 'main.ts')],
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        define: { __VARIANT__: JSON.stringify(`variant_${variant}_marker`) },
        plugins: [inlineWorkerPlugin()],
        ...extra,
    });
}

test.beforeEach(() => {
    // the plugin logs every worker it loads
    const log = console.log;
    console.log = (...args) => { if (!String(args[0]).startsWith('inline-worker-plugin')) log(...args); };
});

test('concurrent builds of the same worker each inline their own build', async () => {
    const dir = fixture('inline-worker!./job.worker');
    try {
        // As an app build script might: several builds at once, configured
        // differently, all importing the same worker. Previously they shared one
        // cache file per worker name and read back each other's bundles.
        const variants = ['A', 'B', 'C', 'D'];
        for (let round = 0; round < 10; round++) {
            await Promise.all(variants.map(v => variantBuild(dir, v, { outfile: join(dir, `out-${v}.js`) })));
            for (const v of variants) {
                const out = readFileSync(join(dir, `out-${v}.js`), 'utf8');
                expect(out, `round ${round}: build ${v} inlines its own worker`).toContain(`variant_${v}_marker`);
                for (const other of variants.filter(o => o !== v)) {
                    expect(out, `round ${round}: build ${v} must not inline build ${other}'s worker`).not.toContain(`variant_${other}_marker`);
                }
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a plain *.worker.ts import resolves (no self-recursion)', async () => {
    const dir = fixture('./job.worker.ts');
    try {
        const result = await variantBuild(dir, 'suffix', { write: false, outfile: join(dir, 'out.js') });
        expect(result.outputFiles!.map(f => f.text).join('')).toContain('variant_suffix_marker');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a build with write: false still inlines its worker', async () => {
    const dir = fixture('inline-worker!./job.worker');
    try {
        const result = await variantBuild(dir, 'memory', { write: false, outfile: join(dir, 'out.js') });
        expect(result.outputFiles!.map(f => f.text).join('')).toContain('variant_memory_marker');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a missing worker is a build error, not a hang', async () => {
    const dir = fixture('inline-worker!./missing.worker');
    try {
        await expect(variantBuild(dir, 'missing', { write: false, outfile: join(dir, 'out.js') })).rejects.toThrow(/missing\.worker/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
