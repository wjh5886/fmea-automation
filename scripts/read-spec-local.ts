/**
 * 로컬 data/uploads/ 에서 설계사양서 텍스트 추출
 */
import mammoth from 'mammoth'
import fs from 'fs'
import path from 'path'

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const SPEC_DIR = path.join('data/uploads', SESSION_ID, 'design_spec')

async function main() {
  const files = fs.readdirSync(SPEC_DIR).sort()
  console.log(`\n설계사양서 파일 (${files.length}개):`)
  files.forEach(f => console.log('  -', f))

  for (const f of files) {
    const fullPath = path.join(SPEC_DIR, f)
    console.log(`\n${'='.repeat(80)}`)
    console.log(`[파일] ${f}`)
    console.log('='.repeat(80))

    const buf = fs.readFileSync(fullPath)
    const result = await mammoth.extractRawText({ buffer: buf })
    const text = result.value

    // 50000자 제한으로 출력
    console.log(text.slice(0, 50000))
    if (text.length > 50000) {
      console.log(`\n... (총 ${text.length}자 중 처음 50000자)`)
    }
  }
}

main().catch(console.error)
