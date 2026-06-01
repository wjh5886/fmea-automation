import ExcelJS from 'exceljs'
import fs from 'fs'

async function main() {
const FILE = 'data/exports/PreFMEA_AI생성_20260527.xlsx'
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(fs.readFileSync(FILE) as any)

const ws = wb.getWorksheet('Pre-FMEA')!
const dataRows = ws.rowCount - 3  // minus title + header + subheader

console.log(`파일: ${FILE}`)
console.log(`총 ${dataRows}개 항목\n`)

console.log('[헤더]')
const hdr = (ws.getRow(2).values as ExcelJS.CellValue[]).slice(1)
console.log(hdr.slice(0,10).map(v => String(v ?? '').replace(/\n/g,' ')).join(' | '))

console.log('\n[데이터 샘플 — 처음 8행]')
for (let r = 4; r <= Math.min(11, ws.rowCount); r++) {
  const v = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1)
  const no   = v[0]
  const comp = String(v[1] ?? '').slice(0, 25)
  const fn   = String(v[3] ?? '').slice(0, 28)
  const fm   = String(v[5] ?? '')
  const s    = v[10], o = v[12], d = v[15], rpn = v[16]
  console.log(`  ${no}. [${fm}] ${fn} | ${comp} | S=${s} O=${o} D=${d} RPN=${rpn}`)
}

// HAZOP 분포
const fmCount: Record<string, number> = {}
for (let r = 4; r <= ws.rowCount; r++) {
  const fm = String((ws.getRow(r).values as ExcelJS.CellValue[])[6] ?? '')
  if (fm) fmCount[fm] = (fmCount[fm] ?? 0) + 1
}
console.log('\n[HAZOP 분포]')
for (const [k, v] of Object.entries(fmCount).sort(([,a],[,b]) => b-a)) {
  console.log(`  ${k.padEnd(8)}: ${v}개`)
}

// SW 컴포넌트 종류
const compSet = new Set<string>()
for (let r = 4; r <= ws.rowCount; r++) {
  const c = String((ws.getRow(r).values as ExcelJS.CellValue[])[2] ?? '').slice(0, 40)
  if (c) compSet.add(c)
}
console.log(`\n[SW 컴포넌트 종류: ${compSet.size}개]`)
Array.from(compSet).slice(0, 10).forEach(c => console.log(`  - ${c}`))
if (compSet.size > 10) console.log(`  ... 외 ${compSet.size - 10}개`)
}
main().catch(console.error)
