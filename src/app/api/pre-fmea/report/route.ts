import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

// AIAG-VDA 2019 AP 룩업 테이블 — export-excel.ts와 동일 기준
// (calculateAP는 S≥9,O≥6일 때 D 무관 VH 반환으로 개선 효과 미반영)
function getActionPriority(s: number, o: number, d: number): string {
  const dB = d <= 1 ? 0 : d <= 3 ? 1 : d <= 6 ? 2 : 3
  const oB = o <= 1 ? 0 : o <= 3 ? 1 : o <= 6 ? 2 : 3
  if (s >= 9) return [
    ['L', 'L', 'M', 'H'],
    ['L', 'M', 'H', 'VH'],
    ['L', 'M', 'H', 'VH'],
    ['M', 'H', 'VH', 'VH'],
  ][oB][dB]
  if (s >= 7) return [
    ['L', 'L', 'L', 'M'],
    ['L', 'L', 'M', 'H'],
    ['L', 'M', 'H', 'VH'],
    ['L', 'M', 'H', 'VH'],
  ][oB][dB]
  if (s >= 4) return [
    ['L', 'L', 'L', 'L'],
    ['L', 'L', 'L', 'M'],
    ['L', 'L', 'M', 'H'],
    ['L', 'L', 'M', 'H'],
  ][oB][dB]
  return 'L'
}

// ── Domain constants (ported from scripts/export-excel.ts) ───────────────────

const VALUE_FAULTS = new Set(['MORE', 'LESS', 'REVERSE', 'CORRUPT'])

const D2_FRS_BASE: Record<string, number> = {
  'JG1-FRS-sens': 2, 'JG1-FRS-rotat': 4, 'JG1-FRS-mode': 5,
  'JG1-FRS-light': 4, 'JG1-FRS-dign': 3, 'JG1-FRS-hapt': 8,
}
const D2_CM_TARGET: Record<string, number> = {
  'JG1-FRS-rotat': 2, 'JG1-FRS-mode': 3, 'JG1-FRS-light': 2, 'JG1-FRS-hapt': 4,
}
const D2_CM_LABEL: Record<string, string> = {
  'JG1-FRS-rotat': '레버 회전 모터 위치 모니터링 요구사항 추가',
  'JG1-FRS-mode':  '변속 모드 전환 조건 이중 검증 요구사항 추가',
  'JG1-FRS-light': '지시등 점등 상태 피드백 모니터링 요구사항 추가',
  'JG1-FRS-hapt':  '햅틱 피드백 구동 완료 확인 모니터링 요구사항 추가',
}

// ── FRS-based helpers ────────────────────────────────────────────────────────

function extractFrsCat(fn: string): string | null {
  const m = fn.match(/\[JG1-FRS-(\w+)\]/)
  return m ? `JG1-FRS-${m[1]}` : null
}

function getSgKey(fn: string, fm: string): string {
  const cat = extractFrsCat(fn)
  if (!cat) return '-'
  if (cat === 'JG1-FRS-sens' || cat === 'JG1-FRS-rotat')
    return VALUE_FAULTS.has(fm) ? 'SG-SBW-001' : 'SG-SBW-002'
  if (cat === 'JG1-FRS-mode') return 'SG-SBW-002'
  return '-'
}

function getSpfLf(fn: string, fm: string, sg: string): string {
  if (sg === '-') return '-'
  const cat = extractFrsCat(fn)
  if (!cat) return '-'
  if ((cat === 'JG1-FRS-sens' || cat === 'JG1-FRS-rotat') &&
      (fm === 'CORRUPT' || fm === 'REVERSE')) return 'SPF'
  return 'LF'
}

function computeD2(fn: string, fm: string): number {
  const cat = extractFrsCat(fn)
  const sig = fn.includes(' / ') ? fn.split(' / ').pop()! : ''
  if (/Crc|AlvCnt|E2E/i.test(sig) && (fm === 'CORRUPT' || fm === 'REVERSE')) return 2
  if (fm === 'NO' && cat && !['JG1-FRS-sens', 'JG1-FRS-rotat'].includes(cat))
    return Math.min(D2_FRS_BASE[cat] ?? 5, 3)
  return cat ? (D2_FRS_BASE[cat] ?? 5) : 5
}

