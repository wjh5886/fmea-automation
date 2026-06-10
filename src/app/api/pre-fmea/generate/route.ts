import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { queryOne, query, execute } from '@/lib/db'
import { storageDownload } from '@/lib/supabase-server'
import { calculateAPSafe } from '@/lib/ap-calculator'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// SW HAZOP 9개 가이드워드 (ICD 파이프라인과 동일)
const VALID_FM = new Set(['MORE', 'LESS', 'REVERSE', 'CORRUPT', 'NO', 'AS_WELL_AS', 'PART_OF', 'EARLY', 'LATE'])

// 서술형 표현 → HAZOP 키워드 정규화 (AI가 잘못된 형식으로 반환할 경우 대응)
const FM_NORMALIZE: Record<string, string> = {
  'DUPLICATE': 'AS_WELL_AS', 'DUPLICATED': 'AS_WELL_AS', 'DUPLICATE OCCURRENCE': 'AS_WELL_AS',
  'DUPLICATE MESSAGE': 'AS_WELL_AS', 'REDUNDANT': 'AS_WELL_AS',
  'CORRUPTED': 'CORRUPT', 'VALUE CORRUPTED': 'CORRUPT', 'DATA CORRUPTED': 'CORRUPT',
  'CORRUPT VALUE': 'CORRUPT', 'INVALID': 'CORRUPT', 'INVALID VALUE': 'CORRUPT',
  'OUT OF RANGE': 'CORRUPT', 'BIT ERROR': 'CORRUPT',
  'PREMATURE': 'EARLY', 'PREMATURE SIGNAL': 'EARLY', 'TOO EARLY': 'EARLY',
  'EARLY SIGNAL': 'EARLY', 'EARLY MESSAGE': 'EARLY',
  'DELAYED': 'LATE', 'MESSAGE DELAYED': 'LATE', 'SIGNAL DELAYED': 'LATE',
  'TOO LATE': 'LATE', 'LATE MESSAGE': 'LATE', 'TIMEOUT': 'LATE',
  'MISSING': 'NO', 'SIGNAL MISSING': 'NO', 'NO SIGNAL': 'NO', 'LOST': 'NO',
  'SIGNAL LOST': 'NO', 'NOT UPDATED': 'NO',
  'REVERSED': 'REVERSE', 'INVERTED': 'REVERSE', 'OPPOSITE': 'REVERSE',
  'SIGN REVERSED': 'REVERSE', 'VALUE REVERSED': 'REVERSE',
  'EXCESSIVE': 'MORE', 'TOO HIGH': 'MORE', 'TOO LARGE': 'MORE', 'OVERFLOW': 'MORE',
  'INSUFFICIENT': 'LESS', 'TOO LOW': 'LESS', 'TOO SMALL': 'LESS', 'UNDERFLOW': 'LESS',
  'PARTIAL': 'PART_OF', 'PARTIAL DATA': 'PART_OF', 'INCOMPLETE': 'PART_OF',
  'ADDITIONAL': 'AS_WELL_AS', 'EXTRA': 'AS_WELL_AS', 'SPURIOUS': 'AS_WELL_AS',
}

function resolveFailureMode(raw: unknown): string | null {
  const upper = String(raw ?? '').trim().toUpperCase()
  if (!upper) return null
  if (VALID_FM.has(upper)) return upper
  if (FM_NORMALIZE[upper]) return FM_NORMALIZE[upper]
  // prefix match: "MORE - duplicate" → MORE
  for (const kw of VALID_FM) {
    if (upper.startsWith(kw)) return kw
  }
  return null
}

async function extractText(filename: string, buf: Buffer): Promise<string> {
  if (filename.toLowerCase().endsWith('.pdf')) return '' // PDF → document block, not text
  if (filename.toLowerCase().match(/\.docx?$/)) {
    const result = await mammoth.extractRawText({ buffer: buf })
    return result.value
  }
  return buf.toString('utf-8') // .dbc, .txt, etc.
}

function isPdf(filename: string) {
  return filename.toLowerCase().endsWith('.pdf')
}

