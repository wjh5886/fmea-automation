import pg from 'pg'
import ExcelJS from 'exceljs'
import path from 'path'
import os from 'os'

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const TEMPLATE_PATH = path.join(
  'data/uploads/263a3e7c-460a-4a2f-998d-99f079137c3f/fmea_template/1779235794926_JG1_SBW-Software_FMEA_format.xlsx'
)
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/fmea_db' })

const AP_COLOR: Record<string, string> = {
  VH: 'FFCC0000', H: 'FFFF4444', M: 'FFFFC000', L: 'FF92D050',
}
const MODE_COLOR: Record<string, string> = {
  // 값의 이상
  MORE:       'FFFDE9D9',  // 연빨강
  LESS:       'FFE2EFDA',  // 연초록
  REVERSE:    'FFFFF2CC',  // 연노랑
  CORRUPT:    'FFFCE4D6',  // 연주황
  // 타이밍/기능의 이상
  NO:         'FFD9D9D9',  // 연회색
  AS_WELL_AS: 'FFDCE6F1',  // 연파랑
  PART_OF:    'FFE2D8F0',  // 연보라
  EARLY:      'FFD9EAF7',  // 연하늘
  LATE:       'FFEAF0FB',  // 연청색
}
// 가이드워드 → Failure Mode 명사구 레이블 (ISO 26262 HAZOP 표준 명칭)
const HAZOP_LABEL: Record<string, string> = {
  MORE:       'Value Higher',
  LESS:       'Value Lower',
  REVERSE:    'Value Reversed',
  CORRUPT:    'Value Corrupted',
  NO:         'Signal Loss',
  AS_WELL_AS: 'Duplicate Occurrence',
  PART_OF:    'Partial Data Loss',
  EARLY:      'Premature Signal',
  LATE:       'Message Delayed',
}

const HDR_BG = 'FF2E4057'
const THIN = (argb = 'FFAAAAAA') => ({ style: 'thin' as const, color: { argb } })
const HAIR = (argb = 'FFCCCCCC') => ({ style: 'hair' as const, color: { argb } })

// 컬럼 너비 (30개 — C28: SPF/LF, C29: D2, C30: CM Rationale / C24-C27은 spliceColumns로 삭제)
const COL_WIDTHS = [5, 26, 11, 28, 14, 10, 42, 36, 42, 16, 5, 38, 5, 36, 28, 5, 7, 14, 42, 5, 5, 5, 7, 12, 16, 14, 12, 8, 5, 40]

// ── Detection2 (Safety Mechanism DC 기반) ────────────────────────────────────
// CASE A 단일 메커니즘: 진단불가=10/9, Low=8/7(보수→8), Medium=6/5/4(보수→5), High=3/2(보수→3), Full=1
// CASE B 복수 메커니즘: High+High→2, High+Low→2, High+Medium→3, Medium+Low→4, Medium+Medium→4
// ※ 실제 SYS.3 Safety Mechanism 목록 확정 시 업데이트 필요
const D2_FRS_BASE: Record<string, number> = {
  'JG1-FRS-sens':  2,   // CASE B: 이중화 센서(High) + E2E(High) → High+High
  'JG1-FRS-rotat': 4,   // CASE B: Fail-safe 재시도(Medium) + 방해 검출(Medium) → Medium+Medium
  'JG1-FRS-mode':  5,   // CASE A: 모드 전환 조건 검증(Medium) → 보수적 5
  'JG1-FRS-light': 4,   // CASE B: Dual CAN(Medium) + 전압 감시(Low) → Medium+Low
  'JG1-FRS-dign':  3,   // CASE B: 다중 검출(High) + DTC 기록(Medium) → High+Medium
  'JG1-FRS-hapt':  8,   // CASE A: 포지션 비교 검증(Low) → 보수적 8
}

