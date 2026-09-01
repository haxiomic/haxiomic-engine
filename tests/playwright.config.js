import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: '.',
    use: { baseURL: 'http://localhost:5177' },
    webServer: {
        command: 'node serve.mjs 5177',
        url: 'http://localhost:5177/tests/fixture.html',
        reuseExistingServer: true,
    },
})
