import mammoth from 'mammoth'
import fs from 'fs'
import path from 'path'

const SESSION = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const BASE = `data/uploads/${SESSION}`

async function extractDir(dirName: string, maxChars = 8000) {
  const dir = path.join(BASE, dirName)
  if (!fs.existsSync(dir)) return
  const files = fs.readdirSync(dir)
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f))
    const result = await mammoth.extractRawText({ buffer: buf as any })
    const text = result.value
    console.log(`\n${'='.repeat(60)}`)
    console.log(`[${dirName}] ${f}  (총 ${text.length}자)`)
    console.log(`${'='.repeat(60)}`)
    console.log(text.slice(0, maxChars))
    if (text.length > maxChars) console.log(`\n... (${text.length - maxChars}자 생략)`)
  }
}

async function main() {
  console.log('■ 설계사양서 (design_spec)')
  await extractDir('design_spec', 6000)
  console.log('\n\n■ 시스템 아키텍처 (architecture)')
  await extractDir('architecture', 4000)
}
main().catch(console.error)
