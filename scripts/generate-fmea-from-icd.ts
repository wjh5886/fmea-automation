/**
 * ICD-based FMEA generation (no Claude API).
 * Reads pre_fmea_icd_variables (extracted from architecture docs + DBC),
 * applies HAZOP rules, and generates component-function-integrated FMEA items.
 *
 * Key difference from signal-only approach:
 *   - FMEA subject = SW Component receiving the signal
 *   - Failure context = "Component X's function fails because input Y has guideword Z"
 *   - Cross-component: SW_INTERNAL signals trace failure propagation paths
 */
import pg from 'pg'

const SESSION_ID = process.argv[2] ?? '263a3e7c-460a-4a2f-998d-99f079137c3f'
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db'
const pool = new pg.Pool({ connectionString: DB_URL })

// ── AP Matrix ─────────────────────────────────────────────────────────────────
type AP = 'VH' | 'H' | 'M' | 'L'
function calcAP(s: number, o: number, d: number): AP {
  // AIAG-VDA 2019 AP Matrix
  if (s >= 9) {
    if (o >= 6) return 'VH'
    if (o >= 4) return d >= 4 ? 'VH' : 'H'
    if (o >= 2) return 'H'        // S≥9, O=2-3 → H regardless of D
    return 'L'
  }
  if (s >= 7) {
    if (o >= 6) return 'VH'
    if (o >= 4) return d >= 7 ? 'VH' : 'H'
    if (o >= 3) return d >= 4 ? 'H' : 'M'
    if (o >= 2) return d >= 7 ? 'H' : 'M'
    return 'L'
  }
  if (s >= 5) {
    if (o >= 6) return d >= 7 ? 'H' : 'M'
    if (o >= 4) return d >= 7 ? 'H' : 'M'
    if (o >= 3) return d >= 4 ? 'M' : 'L'
    return 'L'
  }
  return 'L'
}

// ── Component safety context ───────────────────────────────────────────────────
interface CompCtx {
  baseSeverity: number    // baseline severity for safety-critical failures
  function: string        // what this component does (Korean)
  systemEffect: string    // vehicle-level failure effect (Korean)
}

