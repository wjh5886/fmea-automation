import ExcelJS from 'exceljs'

export type IcdVariable = {
  sw_component: string | null
  variable_name: string
  variable_type: string | null  // Input / Output / Internal / InOut
  direction: string | null       // Send / Receive
  data_type: string | null
  signal_range: string | null
  unit: string | null
  description: string | null
  sort_order: number
}

// Column keyword maps (lowercase match)
const COL_KEYWORDS: Record<keyof Omit<IcdVariable, 'sort_order'>, string[]> = {
  sw_component:  ['sw component', 'sw컴포넌트', '컴포넌트', 'component', 'module', '모듈', 'sw_component', 'owner'],
  variable_name: ['variable name', 'variable', 'signal name', 'signal', '변수명', '변수', '시그널명', '시그널', 'name', 'interface', '항목명', 'port'],
  variable_type: ['type', 'i/o', 'io', '구분', '종류', 'category'],
  direction:     ['direction', '방향', 'dir', 'send/recv', 's/r'],
  data_type:     ['data type', 'datatype', '데이터타입', '데이터 타입', 'dtype', 'data'],
  signal_range:  ['range', '범위', '값범위', 'signal range', 'value range', '유효범위'],
  unit:          ['unit', '단위', 'units'],
  description:   ['description', '설명', '내용', '기능설명', 'remark', '비고', 'note', 'memo'],
}

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'object' && 'richText' in (v as object)) {
    return ((v as { richText: { text: string }[] }).richText ?? []).map(r => r.text).join('')
  }
  return String(v).trim()
}

function matchColumn(header: string): keyof Omit<IcdVariable, 'sort_order'> | null {
  const lc = header.toLowerCase().replace(/[\s_\-]/g, ' ').trim()
  for (const [field, keywords] of Object.entries(COL_KEYWORDS)) {
    if (keywords.some(k => lc.includes(k) || k.includes(lc))) {
      return field as keyof Omit<IcdVariable, 'sort_order'>
    }
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseIcdExcel(buf: any): Promise<IcdVariable[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  // Try each sheet, use the one with most data
  let bestVars: IcdVariable[] = []

  for (const ws of wb.worksheets) {
    const vars = parseSheet(ws)
    if (vars.length > bestVars.length) bestVars = vars
  }

  return bestVars
}

function parseSheet(ws: ExcelJS.Worksheet): IcdVariable[] {
  const rows: string[][] = []
  ws.eachRow((row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1)
    rows.push(vals.map((v: ExcelJS.CellValue) => {
      if (v == null) return ''
      if (typeof v === 'object' && v !== null && 'richText' in v) {
        return ((v as { richText: { text: string }[] }).richText ?? []).map(r => r.text).join('')
      }
      return String(v).trim()
    }))
  })

  if (rows.length < 2) return []

  // Scan all rows for header row — look for the row with most column matches
  let headerRowIdx = -1
  let maxMatches = 0
  let colMap: Record<number, keyof Omit<IcdVariable, 'sort_order'>> = {}

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    const matches: Record<number, keyof Omit<IcdVariable, 'sort_order'>> = {}
    let count = 0
    for (let c = 0; c < row.length; c++) {
      const field = matchColumn(row[c])
      if (field) { matches[c] = field; count++ }
    }
    if (count > maxMatches) {
      maxMatches = count
      headerRowIdx = i
      colMap = matches
    }
  }

  // Need at minimum a variable_name column
  const hasVarName = Object.values(colMap).includes('variable_name')
  if (headerRowIdx === -1 || !hasVarName) return []

  const vars: IcdVariable[] = []
  let sortOrder = 0

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const get = (field: keyof Omit<IcdVariable, 'sort_order'>): string | null => {
      for (const [ci, f] of Object.entries(colMap)) {
        if (f === field) {
          const val = (row[Number(ci)] ?? '').trim()
          return val || null
        }
      }
      return null
    }

    const varName = get('variable_name')
    if (!varName) continue
    // Skip rows that look like section headers (e.g. all caps single word, or same as component)
    if (varName.length < 2) continue

    vars.push({
      sw_component:  get('sw_component'),
      variable_name: varName,
      variable_type: get('variable_type'),
      direction:     get('direction'),
      data_type:     get('data_type'),
      signal_range:  get('signal_range'),
      unit:          get('unit'),
      description:   get('description'),
      sort_order:    sortOrder++,
    })
  }

  return vars
}
