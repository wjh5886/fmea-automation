/**
 * 설계사양서 전체 텍스트 추출 (50000자 제한 없음)
 * 각 파일을 별도 출력 파일로 저장
 */
import mammoth from 'mammoth'
import fs from 'fs'
import path from 'path'

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const SPEC_DIR = path.join('data/uploads', SESSION_ID, 'design_spec')

async function main() {
  const files = fs.readdirSync(SPEC_DIR).sort()

  for (const f of files) {
    const fullPath = path.join(SPEC_DIR, f)
    const buf = fs.readFileSync(fullPath)
    const result = await mammoth.extractRawText({ buffer: buf })
    const text = result.value

    const outPath = `data/spec_${f.replace(/[^a-zA-Z0-9_.-]/g, '_')}.txt`
    fs.writeFileSync(outPath, text, 'utf-8')
    console.log(`저장: ${outPath} (${text.length}자)`)
  }
}

main().catch(console.error)