// ── AIAG-VDA 2019 Action Priority Matrix ─────────────────────────────────────
function getActionPriority(s: number, o: number, d: number): string {
  const dB = d <= 1 ? 0 : d <= 3 ? 1 : d <= 6 ? 2 : 3
  const oB = o <= 1 ? 0 : o <= 3 ? 1 : o <= 6 ? 2 : 3
  if (s >= 9) {
    return [
      ['L', 'L', 'M', 'H'],
      ['L', 'M', 'H', 'VH'],
      ['L', 'M', 'H', 'VH'],
      ['M', 'H', 'VH', 'VH'],
    ][oB][dB]
  }
  if (s >= 7) {
    return [
      ['L', 'L', 'L', 'M'],
      ['L', 'L', 'M', 'H'],
      ['L', 'M', 'H', 'VH'],
      ['L', 'M', 'H', 'VH'],
    ][oB][dB]
  }
  if (s >= 4) {
    return [
      ['L', 'L', 'L', 'L'],
      ['L', 'L', 'L', 'M'],
      ['L', 'L', 'M', 'H'],
      ['L', 'L', 'M', 'H'],
    ][oB][dB]
  }
  return 'L'
}

// ── Counter Measure (AP=VH 전용) ─────────────────────────────────────────────
interface CmResult {
  cm: string
  rationale: string
  d1After: number | null   // D1 개선 목표값 (null = D1 CM 없음)
  d2After: number | null   // D2 개선 목표값 (null = D2 CM 없음)
}

function getCounterMeasure(
  functionName: string,
  _failureMode: string,
  ap: string,
  d1: number,
  d2: number,
): CmResult {
  if (ap !== 'VH') return { cm: '-', rationale: '-', d1After: null, d2After: null }

  const cat = extractFrsCat(functionName)
  const cmParts: string[] = []
  const ratParts: string[] = []

  // D1 개선 — D1≥6: 신규 설계 DV 통합 테스트만으로는 초기 결함 감지 한계
  let d1Target: number | null = null
  if (d1 >= 6) {
    d1Target = d1 >= 7 ? 3 : 4
    cmParts.push(`[D1 개선] DV 통합 테스트에 PV 단위 테스트 수준 조기 검증 추가 (D1: ${d1}→${d1Target})`)
    ratParts.push(`신규 설계로 DV 단계 통합 테스트만으로는 초기 결함 감지 한계 — PV 수준 단위 검증 병행 필요`)
  }

  // D2 개선 — D2≥4: Safety Mechanism 커버리지 부족
  let d2Target: number | null = null
  if (d2 >= 4) {
    let d2Cm = ''
    let d2Rat = ''
    switch (cat) {
      case 'JG1-FRS-rotat':
        d2Target = 2
        d2Cm  = `[D2 개선] 레버 회전 모터 위치 모니터링 요구사항 추가 (D2: ${d2}→${d2Target})`
        d2Rat = 'Fail-safe 재시도 단독으로 ASIL B DC 미충족 — 위치 모니터링 이중화 요구사항 신규 설계 필요'
        break
      case 'JG1-FRS-mode':
        d2Target = 3
        d2Cm  = `[D2 개선] 변속 모드 전환 조건 이중 검증 요구사항 추가 (D2: ${d2}→${d2Target})`
        d2Rat = '단일 모드 검증 메커니즘 Medium DC 수준 — 독립 검증 채널 추가로 High DC 달성 필요'
        break
      case 'JG1-FRS-light':
        d2Target = 2
        d2Cm  = `[D2 개선] 지시등 점등 상태 피드백 모니터링 요구사항 추가 (D2: ${d2}→${d2Target})`
        d2Rat = 'Dual CAN 수신만으로 점등 확인 불가 — 출력 핀 상태 피드백 검증 요구사항 추가 필요'
        break
      case 'JG1-FRS-hapt':
        d2Target = 4
        d2Cm  = `[D2 개선] 햅틱 피드백 구동 완료 확인 모니터링 요구사항 추가 (D2: ${d2}→${d2Target})`
        d2Rat = '단일 Low DC 메커니즘으로 ASIL B 미충족 — 구동 완료 신호 피드백 모니터링 설계 추가 필요'
        break
      default:
        d2Cm  = `[D2 개선] 추가 Safety Mechanism 요구사항 검토 필요 (D2: ${d2}→TBD)`
        d2Rat = '현재 아키텍처 구조상 추가 모니터링 요구사항 신규 설계 검토 필요'
    }
    if (d2Cm)  cmParts.push(d2Cm)
    if (d2Rat) ratParts.push(d2Rat)
  }

  if (cmParts.length === 0) {
    return {
      cm: '추가 조치 검토 필요',
      rationale: '현재 아키텍처 구조상 추가 모니터링 구현 불가 — 시스템 레벨 검토 필요',
      d1After: null, d2After: null,
    }
  }
  return { cm: cmParts.join('\n'), rationale: ratParts.join('\n'), d1After: d1Target, d2After: d2Target }
}

