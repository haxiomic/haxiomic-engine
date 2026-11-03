/**
 * Tests for the compile-time esbuild plugin. Node only — no browser needed, but
 * run by the same runner as the DOM tests so `npm test` covers everything.
 */
import { test, expect } from '@playwright/test'

import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import compileTimePlugin from '../esbuild/compile-time.mjs';

/** A project whose entry imports a compile-time script (its file name given). */
function fixture(script: string, source: string) {
    const dir = mkdtempSync(join(tmpdir(), 'compile-time-'));
    writeFileSync(join(dir, script), source);
    writeFileSync(join(dir, 'main.ts'), `import { value } from './${script.replace(/\.ts$/, '')}';\nexport { value };\n`);
    return dir;
}

async function compile(dir: string, extra: Record<string, unknown> = {}) {
    const result = await build({
        entryPoints: [join(dir, 'main.ts')],
        bundle: true,
        format: 'esm',
        write: false,
        outfile: join(dir, 'out.js'),
        logLevel: 'silent',
        plugins: [compileTimePlugin()],
        ...extra,
    });
    return result.outputFiles!.map(f => f.text).join('');
}

test('a TypeScript compile-time script is run and its exports inlined', async () => {
    const dir = fixture('data.compile-time.ts', 'export const value: number = 6 * 7;\n');
    try {
        expect(await compile(dir)).toContain('42');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a JavaScript compile-time script is run and its exports inlined', async () => {
    const dir = fixture('data.compile-time.mjs', 'export const value = "from-mjs-" + (2 + 3);\n');
    try {
        expect(await compile(dir)).toContain('from-mjs-5');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('concurrent builds each run their own compile-time result', async () => {
    const dir = fixture('data.compile-time.ts', 'declare const __VARIANT__: string;\nexport const value = __VARIANT__;\n');
    try {
        const variants = ['A', 'B', 'C', 'D'];
        for (let round = 0; round < 5; round++) {
            const outs = await Promise.all(variants.map(v =>
                compile(dir, { define: { __VARIANT__: JSON.stringify(`variant_${v}_marker`) } })));
            outs.forEach((out, i) => {
                expect(out, `round ${round}: build ${variants[i]}`).toContain(`variant_${variants[i]}_marker`);
                for (const other of variants.filter(o => o !== variants[i])) {
                    expect(out, `round ${round}: build ${variants[i]} must not see ${other}`).not.toContain(`variant_${other}_marker`);
                }
            });
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('an edited compile-time script is re-run in the same process', async () => {
    const dir = fixture('data.compile-time.ts', 'export const value = "first-version";\n');
    try {
        expect(await compile(dir)).toContain('first-version');
        writeFileSync(join(dir, 'data.compile-time.ts'), 'export const value = "second-version";\n');
        const second = await compile(dir);
        expect(second).toContain('second-version');
        expect(second).not.toContain('first-version');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('same-named scripts in different folders do not collide', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'compile-time-'));
    try {
        for (const name of ['a', 'b']) {
            mkdirSync(join(dir, name));
            writeFileSync(join(dir, name, 'data.compile-time.ts'), `export const value = "folder-${name}";\n`);
        }
        writeFileSync(join(dir, 'main.ts'),
            "import { value as a } from './a/data.compile-time';\nimport { value as b } from './b/data.compile-time';\nexport const both = a + '|' + b;\n");
        const out = await compile(dir);
        expect(out).toContain('folder-a');
        expect(out).toContain('folder-b');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
