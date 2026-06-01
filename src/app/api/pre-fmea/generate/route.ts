import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { queryOne, query, execute, getPool } from '@/lib/db'
import { storageDownload } from '@/lib/supabase-server'
import { calculateAPSafe } from '@/lib/ap-calculator'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

// ── System role prompt (Anthropic system param) ───────────────────────────────
const SYSTEM_ROLE = `당신은 ISO 26262 및 Automotive SPICE 표준을 준수하는 자동차 임베디드 소프트웨어 안전 분석가이자 FMEA 전문가입니다.
특정 '차량 제어 아이템(Item)'의 도메인 컨텍스트를 기반으로, 입력된 프로젝트 데이터를 분석하여 정밀하고 누락 없는 SW FMEA 문서를 생성하는 것이 임무입니다.

[계층 구조 집중 규칙]
- 지정된 [Target 아이템]의 도메인 특성, 물리적 메커니즘, 안전 무결성에 집중합니다.
- [참조 데이터]가 있으면 고장 모드명·원인 표현·S/O/D 기준을 계승하여 일관성을 유지합니다.
- 참조 데이터가 비어있으면 제공된 Input 소스에서 제로베이스로 도출합니다.
- HAZOP Guide Words: MORE / LESS / CORRUPT / EARLY / LATE 5가지만 사용합니다 (STUCK·ERRATIC 금지).`