const COMP_CTX: Record<string, CompCtx> = {
  'CstAp_PwrMGT':          { baseSeverity: 8, function: '전원 전압 감시 및 ECU 전원 상태 관리', systemEffect: '저전압/과전압 보호 미동작으로 ECU 및 액추에이터 손상, SBW 기능 상실' },
  'CstAp_CANMGT':          { baseSeverity: 8, function: 'CAN 신호 수신/배포 및 기어 명령 처리', systemEffect: '잘못된 기어 명령 또는 신호 손실로 SBW 변속 오류' },
  'CstAp_ECUModeMgt':      { baseSeverity: 7, function: 'ECU 동작 모드 전환 제어 (Normal/Sleep/Wakeup)', systemEffect: '모드 전환 오류로 SBW 기능 불완전 활성화 또는 변속 중 Sleep 진입' },
  'CstAp_ButtonMgt':       { baseSeverity: 9, function: '변속 버튼 입력 감지 및 기어 명령 생성', systemEffect: '운전자 의도와 다른 기어 명령으로 의도치 않은 변속 또는 변속 불가' },
  'CstAp_HapticControlMgt':{ baseSeverity: 5, function: '변속 조작 촉각 피드백 제어', systemEffect: '햅틱 오동작으로 운전자 오인지, 직접 안전 영향 없음' },
  'CstAp_MotorControlMgt': { baseSeverity: 9, function: '다이얼/스피어 모터 구동 위치 제어', systemEffect: '모터 오동작으로 레버 목표 위치 미도달 또는 기구부 충돌, SBW 기능 상실' },
  'CstAp_PosMgt':          { baseSeverity: 10, function: '이중화 위치 센서 기반 기어 포지션 판정 (ASIL B)', systemEffect: '잘못된 기어 포지션 판정으로 의도치 않은 기어 변속 실행 (ASIL B 위반)' },
  'CstAp_MovingMgt':       { baseSeverity: 9, function: '레버 이동 완료 감지 (이중화 센서)', systemEffect: '이동 미완료 상태의 조기 완료 판정으로 레버 중간 위치 고착' },
  'CstAp_MoodControlMgt':  { baseSeverity: 3, function: '무드램프 색상/밝기 제어', systemEffect: '조명 오동작, 직접 안전 영향 없음' },
  'CstAp_DtcMgt':          { baseSeverity: 6, function: 'DTC 기록 및 진단 이력 관리', systemEffect: '안전 관련 고장 DTC 미기록으로 고장 추적 불가' },
  'CstAp_IdtMgt':          { baseSeverity: 4, function: 'PRND 인디케이터/조명 PWM 제어', systemEffect: '기어 상태 표시 오류로 운전자 기어 오인지 가능성' },
  'CstAp_DIDMgt':          { baseSeverity: 5, function: 'DID 데이터 읽기/쓰기 처리', systemEffect: '차량 옵션 설정값 오류로 SBW 특수 기능 불일치' },
  'CstAp_VehicleReset_Mgt':{ baseSeverity: 7, function: '차량 리셋 조건 감지 및 ECU 리셋 제어', systemEffect: '불필요한 ECU 리셋 또는 필요한 리셋 미수행으로 SBW 상태 오염' },
  'BswIF_CAN':             { baseSeverity: 9, function: 'CAN 메시지 송수신 및 E2E 보호 처리', systemEffect: 'E2E 검증 실패 시 오염된 기어 명령 처리로 의도치 않은 변속' },
  'BswIF_ECUModeCntl':     { baseSeverity: 6, function: 'ComM 통신 모드 및 DEM 진단 주기 관리', systemEffect: 'CAN 통신 비활성화 또는 DTC 주기 오류로 초기 기어 명령 손실' },
  'BswIF_IoHwAb':          { baseSeverity: 8, function: 'ADC/디지털 I/O 하드웨어 추상화 계층', systemEffect: '센서값 0 전달 또는 디지털 신호 반전으로 CstAp_PosMgt/PwrMGT 오판단' },
  'BswIF_Nvm':             { baseSeverity: 5, function: 'EEPROM 비휘발성 데이터 읽기/쓰기', systemEffect: 'NvM 오류로 부팅 시 잘못된 설정값 로딩' },
  'BswIF_Sbc':             { baseSeverity: 8, function: 'SBC 칩 Watchdog 트리거 및 전원 관리', systemEffect: 'WDG 트리거 실패로 SBC가 ECU 리셋 실행, 변속 중 기능 중단' },
  'BswIF_WdgM':            { baseSeverity: 8, function: '소프트웨어 워치독 체크포인트 감시', systemEffect: 'SW 실행 흐름 오류 감지 시 ECU 리셋으로 변속 중 기능 중단' },
  'BswIF_SafetyLib':       { baseSeverity: 9, function: '메모리 무결성/ECC 오류 감지', systemEffect: '메모리 변조 미감지로 ASIL B 위치 임계값 오염, 기어 포지션 판정 오류' },
  'BswIF_Dcm_19_RDTCI':    { baseSeverity: 5, function: 'DTC 읽기 서비스 (UDS 0x19)', systemEffect: 'DTC 오설정으로 잘못된 고장 진단' },
  'BswIF_Dcm_22_2E_RWDID': { baseSeverity: 5, function: 'DID 읽기/쓰기 서비스 (UDS 0x22/0x2E)', systemEffect: '차량 설정 DID 오류로 SBW 동작 파라미터 불일치' },
  'BswIF_Dcm_27_SA':       { baseSeverity: 8, function: '보안 접근 인증 (UDS 0x27)', systemEffect: '인증 우회로 무단 ECU 캘리브레이션 변경 가능' },
  'BswIF_Dcm_28_CC':       { baseSeverity: 5, function: '통신 제어 서비스 (UDS 0x28)', systemEffect: '진단 중 의도치 않은 CAN 송수신으로 타 ECU 반응 유발' },
  'BswIF_Dcm_31_RC':       { baseSeverity: 8, function: '루틴 제어/Secure Boot 검증 (UDS 0x31)', systemEffect: 'Secure Boot 검증 실패로 변조된 SW 실행 가능' },
}

const DEFAULT_CTX: CompCtx = {
  baseSeverity: 5,
  function: 'SW 컴포넌트 기능 처리',
  systemEffect: 'SW 컴포넌트 오동작으로 SBW 기능 부분 영향',
}