function getD2(functionName: string, failureMode: string): number {
  const cat = extractFrsCat(functionName)
  const sigName = functionName.includes(' / ') ? functionName.split(' / ').pop()! : ''
  const isE2ESig = /Crc|AlvCnt|E2E/i.test(sigName)

  // E2E 신호의 CORRUPT/REVERSE: E2E CRC = High Coverage 입증 메커니즘 → D2=2
  if (isE2ESig && (failureMode === 'CORRUPT' || failureMode === 'REVERSE')) return 2

  // DTC 감시 신호의 NO: 타임아웃 모니터링 = High Coverage → D2=3
  // (sens/rotat 제외 — 이미 base D2가 더 낮거나 같음)
  if (failureMode === 'NO' && cat && !['JG1-FRS-sens', 'JG1-FRS-rotat'].includes(cat)) {
    return Math.min(D2_FRS_BASE[cat] ?? 5, 3)
  }

  // FRS 카테고리 기반 기본값
  if (cat && D2_FRS_BASE[cat] !== undefined) return D2_FRS_BASE[cat]
  return 5  // 기본: 단일 Medium 메커니즘 (보수적)
}

// ── Effect on SG / SPF/LF 헬퍼 함수 ──────────────────────────────────────────
const VALUE_FAULTS  = new Set(['MORE', 'LESS', 'REVERSE', 'CORRUPT'])
const TIMING_FAULTS = new Set(['NO', 'AS_WELL_AS', 'PART_OF', 'EARLY', 'LATE'])

function extractFrsCat(functionName: string): string | null {
  const m = functionName.match(/\[JG1-FRS-(\w+)\]/)
  return m ? `JG1-FRS-${m[1]}` : null
}

// FRS 카테고리 + HAZOP 모드 → Safety Goal 매핑
// SG-SBW-001: 의도치 않은 변속 (값 오류 → 잘못된 기어 명령)
// SG-SBW-002: 변속 기능 상실 (신호 손실·타이밍 오류 → 기능 미동작)
function getEffectOnSG(functionName: string, failureMode: string): string {
  const cat = extractFrsCat(functionName)
  if (!cat) return '-'
  if (cat === 'JG1-FRS-sens' || cat === 'JG1-FRS-rotat') {
    return VALUE_FAULTS.has(failureMode) ? 'SG-SBW-001\n(ASIL B)' : 'SG-SBW-002\n(ASIL B)'
  }
  if (cat === 'JG1-FRS-mode') return 'SG-SBW-002\n(ASIL B)'
  return '-'
}

// SPF: ASIL B 신호의 CORRUPT/REVERSE — E2E 미감지 시 즉시 SG 위배
// LF:  기타 SG 위배 가능 항목 — 타임아웃·범위 감시 등 안전 메커니즘으로 감지 가능
function getSPFLF(functionName: string, failureMode: string, sgEffect: string): string {
  if (sgEffect === '-') return '-'
  const cat = extractFrsCat(functionName)
  if (!cat) return '-'
  if ((cat === 'JG1-FRS-sens' || cat === 'JG1-FRS-rotat') &&
      (failureMode === 'CORRUPT' || failureMode === 'REVERSE')) {
    return 'SPF'
  }
  return 'LF'
}

