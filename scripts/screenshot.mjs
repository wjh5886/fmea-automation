import { chromium } from '../node_modules/playwright/index.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setViewportSize({ width: 1400, height: 900 })

await page.goto('http://localhost:3000/pre-fmea', { waitUntil: 'networkidle' })
await page.screenshot({ path: '/tmp/prefmea_list.png', fullPage: false })
console.log('Screenshot 1: pre-fmea list')

const sessionBtn = page.locator('text=API_테스트_세션').first()
if (await sessionBtn.isVisible()) {
  await sessionBtn.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/prefmea_session.png', fullPage: false })
  console.log('Screenshot 2: session detail')
}

await browser.close()