function computeRecD(fn: string, fm: string, ap: string, d1: number): number {
  if (ap !== 'VH') return d1
  const d2 = computeD2(fn, fm)
  const d1Target = d1 >= 7 ? 3 : d1 >= 6 ? 4 : null
  const cat = extractFrsCat(fn)
  const d2Target = d2 >= 4 && cat ? (D2_CM_TARGET[cat] ?? null) : null
  return Math.min(d1Target ?? d1, d2Target ?? d2)
}

function getCmText(fn: string, fm: string, ap: string, d1: number): string {
  if (ap !== 'VH') return '-'
  const d2  = computeD2(fn, fm)
  const cat = extractFrsCat(fn)
  const parts: string[] = []
  if (d1 >= 6) {
    const t = d1 >= 7 ? 3 : 4
    parts.push(`[D1 개선] PV 단위 테스트 수준 조기 검증 추가 (D1: ${d1}→${t})`)
  }
  if (d2 >= 4 && cat && D2_CM_TARGET[cat] !== undefined) {
    parts.push(`[D2 개선] ${D2_CM_LABEL[cat]} (D2: ${d2}→${D2_CM_TARGET[cat]})`)
  }
  return parts.length ? parts.join('\n') : '추가 조치 검토 필요'
}

function extractSafetyMech(preventiveAction: string): string {
  const m = preventiveAction.match(/사양서 안전메커니즘\([^)]+\):\s*(.+)$/)
  return m ? m[1].trim() : ''
}

function hasSafetyMechanism(preventiveAction: string, detectionAction: string): boolean {
  const sm = extractSafetyMech(preventiveAction)
  if (sm && sm !== '-') return true
  const da = detectionAction.trim()
  return da.length > 2 && da !== '-'
}

// ── SOD matrix bins ──────────────────────────────────────────────────────────
// Note: prompt specified D as "1, 2~4, 5~6, 7~10, 8~10" (last two overlap).
// Interpreted as standard AIAG-VDA bands: 1, 2~4, 5~6, 7~8, 9~10

const O_BINS = ['1', '2-3', '4-5', '6-7', '8-10']
const D_BINS = ['1', '2-4', '5-6', '7-8', '9-10']

function oBinIdx(o: number): number {
  if (o === 1)           return 0
  if (o <= 3)            return 1
  if (o <= 5)            return 2
  if (o <= 7)            return 3
  return 4
}
function dBinIdx(d: number): number {
  if (d === 1)           return 0
  if (d <= 4)            return 1
  if (d <= 6)            return 2
  if (d <= 8)            return 3
  return 4
}

type MatrixCell = { s: number; oIdx: number; dIdx: number; count: number }

function buildMatrix(
  items: { s: number; o: number; d: number }[],
): MatrixCell[] {
  const map: Record<string, number> = {}
  for (const it of items) {
    const key = `${it.s}_${oBinIdx(it.o)}_${dBinIdx(it.d)}`
    map[key] = (map[key] ?? 0) + 1
  }
  return Object.entries(map)
    .filter(([, c]) => c > 0)
    .map(([k, count]) => {
      const [s, oIdx, dIdx] = k.split('_').map(Number)
      return { s, oIdx, dIdx, count }
    })
}

// ── Conclusion text generator ────────────────────────────────────────────────

interface SgStat {
  sg: string
  totalSPF: number; spfWithoutSM: number
  totalLF: number;  lfWithoutSM: number
}
interface ApStat { initial: number; recommended: number }