async function main() {
  // ── 데이터 조회 (ICD 변수 정보 LEFT JOIN) ──────────────────────────────────────
  const { rows: items } = await pool.query(`
    SELECT
      p.source, p.sw_component, p.function_name,
      p.failure_mode, p.failure_detail,
      p.effect_local, p.effect_system, p.potential_cause,
      p.severity, p.occurrence, p.detection,
      p.preventive_action, p.detection_action,
      p.action_priority, p.review_status,
      v.variable_type, v.signal_range, v.data_type
    FROM pre_fmea_items p
    LEFT JOIN LATERAL (
      SELECT variable_type, signal_range, data_type
      FROM pre_fmea_icd_variables
      WHERE sw_component = p.sw_component
        AND variable_name = split_part(p.function_name, ' / ', 2)
      LIMIT 1
    ) v ON p.source = 'icd'
    WHERE p.session_id = $1 AND p.source IN ('ai', 'icd')
    ORDER BY p.source DESC, p.sw_component, p.function_name, p.failure_mode
  `, [SESSION_ID])

  const aiCount  = items.filter(r => r.source === 'ai').length
  const icdCount = items.filter(r => r.source === 'icd').length
  console.log(`총 ${items.length}개 항목 (사양서: ${aiCount}개, ICD: ${icdCount}개)`)

  // ── 템플릿 로드 ────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(TEMPLATE_PATH)
  const ws = wb.getWorksheet('Sheet1')!
  ws.name = 'SW_FMEA'

  // 타이틀 행(row 1) 업데이트
  const titleCell = ws.getCell(1, 1)
  titleCell.value =
    `JG1 SBW Software FMEA — ${new Date().toLocaleDateString('ko-KR')}` +
    `  [사양서: ${aiCount}개 / ICD: ${icdCount}개]`

  // 컬럼 너비 적용
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  // C20~C23 / C28~C30 헤더 설정 (템플릿 헤더 row 2/3에 추가)
  const EXT_HDR: Record<number, string> = {
    20: 'S*\n(After)',
    21: 'O*\n(After)',
    22: 'D*\n(After)',
    23: 'AP*\n(After)',
    28: 'SPF/LF',
    29: 'D2',
    30: 'Counter Measure\nRationale',
  }
  ;[20, 21, 22, 23, 28, 29, 30].forEach(col => {
    ;[2, 3].forEach(r => {
      const hc = ws.getCell(r, col)
      hc.value = EXT_HDR[col]
      hc.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
      hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } }
      hc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      hc.border = { top: THIN(), bottom: THIN(), left: THIN(), right: THIN() }
    })
  })

  // ── 데이터 행 (row 4~) ─────────────────────────────────────────────────────────
  const DATA_START = 4
  let no = 1

  for (const item of items) {
    const rowNum = DATA_START + (no - 1)
    const row = ws.getRow(rowNum)
    row.height = 48

    // 신호명 추출 (function_name: "[FRS-xxx] 설명 / SIGNAL_NAME")
    const sigName = item.function_name.includes(' / ')
      ? item.function_name.split(' / ').pop()!
      : item.function_name

    // Interface Category (External / Internal)
    const intfCat = item.source === 'icd'
      ? (item.variable_type === 'SW_INTERNAL' ? 'Internal' : 'External')
      : '-'

    // Interface Variable Type 표시 (타입\nRange: …)
    const varType = item.variable_type ?? (item.source === 'ai' ? 'Function' : '')
    const rangeStr = item.signal_range && item.signal_range !== '-'
      ? `${item.data_type ?? varType}\nRange: ${item.signal_range}`
      : (item.data_type ?? varType)

    // Effect on SG — ICD는 FRS 카테고리+HAZOP 기반 매핑, AI 사양서 항목은 중증도 기반
    const sgEffect = item.source === 'icd'
      ? getEffectOnSG(item.function_name ?? '', item.failure_mode ?? '')
      : (item.severity >= 9 ? 'SG-SBW-001\n(ASIL B)' : item.severity >= 8 ? 'SG-SBW-002\n(ASIL B)' : '-')

    // SPF/LF 분류
    const spfLf = item.source === 'icd'
      ? getSPFLF(item.function_name ?? '', item.failure_mode ?? '', sgEffect)
      : (sgEffect !== '-' ? 'LF' : '-')

    // Detection2 — Safety Mechanism DC 기반
    const d2 = item.source === 'icd'
      ? getD2(item.function_name ?? '', item.failure_mode ?? '')
      : 5  // AI 사양서 항목: 단일 Medium 기본값

    // Safety Mechanism — preventive_action에 포함된 사양서 안전 메커니즘 추출
    const safetyMechMatch = (item.preventive_action ?? '').match(/사양서 안전메커니즘\([^)]+\):\s*(.+)$/)
    const safetyMech = safetyMechMatch ? safetyMechMatch[1].trim() : ''
    const basePreventive = (item.preventive_action ?? '').split('; 사양서 안전메커니즘(')[0]
    // Test Method — detection_action 전체 (DTC 감지 조건 + 결함판정기준)
    const testMethod = item.detection_action ?? ''

    // RPN = S × O × D
    const rpn = (item.severity ?? 0) * (item.occurrence ?? 0) * (item.detection ?? 0)

    // Is countermeasure required
    const ap = String(item.action_priority ?? '')
    const counterReq = ap === 'VH' ? 'Yes (VH)' : ap === 'H' ? 'Yes (H)' : ap === 'M' ? 'Conditional' : 'No'

    // Counter Measure (AP=VH 전용)
    const { cm, rationale, d1After, d2After } = getCounterMeasure(
      item.function_name ?? '', item.failure_mode ?? '', ap,
      item.detection ?? 0, d2,
    )

    // 개선 후 SOD 재평가
    const sAfter = item.severity  ?? 0   // S: 고장 영향 불변
    const oAfter = item.occurrence ?? 0  // O: 예방 조치 미적용 시 불변
    const dAfter = ap === 'VH'
      ? Math.min(d1After ?? (item.detection ?? 0), d2After ?? d2)
      : (item.detection ?? 0)            // 非VH: 그대로 복사
    const apAfter = getActionPriority(sAfter, oAfter, dAfter)

    const vals: (string | number)[] = [
      no,                          // C1:  No
      item.sw_component ?? '',     // C2:  SW Unit Name
      intfCat,                     // C3:  Interface Category
      sigName,                     // C4:  Interface(Variable) name
      rangeStr,                    // C5:  Interface(Variable) type
      HAZOP_LABEL[item.failure_mode] ?? item.failure_mode ?? '',  // C6:  Failure mode (명사구 레이블)
      item.failure_detail ?? '',   // C7:  Detail of the failure mode
      item.effect_local ?? '',     // C8:  Effect on Module
      item.effect_system ?? '',    // C9:  Effect on System
      sgEffect,                    // C10: Effect on SG (FRS+HAZOP 기반 매핑)
      item.severity ?? 0,          // C11: S
      basePreventive,              // C12: Preventive Action (안전 메커니즘 제외)
      item.occurrence ?? 0,        // C13: O
      safetyMech,                  // C14: Safety Mechanism (사양서 안전 메커니즘)
      testMethod,                  // C15: Test Method (DTC 감지 조건)
      item.detection ?? 0,         // C16: D
      rpn,                         // C17: RPN
      counterReq,                               // C18: Is countermeasure required
      cm,                                       // C19: Counter Measure (AP=VH: 개선 조치, 非VH: '-')
      sAfter,                                   // C20: S* (After)
      oAfter,                                   // C21: O* (After)
      dAfter,                                   // C22: D* (After)
      apAfter,                                  // C23: AP* (After)
      '',                                        // C24: (삭제 예정)
      '',                                        // C25: (삭제 예정)
      '',                                        // C26: (삭제 예정)
      '',                                        // C27: (삭제 예정)
      spfLf,                                     // C28: SPF/LF 분류
      d2,                                        // C29: D2 (Safety Mechanism DC 기반 검출도)
      rationale,                                 // C30: Counter Measure Rationale
    ]

    vals.forEach((val, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = val as ExcelJS.CellValue
      cell.font = { size: 9 }
      cell.border = {
        top: HAIR(), bottom: HAIR(), left: THIN(), right: THIN(),
      }
      // 기본 정렬 — 숫자·코드 컬럼은 center
      const centerCols = new Set([1, 3, 6, 11, 13, 16, 17, 18, 20, 21, 22, 23, 28, 29])
      cell.alignment = {
        vertical: 'top',
        wrapText: true,
        horizontal: centerCols.has(ci + 1) ? 'center' : 'left',
      }
    })

    // HAZOP 모드 색상 (C6)
    const modeCell = row.getCell(6)
    const modeArgb = MODE_COLOR[item.failure_mode] ?? null
    if (modeArgb) modeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: modeArgb } }
    modeCell.font = { bold: true, size: 9 }

    // S 열 (C11) 색상
    const sCell = row.getCell(11)
    if (item.severity >= 9) {
      sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } }
      sCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    } else if (item.severity >= 8) {
      sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF7C7C' } }
      sCell.font = { bold: true, size: 9 }
    } else if (item.severity >= 6) {
      sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } }
    }

    // RPN 열 (C17) 색상
    const rpnCell = row.getCell(17)
    if (rpn >= 100) {
      rpnCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } }
      rpnCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    } else if (rpn >= 50) {
      rpnCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } }
      rpnCell.font = { bold: true, size: 9 }
    }

    // C20 S* 색상 (C11과 동일 기준)
    const sAfterCell = row.getCell(20)
    if (sAfter >= 9) {
      sAfterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } }
      sAfterCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    } else if (sAfter >= 8) {
      sAfterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF7C7C' } }
      sAfterCell.font = { bold: true, size: 9 }
    } else if (sAfter >= 6) {
      sAfterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } }
    }

    // C23 AP* 색상
    const apAfterCell = row.getCell(23)
    if (AP_COLOR[apAfter]) {
      apAfterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AP_COLOR[apAfter] } }
      apAfterCell.font = {
        bold: true, size: 9,
        color: { argb: (apAfter === 'VH' || apAfter === 'H') ? 'FFFFFFFF' : 'FF000000' },
      }
    }

    // Is countermeasure required (C18) 색상
    const crCell = row.getCell(18)
    if (ap === 'VH') crCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AP_COLOR.VH } }
    else if (ap === 'H') crCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AP_COLOR.H } }
    else if (ap === 'M') crCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AP_COLOR.M } }
    else if (ap === 'L') crCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AP_COLOR.L } }

    // SPF/LF 색상 (C28)
    const spfCell = row.getCell(28)
    if (spfLf === 'SPF') {
      spfCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } }
      spfCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    } else if (spfLf === 'LF') {
      spfCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } }
      spfCell.font = { bold: true, size: 9 }
    }

    // D2 색상 (C29) — 낮을수록 좋음 (High Coverage=녹, Low Coverage=적)
    const d2Cell = row.getCell(29)
    if (d2 <= 2) {
      d2Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }  // 녹 (Full/High)
      d2Cell.font = { bold: true, size: 9 }
    } else if (d2 <= 4) {
      d2Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF1DE' } }  // 연녹 (High~Medium)
      d2Cell.font = { size: 9 }
    } else if (d2 <= 6) {
      d2Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } }  // 주황 (Medium)
      d2Cell.font = { bold: true, size: 9 }
    } else {
      d2Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF7C7C' } }  // 적 (Low/없음)
      d2Cell.font = { bold: true, size: 9 }
    }

    // C30 Counter Measure Rationale 색상
    const cmCell = row.getCell(30)
    if (ap === 'VH') {
      cmCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE7E7' } }  // 연적색 (VH 조치 필요)
      cmCell.font = { size: 9, italic: true }
    } else {
      cmCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }  // 연회색 (해당 없음)
      cmCell.font = { size: 9, color: { argb: 'FF999999' } }
    }

    // 출처 배경색 (HAZOP/S/RPN/countermeasure/SPF/LF/D2 컬럼 제외)
    const SRC_BG = item.source === 'ai' ? 'FFECF4FF' : 'FFECFFF4'
    const skipBg = new Set([6, 11, 17, 18, 20, 23, 28, 29, 30])
    for (let ci = 1; ci <= 30; ci++) {
      if (!skipBg.has(ci)) {
        const cell = row.getCell(ci)
        if (!cell.fill || (cell.fill as ExcelJS.FillPattern).pattern !== 'solid' ||
            (cell.fill as ExcelJS.FillPattern).fgColor?.argb === undefined) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SRC_BG } }
        }
      }
    }

    row.commit()
    no++
  }

  // C24-C27 열 완전 삭제 (TargetDate / Responsibility / Status / Evidence)
  // spliceColumns는 전체 행에 걸쳐 열을 물리적으로 제거 → 이후 C28-C30이 C24-C26으로 자동 시프트
  ws.spliceColumns(24, 4)

  // 화면 고정 (C4까지 고정, 헤더 3행 고정)
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 3 }]

  // ── AP 분포 요약 시트 ──────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('AP 분포 요약')
  ws2.columns = [
    { key: 'comp',  width: 35 }, { key: 'VH', width: 8 },
    { key: 'H',     width: 8  }, { key: 'M',  width: 8 },
    { key: 'L',     width: 8  }, { key: 'rpn', width: 9 },
    { key: 'total', width: 8  },
  ]

  const dist: Record<string, number> = {}
  const byComp: Record<string, Record<string, number>> = {}
  const rpnByComp: Record<string, number[]> = {}
  for (const it of items) {
    const ap = it.action_priority ?? 'null'
    dist[ap] = (dist[ap] ?? 0) + 1
    byComp[it.sw_component] ??= {}
    byComp[it.sw_component][ap] = (byComp[it.sw_component][ap] ?? 0) + 1
    rpnByComp[it.sw_component] ??= []
    rpnByComp[it.sw_component].push((it.severity ?? 0) * (it.occurrence ?? 0) * (it.detection ?? 0))
  }

  const sumHdr = ws2.getRow(1)
  ;['SW 컴포넌트', 'VH', 'H', 'M', 'L', '평균 RPN', '합계'].forEach((v, i) => {
    const c = sumHdr.getCell(i + 1)
    c.value = v
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = { top: THIN(), bottom: THIN(), left: THIN(), right: THIN() }
  })
  sumHdr.height = 22
  sumHdr.commit()

  let sumRowNum = 2
  for (const [comp, apMap] of Object.entries(byComp)) {
    const r = ws2.getRow(sumRowNum++)
    r.getCell(1).value = comp
    r.getCell(1).font = { size: 9 }
    ;(['VH', 'H', 'M', 'L'] as const).forEach((a, i) => {
      const c = r.getCell(i + 2)
      c.value = apMap[a] ?? 0
      c.alignment = { horizontal: 'center' }
      c.font = { size: 9 }
      if (apMap[a] && AP_COLOR[a]) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AP_COLOR[a] } }
        c.font = { bold: true, size: 9, color: { argb: a === 'VH' || a === 'H' ? 'FFFFFFFF' : 'FF000000' } }
      }
    })
    const rpns = rpnByComp[comp] ?? []
    const avgRpn = rpns.length ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0
    r.getCell(6).value = avgRpn
    r.getCell(6).alignment = { horizontal: 'center' }
    r.getCell(6).font = { size: 9 }
    r.getCell(7).value = Object.values(apMap).reduce((a, b) => a + b, 0)
    r.getCell(7).font = { bold: true, size: 9 }
    r.getCell(7).alignment = { horizontal: 'center' }
    r.commit()
  }

  const totRow = ws2.getRow(sumRowNum)
  totRow.getCell(1).value = '전체 합계'
  totRow.getCell(1).font = { bold: true }
  ;(['VH', 'H', 'M', 'L'] as const).forEach((a, i) => {
    totRow.getCell(i + 2).value = dist[a] ?? 0
    totRow.getCell(i + 2).font = { bold: true }
    totRow.getCell(i + 2).alignment = { horizontal: 'center' }
  })
  const allRpns = items.map(it => (it.severity ?? 0) * (it.occurrence ?? 0) * (it.detection ?? 0))
  totRow.getCell(6).value = Math.round(allRpns.reduce((a, b) => a + b, 0) / (allRpns.length || 1))
  totRow.getCell(6).font = { bold: true }
  totRow.getCell(6).alignment = { horizontal: 'center' }
  totRow.getCell(7).value = items.length
  totRow.getCell(7).font = { bold: true }
  totRow.getCell(7).alignment = { horizontal: 'center' }
  totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  totRow.commit()

  // ── 저장 ──────────────────────────────────────────────────────────────────────
  const outPath = path.join(os.homedir(), 'Desktop', 'JG1_SBW_FMEA_20260601.xlsx')
  await wb.xlsx.writeFile(outPath)
  console.log(`\n✅ 저장: ${outPath}`)
  console.log(`   항목: ${items.length}개 (사양서: ${aiCount}개, ICD: ${icdCount}개)`)
  console.log(`   AP 분포: VH=${dist['VH']??0} H=${dist['H']??0} M=${dist['M']??0} L=${dist['L']??0}`)

  await pool.end()
}

main().catch(e => { console.error('❌', e); process.exit(1) })