// ── HAZOP rules by variable_type and data_type ─────────────────────────────────
function getHazopWords(varType: string, dataType: string, description: string): string[] {
  const isPolling = description.includes('polling') || description.includes('ms)')
  const isBool    = dataType === 'bool' || dataType === 'boolean'
  const isEnum    = dataType === 'enum' || /Sta$|State$|Mode$/i.test(dataType)

  if (varType === 'CAN_RX' || varType === 'CAN_TX') {
    if (isBool)    return ['CORRUPT']
    if (isPolling) return ['MORE', 'LESS', 'CORRUPT', 'LATE']  // polling → timing matters
    return ['MORE', 'LESS', 'CORRUPT']
  }
  if (varType === 'HW_INPUT') {
    if (isBool) return ['CORRUPT']
    return ['MORE', 'LESS', 'CORRUPT']
  }
  if (varType === 'SW_INTERNAL') {
    if (isBool || isEnum) return ['CORRUPT']
    return ['MORE', 'LESS', 'CORRUPT']
  }
  return ['MORE', 'LESS', 'CORRUPT']
}

// ── Parse DBC context from description field ───────────────────────────────────
function parseMeta(desc: string): { msgName: string; sender: string; periodMs: number | null } {
  const msgMatch = desc.match(/\[DBC:\s*([^,]+),\s*sender=(\w+)\]/)
  const perMatch = desc.match(/Period:\s*(\d+)ms/)
  return {
    msgName:  msgMatch?.[1]?.trim() ?? '',
    sender:   msgMatch?.[2]?.trim() ?? '',
    periodMs: perMatch ? +perMatch[1] : null,
  }
}

// ── Failure text builder ───────────────────────────────────────────────────────
interface IcdVar {
  sw_component: string; variable_name: string; variable_type: string
  direction: string; data_type: string; signal_range: string
  unit: string; description: string
}