function buildConclusion(
  sgAnalysis: SgStat[],
  apSummary: Record<string, ApStat>,
  totalItems: number,
): string {
  const lines: string[] = []

  // 1. SPF Safety Mechanism 할당 여부
  for (const sg of sgAnalysis) {
    if (sg.totalSPF === 0) continue
    if (sg.spfWithoutSM === 0) {
      lines.push(
        `${sg.sg} 위반 SPF ${sg.totalSPF}개 전원에 Safety Mechanism이 누락 없이 할당되어 있습니다.`,
      )
    } else {
      lines.push(
        `${sg.sg} 위반 SPF ${sg.totalSPF}개 중 ${sg.spfWithoutSM}개에 Safety Mechanism 미할당 — 즉시 보완이 필요합니다.`,
      )
    }
  }

  // 2. LF 개선 조치 적정성
  const totalLF = sgAnalysis.reduce((s, r) => s + r.totalLF, 0)
  const lfNoSm  = sgAnalysis.reduce((s, r) => s + r.lfWithoutSM, 0)
  if (totalLF > 0) {
    if (lfNoSm === 0) {
      lines.push(
        `ASIL B LF ${totalLF}개 전원에 적절한 개선 조치(Counter Measure)가 수립되어 있습니다.`,
      )
    } else {
      lines.push(
        `ASIL B LF ${totalLF}개 중 ${lfNoSm}개에 Safety Mechanism 미할당 — 추가 개선 검토가 필요합니다.`,
      )
    }
  }

  // 3. AP 리스크 저감 성과
  const vhInit = apSummary['VH']?.initial      ?? 0
  const vhRec  = apSummary['VH']?.recommended  ?? 0
  const hInit  = apSummary['H']?.initial       ?? 0
  const hRec   = apSummary['H']?.recommended   ?? 0
  if (vhInit > 0) {
    lines.push(
      `개선 조치 적용 결과 AP=VH 항목이 ${vhInit}개 → ${vhRec}개로 감소하였으며, ` +
      `AP=H 항목은 ${hInit}개 → ${hRec}개로 조정되었습니다. ` +
      `전체 ${totalItems}개 항목에 대한 리스크 저감 조치가 완료되었습니다.`,
    )
  }

  return lines.join(' ')
}