// ── Build reference data table from human FMEA items ─────────────────────────
function buildReferenceTable(
  humanItems: Record<string, unknown>[],
): string {
  if (!humanItems.length) return '(없음 — 신규 아이템, 제로베이스 생성)'

  const seen = new Set<string>()
  const rows: string[] = []

  for (const item of humanItems) {
    const key = `${item.sw_component}__${item.failure_mode ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    const comp = String(item.sw_component ?? '').replace(/[\n\r]+/g, '')
    const fm   = String(item.failure_mode ?? '-')
    const s    = item.severity   != null ? String(item.severity)   : '-'
    const o    = item.occurrence != null ? String(item.occurrence) : '-'
    const d    = item.detection  != null ? String(item.detection)  : '-'
    const detail = String(item.failure_detail ?? item.function_name ?? '').slice(0, 60)
    const cause  = String(item.potential_cause ?? '').slice(0, 50) || '-'

    rows.push(`| ${comp} | ${fm} | ${s} | ${o} | ${d} | ${detail} | ${cause} |`)
    if (rows.length >= 40) break // 토큰 절약: 최대 40행
  }

  const header = `| SW 컴포넌트 | HAZOP | S | O | D | 고장 상세 (요약) | 잠재 원인 (요약) |
|---|---|---|---|---|---|---|`
  return `${header}\n${rows.join('\n')}`
}

// ── System FMEA parser (System Information sheet) ────────────────────────────
interface SgRow { sgId: string; description: string; asil: string; hazard: string }
interface SmRow { smId: string; name: string; dc: string }

async function parseSysFmeaAsync(buf: Buffer): Promise<{ sgs: SgRow[]; sms: SmRow[] }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  // ExcelJS 타입은 구형 Buffer를 기대하므로 ArrayBuffer 경유
  await wb.xlsx.load(buf.buffer as ArrayBuffer)
  const ws = wb.getWorksheet('System Information')
  if (!ws) return { sgs: [], sms: [] }

  function cellText(v: unknown): string {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') {
      const rv = v as Record<string, unknown>
      if (Array.isArray(rv.richText)) return (rv.richText as { text: string }[]).map(r => r.text).join('')
      if (typeof rv.text === 'string') return rv.text
    }
    return String(v)
  }

  const sgs: SgRow[] = []
  const sms: SmRow[] = []
  let inSg = false, inSm = false

  ws.eachRow((row) => {
    const c2 = cellText(row.getCell(2).value).trim()
    const c3 = cellText(row.getCell(3).value).trim()
    const c4 = cellText(row.getCell(4).value).trim()
    const c5 = cellText(row.getCell(5).value).trim()

    if (/SG\s*ID/i.test(c2)) { inSg = true; inSm = false; return }
    if (/Safety\s*[Mm]echanism/i.test(c2) && /ID/i.test(c3)) { inSm = true; inSg = false; return }
    if (/Safety\s*[Mm]echanism/i.test(c2) && sgs.length > 0) { inSm = true; inSg = false; return }

    if (inSg && /^SG\d/i.test(c2)) {
      sgs.push({ sgId: c2, description: c3, asil: c4, hazard: c5 })
    }
    if (inSm) {
      const m = c3.match(/\[((?:EXT)?SM\d+)\]/)
      if (m) sms.push({ smId: m[1], name: c3, dc: c4 })
    }
  })

  return { sgs, sms }
}

// ── SG/SM context builder ─────────────────────────────────────────────────────
function buildSgSmContext(
  sgs: SgRow[],
  sms: SmRow[],
): string {
  if (!sgs.length) return ''

  const sgLines = sgs.map(sg =>
    `  - ${sg.sgId} (ASIL ${sg.asil ?? '?'}): ${sg.description}  [Hazard: ${sg.hazard ?? '-'}]`,
  ).join('\n')

  const smLines = sms.map(sm =>
    `  - ${sm.smId} [DC: ${sm.dc ?? '-'}]: ${sm.name}`,
  ).join('\n')

  return `
■ [시스템 FMEA 기반 Safety Goal 목록 — effect_sg 매핑 시 반드시 참조]
각 FMEA 항목의 effect_system을 분석하여 위반 가능한 SG ID를 effect_sg에 기입하세요.
위반이 없으면 "-"로 기입합니다.

${sgLines}

■ [Safety Mechanism 목록 — detection_action 작성 시 참조]
아래 SM이 구현되어 있을 경우 detection_action에 SM ID를 포함하여 기술하세요.
SM의 DC(진단 커버리지)가 High이면 Detection 2~3, Medium이면 3~5, Low이면 6~7 적용 가능합니다.

${smLines}
`
}

// ── System role prompt (Anthropic system param) ───────────────────────────────
const SYSTEM_ROLE = `당신은 ISO 26262 및 Automotive SPICE 표준을 준수하는 자동차 임베디드 소프트웨어 안전 분석가이자 FMEA 전문가입니다.
특정 '차량 제어 아이템(Item)'의 도메인 컨텍스트를 기반으로, 입력된 프로젝트 데이터를 분석하여 정밀하고 누락 없는 SW FMEA 문서를 생성하는 것이 임무입니다.

[계층 구조 집중 규칙]
- 지정된 [Target 아이템]의 도메인 특성, 물리적 메커니즘, 안전 무결성에 집중합니다.
- [참조 데이터]가 있으면 고장 모드명·원인 표현·S/O/D 기준을 계승하여 일관성을 유지합니다.
- 참조 데이터가 비어있으면 제공된 Input 소스에서 제로베이스로 도출합니다.
- HAZOP Guide Words: MORE / LESS / REVERSE / CORRUPT / NO / AS_WELL_AS / PART_OF / EARLY / LATE 9가지를 사용합니다 (STUCK·ERRATIC 금지).
- failure_mode 필드에는 반드시 위 9개 키워드 중 하나만 정확히 기입하세요. 'Duplicate Occurrence', 'Value Corrupted' 같은 서술형 표현은 절대 사용 금지.`

// ── User prompt builder ───────────────────────────────────────────────────────
function buildUserPrompt(opts: {
  itemName: string
  referenceTable: string
  templateCtx: string
  archCtx: string
  dbcCtx: string
  specCtx: string
  sgSmCtx: string
}): string {
  return `[전달받은 실제 데이터 & 컨텍스트 정보]

■ [CRITICAL] 1. Target 아이템 (도메인 컨텍스트 영역)
- 아이템 이름: ${opts.itemName}
※ 이 아이템의 제어 특성에만 집중하십시오. 타 도메인 간섭 금지.

■ 2. 참조 데이터 (기존 Human FMEA 이력 — SOD 기준 및 표현식 계승용)
${opts.referenceTable}
${opts.sgSmCtx}
■ 3. 프로젝트별 Input 데이터

[FMEA 양식 가이드]:
${opts.templateCtx}

[시스템 아키텍처 사양]:
${opts.archCtx}

[DBC 시그널 정보]:
${opts.dbcCtx}

[기능 사양서 내용]:
${opts.specCtx}

---

[Output Format]
아래 JSON 배열만 출력하세요 (마크다운·설명 없이):

[
  {
    "sw_component": "SW 컴포넌트명 (참조 데이터의 표기와 정확히 일치)",
    "function_name": "해당 기능명 또는 인터페이스 변수명",
    "failure_mode": "MORE|LESS|REVERSE|CORRUPT|NO|AS_WELL_AS|PART_OF|EARLY|LATE 중 하나 (9개 HAZOP 키워드만 허용, 서술형 표현 금지)",
    "failure_detail": "구체적인 고장 내용 (1~2문장)",
    "effect_local": "모듈 수준 영향 (1문장)",
    "effect_system": "시스템/차량 수준 영향 (1문장)",
    "effect_sg": "위반되는 SG ID 콤마 구분 (예: SG01, SG03) 또는 위반 없으면 '-'",
    "potential_cause": "잠재적 원인 (1~2문장, DBC/아키텍처 기반으로 구체적으로)",
    "severity": 숫자(1~10),
    "occurrence": 숫자(1~10),
    "detection": 숫자(1~10),
    "preventive_action": "예방 설계 조치 (1문장)",
    "detection_action": "검출/진단 방법 — 해당 SM이 있으면 SM ID 포함 (예: [SM15] CAN CRC Fault Check 적용)",
    "confidence_score": 0.0~1.0
  }
]

[SOD 기준]
- Severity: 10=안전사고(충돌/부상), 7~9=핵심기능 상실, 4~6=성능저하, 1~3=사용자 불편
- Occurrence: 9~10=빈번(≥1/1000h), 6~8=가끔, 3~5=드물게, 1~2=거의없음
- Detection: 1~2=확실한 자동감지(≥99%), 3~4=높은감지, 5~6=보통, 7~8=낮음, 9~10=감지불가
- 참조 데이터의 SOD 값을 우선 기준으로 삼아 일관성을 유지하세요.

${HAZOP_BY_DTYPE_TABLE}

[요구사항]
- 설계사양서의 각 SW 컴포넌트/기능에 대해 위 데이터 타입별 HAZOP 규칙을 적용하세요.
- 최소 20개 이상의 FMEA 항목을 생성하세요.
- DBC 시그널이 있으면 Timeout·CRC·E2E 고장 원인을 CORRUPT 또는 EARLY/LATE 항목에 포함하세요.
- ISO 26262 ASIL 요구사항과 참조 데이터의 패턴을 반영하세요.
- Detection: Unit Test 완료 시 3(DV 기준 6), Safety Mechanism 있으면 2~3 적용 가능.`
}

type ClaudeMessage = Anthropic.Messages.MessageParam
type DocBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

// ── Spec chunker: extract relevant section per component ─────────────────────
function extractSpecChunk(specText: string, componentName: string, maxLen = 4000): string {
  if (!specText || specText === 'N/A (파일 미업로드)') return specText?.slice(0, maxLen) ?? ''

  // Normalize component name: CstAp_CANMGT → CANMGT, CstAp_MotorControlMgt → MotorControlMgt
  const shortName = componentName.replace(/^(?:CstAp|BswIF|CtAp|CtCdd|Cst|Bsw)_?/i, '')
  const keywords  = [componentName, shortName].filter(Boolean)

  const lines = specText.split('\n')
  let bestStart = -1
  let bestScore = 0

  // Slide a 200-line window and score by keyword density
  const WINDOW = 200
  for (let i = 0; i < lines.length - 10; i += 50) {
    const slice = lines.slice(i, i + WINDOW).join('\n')
    let score = 0
    for (const kw of keywords) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      score += (slice.match(re) ?? []).length
    }
    if (score > bestScore) { bestScore = score; bestStart = i }
  }

  if (bestStart < 0 || bestScore === 0) {
    // No match — return beginning of spec
    return specText.slice(0, maxLen)
  }

  return lines.slice(bestStart, bestStart + WINDOW).join('\n').slice(0, maxLen)
}

// ── ICD variable table builder ────────────────────────────────────────────────
function buildIcdVariableTable(vars: Record<string, unknown>[]): string {
  const header = `| # | 변수명 | 방향 | 데이터 타입 | 범위 | 단위 | 설명 |
|---|--------|------|------------|------|------|------|`
  const rows = vars.map((v, i) => {
    const name  = String(v.variable_name ?? '')
    const dir   = String(v.variable_type ?? v.direction ?? '-')
    const dtype = String(v.data_type ?? '-')
    const range = String(v.signal_range ?? '-')
    const unit  = String(v.unit ?? '-')
    const desc  = String(v.description ?? '-').slice(0, 60)
    return `| ${i + 1} | ${name} | ${dir} | ${dtype} | ${range} | ${unit} | ${desc} |`
  })
  return `${header}\n${rows.join('\n')}`
}

// ── HAZOP Guideword table by data type (SL SW FMEA Guideline v4.2) ───────────
const HAZOP_BY_DTYPE_TABLE = `[CRITICAL: 데이터 타입별 HAZOP Guideword 적용 규칙 — SL SW FMEA Guideline v4.2]
각 변수의 데이터 타입(data_type 컬럼)을 확인하고 아래 규칙에 따라 HAZOP를 선택적으로 적용하세요.
본 시스템은 SW HAZOP 가이드의 9개 Guideword를 모두 사용합니다:
  MORE(증가), LESS(감소), REVERSE(역/반전), CORRUPT(이외/파괴), NO(없음), AS_WELL_AS(과다/여분), PART_OF(부족/빠짐), EARLY(빠름), LATE(느림)

⚠ failure_mode 필드에는 반드시 위 키워드 중 하나를 정확히 입력하세요. 예: "CORRUPT" (O) / "Value Corrupted" (X), "EARLY" (O) / "Premature Signal" (X)

| 데이터 타입 | 적용 Guideword | 적용 제외 |
|------------|---------------|----------|
| bool / boolean | REVERSE, CORRUPT | MORE, LESS, NO, AS_WELL_AS, PART_OF, EARLY, LATE |
| uint8, uint16, uint32 (unsigned) | MORE, LESS, REVERSE, CORRUPT | NO, AS_WELL_AS, PART_OF, EARLY, LATE |
| sint8, sint16, sint32 (signed) | MORE, LESS, REVERSE, CORRUPT | NO, AS_WELL_AS, PART_OF, EARLY, LATE |
| float32, float64 | MORE, LESS, REVERSE, CORRUPT | NO, AS_WELL_AS, PART_OF, EARLY, LATE |
| enum | MORE, LESS, REVERSE, CORRUPT | NO, AS_WELL_AS, PART_OF, EARLY, LATE |
| 통신 신호 — Polling 방식 | MORE, LESS, CORRUPT, NO, EARLY, LATE | REVERSE, AS_WELL_AS, PART_OF |
| 통신 신호 — Interrupt/Event 방식 | CORRUPT, NO, AS_WELL_AS, PART_OF, EARLY, LATE | MORE, LESS, REVERSE |
| 데이터 타입 미지정 (null) | MORE, LESS, REVERSE, CORRUPT, NO, AS_WELL_AS, PART_OF, EARLY, LATE | 없음 (전체 검토) |

※ direction 컬럼이 "Output" 또는 "Send"인 경우 → 주로 값 오류(MORE/LESS/REVERSE/CORRUPT) 집중
※ direction 컬럼이 "Input" 또는 "Recv"인 경우 → 타이밍 오류(NO/EARLY/LATE/AS_WELL_AS/PART_OF)도 중요하게 검토`

// ── ICD-mode user prompt builder ──────────────────────────────────────────────
function buildIcdUserPrompt(opts: {
  itemName: string
  component: string
  variableTable: string
  referenceTable: string
  specCtx: string
  dbcCtx: string
  sgSmCtx: string
}): string {
  return `[전달받은 실제 데이터 & 컨텍스트 정보]

■ [CRITICAL] 1. Target 아이템 및 컴포넌트
- 아이템: ${opts.itemName}
- SW 컴포넌트: ${opts.component}
※ 이 컴포넌트의 인터페이스 변수에만 집중하세요.

■ 2. 참조 데이터 (기존 Human FMEA 이력)
${opts.referenceTable}
${opts.sgSmCtx}
■ 3. 분석 대상 인터페이스 변수 목록
${opts.variableTable}

■ 4. 프로젝트 Input 데이터

[DBC 시그널 정보]:
${opts.dbcCtx}

[기능 사양서 (요약)]:
${opts.specCtx}

---

${HAZOP_BY_DTYPE_TABLE}

---

[Output Format]
아래 JSON 배열만 출력하세요 (마크다운·설명 없이):

[
  {
    "sw_component": "${opts.component}",
    "function_name": "위 변수 목록의 변수명을 정확히 기입",
    "failure_mode": "MORE|LESS|REVERSE|CORRUPT|NO|AS_WELL_AS|PART_OF|EARLY|LATE 중 하나 (9개 HAZOP 키워드만 허용, 서술형 표현 금지)",
    "failure_detail": "구체적인 고장 내용 (1~2문장, 해당 Guideword가 이 데이터 타입에서 의미하는 바를 반영)",
    "effect_local": "모듈 수준 영향 (1문장)",
    "effect_system": "시스템/차량 수준 영향 (1문장)",
    "effect_sg": "위반되는 SG ID 콤마 구분 (예: SG01, SG03) 또는 위반 없으면 '-'",
    "potential_cause": "잠재적 원인 (1~2문장, 신호 특성 기반으로 구체적으로)",
    "severity": 숫자(1~10),
    "occurrence": 숫자(1~10),
    "detection": 숫자(1~10),
    "preventive_action": "예방 설계 조치 (1문장)",
    "detection_action": "검출/진단 방법 — 해당 SM이 있으면 SM ID 포함 (예: [SM15] CAN CRC Fault Check 적용)",
    "confidence_score": 0.0~1.0
  }
]

[작업 지시]
- 각 변수의 데이터 타입을 확인하고 위 HAZOP 규칙 테이블에 따라 적용 가능한 Guideword만 생성하세요.
- bool 변수에 MORE/LESS 항목을 생성하지 마세요.
- Interrupt 통신 신호에 MORE/LESS 항목을 생성하지 마세요.
- function_name에는 반드시 위 변수 목록의 변수명을 그대로 기입하세요.
- 참조 데이터의 SOD 기준과 표현식을 최대한 계승하세요.
- DBC 시그널이 있으면 Timeout·CRC·E2E 고장 원인을 CORRUPT 또는 EARLY/LATE 항목에 포함하세요.

[SOD 기준]
- Severity: 10=안전사고(충돌/부상), 7~9=핵심기능 상실, 4~6=성능저하, 1~3=사용자 불편
- Occurrence: 9~10=빈번(≥1/1000h), 6~8=가끔, 3~5=드물게, 1~2=거의없음
- Detection: 1~2=확실한 자동감지(≥99%), 3~4=높은감지, 5~6=보통, 7~8=낮음, 9~10=감지불가
  ※ SW Verification Unit Test 완료 시 Detection 3(DV 기준 6), PV 단계 시 3~5
  ※ Safety Mechanism(Range Check, Plausibility 등) 있으면 Detection 2~3 적용 가능`
}

// ── ICD-based generation handler ──────────────────────────────────────────────
async function handleIcdGenerate(
  session_id: string,
  session: Record<string, unknown>,
  dbcCtx: string,
  specCtx: string,
  humanItems: Record<string, unknown>[],
  sgSmCtx: string,
): Promise<NextResponse> {
  const icdVars = await query(
    'SELECT * FROM pre_fmea_icd_variables WHERE session_id = $1 ORDER BY sort_order',
    [session_id],
  )
  if (!icdVars.length) {
    return NextResponse.json({ error: 'ICD 변수가 없습니다. 먼저 ICD 파일을 업로드하고 파싱하세요.' }, { status: 400 })
  }

  const itemName = String(session.item_name ?? 'SBW')
  const referenceTable = buildReferenceTable(humanItems)

  // Group variables by sw_component
  const grouped: Record<string, Record<string, unknown>[]> = {}
  for (const v of icdVars) {
    const key = String(v.sw_component ?? '(미지정)')
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(v)
  }

  const clamp = (v: unknown, lo: number, hi: number): number | null => {
    const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  // Per-component batches — send up to 20 variables per Claude call
  const BATCH_SIZE = 20
  const allRows: ReturnType<typeof buildRow>[] = []
  let totalAiItems = 0

  type RowType = {
    session_id: string; item_no: string; sw_component: string | null; function_name: string | null
    failure_mode: string; failure_detail: string | null; effect_local: string | null; effect_system: string | null
    effect_sg: string | null
    potential_cause: string | null; severity: number | null; occurrence: number | null; detection: number | null
    preventive_action: string | null; detection_action: string | null; confidence_score: number
    action_priority: string | null
  }
  function buildRow(it: Record<string, unknown>, idx: number): RowType {
    const s = clamp(it.severity, 1, 10)
    const o = clamp(it.occurrence, 1, 10)
    const d = clamp(it.detection, 1, 10)
    const rawSg = str(it.effect_sg)
    return {
      session_id,
      item_no: String(idx + 1).padStart(4, '0'),
      sw_component: str(it.sw_component),
      function_name: str(it.function_name),
      failure_mode: resolveFailureMode(it.failure_mode) ?? 'CORRUPT',
      failure_detail: str(it.failure_detail),
      effect_local: str(it.effect_local),
      effect_system: str(it.effect_system),
      effect_sg: rawSg === '-' ? null : rawSg,
      potential_cause: str(it.potential_cause),
      severity: s,
      occurrence: o,
      detection: d,
      preventive_action: str(it.preventive_action),
      detection_action: str(it.detection_action),
      confidence_score: Math.min(1, Math.max(0, Number(it.confidence_score) || 0)),
      action_priority: calculateAPSafe(s, o, d),
    }
  }

  // Run all component batches in parallel
  const batchPromises: Promise<Record<string, unknown>[]>[] = []

  for (const [component, vars] of Object.entries(grouped)) {
    const componentSpecCtx = extractSpecChunk(specCtx, component, 4000)
    for (let start = 0; start < vars.length; start += BATCH_SIZE) {
      const batch = vars.slice(start, start + BATCH_SIZE)
      const variableTable = buildIcdVariableTable(batch)
      const userPromptText = buildIcdUserPrompt({
        itemName, component, variableTable, referenceTable,
        specCtx: componentSpecCtx,
        dbcCtx: dbcCtx.slice(0, 2000),
        sgSmCtx,
      })
      batchPromises.push(
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: SYSTEM_ROLE,
          messages: [{ role: 'user', content: userPromptText }],
        }).then(res => {
          const raw = res.content[0].type === 'text' ? res.content[0].text : ''
          const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
          const parsed = JSON.parse(cleaned)
          return Array.isArray(parsed) ? parsed : []
        }).catch(() => [])
      )
    }
  }

  const batchResults = await Promise.all(batchPromises)
  for (const items of batchResults) {
    totalAiItems += items.length
    const filtered = (items as Record<string, unknown>[]).filter(it => resolveFailureMode(it.failure_mode) !== null)
    for (const it of filtered) {
      allRows.push(buildRow(it, allRows.length))
    }
  }

  // Re-number item_no sequentially
  allRows.forEach((r, i) => { r.item_no = String(i + 1).padStart(4, '0') })

  // Save to DB
  await execute("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [session_id])

  for (const row of allRows) {
    await query(
      `INSERT INTO pre_fmea_items
       (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
        effect_local, effect_system, effect_sg, potential_cause, severity, occurrence, detection,
        preventive_action, detection_action, confidence_score, action_priority, source, review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ai','pending')`,
      [row.session_id, row.item_no, row.sw_component, row.function_name, row.failure_mode,
       row.failure_detail, row.effect_local, row.effect_system, row.effect_sg, row.potential_cause,
       row.severity, row.occurrence, row.detection, row.preventive_action,
       row.detection_action, row.confidence_score, row.action_priority],
    )
  }

  await execute(
    "UPDATE pre_fmea_sessions SET status = 'generated', updated_at = now() WHERE id = $1",
    [session_id],
  )

  return NextResponse.json({
    count: allRows.length,
    total: totalAiItems,
    filtered: totalAiItems - allRows.length,
    itemName,
    mode: 'icd',
    icdVariableCount: icdVars.length,
    components: Object.keys(grouped).length,
    referenceCount: humanItems.length,
  })
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { session_id, mode } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    // 1. 세션 + 문서 조회
    const [sessions, allDocs] = await Promise.all([
      query('SELECT * FROM pre_fmea_sessions WHERE id = $1', [session_id]),
      query('SELECT * FROM pre_fmea_documents WHERE session_id = $1 ORDER BY created_at', [session_id]),
    ])

    const session = sessions[0]
    if (!session) return NextResponse.json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })

    const itemName = String(session.item_name ?? 'SBW')

    // 참조 데이터: 동일 아이템명의 모든 세션에서 human FMEA 조회 (교차 세션, 최대 200행)
    const humanItems = await query(
      `SELECT pi.sw_component, pi.failure_mode, pi.failure_detail, pi.function_name,
              pi.potential_cause, pi.severity, pi.occurrence, pi.detection
       FROM pre_fmea_items pi
       JOIN pre_fmea_sessions ps ON pi.session_id = ps.id
       WHERE ps.item_name = $1 AND pi.source = 'human'
       ORDER BY pi.sw_component, pi.failure_mode
       LIMIT 200`,
      [itemName],
    )

    const docsByType = (type: string) => allDocs.filter(d => d.doc_type === type)
    const specDocs   = docsByType('design_spec')
    const archDocs   = docsByType('architecture')
    const dbcDocs    = docsByType('dbc_file')
    const tmplDocs   = docsByType('fmea_template')

    // SG/SM — 시스템 FMEA 파일 직접 파싱 (DB 저장 없이 on-the-fly)
    const sysFmeaDocs = docsByType('system_fmea')
    let sgSmCtx = ''
    if (sysFmeaDocs.length) {
      try {
        const sysBuf = await storageDownload(String(sysFmeaDocs[0].storage_path))
        const { sgs, sms } = await parseSysFmeaAsync(sysBuf)
        sgSmCtx = buildSgSmContext(sgs, sms)
      } catch { /* 파싱 실패 시 SG/SM 없이 진행 */ }
    }

    if (!specDocs.length) return NextResponse.json({ error: 'SW 설계사양서(design_spec)가 없습니다.' }, { status: 400 })

    // 2. 각 doc_type별 텍스트 추출 + PDF 블록 수집
    const pdfBlocks: DocBlock[] = []

    async function loadDocs(docs: Record<string, unknown>[]): Promise<string> {
      const parts: string[] = []
      for (const doc of docs) {
        const filename = String(doc.filename ?? '')
        const buf = await storageDownload(String(doc.storage_path))
        if (isPdf(filename)) {
          pdfBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
          parts.push(`[PDF 첨부: ${filename}]`)
        } else {
          const text = await extractText(filename, buf)
          parts.push(`=== ${filename} ===\n${text}`)
        }
      }
      return parts.join('\n\n') || 'N/A (파일 미업로드)'
    }

    const [specCtx, archCtx, dbcCtx, templateCtx] = await Promise.all([
      loadDocs(specDocs),
      loadDocs(archDocs),
      loadDocs(dbcDocs),
      loadDocs(tmplDocs),
    ])

    // ICD 모드: ICD 변수 기반 배치 생성으로 분기
    if (mode === 'icd') {
      return handleIcdGenerate(session_id, session, dbcCtx, specCtx, humanItems, sgSmCtx)
    }

    // 3. 참조 데이터 테이블 구성
    const referenceTable = buildReferenceTable(humanItems)

    // 4. 프롬프트 구성 (itemName은 위에서 이미 선언)
    const userPromptText = buildUserPrompt({ itemName, referenceTable, templateCtx, archCtx, dbcCtx, specCtx, sgSmCtx })

    // 5. Claude 메시지 빌드 (PDF document 블록 + 텍스트 블록)
    let messages: ClaudeMessage[]
    if (pdfBlocks.length > 0) {
      messages = [{
        role: 'user',
        content: [...pdfBlocks, { type: 'text' as const, text: userPromptText }],
      }]
    } else {
      messages = [{ role: 'user', content: userPromptText }]
    }

    // 6. Claude API 호출
    const aiResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_ROLE,
      messages,
    })

    const rawText = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : ''
    let aiItems: Record<string, unknown>[]
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      aiItems = JSON.parse(cleaned)
      if (!Array.isArray(aiItems)) throw new Error('Expected array')
    } catch {
      return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText.slice(0, 500) }, { status: 500 })
    }

    // 7. 유효성 검사 및 저장 준비
    const clamp = (v: unknown, lo: number, hi: number): number | null => {
      const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const rows = aiItems
      .filter(it => resolveFailureMode(it.failure_mode) !== null)
      .map((it, idx) => {
        const s = clamp(it.severity, 1, 10)
        const o = clamp(it.occurrence, 1, 10)
        const d = clamp(it.detection, 1, 10)
        const rawSg = str(it.effect_sg)
        return {
          session_id,
          item_no: String(idx + 1).padStart(3, '0'),
          sw_component: str(it.sw_component),
          function_name: str(it.function_name),
          failure_mode: resolveFailureMode(it.failure_mode) ?? 'CORRUPT',
          failure_detail: str(it.failure_detail),
          effect_local: str(it.effect_local),
          effect_system: str(it.effect_system),
          effect_sg: rawSg === '-' ? null : rawSg,
          potential_cause: str(it.potential_cause),
          severity: s,
          occurrence: o,
          detection: d,
          preventive_action: str(it.preventive_action),
          detection_action: str(it.detection_action),
          confidence_score: Math.min(1, Math.max(0, Number(it.confidence_score) || 0)),
          action_priority: calculateAPSafe(s, o, d),
        }
      })

    // 8. 기존 AI 항목 삭제 후 재삽입
    await execute("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [session_id])

    for (const row of rows) {
      await query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, effect_sg, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ai','pending')`,
        [row.session_id, row.item_no, row.sw_component, row.function_name, row.failure_mode,
         row.failure_detail, row.effect_local, row.effect_system, row.effect_sg, row.potential_cause,
         row.severity, row.occurrence, row.detection, row.preventive_action,
         row.detection_action, row.confidence_score, row.action_priority],
      )
    }

    await execute(
      "UPDATE pre_fmea_sessions SET status = 'generated', updated_at = now() WHERE id = $1",
      [session_id],
    )

    return NextResponse.json({
      count: rows.length,
      total: aiItems.length,
      filtered: aiItems.length - rows.length,
      itemName,
      referenceCount: humanItems.length,
      sources: {
        design_spec: specDocs.length,
        architecture: archDocs.length,
        dbc_file: dbcDocs.length,
        fmea_template: tmplDocs.length,
      },
    })
  } catch (e) {
    console.error('[pre-fmea/generate]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
