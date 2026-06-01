import { chromium } from '../node_modules/playwright/index.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setViewportSize({ width: 1400, height: 900 })

await page.goto('http://localhost:3000/pre-fmea', { waitUntil: 'networkidle' })
await page.locator('text=SBW').first().click()
await page.waitForTimeout(1000)
await page.locator('text=API_테스트_세션').first().click()
await page.waitForTimeout(2500)

// 2단계 탭 클릭
const tab2 = page.locator('text=2단계 피드백 & 고도화').first()
if (await tab2.isVisible()) {
  await tab2.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/tab2.png' })
  console.log('Screenshot: 2단계 tab')
}

// 다시 1단계로 돌아와서 테이블 더 아래로 스크롤
await page.locator('text=1단계 문서 업로드').first().click()
await page.waitForTimeout(1000)
// 페이지 끝까지 스크롤
await page.evaluate(() => window.scrollTo(0, 1200))
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/table_mid.png' })
console.log('Screenshot: table middle')

await page.evaluate(() => window.scrollTo(0, 2500))
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/table_bottom.png' })
console.log('Screenshot: table bottom')

await browser.close()
