import { chromium } from '../node_modules/playwright/index.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setViewportSize({ width: 1400, height: 900 })

await page.goto('http://localhost:3000/pre-fmea', { waitUntil: 'networkidle' })

// SBW 카드 클릭
await page.locator('text=SBW').first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/sbw_sessions.png' })
console.log('Screenshot 1: SBW sessions list')

// API 테스트 세션 클릭
const sessionLink = page.locator('text=API_테스트_세션').first()
if (await sessionLink.isVisible()) {
  await sessionLink.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/session_detail.png' })
  console.log('Screenshot 2: session detail page')
  
  // 스크롤 다운해서 FMEA 테이블 확인
  await page.evaluate(() => window.scrollBy(0, 500))
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/tmp/session_table.png' })
  console.log('Screenshot 3: FMEA table section')
} else {
  console.log('API_테스트_세션 버튼 못 찾음')
  const text = await page.textContent('body')
  console.log('페이지 텍스트 일부:', text?.slice(0, 300))
}

await browser.close()