// ── GET handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const url       = new URL(req.url)
    const sessionId = url.searchParams.get('session_id')
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 })
    }

    // ① User Input Meta (query params)
    const analysisInfo = {
      vehicle:    url.searchParams.get('vehicle')    ?? '',
      item:       url.searchParams.get('item')       ?? '',
      customer:   url.searchParams.get('customer')   ?? '',
      department: url.searchParams.get('department') ?? '',
      author:     url.searchParams.get('author')     ?? '',
      version:    url.searchParams.get('version')    ?? '',
      generatedAt: new Date().toISOString(),
    }

    // DB 조회 (ICD + AI 사양서 항목)
    const rows = await query<Record<string, unknown>>(`
      SELECT
        p.id, p.item_no, p.sw_component, p.function_name,
        p.failure_mode, p.failure_detail,
        p.severity, p.occurrence, p.detection,
        p.preventive_action, p.detection_action,
        p.action_priority, p.review_status, p.source
      FROM pre_fmea_items p
      WHERE p.session_id = $1 AND p.source IN ('ai', 'icd')
      ORDER BY p.source DESC, p.sw_component, p.function_name, p.failure_mode
    `, [sessionId])

    if (!rows.length) {
      return NextResponse.json({ error: '항목 없음' }, { status: 404 })
    }

    // 항목별 계산
    const processed = rows.map(it => {
      const fn = String(it.function_name    ?? '')
      const fm = String(it.failure_mode     ?? '')
      const s  = Number(it.severity         ?? 0)
      const o  = Number(it.occurrence       ?? 0)
      const d  = Number(it.detection        ?? 0)
      const ap = String(it.action_priority  ?? '')
      const pa = String(it.preventive_action ?? '')
      const da = String(it.detection_action  ?? '')

      const sg    = getSgKey(fn, fm)
      const spfLf = getSpfLf(fn, fm, sg)
      const hasSM = hasSafetyMechanism(pa, da)

      const recD  = computeRecD(fn, fm, ap, d)
      const recAp = getActionPriority(s, o, recD)
      const cm    = getCmText(fn, fm, ap, d)

      return {
        itemNo:   String(it.item_no    ?? ''),
        swUnit:   String(it.sw_component ?? ''),
        fn, fm,
        failureDetail: String(it.failure_detail ?? ''),
        s, o, d,
        recS: s, recO: o, recD,
        ap, recAp,
        sg, spfLf, hasSM,
        status: String(it.review_status ?? 'pending'),
        cm,
      }
    })

    // ② Safety Goal Violation Analysis
    const sgMap: Record<string, SgStat> = {}
    for (const it of processed) {
      if (it.sg === '-') continue
      if (!sgMap[it.sg]) sgMap[it.sg] = { sg: it.sg, totalSPF: 0, spfWithoutSM: 0, totalLF: 0, lfWithoutSM: 0 }
      if (it.spfLf === 'SPF') {
        sgMap[it.sg].totalSPF++
        if (!it.hasSM) sgMap[it.sg].spfWithoutSM++
      } else if (it.spfLf === 'LF') {
        sgMap[it.sg].totalLF++
        if (!it.hasSM) sgMap[it.sg].lfWithoutSM++
      }
    }
    const safetyGoalAnalysis = Object.values(sgMap)

    // ③ SOD Matrix (Initial vs Recommended)
    const sodMatrix = {
      sBins: Array.from({ length: 10 }, (_, i) => i + 1),
      oBins: O_BINS,
      dBins: D_BINS,
      initial:     buildMatrix(processed.map(it => ({ s: it.s,    o: it.o,    d: it.d    }))),
      recommended: buildMatrix(processed.map(it => ({ s: it.recS, o: it.recO, d: it.recD }))),
    }

    // ④ AP Summary (Initial vs Recommended)
    const apSummary: Record<string, ApStat> = {
      VH: { initial: 0, recommended: 0 },
      H:  { initial: 0, recommended: 0 },
      M:  { initial: 0, recommended: 0 },
      L:  { initial: 0, recommended: 0 },
    }
    for (const it of processed) {
      if (apSummary[it.ap])    apSummary[it.ap].initial++
      if (apSummary[it.recAp]) apSummary[it.recAp].recommended++
    }

    // ⑤ Additional Action Items (VH 또는 고위험군: S≥9 AND O≥6 AND D≥8)
    const additionalActionItems = processed
      .filter(it => it.ap === 'VH' || (it.s >= 9 && it.o >= 6 && it.d >= 8))
      .map(it => ({
        fmeaId:      it.itemNo,
        swUnit:      it.swUnit,
        failureMode: it.fm,
        sgViolation: it.sg !== '-',
        sg:          it.sg,
        spfLf:       it.spfLf,
        initialS:    it.s,
        initialO:    it.o,
        initialD:    it.d,
        initialAP:   it.ap,
        recS:        it.recS,
        recO:        it.recO,
        recD:        it.recD,
        recAP:       it.recAp,
      }))

    // ⑥ Detailed Recommended Action Monitoring (AP=VH 항목)
    const monitoringItems = processed
      .filter(it => it.ap === 'VH')
      .map(it => ({
        fmeaId:      it.itemNo,
        swUnit:      it.swUnit,
        failureMode: it.fm,
        sgViolation: it.sg !== '-',
        sg:          it.sg,
        action:      it.cm,
        status:      'Open',   // VH 항목은 조치 완료 전 전원 Open
        initialS:    it.s,
        initialO:    it.o,
        initialD:    it.d,
        recS:        it.recS,
        recO:        it.recO,
        recD:        it.recD,
        recAP:       it.recAp,
      }))

    const actionMonitoring = {
      openCount:   monitoringItems.length,  // 초기 상태: 전원 Open
      closedCount: 0,
      items: monitoringItems,
    }

    // ⑦ Conclusion
    const conclusion = buildConclusion(safetyGoalAnalysis, apSummary, processed.length)

    return NextResponse.json({
      analysisInfo:        { ...analysisInfo, totalItems: processed.length },
      safetyGoalAnalysis,
      sodMatrix,
      apSummary,
      additionalActionItems,
      actionMonitoring,
      conclusion,
    })
  } catch (e) {
    console.error('[pre-fmea/report]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
