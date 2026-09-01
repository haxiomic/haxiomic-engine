import { test, expect } from '@playwright/test'

async function open(page, scope = 'document') {
    await page.goto(`/tests/fixture.html?scope=${scope}`)
    await page.waitForFunction(() => window.ready === true)
    await page.evaluate(() => window.reset())
}
const got = (page) => page.evaluate(() => window.received)

test('typing into a text field never reaches a surface', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.locator('#text').click()
    await page.keyboard.type('hello')
    expect(await page.locator('#text').inputValue()).toBe('hello')
    expect((await got(page)).s1).toEqual([])
})

test('a shadow-DOM text field is also respected', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.locator('#host input').click()
    await page.keyboard.press('a')
    expect((await got(page)).s1).toEqual([])
})

test('shortcuts survive focus sitting on app chrome', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.locator('#button').click()
    await page.keyboard.press('w')
    expect((await got(page)).s1).toEqual(['w'])
})

test('keys a focused control uses stay with it', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.locator('#button').click()
    for (const k of ['Space', 'Enter', 'Tab', 'ArrowLeft']) await page.keyboard.press(k)
    expect((await got(page)).s1).toEqual([])
})

test('a focused range keeps its arrow keys', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.locator('#range').click()
    await page.keyboard.press('ArrowLeft')
    expect((await got(page)).s1).toEqual([])
})

test('exactly one surface owns the keyboard', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.keyboard.press('a')
    await page.locator('#s2').click()
    await page.keyboard.press('b')
    const r = await got(page)
    expect(r.s1).toEqual(['a'])
    expect(r.s2).toEqual(['b'])
})

test('pointing at chrome does not release the claim', async ({ page }) => {
    await open(page)
    await page.locator('#s1').click()
    await page.locator('#chrome-text').click()
    await page.keyboard.press('w')
    const r = await got(page)
    expect(r.s1).toEqual(['w'])
    expect(r.s2).toEqual([])
})

test('scope=shared releases the claim to every surface', async ({ page }) => {
    await open(page, 'shared')
    await page.locator('#s1').click()
    await page.locator('#chrome-text').click()
    await page.keyboard.press('w')
    const r = await got(page)
    expect(r.s1).toEqual(['w'])
    expect(r.s2).toEqual(['w'])
})

test('scope=element requires focus on the surface', async ({ page }) => {
    await open(page, 'element')
    await page.locator('#s1').click()
    await page.keyboard.press('a')
    await page.locator('#button').click()
    await page.keyboard.press('b')
    expect((await got(page)).s1).toEqual(['a'])
})

test('focus follows Tab, and so does the keyboard', async ({ page }) => {
    await open(page)
    await page.locator('#s1').focus()
    await page.keyboard.press('a')
    await page.locator('#s2').focus()
    await page.keyboard.press('b')
    const r = await got(page)
    expect(r.s1).toEqual(['a'])
    expect(r.s2).toEqual(['b'])
})

test('globalKeyDown sees everything, always', async ({ page }) => {
    await open(page)
    await page.locator('#text').click()
    await page.keyboard.press('z')
    expect((await got(page)).global).toContain('z')
})