function buildFailureText(v: IcdVar, hazop: string, ctx: CompCtx): {
  function_name: string; failure_detail: string; effect_local: string
  effect_system: string; potential_cause: string
  preventive_action: string; detection_action: string
} {
  const meta   = parseMeta(v.description)
  const signal = v.variable_name
  const comp   = v.sw_component
  const dtype  = v.data_type
  const range  = v.signal_range && v.signal_range !== '-' ? ` [${v.signal_range}]` : ''
  const period = meta.periodMs ? ` (${meta.periodMs}ms 주기)` : ''
  const src    = meta.sender   ? `${meta.sender}` : (v.description.match(/BswIF_\w+|CstAp_\w+/)?.[0] ?? '외부 ECU')
  const isCanRx = v.variable_type === 'CAN_RX'
  const isHwIn  = v.variable_type === 'HW_INPUT'
  const isSw    = v.variable_type === 'SW_INTERNAL'
  const hasDbc  = v.description.includes('[DBC:')

  // function_name
  let function_name: string
  if (isCanRx && meta.msgName)
    function_name = `CAN 수신: ${signal}${period} — ${meta.msgName} (from ${src})`
  else if (isHwIn)
    function_name = `HW 입력: ${signal}${range} — BswIF_IoHwAb→${comp}`
  else if (isSw)
    function_name = `SW 인터페이스: ${signal} — ${src}→${comp}`
  else
    function_name = `CAN 송신: ${signal} — ${comp}→외부`

  let failure_detail: string, effect_local: string, effect_system: string
  let potential_cause: string, preventive_action: string, detection_action: string

  switch (hazop) {
    case 'CORRUPT':
      if (dtype === 'bool') {
        failure_detail    = `${signal} 신호 값이 반전(0↔1) 또는 비정상 상태로 ${comp}에 수신됨`
        effect_local      = `${comp}의 ${ctx.function} 중 ${signal} 기반 분기 로직이 반대 조건으로 실행됨`
        potential_cause   = isCanRx
          ? `CAN 버스 비트 오류 또는 ${src} ECU SW 버그로 ${signal} 플래그 반전 송출`
          : isHwIn ? `HW 핀 노이즈 또는 Active High/Low 논리 설정 오류로 신호 반전`
          : `${src} 컴포넌트의 상태 플래그 변수 오초기화 또는 경쟁 조건(race condition)`
        preventive_action = `${signal} 수신 후 Plausibility 체크 및 이중 변수 교차 검증 적용`
        detection_action  = `${signal} 비정상 전환 감지 DTC 및 연속 2회 확인 후 처리`
      } else {
        failure_detail    = `${signal}${range} 신호가 물리적으로 불가능한 값 또는 비정상 패턴으로 ${comp}에 수신됨`
        effect_local      = `${comp}의 ${ctx.function} 로직에 비정상 입력으로 제어 오동작`
        potential_cause   = isCanRx
          ? `CAN 프레임 비트 오류 또는 ${src} ECU SW 버그로 ${signal} 물리값 범위 초과 송출`
          : isHwIn ? `센서 전원 이상 또는 ADC 기준 전압 변동으로 ${signal} 비정상값 측정`
          : `${src}의 ${signal} 연산 오류 또는 변수 타입 오버플로우`
        preventive_action = `${signal} 수신값 물리 범위 검증(Plausibility Check) 후 범위 외 시 이전 유효값 유지`
        detection_action  = `${signal} 범위 초과 DTC 즉시 설정 및 직전 유효값 Hold 로직 구현`
      }
      effect_system = ctx.systemEffect
      break

    case 'MORE':
      failure_detail    = `${signal}${range} 신호값이 정상 최대 범위를 초과하여 ${comp}에 전달됨`
      effect_local      = `${comp}의 ${ctx.function} 로직이 과도한 입력값으로 오동작 또는 포화 상태 진입`
      effect_system     = ctx.systemEffect
      potential_cause   = isCanRx
        ? `${src} ECU의 ${signal} 연산 오버플로우 또는 센서 포화로 최대 범위 초과 값 송출`
        : isHwIn ? `센서 전원 과전압 또는 ADC 채널 이상으로 측정값이 최대 범위(${v.signal_range}) 초과`
        : `${src}에서 ${signal} 계산 시 상한 클램핑 미적용으로 오버플로우 값 전달`
      preventive_action = `${signal} 수신값 상한 클램핑 및 Range Check 로직 필수 구현`
      detection_action  = `${signal} 상한 초과 감지 DTC 및 Unit Test 경계값(max+1) 검증`
      break

    case 'LESS':
      failure_detail    = `${signal}${range} 신호값이 정상 최솟값 미만으로 ${comp}에 전달됨`
      effect_local      = `${comp}의 ${ctx.function} 로직이 부족한 입력값으로 제어 응답 부족`
      effect_system     = ctx.systemEffect
      potential_cause   = isCanRx
        ? `${src} ECU의 ${signal} 산출 오류 또는 신호선 접촉불량으로 최솟값 미만 송출`
        : isHwIn ? `센서 전원 저하 또는 배선 단선으로 ${signal} ADC 측정값이 하한(${v.signal_range}) 미만`
        : `${src}에서 ${signal} 초기화 오류 또는 클리어 조건 미충족으로 0 또는 하한 미만 값 전달`
      preventive_action = `${signal} 수신값 하한 클램핑 및 센서/신호원 Plausibility 병렬 확인`
      detection_action  = `${signal} 하한 이탈 DTC 설정 및 대체값(Hold/Default) 적용 로직 검증`
      break

    case 'LATE':
      failure_detail    = `${signal}${period} CAN 신호가 주기 타임아웃(>${(meta.periodMs ?? 20) * 3}ms) 초과하여 ${comp}에 미수신`
      effect_local      = `${comp}의 ${ctx.function} 로직이 ${signal} 직전 유효값 유지 또는 타임아웃 기본값으로 동작`
      effect_system     = `${signal} 타임아웃 상태에서 ${comp} 제어 지연 및 기능 저하: ${ctx.systemEffect}`
      potential_cause   = `CAN 버스 과부하, ${src} ECU 처리 지연, 또는 게이트웨이(CGW) 버퍼링으로 ${signal} 전송 주기 초과`
      preventive_action = `${signal} 타임아웃 임계값을 주기의 3배로 설정 및 타임아웃 시 안전 기본값 적용`
      detection_action  = `${signal} 수신 타임아웃 DTC 설정 및 타임아웃 카운터 NvM 기록`
      break

    case 'EARLY':
      failure_detail    = `${signal}${period} CAN 신호가 예정 주기보다 이른 시점에 ${comp}에 수신됨`
      effect_local      = `${comp}의 ${ctx.function} 로직이 동일 주기에 중복 처리 또는 이전 처리 덮어쓰기`
      effect_system     = `${signal} 조기 수신으로 ${comp} 타이밍 의존 제어 로직 오동작`
      potential_cause   = `CAN 버스 타이밍 편차 또는 ${src} ECU 스케줄링 이상으로 전송 주기 선행`
      preventive_action = `수신 윈도우 타이밍 검증(주기 50% 이내 수신 시 무효화) 및 롤링카운터 시퀀스 검증`
      detection_action  = `AlvCnt 시퀀스 오류 감지 DTC 및 수신 주기 이탈 감지`
      break

    default:
      failure_detail = effect_local = effect_system = potential_cause = preventive_action = detection_action = '-'
  }

  return { function_name, failure_detail, effect_local, effect_system, potential_cause, preventive_action, detection_action }
}

