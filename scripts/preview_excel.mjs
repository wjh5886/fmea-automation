import ExcelJS from '../node_modules/exceljs/dist/es5/index.nodejs.js'
import fs from 'fs'

const wb = new ExcelJS.Workbook()
await wb.xlsx.load(fs.readFileSync('data/exports/PreFMEA_AI생성_20260527.xlsx'))

const ws = wb.getWorksheet('Pre-FMEA')
if (!ws) { console.log('시트 없음'); process.exit(1) }

console.log(`총 행수: ${ws.rowCount}`)
console.log('\n[헤더 행]')
const hdr = ws.getRow(2)
console.log(hdr.values?.slice(1, 10).join(' | '))

console.log('\n[데이터 샘플 — 처음 5행]')
for (let r = 4; r <= Math.min(8, ws.rowCount); r++) {
  const row = ws.getRow(r)
  const v = (row.values as any[])?.slice(1) ?? []
  console.log(`  ${v[0]} | ${String(v[1]).slice(0,20)} | ${v[5]} | ${String(v[6]).slice(0,40)} | S=${v[10]} O=${v[12]} D=${v[15]} RPN=${v[16]}`)
}

// AP 분포 (컬럼이 없으면 SOD 기반 체크)
const fmCount: Record<string,number> = {}
for (let r = 4; r <= ws.rowCount; r++) {
  const row = ws.getRow(r)
  const fm = String((row.values as any[])?.[6] ?? '')
  if (fm) fmCount[fm] = (fmCount[fm] ?? 0) + 1
}
console.log('\n[고장 형태 분포]')
Object.entries(fmCount).forEach(([k,v]) => console.log(`  ${k}: ${v}개`))
