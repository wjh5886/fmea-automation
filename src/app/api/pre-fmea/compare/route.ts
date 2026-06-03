import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { storageDownload } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

const HAZOP = new Set(['MORE','LESS','CORRUPT','EARLY','LATE','STUCK','ERRATIC'])

function extractHazop(raw: unknown): string | null {
  const m = String(raw ?? '').trim().match(/^(MORE|LESS|CORRUPT|EARLY|LATE|STUCK|ERRATIC)/i)
  return m ? m[1].toUpperCase() : null
}

function normalize(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '').replace(/[^a-z0-9가-힣]/g, '')
}

const str = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }

// Scan all rows to find the header row containing "SW Unit Name" or similar FMEA header markers
function detectHeaderRow(raw: unknown[][]): { headerRow: number; colMap: Record<string, number> } {
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    const cells = row.map(c => String(c ?? '').replace(/[\n\r]+/g, ' ').trim())
    const rowNorm = cells.map(c => c.toLowerCase())

    // Identify header row: must contain "sw unit" and "failure"
    const hasSWUnit = rowNorm.some(c => c.includes('sw unit') || c.includes('sw_unit'))
    const hasFailure = rowNorm.some(c => c.includes('failure') && c.includes('mode'))
    if (!hasSWUnit || !hasFailure) continue

    // Build column map from this header row
    const colMap: Record<string, number> = {}
    cells.forEach((cell, colIdx) => {
      const n = cell.toLowerCase().replace(/[\s\n\r]+/g, ' ').trim()
      if (!n) return

      if (n === 'no' || n === '번호' || n === 'no.') {
        if (!('no' in colMap)) colMap.no = colIdx
      } else if (n.includes('sw unit') || n === 'sw unit name') {
        colMap.sw_component = colIdx
      // detail check BEFORE failure mode (to avoid "Detail of the failure mode" matching failure_mode)
      } else if (n.includes('detail') && n.includes('failure')) {
        colMap.failure_detail = colIdx
      } else if (n.includes('failure mode') || (n.includes('failure') && n.includes('hazop'))) {
        colMap.failure_mode = colIdx
      // var_type check BEFORE interface+name (to avoid "Interface(Variable) type" matching function_name)
      } else if (n.includes('variable') && n.includes('type')) {
        colMap.var_type = colIdx
      } else if (n.includes('interface') && (n.includes('variable') || n.includes('name'))) {
        colMap.function_name = colIdx
      } else if (n.includes('interface') && n.includes('categ')) {
        colMap.iface_cat = colIdx
      } else if (n.includes('effect') && (n.includes('module') || n.includes('local'))) {
        colMap.effect_local = colIdx
      } else if (n.includes('effect') && n.includes('system')) {
        colMap.effect_system = colIdx
      } else if (n.includes('preventive')) {
        colMap.preventive_action = colIdx
      } else if (n.includes('detection action') || n.includes('safety mechanism')) {
        colMap.detection_action = colIdx
      } else if (n.includes('test method')) {
        colMap.test_method = colIdx
      } else if (n === 's') {
        // Only set on first occurrence (before-action S; after-action S comes later)
        if (!('severity' in colMap)) colMap.severity = colIdx
      } else if (n === 'o') {
        if (!('occurrence' in colMap)) colMap.occurrence = colIdx
      } else if (n === 'd') {
        if (!('detection' in colMap)) colMap.detection = colIdx
      } else if (n === 'rpn') {
        if (!('rpn' in colMap)) colMap.rpn = colIdx
      }
    })

    // Verify minimum required columns found
    if ('sw_component' in colMap && 'failure_mode' in colMap) {
      return { headerRow: i, colMap }
    }
  }

  // Hard fallback: use known template column indices
  return {
    headerRow: 2,
    colMap: {
      no: 0, sw_component: 1, iface_cat: 2, function_name: 3, var_type: 4,
      failure_mode: 5, failure_detail: 6, effect_local: 7, effect_system: 8,
      effect_sg: 9, severity: 10, preventive_action: 11, occurrence: 12,
      detection_action: 13, test_method: 14, detection: 15, rpn: 16,
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    // 1. human_fmea 문서 조회
    const docs = await query(
      "SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'human_fmea'",
      [session_id],
    )
    if (!docs.length) return NextResponse.json({ error: '인간 작성 FMEA 파일이 없습니다. 2단계에서 업로드하세요.' }, { status: 400 })

    // 2. Excel 파싱
    const buf = await storageDownload(String(docs[0].storage_path))
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]

    // 3. 동적 헤더 탐지 (파일 전체 스캔)
    const { headerRow, colMap } = detectHeaderRow(raw)

    // 헤더 다음 행이 빈 서브헤더인지 확인하여 dataStart 결정
    let dataStart = headerRow + 1
    if (dataStart < raw.length) {
      const nextRow = raw[dataStart]
      const nonEmpty = nextRow.filter(c => String(c ?? '').trim()).length
      if (nonEmpty === 0 || nonEmpty <= 2) dataStart++ // 빈 서브헤더 행 스킵
    }

    const C = colMap

    // 4. 인간 항목 파싱 — 모든 행 저장, sw_component 기준 carry-forward
    type HumanItem = {
      session_id: string; item_no: string | null; sw_component: string | null; function_name: string | null
      failure_mode: string | null; failure_detail: string | null; effect_local: string | null
      effect_system: string | null; severity: number | null; occurrence: number | null
      detection: number | null; preventive_action: string | null; detection_action: string | null
    }
    const humanItems: HumanItem[] = []
    let lastSwComp: string | null = null
    let lastFailureMode: string | null = null

    for (let i = dataStart; i < raw.length; i++) {
      const row = raw[i]

      // sw_component carry-forward (merged cell region in FMEA table)
      const swRaw = str(row[C.sw_component ?? 1])?.replace(/[\n\r]+/g, '') ?? null
      if (swRaw) { lastSwComp = swRaw; lastFailureMode = null } // new component resets mode
      const swComp = lastSwComp
      if (!swComp) continue

      // failure_mode carry-forward (HAZOP keyword only in first row of each mode group)
      const rawFm = str(row[C.failure_mode ?? 5]) ?? ''
      const rawDetail = str(row[C.failure_detail ?? 6])
      if (!rawFm && !rawDetail) continue // fully empty row

      const extracted = extractHazop(rawFm)
      if (extracted) lastFailureMode = extracted
      const fm = lastFailureMode

      humanItems.push({
        session_id,
        item_no: str(row[C.no ?? 0]) ?? String(humanItems.length + 1).padStart(3, '0'),
        sw_component: swComp,
        function_name: str(row[C.function_name ?? 3]),
        failure_mode: fm && HAZOP.has(fm) ? fm : null,
        failure_detail: rawDetail,
        effect_local: str(row[C.effect_local ?? 7]),
        effect_system: str(row[C.effect_system ?? 8]),
        severity: num(row[C.severity ?? 10]),
        occurrence: num(row[C.occurrence ?? 12]),
        detection: num(row[C.detection ?? 15]),
        preventive_action: str(row[C.preventive_action ?? 11]),
        detection_action: str(row[C.detection_action ?? 13]),
      })
    }

    if (!humanItems.length) {
      return NextResponse.json({
        error: `파싱된 항목 없음 (headerRow=${headerRow}, dataStart=${dataStart}, colMap=${JSON.stringify(colMap)}). 파일 형식을 확인하세요.`,
      }, { status: 400 })
    }

    // 5. AI 항목 조회
    const aiItems = await query(
      "SELECT * FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai' ORDER BY item_no",
      [session_id],
    )

    // 6. 갭 분석 — (sw_component, failure_mode) 기준 중복 제거 후 비교
    type GapRow = {
      session_id: string; gap_type: string; field_name: string | null
      sw_component: string | null; failure_mode: string | null
      ai_value: string | null; human_value: string | null; severity: number | null; lesson: string
    }
    const gaps: GapRow[] = []

    const aiMap = new Map<string, typeof aiItems[0]>()
    for (const ai of aiItems) {
      const key = `${normalize(ai.sw_component)}__${ai.failure_mode ?? ''}`
      aiMap.set(key, ai)
    }

    const matchedAiKeys = new Set<string>()
    const seenHumanKeys = new Set<string>() // 중복 (sw_comp, failure_mode) 제거용

    for (const h of humanItems) {
      const key = `${normalize(h.sw_component)}__${h.failure_mode ?? ''}`
      if (seenHumanKeys.has(key)) continue // 동일 키의 첫 번째 행만 갭 분석에 사용
      seenHumanKeys.add(key)

      const ai = aiMap.get(key)

      if (!ai) {
        gaps.push({
          session_id, gap_type: 'missing_item', field_name: null,
          sw_component: h.sw_component, failure_mode: h.failure_mode,
          ai_value: null,
          human_value: `${h.sw_component} / ${h.failure_mode ?? '?'} — ${(h.failure_detail ?? '').slice(0, 80)}`,
          severity: h.severity,
          lesson: `AI가 ${h.sw_component}의 ${h.failure_mode ?? '?'} 고장 형태를 누락했습니다.`,
        })
      } else {
        matchedAiKeys.add(key)
        const sod: [string, number | null, number | null][] = [
          ['severity',   Number(ai.severity)   || null, h.severity],
          ['occurrence', Number(ai.occurrence) || null, h.occurrence],
          ['detection',  Number(ai.detection)  || null, h.detection],
        ]
        for (const [field, aiVal, humVal] of sod) {
          if (aiVal !== null && humVal !== null && Math.abs(aiVal - humVal) >= 2) {
            gaps.push({
              session_id, gap_type: 'wrong_sod', field_name: field,
              sw_component: h.sw_component, failure_mode: h.failure_mode,
              ai_value: String(aiVal), human_value: String(humVal),
              severity: h.severity,
              lesson: `${h.sw_component}/${h.failure_mode} ${field}: AI=${aiVal}, 전문가=${humVal} (차이 ${Math.abs(aiVal - humVal)})`,
            })
          }
        }
        if (!ai.potential_cause && !ai.detection_action) {
          gaps.push({
            session_id, gap_type: 'missing_action', field_name: 'detection_action',
            sw_component: h.sw_component, failure_mode: h.failure_mode,
            ai_value: null, human_value: h.detection_action,
            severity: h.severity,
            lesson: `${h.sw_component}/${h.failure_mode}: 검출/조치 정보가 AI 항목에 부족합니다.`,
          })
        }
      }
    }

    // 7. DB 저장
    await query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'human'", [session_id])
    await query('DELETE FROM pre_fmea_gaps WHERE session_id = $1', [session_id])

    for (const h of humanItems) {
      await query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1.0,'human','accepted')`,
        [h.session_id, h.item_no, h.sw_component, h.function_name, h.failure_mode,
         h.failure_detail, h.effect_local, h.effect_system, h.severity, h.occurrence,
         h.detection, h.preventive_action, h.detection_action],
      )
    }

    for (const g of gaps) {
      await query(
        `INSERT INTO pre_fmea_gaps
         (session_id, gap_type, field_name, sw_component, failure_mode, ai_value, human_value, severity, lesson)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [g.session_id, g.gap_type, g.field_name, g.sw_component, g.failure_mode,
         g.ai_value, g.human_value, g.severity, g.lesson],
      )
    }

    await query(
      "UPDATE pre_fmea_sessions SET status = 'reviewed', updated_at = now() WHERE id = $1",
      [session_id],
    )

    const uniqueHumanKeys = seenHumanKeys.size
    return NextResponse.json({
      humanCount: humanItems.length,
      humanUnique: uniqueHumanKeys,
      aiCount: aiItems.length,
      matchedCount: matchedAiKeys.size,
      missingItems: gaps.filter(g => g.gap_type === 'missing_item').length,
      sodDiffs:     gaps.filter(g => g.gap_type === 'wrong_sod').length,
      missingActions: gaps.filter(g => g.gap_type === 'missing_action').length,
      totalGaps: gaps.length,
      headerRow,
      dataStart,
      colMap,
      gaps: gaps.slice(0, 60),
    })
  } catch (e) {
    console.error('[pre-fmea/compare]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
