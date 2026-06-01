// 변수명 정규화 (Python pipeline.py의 normalize_varname 포팅)
const DE_PREFIXES = ['de', 'dg', 'di', 'dv', 'dp', 'dm']
const NOISE_PARTS = new Set(['i', 'p', 'b', 'u1', 'u8', 'u16', 'u32', 'ctap', 'ctdcm', 'raw'])

export function normalizeVarname(vn: string): string {
  if (!vn) return ''
  let low = vn.toLowerCase()

  for (const pfx of DE_PREFIXES) {
    if (low.startsWith(pfx) && low.length > pfx.length + 2) {
      low = low.slice(pfx.length)
      break
    }
  }

  low = low.replace(/^u\d+_/, '')

  const parts = low.split('_')
  const meaningful = parts.filter(p => p.length > 2 && !NOISE_PARTS.has(p))
  if (meaningful.length >= 2) return meaningful[meaningful.length - 1]
  if (meaningful.length === 1) return meaningful[0]
  return parts[parts.length - 1] ?? low
}

export type CompareRow = {
  norm_key: string
  failure_mode: string
  a_variable_name: string | null
  b_variable_name: string | null
  a_id: string | null
  b_id: string | null
  a_severity: number | null
  a_occurrence: number | null
  a_detection: number | null
  a_rpn: number | null
  a_effect: string | null
  a_preventive: string | null
  b_severity: number | null
  b_occurrence: number | null
  b_detection: number | null
  b_rpn: number | null
  diff: 'b_missing' | 'different' | 'same' | 'a_only' | 'b_only' | 'both_missing'
  recommendation: string | null
}

export type CompareResult = {
  summary: {
    total_a: number; total_b: number
    b_missing: number; different: number; same: number
    a_only: number; b_only: number; both_missing: number
  }
  rows: CompareRow[]
}

const DIFF_ORDER: Record<string, number> = {
  b_missing: 0, different: 1, both_missing: 2, same: 3, a_only: 4, b_only: 5,
}

type FmeaRow = {
  id: string; variable_name: string; failure_mode: string | null
  severity: number | null; occurrence: number | null; detection: number | null
  rpn: number | null; effect_system: string | null; preventive_action: string | null
}

export function compareFmeaRows(rowsA: FmeaRow[], rowsB: FmeaRow[]): CompareResult {
  const buildLookup = (rows: FmeaRow[]) => {
    const m = new Map<string, FmeaRow>()
    for (const r of rows) {
      const key = `${normalizeVarname(r.variable_name)}||${r.failure_mode ?? ''}`
      const existing = m.get(key)
      if (!existing || (r.rpn ?? 0) > (existing.rpn ?? 0)) m.set(key, r)
    }
    return m
  }

  const lookupA = buildLookup(rowsA)
  const lookupB = buildLookup(rowsB)
  const allKeys = new Set([...lookupA.keys(), ...lookupB.keys()])

  const resultRows: CompareRow[] = []
  for (const key of allKeys) {
    const [normVn, fm] = key.split('||')
    const ra = lookupA.get(key) ?? null
    const rb = lookupB.get(key) ?? null
    const aSev = ra?.severity ?? null
    const bSev = rb?.severity ?? null

    let diff: CompareRow['diff']
    let rec: string | null = null

    if (ra && rb) {
      if (aSev !== null && bSev === null) { diff = 'b_missing'; rec = 'copy_from_a' }
      else if (aSev !== null && bSev !== null) {
        const changed = ra.severity !== rb.severity || ra.occurrence !== rb.occurrence || ra.detection !== rb.detection
        diff = changed ? 'different' : 'same'; rec = changed ? 'review' : null
      } else { diff = 'both_missing' }
    } else if (ra) { diff = 'a_only' }
    else { diff = 'b_only'; rec = bSev === null ? 'rule_based' : null }

    resultRows.push({
      norm_key: normVn, failure_mode: fm,
      a_variable_name: ra?.variable_name ?? null,
      b_variable_name: rb?.variable_name ?? null,
      a_id: ra?.id ?? null, b_id: rb?.id ?? null,
      a_severity: ra?.severity ?? null, a_occurrence: ra?.occurrence ?? null,
      a_detection: ra?.detection ?? null, a_rpn: ra?.rpn ?? null,
      a_effect: ra?.effect_system ?? null, a_preventive: ra?.preventive_action ?? null,
      b_severity: rb?.severity ?? null, b_occurrence: rb?.occurrence ?? null,
      b_detection: rb?.detection ?? null, b_rpn: rb?.rpn ?? null,
      diff, recommendation: rec,
    })
  }

  resultRows.sort((a, b) => {
    const od = (DIFF_ORDER[a.diff] ?? 9) - (DIFF_ORDER[b.diff] ?? 9)
    if (od !== 0) return od
    return (a.norm_key ?? '').localeCompare(b.norm_key ?? '') || (a.failure_mode ?? '').localeCompare(b.failure_mode ?? '')
  })

  const summary = {
    total_a: rowsA.length, total_b: rowsB.length,
    b_missing: resultRows.filter(r => r.diff === 'b_missing').length,
    different: resultRows.filter(r => r.diff === 'different').length,
    same: resultRows.filter(r => r.diff === 'same').length,
    a_only: resultRows.filter(r => r.diff === 'a_only').length,
    b_only: resultRows.filter(r => r.diff === 'b_only').length,
    both_missing: resultRows.filter(r => r.diff === 'both_missing').length,
  }

  return { summary, rows: resultRows }
}
