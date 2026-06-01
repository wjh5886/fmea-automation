import mammoth from 'mammoth'
import fs from 'fs'
import path from 'path'

const SESSION = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const BASE = `data/uploads/${SESSION}`

async function main() {
  const specDir = path.join(BASE, 'design_spec')
  const archDir = path.join(BASE, 'architecture')

  // 전체 텍스트 합치기
  let allText = ''
  for (const dir of [specDir, archDir]) {
    for (const f of fs.readdirSync(dir)) {
      const buf = fs.readFileSync(path.join(dir, f))
      const result = await mammoth.extractRawText({ buffer: buf as any })
      allText += `\n\n===FILE:${f}===\n` + result.value
    }
  }

  // SW 컴포넌트 패턴 추출: CstAp_XXX[SwCNNN] / ASIL X 또는 BswIF_XXX
  const compPattern = /\b((?:CstAp|BswIF|CtAp|CtCdd|Cst|Bsw)\w+)\s*\[SwC\d+\]\s*\/\s*(ASIL\s*[ABCD]|QM)/gi
  const unitPattern = /\b((?:CtAp|CtCdd|BswIF)\w+)\s*\[SwU[\d.]+\]\s*\/\s*(ASIL\s*[ABCD]|QM)/gi
  const paramPattern = /\bV_(\w+)\s+[\d.]+[Vu]?\s+(\d+(?:\.\d+)?V?[^\n]{0,30})/g

  const components: Map<string, { asil: string; units: string[]; params: string[] }> = new Map()

  let m
  while ((m = compPattern.exec(allText)) !== null) {
    const name = m[1], asil = m[2].replace(/\s+/, '')
    if (!components.has(name)) components.set(name, { asil, units: [], params: [] })
  }

  while ((m = unitPattern.exec(allText)) !== null) {
    const unitName = m[1]
    // 해당 유닛이 속한 컴포넌트 찾기
    for (const [comp] of components) {
      const prefix = comp.replace('CstAp_', 'CtAp_').replace('BswIF_', 'BswIF_')
      if (unitName.startsWith(prefix.slice(0, 8))) {
        components.get(comp)!.units.push(unitName)
        break
      }
    }
  }

  console.log(`\n■ SW 컴포넌트 목록 (총 ${components.size}개)\n`)
  for (const [name, info] of components) {
    console.log(`  ${name} [${info.asil}]`)
    if (info.units.length) console.log(`    └ Units: ${info.units.slice(0,3).join(', ')}${info.units.length>3 ? '...' : ''}`)
  }

  // 컴포넌트별 주요 텍스트 컨텍스트 추출 (각 500자)
  console.log('\n\n■ 컴포넌트별 기능 요약\n')
  const compNames = Array.from(components.keys())
  for (const comp of compNames.slice(0, 15)) {  // 처음 15개
    const idx = allText.indexOf(comp + '[')
    if (idx < 0) continue
    const snippet = allText.slice(idx, idx + 600)
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const info = components.get(comp)!
    console.log(`\n[${comp}] ${info.asil}`)
    console.log(snippet.slice(0, 400))
    console.log('---')
  }

  // 아키텍처 파일에서 인터페이스 정보
  console.log('\n\n■ 아키텍처 — 컴포넌트 간 인터페이스 (샘플)\n')
  const archFiles = fs.readdirSync(archDir)
  const archBuf = fs.readFileSync(path.join(archDir, archFiles[0]))
  const archText = (await mammoth.extractRawText({ buffer: archBuf as any })).value
  console.log(archText.slice(0, 3000))
}

main().catch(console.error)
