import { chromium } from '../node_modules/playwright/index.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setViewportSize({ width: 1400, height: 900 })

// 세션 페이지로 이동
await page.goto('http://localhost:3000/pre-fmea', { waitUntil: 'networkidle' })
await page.locator('text=SBW').first().click()
await page.waitForTimeout(800)
await page.locator('text=API_테스트_세션').first().click()
await page.waitForTimeout(2500)

// 통계 바까지 스크롤
await page.evaluate(() => window.scrollTo(0, 850))
await page.waitForTimeout(400)
await page.screenshot({ path: '/tmp/stats_final.png' })
console.log('stats captured')

// 테이블 행 캡처 (item 행들이 보이는 곳)
await page.evaluate(() => window.scrollTo(0, 1600))
await page.waitForTimeout(400)
await page.screenshot({ path: '/tmp/table_data.png' })
console.log('table data captured')

await browser.close()
