/* Static file server for the browser tests. No bundler: the fixture uses an
   import map, so the built ES modules load exactly as a consumer would get them. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// A file URL's pathname is not a filesystem path on Windows (`/C:/...`) or with
// encoded characters (`%20`); convert it.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' }

export function serve(port = 5177) {
    const server = createServer(async (req, res) => {
        const path = join(ROOT, normalize(decodeURIComponent(req.url.split('?')[0])))
        if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return }
        try {
            const body = await readFile(path)
            res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
            res.end(body)
        } catch { res.writeHead(404).end('not found') }
    })
    return new Promise(resolve => server.listen(port, () => resolve(server)))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.argv[2] ?? 5177)
    await serve(port)
    console.log(`serving ${ROOT} on http://localhost:${port}`)
}
