/**
 * Direct FMEA generation script — no Claude API needed.
 * Reads DBC + human FMEA Excel → generates component-level FMEA items → inserts into DB.
 * Usage: npx tsx scripts/generate-fmea-direct.ts <session_id>
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import ExcelJS from 'exceljs'

const SESSION_ID = process.argv[2] ?? '263a3e7c-460a-4a2f-998d-99f079137c3f'
const UPLOAD_DIR = './data/uploads'
const DB_URL     = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db'

// ── DB ────────────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: DB_URL })
async function query(sql: string, params: unknown[] = []) {
  const r = await pool.query(sql, params)
  return r.rows
}

// ── AP Calculator ─────────────────────────────────────────────────────────────
type AP = 'VH' | 'H' | 'M' | 'L'
function calcAP(s: number, o: number, d: number): AP {
  if (s >= 9) {
    if (o >= 6)              return 'VH'
    if (o >= 4) return d >= 6 ? 'VH' : 'H'
    if (o >= 2) return d >= 6 ? 'H'  : 'M'
    return 'L'
  }
  if (s >= 7) {
    if (o >= 6) return d >= 6 ? 'VH' : 'H'
    if (o >= 4) return d >= 6 ? 'H'  : 'M'
    if (o >= 2) return d >= 6 ? 'M'  : 'L'
    return 'L'
  }
  if (s >= 5) {
    if (o >= 6) return d >= 6 ? 'H' : 'M'
    if (o >= 4) return d >= 6 ? 'M' : 'L'
    return 'L'
  }
  return 'L'
}

// ── DBC Parser (SBW-relevant signals only) ────────────────────────────────────
interface SbwSignal {
  msgName: string
  msgId: number
  sender: string
  sigName: string
  length: number
  signed: boolean
  factor: number
  offset: number
  min: number
  max: number
  unit: string
  receivers: string[]
  comment: string | null
  isSbwSender: boolean  // true = SBW sends this signal (Output), false = SBW receives (Input)
}

function parseDbcForSbw(text: string): SbwSignal[] {
  const MSG_RE = /^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/
  const SIG_RE = /^\s+SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([^,]+),([^)]+)\)\s+\[([^|]+)\|([^\]]+)\]\s+"([^"]*)"\s+(.*)/
  const CMT_RE = /^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)"\s*;/

  type Msg = { id: number; name: string; sender: string; signals: Omit<SbwSignal, 'msgName'|'msgId'|'sender'|'isSbwSender'>[] }
  const messages = new Map<number, Msg>()
  const comments = new Map<string, string>()
  let cur: Msg | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const mm = line.match(MSG_RE)
    if (mm) {
      cur = { id: +mm[1], name: mm[2], sender: mm[4], signals: [] }
      messages.set(cur.id, cur)
      continue
    }
    // Match rawLine (not trimmed) so leading spaces are preserved for SIG_RE
    const sm = rawLine.match(SIG_RE)
    if (sm && cur) {
      cur.signals.push({
        sigName:   sm[1],
        length:    +sm[3],
        signed:    sm[5] === '-',
        factor:    parseFloat(sm[6]),
        offset:    parseFloat(sm[7]),
        min:       parseFloat(sm[8]),
        max:       parseFloat(sm[9]),
        unit:      sm[10],
        receivers: sm[11].split(',').map(s => s.trim()).filter(Boolean),
        comment:   null,
      })
      continue
    }
    if (line === '') cur = null
    const cm = line.match(CMT_RE)
    if (cm) comments.set(`${cm[1]}_${cm[2]}`, cm[3].replace(/\\"/g, '"'))
  }

  const result: SbwSignal[] = []
  for (const msg of messages.values()) {
    const isSbwSender = msg.sender === 'SBW'
    for (const sig of msg.signals) {
      const isSbwReceiver = sig.receivers.includes('SBW')
      if (!isSbwSender && !isSbwReceiver) continue
      const comment = comments.get(`${msg.id}_${sig.sigName}`) ?? null
      result.push({
        msgName: msg.name, msgId: msg.id, sender: msg.sender,
        ...sig, comment,
        isSbwSender,
      })
    }
  }
  return result
}

// ── Data type determination ───────────────────────────────────────────────────
function getDataType(sig: SbwSignal): string {
  if (sig.length === 1)       return 'bool'
  if (sig.length <= 8)        return sig.signed ? 'sint8'  : 'uint8'
  if (sig.length <= 16)       return sig.signed ? 'sint16' : 'uint16'
  if (sig.length <= 32)       return sig.signed ? 'sint32' : 'uint32'
  return 'uint64'
}

// ── HAZOP Guidewords by data type ─────────────────────────────────────────────
function getHazopWords(dtype: string, isOutput: boolean): string[] {
  switch (dtype) {
    case 'bool':   return ['CORRUPT']
    case 'uint8': case 'uint16': case 'uint32':
    case 'sint8': case 'sint16': case 'sint32':
    case 'uint64':
      return ['MORE', 'LESS', 'CORRUPT']
    default:
      return isOutput
        ? ['MORE', 'LESS', 'CORRUPT']
        : ['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE']
  }
}

// ── Reference patterns from human FMEA ───────────────────────────────────────
interface HumanRef {
  sw_component: string
  failure_mode: string
  severity: number
  occurrence: number
  detection: number
  failure_detail: string
}

async function loadHumanFmeaRefs(xlsxPath: string): Promise<HumanRef[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fs.readFileSync(xlsxPath) as any)

  const refs: HumanRef[] = []
  for (const ws of wb.worksheets) {
    if (ws.rowCount < 3) continue

    // Find header row
    let headerRow = -1
    let colMap: Record<string, number> = {}
    for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
      const row = ws.getRow(r)
      const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(v => String(v ?? '').toLowerCase())
      if (vals.some(v => v.includes('failure') || v.includes('고장') || v.includes('mode'))) {
        headerRow = r
        vals.forEach((v, i) => {
          if (v.includes('component') || v.includes('컴포넌트') || v.includes('sw_comp')) colMap['sw_component'] = i + 1
          if ((v.includes('failure') && v.includes('mode')) || v === '고장 모드' || v === 'failure_mode') colMap['failure_mode'] = i + 1
          if (v.includes('severity') || v === 's' || v === '심각도') colMap['severity'] = i + 1
          if (v.includes('occurrence') || v === 'o' || v === '발생도') colMap['occurrence'] = i + 1
          if (v.includes('detection') || v === 'd' || v === '검출도') colMap['detection'] = i + 1
          if (v.includes('detail') || v.includes('상세') || v.includes('failure_detail')) colMap['failure_detail'] = i + 1
        })
        break
      }
    }
    if (headerRow < 0 || !colMap['sw_component']) continue

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const get = (col: number | undefined) => col ? String(row.getCell(col).value ?? '').trim() : ''
      const sw = get(colMap['sw_component'])
      const fm = get(colMap['failure_mode'])
      const s  = parseFloat(get(colMap['severity']))
      const o  = parseFloat(get(colMap['occurrence']))
      const d  = parseFloat(get(colMap['detection']))
      if (!sw || !fm) continue
      refs.push({
        sw_component: sw,
        failure_mode: fm.toUpperCase(),
        severity:    isFinite(s) ? Math.round(s) : 7,
        occurrence:  isFinite(o) ? Math.round(o) : 4,
        detection:   isFinite(d) ? Math.round(d) : 5,
        failure_detail: get(colMap['failure_detail']),
      })
    }
    if (refs.length > 0) break
  }
  return refs
}

// SOD defaults by HAZOP + signal context
function getDefaultSod(
  hazop: string,
  dtype: string,
  isOutput: boolean,
  humanRefs: HumanRef[],
  sigName: string,
): { s: number; o: number; d: number } {
  // Look for matching human ref
  const upperSig = sigName.toUpperCase()
  const ref = humanRefs.find(r =>
    r.failure_mode === hazop ||
    r.failure_detail?.toUpperCase().includes(upperSig.slice(0, 6))
  )
  if (ref?.severity && ref.occurrence && ref.detection) {
    return { s: ref.severity, o: ref.occurrence, d: ref.detection }
  }

  // Heuristic defaults for SBW domain
  const isTiming = hazop === 'EARLY' || hazop === 'LATE'
  const isValue  = hazop === 'MORE' || hazop === 'LESS'
  const isCorrupt = hazop === 'CORRUPT'

  // SBW 핵심 신호 패턴
  const isCritical = /SBW_(Gear|Park|Target|Actu|Shift|Lever|Pos|Pos|Req|Sta)/i.test(sigName)
  const isCrc = /Crc|AlvCnt|E2E/i.test(sigName)
  const isVehSpd = /VehSpd|Speed|Spd/i.test(sigName)
  const isGear = /Gear|TCU_Gear|HTCU_Gear/i.test(sigName)

  if (isCrc) {
    // E2E/CRC 오류는 CORRUPT - 중간 심각도
    return { s: 7, o: 3, d: 4 }
  }
  if (isCritical && isOutput) {
    if (isCorrupt)    return { s: 9, o: 3, d: 4 }
    if (isValue)      return { s: 8, o: 3, d: 5 }
    return               { s: 7, o: 3, d: 5 }
  }
  if (isGear) {
    if (isCorrupt)    return { s: 8, o: 3, d: 4 }
    if (isValue)      return { s: 7, o: 4, d: 5 }
    if (isTiming)     return { s: 7, o: 3, d: 5 }
    return               { s: 7, o: 3, d: 5 }
  }
  if (isVehSpd) {
    if (isValue)      return { s: 7, o: 3, d: 4 }
    if (isTiming)     return { s: 6, o: 3, d: 5 }
    return               { s: 6, o: 3, d: 5 }
  }
  if (dtype === 'bool') {
    return isOutput ? { s: 7, o: 3, d: 5 } : { s: 6, o: 3, d: 5 }
  }
  if (isTiming) return { s: 6, o: 3, d: 5 }
  if (isCorrupt) return { s: 6, o: 3, d: 5 }
  return { s: 5, o: 3, d: 5 }
}

// Generate FMEA text descriptions
function buildFmeaItem(sig: SbwSignal, hazop: string, humanRefs: HumanRef[]): Record<string, unknown> {
  const dtype = getDataType(sig)
  const isOutput = sig.isSbwSender
  const direction = isOutput ? 'SBW → 외부 ECU' : `${sig.sender} → SBW`
  const rangeStr  = (sig.min !== 0 || sig.max !== 0)
    ? `${sig.min * sig.factor + sig.offset}~${sig.max * sig.factor + sig.offset}${sig.unit ? ' ' + sig.unit : ''}`
    : `${dtype}`

  const { s, o, d } = getDefaultSod(hazop, dtype, isOutput, humanRefs, sig.sigName)

  // SW 컴포넌트명: 메시지 이름 기반
  const sw_component = sig.isSbwSender ? 'SBW 송신 처리' : `SBW 수신 처리 (${sig.msgName})`

  let failure_detail: string
  let effect_local: string
  let effect_system: string
  let potential_cause: string
  let preventive_action: string
  let detection_action: string

  const sigDesc = sig.comment ? `(${sig.comment})` : ''
  const sigInfo = `${sig.sigName}${sigDesc} [${rangeStr}]`

  switch (hazop) {
    case 'MORE':
      failure_detail = `${sigInfo} 신호값이 정상 범위를 초과하여 송출됨`
      effect_local   = isOutput ? 'SBW 출력 신호 과도값으로 수신 ECU 오판단 유발' : '과도한 입력값으로 SBW 내부 제어 로직 오동작'
      effect_system  = isOutput ? '외부 ECU에 잘못된 상태 정보 전달 → 시스템 제어 불일치' : '잘못된 입력으로 SBW 변속 제어 오류'
      potential_cause = `소프트웨어 연산 오류 또는 센서/액추에이터 포화로 인해 ${sig.sigName} 값이 최대 범위(${sig.max})를 초과`
      preventive_action = '입력/출력 값 범위 검증 로직(Range Check) 및 클램핑 처리 적용'
      detection_action  = '범위 초과 감지 DTC 설정 및 Unit Test 경계값 검증'
      break
    case 'LESS':
      failure_detail = `${sigInfo} 신호값이 정상 범위 미만으로 송출됨`
      effect_local   = isOutput ? 'SBW 출력 신호 과소값으로 수신 ECU 제어 부족' : '낮은 입력값으로 SBW 제어 응답 부족'
      effect_system  = isOutput ? '수신 ECU가 필요 제어량 미달 → 기능 부분 손실' : 'SBW 변속 제어 부족으로 운전자 의도 미반영'
      potential_cause = `센서 고장, 신호선 접촉불량 또는 SW 연산 오류로 ${sig.sigName} 값이 최솟값(${sig.min}) 미만으로 하강`
      preventive_action = '최솟값 경계 클램핑 및 센서 플라우시빌리티 체크 적용'
      detection_action  = '하한 범위 감지 DTC 및 응답 모니터링 로직 적용'
      break
    case 'CORRUPT':
      if (/Crc|AlvCnt|E2E/i.test(sig.sigName)) {
        failure_detail = `${sigInfo} E2E/CRC 보호 신호의 값이 불일치 또는 변조됨`
        effect_local   = 'E2E 검증 실패로 해당 메시지 수신 무효화'
        effect_system  = '메시지 무효화로 SBW 제어 기능 일시 중단 또는 Fallback 진입'
        potential_cause = `전기적 노이즈, 버스 충돌, 또는 ECU 내부 메모리 오류로 CRC/AlvCnt 값 오염`
        preventive_action = 'E2E Profile 2 프로토콜 적용 및 CRC 계산 모듈 코드 리뷰'
        detection_action  = 'E2E 라이브러리 오류 카운터 DTC 및 롤링카운터 불일치 감지'
      } else if (dtype === 'bool') {
        failure_detail = `${sigInfo} bool 신호가 정상 상태(0 또는 1) 외의 값 또는 반전된 값으로 수신됨`
        effect_local   = 'SBW 상태 판단 로직에 잘못된 플래그 입력'
        effect_system  = isOutput ? '수신 ECU에 잘못된 상태 전달 → 불필요한 제어 조치' : 'SBW 제어 조건 오판단으로 의도치 않은 변속'
        potential_cause = `EMI/노이즈로 인한 비트 반전 또는 ECU 내부 상태 머신 오류`
        preventive_action = '중복 플래그 검증 및 상태 머신 트랜지션 Plausibility 체크'
        detection_action  = '상태값 이중화 비교 및 유효 범위 검증 DTC'
      } else {
        failure_detail = `${sigInfo} 신호값이 물리적으로 불가능한 값 또는 비정상 패턴으로 수신됨`
        effect_local   = '비정상 입력에 의한 SW 컴포넌트 이상 동작 또는 예외 상태 진입'
        effect_system  = isOutput ? '외부 ECU에 무효 데이터 전달 → 시스템 안전 모드 진입' : 'SBW 제어 오류로 기어 포지션 불일치'
        potential_cause = `전기적 노이즈, 신호 간섭 또는 송신 ECU 내부 소프트웨어 버그로 물리적으로 불가능한 값 발생`
        preventive_action = '플라우시빌리티 체크 및 신호 필터링 알고리즘 적용'
        detection_action  = '이상값 감지 DTC 및 연속 비교 모니터링 적용'
      }
      break
    case 'EARLY':
      failure_detail = `${sigInfo} 신호가 예정된 주기보다 이른 시점에 수신됨`
      effect_local   = '예상 시점보다 빠른 신호 처리로 SBW 순서 제어 오류'
      effect_system  = '타이밍 의존 제어 로직 오동작으로 변속 시퀀스 불일치'
      potential_cause = 'CAN 버스 타이밍 편차 또는 송신 ECU 스케줄링 이상으로 전송 주기 선행 발생'
      preventive_action = '수신 윈도우 타이밍 검증 및 메시지 타임스탬프 유효성 체크 적용'
      detection_action  = '롤링카운터 기반 메시지 순서 검증 및 수신 주기 모니터링'
      break
    case 'LATE':
      failure_detail = `${sigInfo} 신호가 예정된 주기를 초과하여 지연 수신됨`
      effect_local   = '제어 주기 내 신호 미수신으로 직전 값 유지 또는 디폴트 처리'
      effect_system  = '지연된 신호로 인한 SBW 제어 지연 및 운전자 응답성 저하'
      potential_cause = 'CAN 버스 과부하, ECU 처리 지연, 또는 게이트웨이 버퍼링으로 인한 전송 지연'
      preventive_action = '메시지 타임아웃 감시(Supervision) 및 최대 허용 지연시간 정의'
      detection_action  = '수신 타임아웃 DTC 설정 및 메시지 부재 시 Fallback 처리 검증'
      break
    default:
      failure_detail = `${sig.sigName} 신호 이상`
      effect_local = effect_system = potential_cause = preventive_action = detection_action = '-'
  }

  return {
    sw_component,
    function_name: sig.sigName,
    failure_mode:  hazop,
    failure_detail,
    effect_local,
    effect_system,
    potential_cause,
    severity:    s,
    occurrence:  o,
    detection:   d,
    rpn:         s * o * d,
    preventive_action,
    detection_action,
    confidence_score: 0.7,
    action_priority: calcAP(s, o, d),
    source: 'ai' as const,
    review_status: 'pending' as const,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ Direct FMEA generation for session: ${SESSION_ID}`)

  // Load DBC
  const sessionDir = path.join(UPLOAD_DIR, SESSION_ID)
  const dbcDir = path.join(sessionDir, 'dbc_file')
  const dbcFiles = fs.existsSync(dbcDir) ? fs.readdirSync(dbcDir) : []
  if (!dbcFiles.length) { console.error('❌ DBC 파일이 없습니다.'); process.exit(1) }
  const dbcText = fs.readFileSync(path.join(dbcDir, dbcFiles[0]), 'utf-8')
  console.log(`✅ DBC loaded: ${dbcFiles[0]}`)

  const sbwSignals = parseDbcForSbw(dbcText)
  console.log(`✅ SBW signals parsed: ${sbwSignals.length}개`)

  // Load human FMEA refs
  const humanDir = path.join(sessionDir, 'human_fmea')
  const humanFiles = fs.existsSync(humanDir) ? fs.readdirSync(humanDir) : []
  let humanRefs: HumanRef[] = []
  if (humanFiles.length) {
    humanRefs = await loadHumanFmeaRefs(path.join(humanDir, humanFiles[0]))
    console.log(`✅ Human FMEA refs: ${humanRefs.length}개`)
  } else {
    console.log('⚠️  Human FMEA 없음 — 기본값 사용')
  }

  // Generate FMEA items
  const allItems: Record<string, unknown>[] = []
  for (const sig of sbwSignals) {
    const dtype  = getDataType(sig)
    const isOut  = sig.isSbwSender
    const hazops = getHazopWords(dtype, isOut)

    // Skip purely CRC/CCP byte signals (no semantic)
    if (/CCP_REQ_Byte|CCP_RESP_Byte|GST_SBW_Byte/.test(sig.sigName)) continue

    for (const hazop of hazops) {
      allItems.push(buildFmeaItem(sig, hazop, humanRefs))
    }
  }

  // Re-number
  allItems.forEach((item, i) => { item.item_no = String(i + 1).padStart(4, '0') })
  console.log(`✅ Generated ${allItems.length}개 FMEA 항목`)

  // Show preview
  const preview = allItems.slice(0, 5)
  console.log('\n[Preview — 첫 5개]')
  for (const it of preview) {
    console.log(`  ${it.item_no}. [${it.failure_mode}] ${it.function_name} | SW: ${String(it.sw_component).slice(0,30)} | S${it.severity}/O${it.occurrence}/D${it.detection} AP=${it.action_priority}`)
  }

  // Insert to DB
  const client = await pool.connect()
  try {
    await client.query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [SESSION_ID])
    await client.query('BEGIN')
    for (const row of allItems) {
      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [SESSION_ID, row.item_no, row.sw_component, row.function_name, row.failure_mode,
         row.failure_detail, row.effect_local, row.effect_system, row.potential_cause,
         row.severity, row.occurrence, row.detection,
         row.preventive_action, row.detection_action, row.confidence_score, row.action_priority],
      )
    }
    await client.query('COMMIT')
    console.log(`\n✅ DB 삽입 완료: ${allItems.length}개`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  // Update session status
  await query(
    "UPDATE pre_fmea_sessions SET status = 'generated', updated_at = now() WHERE id = $1",
    [SESSION_ID],
  )

  // AP distribution summary
  const dist: Record<string, number> = {}
  for (const it of allItems) {
    const ap = String(it.action_priority ?? 'null')
    dist[ap] = (dist[ap] ?? 0) + 1
  }
  console.log('\n[AP 분포]')
  for (const [ap, cnt] of Object.entries(dist).sort()) {
    console.log(`  ${ap}: ${cnt}개`)
  }

  await pool.end()
  console.log('\n✅ 완료!')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
