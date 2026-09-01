import { test, expect } from '@playwright/test'

/* The demo is a manual tool, but a smoke test keeps it from rotting silently. */
test('demo page loads and reflects ownership', async ({ page }) => {
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto('/tests/demo.html')
    await page.waitForFunction(() => window.ready === true)

    expect(await page.locator('tr[id^="r"]').count()).toBeGreaterThan(20)

    const counts = () => page.evaluate(() =>
        [...document.querySelectorAll('.k')].map(e => Number(e.textContent)))

    await page.locator('#s1 canvas').click()
    await page.keyboard.press('w')
    expect(await counts()).toEqual([1, 0])

    await page.locator('#s2 canvas').click()
    await page.keyboard.press('w')
    expect(await counts()).toEqual([1, 1])

    // a text field consumes; the row says so. The row is written on a timeout,
    // so this needs the retrying assertion rather than a one-shot read.
    const textRow = page.locator('tr', { has: page.locator('input[placeholder=text]') })
    await textRow.locator('input').click()
    await page.keyboard.press('a')
    await expect(textRow.locator('.r')).toContainText('consumed')
    expect(await counts()).toEqual([1, 1])

    expect(errors).toEqual([])
})
