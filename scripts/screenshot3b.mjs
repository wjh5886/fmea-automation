import { chromium } from '../node_modules/playwright/index.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setViewportSize({ width: 1400, height: 900 })

await page.goto('http://localhost:3000/pre-fmea', { waitUntil: 'networkidle' })
await page.locator('text=SBW').first().click()
await page.waitForTimeout(1000)
await page.locator('text=API_테스트_세션').first().click()
await page.waitForTimeout(3000)

// 페이지 아래로 스크롤해서 통계 바와 테이블 헤더 확인
await page.evaluate(() => window.scrollTo(0, 900))
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/stats_area.png' })
console.log('Screenshot: stats and table header area')

// 더 아래 (테이블 중간)
await page.evaluate(() => window.scrollTo(0, 1800))
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/table_rows.png' })
console.log('Screenshot: table rows')

// 2단계 탭
const tab2 = page.locator('text=2단계').first()
if (await tab2.isVisible()) {
  await tab2.click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/tab2_view.png' })
  console.log('Screenshot: tab2')
}

await browser.close()