// ── SOD by component + signal type + hazop ────────────────────────────────────
function getSod(v: IcdVar, hazop: string, ctx: CompCtx): { s: number; o: number; d: number } {
  const s  = ctx.baseSeverity
  const meta = parseMeta(v.description)
  const hasDbc   = v.description.includes('[DBC:')
  const isE2E    = /Crc|AlvCnt|E2E/i.test(v.variable_name)
  const isTimeout = /Timeout$|_To$/i.test(v.variable_name)
  const isCanRx  = v.variable_type === 'CAN_RX'
  const isHwIn   = v.variable_type === 'HW_INPUT'
  const isBool   = v.data_type === 'bool'

  // Occurrence
  let o = 3  // default: rare
  if (isCanRx && meta.periodMs && meta.periodMs <= 50)  o = 4  // fast CAN: more EMI exposure
  if (isHwIn)  o = 3
  if (isE2E)   o = 2  // E2E protected, lower probability
  if (isTimeout) o = 3

  // Detection
  let d = 4  // default: moderate
  if (isE2E)         d = 2  // E2E errors immediately detected
  if (isTimeout)     d = 3  // timeout flags detectable
  if (isHwIn && !isBool) d = 4  // ADC plausibility
  if (hazop === 'LATE' || hazop === 'EARLY') d = 3  // timing issues have supervision
  if (hazop === 'CORRUPT' && !hasDbc)        d = 5  // no DBC = no E2E context

  // Special overrides for safety-critical
  if (ctx.baseSeverity >= 9 && hazop === 'CORRUPT') { o = Math.min(o, 4); d = Math.min(d, 4) }
  if (ctx.baseSeverity <= 3) { o = 3; d = 5 }  // comfort signals

  return { s, o, d }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ ICD 기반 통합 분석 FMEA 생성 (API 없이)`)
  console.log(`  세션: ${SESSION_ID}`)

  // Load ICD variables — focus on Input direction (failures that affect the component)
  // Include both CAN_RX/HW_INPUT (external inputs) and key SW_INTERNAL inputs
  const icdVars = (await pool.query(`
    SELECT sw_component, variable_name, variable_type, direction,
           data_type, signal_range, unit, description
    FROM pre_fmea_icd_variables
    WHERE session_id = $1
      AND direction = 'Input'
      AND sw_component NOT IN ('COM', 'BswIF_Dcm_10_DSC', 'BswIF_Dcm_14_CDTCI',
                                'BswIF_Dcm_85_CDTCS', 'BswIF_Dcm_Service',
                                'CstAp_DIDMgtCstAp_DtcMgt', 'CstAP_DtcMgt',
                                'CstAp_CANMgt', 'CstAp_MoodCntlMgt', 'BswIF_EcuModeCntl')
    ORDER BY sw_component, variable_type, variable_name
  `, [SESSION_ID])).rows as IcdVar[]

  console.log(`✅ ICD 입력 변수 로드: ${icdVars.length}개`)

  // Also load key Output variables for CAN TX (SBW sends wrong values)
  const txVars = (await pool.query(`
    SELECT sw_component, variable_name, variable_type, direction,
           data_type, signal_range, unit, description
    FROM pre_fmea_icd_variables
    WHERE session_id = $1
      AND direction = 'Output'
      AND variable_type IN ('CAN_TX', 'HW_OUTPUT')
      AND sw_component IN ('BswIF_CAN', 'BswIF_IoHwAb', 'CstAp_CANMGT')
    ORDER BY sw_component, variable_name
  `, [SESSION_ID])).rows as IcdVar[]

  console.log(`✅ ICD 출력 변수 로드 (CAN TX): ${txVars.length}개`)

  const allVars = [...icdVars, ...txVars]

  // ── Generate FMEA items ──────────────────────────────────────────────────────
  interface FmeaRow {
    sw_component: string; function_name: string; failure_mode: string
    failure_detail: string; effect_local: string; effect_system: string
    potential_cause: string; severity: number; occurrence: number; detection: number
    preventive_action: string; detection_action: string; confidence_score: number
  }

  const rows: FmeaRow[] = []
  const seen = new Set<string>()

  for (const v of allVars) {
    const ctx    = COMP_CTX[v.sw_component] ?? DEFAULT_CTX
    const hazops = getHazopWords(v.variable_type, v.data_type, v.description)

    // Skip pure E2E/timeout signals from ICD vars that already appear in signal-level analysis
    // But keep if they have DBC match (more meaningful)
    const isMinor = /Timeout$|_To$/.test(v.variable_name) && !v.description.includes('[DBC:')

    for (const hazop of hazops) {
      if (isMinor && hazop !== 'CORRUPT') continue  // timeout signals: CORRUPT only

      const dedup = `${v.sw_component}|${v.variable_name}|${hazop}`
      if (seen.has(dedup)) continue
      seen.add(dedup)

      const texts = buildFailureText(v, hazop, ctx)
      const { s, o, d } = getSod(v, hazop, ctx)
      const conf = v.description.includes('[DBC:') ? 0.82 : 0.72  // DBC-matched = higher confidence

      rows.push({
        sw_component: v.sw_component,
        function_name: texts.function_name,
        failure_mode: hazop,
        failure_detail: texts.failure_detail,
        effect_local: texts.effect_local,
        effect_system: texts.effect_system,
        potential_cause: texts.potential_cause,
        severity: s, occurrence: o, detection: d,
        preventive_action: texts.preventive_action,
        detection_action: texts.detection_action,
        confidence_score: conf,
      })
    }
  }

  console.log(`✅ FMEA 항목 생성: ${rows.length}개`)

  // ── Insert to DB ──────────────────────────────────────────────────────────────
  const client = await pool.connect()
  try {
    await client.query(`DELETE FROM pre_fmea_items WHERE session_id=$1 AND source='ai'`, [SESSION_ID])
    console.log(`  기존 AI 항목 삭제`)

    await client.query('BEGIN')
    for (let i = 0; i < rows.length; i++) {
      const r  = rows[i]
      const ap = calcAP(r.severity, r.occurrence, r.detection)
      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [SESSION_ID, String(i+1).padStart(4,'0'), r.sw_component, r.function_name,
         r.failure_mode, r.failure_detail, r.effect_local, r.effect_system, r.potential_cause,
         r.severity, r.occurrence, r.detection, r.preventive_action, r.detection_action,
         r.confidence_score, ap],
      )
    }
    await client.query('COMMIT')
    await client.query(`UPDATE pre_fmea_sessions SET status='generated', updated_at=now() WHERE id=$1`, [SESSION_ID])

    // Summary
    const apDist: Record<string,number> = {}
    const compDist: Record<string,number> = {}
    const typeDist: Record<string,number> = {}
    for (const r of rows) {
      const ap = calcAP(r.severity, r.occurrence, r.detection)
      apDist[ap]  = (apDist[ap] ?? 0) + 1
      compDist[r.sw_component] = (compDist[r.sw_component] ?? 0) + 1
    }
    for (const v of allVars) {
      typeDist[v.variable_type] = (typeDist[v.variable_type] ?? 0) + 1
    }

    console.log(`\n✅ DB 삽입 완료: ${rows.length}개\n`)
    console.log('[AP 분포]')
    for (const [ap, cnt] of Object.entries(apDist).sort()) console.log(`  ${ap}: ${cnt}개`)
    console.log('\n[신호 출처별 입력 변수]')
    for (const [t, cnt] of Object.entries(typeDist).sort()) console.log(`  ${t.padEnd(15)}: ${cnt}개`)
    console.log('\n[SW 컴포넌트별 FMEA 항목 (상위 20개)]')
    for (const [comp, cnt] of Object.entries(compDist).sort((a,b) => b[1]-a[1]).slice(0,20))
      console.log(`  ${comp.padEnd(35)}: ${cnt}개`)

    // Sample
    console.log('\n[통합 분석 샘플 — 첫 5개]')
    for (const r of rows.slice(0, 5)) {
      console.log(`\n  [${r.sw_component}] ${r.failure_mode} | ${r.function_name.slice(0,60)}`)
      console.log(`  상세: ${r.failure_detail.slice(0,80)}`)
      console.log(`  영향: ${r.effect_system.slice(0,80)}`)
      console.log(`  S${r.severity}/O${r.occurrence}/D${r.detection} AP=${calcAP(r.severity, r.occurrence, r.detection)}`)
    }
  } catch (e) {
    await client.query('ROLLBACK'); throw e
  } finally {
    client.release(); await pool.end()
  }
}

main().catch(e => { console.error('❌', e); process.exit(1) })