// ── User prompt builder ───────────────────────────────────────────────────────
function buildUserPrompt(opts: {
  itemName: string
  referenceTable: string
  templateCtx: string
  archCtx: string
  dbcCtx: string
  specCtx: string
}): string {
  return `[전달받은 실제 데이터 & 컨텍스트 정보]

■ [CRITICAL] 1. Target 아이템 (도메인 컨텍스트 영역)
- 아이템 이름: ${opts.itemName}
※ 이 아이템의 제어 특성에만 집중하십시오. 타 도메인 간섭 금지.

■ 2. 참조 데이터 (기존 Human FMEA 이력 — SOD 기준 및 표현식 계승용)
${opts.referenceTable}

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
    "failure_mode": "MORE|LESS|CORRUPT|EARLY|LATE 중 하나",
    "failure_detail": "구체적인 고장 내용 (1~2문장)",
    "effect_local": "모듈 수준 영향 (1문장)",
    "effect_system": "시스템/차량 수준 영향 (1문장)",
    "potential_cause": "잠재적 원인 (1~2문장, DBC/아키텍처 기반으로 구체적으로)",
    "severity": 숫자(1~10),
    "occurrence": 숫자(1~10),
    "detection": 숫자(1~10),
    "preventive_action": "예방 설계 조치 (1문장)",
    "detection_action": "검출/진단 방법 (1문장)",
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
본 시스템은 MORE/LESS/CORRUPT/EARLY/LATE 5종만 사용하며, 가이드라인 Guideword를 다음과 같이 매핑합니다:
  - 가이드라인 Reverse → CORRUPT (값이 반전/비정상 범위)
  - 가이드라인 No / Part of → LESS (신호 없음 또는 부분 수신)
  - 가이드라인 As well as → CORRUPT (예상 외 추가 신호)

| 데이터 타입 | 적용 Guideword | 적용 제외 |
|------------|---------------|----------|
| bool / boolean | CORRUPT | MORE, LESS, EARLY, LATE |
| uint8, uint16, uint32 (unsigned) | MORE, LESS, CORRUPT | EARLY, LATE |
| sint8, sint16, sint32 (signed) | MORE, LESS, CORRUPT | EARLY, LATE |
| float32, float64 | MORE, LESS, CORRUPT | EARLY, LATE |
| enum | MORE, LESS, CORRUPT | EARLY, LATE |
| 통신 신호 — Polling 방식 | MORE, LESS, CORRUPT, EARLY, LATE | 없음 |
| 통신 신호 — Interrupt/Event 방식 | CORRUPT, EARLY, LATE | MORE, LESS |
| 데이터 타입 미지정 (null) | MORE, LESS, CORRUPT, EARLY, LATE | 없음 (전체 검토) |

※ direction 컬럼이 "Output" 또는 "Send"인 경우 → 주로 값 오류(MORE/LESS/CORRUPT) 집중
※ direction 컬럼이 "Input" 또는 "Recv"인 경우 → 타이밍 오류(EARLY/LATE)도 중요하게 검토`

// ── ICD-mode user prompt builder ──────────────────────────────────────────────
function buildIcdUserPrompt(opts: {
  itemName: string
  component: string
  variableTable: string
  referenceTable: string
  specCtx: string
  dbcCtx: string
}): string {
  return `[전달받은 실제 데이터 & 컨텍스트 정보]

■ [CRITICAL] 1. Target 아이템 및 컴포넌트
- 아이템: ${opts.itemName}
- SW 컴포넌트: ${opts.component}
※ 이 컴포넌트의 인터페이스 변수에만 집중하세요.

■ 2. 참조 데이터 (기존 Human FMEA 이력)
${opts.referenceTable}

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
    "failure_mode": "MORE|LESS|CORRUPT|EARLY|LATE 중 하나",
    "failure_detail": "구체적인 고장 내용 (1~2문장, 해당 Guideword가 이 데이터 타입에서 의미하는 바를 반영)",
    "effect_local": "모듈 수준 영향 (1문장)",
    "effect_system": "시스템/차량 수준 영향 (1문장)",
    "potential_cause": "잠재적 원인 (1~2문장, 신호 특성 기반으로 구체적으로)",
    "severity": 숫자(1~10),
    "occurrence": 숫자(1~10),
    "detection": 숫자(1~10),
    "preventive_action": "예방 설계 조치 (1문장)",
    "detection_action": "검출/진단 방법 (1문장)",
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

  const VALID_FM = new Set(['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE'])
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
    potential_cause: string | null; severity: number | null; occurrence: number | null; detection: number | null
    preventive_action: string | null; detection_action: string | null; confidence_score: number
    action_priority: string | null
  }
  function buildRow(it: Record<string, unknown>, idx: number): RowType {
    const s = clamp(it.severity, 1, 10)
    const o = clamp(it.occurrence, 1, 10)
    const d = clamp(it.detection, 1, 10)
    return {
      session_id,
      item_no: String(idx + 1).padStart(4, '0'),
      sw_component: str(it.sw_component),
      function_name: str(it.function_name),
      failure_mode: String(it.failure_mode).toUpperCase(),
      failure_detail: str(it.failure_detail),
      effect_local: str(it.effect_local),
      effect_system: str(it.effect_system),
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
    const filtered = (items as Record<string, unknown>[]).filter(it => VALID_FM.has(String(it.failure_mode ?? '').toUpperCase()))
    for (const it of filtered) {
      allRows.push(buildRow(it, allRows.length))
    }
  }

  // Re-number item_no sequentially
  allRows.forEach((r, i) => { r.item_no = String(i + 1).padStart(4, '0') })

  // Save to DB
  await execute("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [session_id])

  const pool = getPool()
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    for (const row of allRows) {
      await dbClient.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [row.session_id, row.item_no, row.sw_component, row.function_name, row.failure_mode,
         row.failure_detail, row.effect_local, row.effect_system, row.potential_cause,
         row.severity, row.occurrence, row.detection, row.preventive_action,
         row.detection_action, row.confidence_score, row.action_priority],
      )
    }
    await dbClient.query('COMMIT')
  } catch (e) {
    await dbClient.query('ROLLBACK')
    throw e
  } finally {
    dbClient.release()
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
      return handleIcdGenerate(session_id, session, dbcCtx, specCtx, humanItems)
    }

    // 3. 참조 데이터 테이블 구성
    const referenceTable = buildReferenceTable(humanItems)

    // 4. 프롬프트 구성 (itemName은 위에서 이미 선언)
    const userPromptText = buildUserPrompt({ itemName, referenceTable, templateCtx, archCtx, dbcCtx, specCtx })

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
    const VALID_FM = new Set(['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE'])

    const rows = aiItems
      .filter(it => VALID_FM.has(String(it.failure_mode ?? '').toUpperCase()))
      .map((it, idx) => {
        const s = clamp(it.severity, 1, 10)
        const o = clamp(it.occurrence, 1, 10)
        const d = clamp(it.detection, 1, 10)
        return {
          session_id,
          item_no: String(idx + 1).padStart(3, '0'),
          sw_component: str(it.sw_component),
          function_name: str(it.function_name),
          failure_mode: String(it.failure_mode).toUpperCase(),
          failure_detail: str(it.failure_detail),
          effect_local: str(it.effect_local),
          effect_system: str(it.effect_system),
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

    const pool = getPool()
    const dbClient = await pool.connect()
    try {
      await dbClient.query('BEGIN')
      for (const row of rows) {
        await dbClient.query(
          `INSERT INTO pre_fmea_items
           (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
            effect_local, effect_system, potential_cause, severity, occurrence, detection,
            preventive_action, detection_action, confidence_score, action_priority, source, review_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
          [row.session_id, row.item_no, row.sw_component, row.function_name, row.failure_mode,
           row.failure_detail, row.effect_local, row.effect_system, row.potential_cause,
           row.severity, row.occurrence, row.detection, row.preventive_action,
           row.detection_action, row.confidence_score, row.action_priority],
        )
      }
      await dbClient.query('COMMIT')
    } catch (e) {
      await dbClient.query('ROLLBACK')
      throw e
    } finally {
      dbClient.release()
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
