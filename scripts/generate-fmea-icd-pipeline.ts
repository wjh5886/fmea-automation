/**
 * ICD Pipeline — ICD 신호 × 제어기능사양서 FRS 매핑 기반 FMEA 생성
 *
 * 흐름:
 *   pre_fmea_icd_variables (DBC + 아키텍처 추출)
 *     → 제어기능사양서 FRS 패턴 매핑 (신호명 → JG1-FRS-xxx)
 *     → HAZOP 분석 + S/O/D 산출
 *     → pre_fmea_items (source='icd') 삽입
 *
 * SWE3 불필요 — 설계 前 FMEA, 요구사항(FRS) 기반
 * 임계값 출처: 제어기능사양서 2.5절 DTC 검출 조건
 */
import pg from 'pg'
import { calculateAP } from '../src/lib/ap-calculator.js'

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/fmea_db' })

// ── 타입 정의 ──────────────────────────────────────────────────────────────────
interface IcdVar {
  sw_component: string; variable_name: string; variable_type: string
  direction: string; data_type: string; signal_range: string
  unit: string; description: string
}

interface FrsContext {
  frsId: string         // 예: 'JG1-FRS-sens'
  chapter: string       // 예: '2.3 변속단 신호 검출 및 송출'
  funcName: string      // 기능명 (한국어)
  safetyLevel: number   // S 기준값
  isAsilB: boolean
  dtcTimeoutMs: number | null  // DTC 검출 시간 (ms), null = 규정 없음
  dtcVoltThresh: string | null // 전압 임계값 문자열 (해당 시)
  dtcId: string | null         // DTC 코드
  sysEffect: string            // 시스템 영향
}

// ── 제어기능사양서 FRS 분류별 안전 수준 ─────────────────────────────────────────
const FRS_CATEGORIES: Record<string, Omit<FrsContext, 'frsId' | 'dtcTimeoutMs' | 'dtcVoltThresh' | 'dtcId'>> = {
  'JG1-FRS-sens': {
    chapter: '2.3 변속단 신호 검출 및 송출',
    funcName: '변속단 신호 검출 및 송출 (ASIL B)',
    safetyLevel: 9,
    isAsilB: true,
    sysEffect: '잘못된 변속단 정보(PRND) 송출로 의도치 않은 차량 변속 — ISO26262 ASIL B 요구 위반 위험',
  },
  'JG1-FRS-rotat': {
    chapter: '2.2 레버 회전 전환 제어',
    funcName: '컬럼식 레버 회전 전환 제어 (ASIL B)',
    safetyLevel: 8,
    isAsilB: true,
    sysEffect: '레버 회전 전환 실패로 주행 가능/불가 상태 오표시 — 회전 중 변속 신호 미송출 또는 오송출 (ASIL B)',
  },
  'JG1-FRS-mode': {
    chapter: '2.1 동작 모드 제어',
    funcName: 'SBW ECU 동작 모드 전환 관리',
    safetyLevel: 7,
    isAsilB: false,
    sysEffect: 'ECU 모드 오전환으로 PowerOn 핵심 기능 비활성화 또는 Sleep 조기 진입 — 변속 기능 상실',
  },
  'JG1-FRS-dign': {
    chapter: '2.5 고장 진단',
    funcName: '고장 진단 검출 및 DTC 기록',
    safetyLevel: 5,
    isAsilB: false,
    sysEffect: '안전 관련 고장 미감지로 DTC 미기록 — 고장 추적 불가 및 후속 안전 대응 지연',
  },
  'JG1-FRS-light': {
    chapter: '2.4 인디케이터/무드조명 제어',
    funcName: 'PRND 인디케이터 및 무드조명 제어',
    safetyLevel: 4,
    isAsilB: false,
    sysEffect: '기어 상태 표시 오류로 운전자 기어 오인지 가능 — 직접 변속 제어에는 영향 없음',
  },
  'JG1-FRS-hapt': {
    chapter: '2.7 R단 햅틱',
    funcName: 'R단 진입 햅틱 진동 제어',
    safetyLevel: 3,
    isAsilB: false,
    sysEffect: 'R단 햅틱 미동작 — 편의 기능 저하, 직접 안전 영향 없음',
  },
}

// ── FRS 사양서 요구사항 세부 내용 (SBW 제어기능사양서 2절 기반 — Option B) ────────────────
const FRS_SPEC_DETAIL: Record<string, {
  reqIds: string; keyThresholds: string; safetyMech: string
  faultCondition: string; outputSig: string
}> = {
  'JG1-FRS-sens': {
    reqIds: 'JG1-FRS-sens-01~03',
    keyThresholds:
      'P버튼 1-out-of-2 홀스위치(30ms 필터, Stuck 180s→DTC C153364) / ' +
      '레버 1chip 2Die 180° offset(stay 30ms, D/R→N debounce 100ms) / ' +
      'Abnormal Sensing Value 또는 Redundancy Check Error 2초 이상 → DTC C225701',
    safetyMech:
      '이중화 센서(1chip 2Die, 180° offset) Redundancy Check + 1-out-of-2 P버튼 감지 + ' +
      '30ms 필터·180s Stuck 타이머 + ASIL B E2E 보호 (JG1-FRS-sens-01)',
    faultCondition:
      'SBW_SHFTR_FF_LvrWrngMsg: 0x03(P Button Failure) / 0x06(Button Stuck) / ' +
      '0x12(Lever Stuck) / 0x13(Lever Hall Sensor Failure) — ' +
      'LvrUnitSta: 0x01(기능저하 없음) / 0x02(기능저하)',
    outputSig:
      'SBW_SHFTR_FF_LvrPosInfo / SBW_SHFTR_FF_P_Sta / SBW_SHFTR_FF_LvrWrngMsg / SBW_SHFTR_FF_LvrUnitSta',
  },
  'JG1-FRS-rotat': {
    reqIds: 'JG1-FRS-rotat-01~04',
    keyThresholds:
      '회전 조건: EV Ready ON + 착좌(DrvStOcc/PplPresence) + 운전석 도어 닫힘(DrvDrSw) / ' +
      'ModePosInfo: 0x1=12시(Standby)·0x2=2시(주행)·0x3=Invalid / ' +
      'Fail-safe: 방해 2DC→0x1B(Override), 외력→0x1F(Failure 1), 반복→0x1C(Failure 2)',
    safetyMech:
      'Fail-safe 재시도 메커니즘 + 회전 방해 검출(외력·간섭) + Override 안내 메시지 + ASIL B 보호 (JG1-FRS-rotat-01)',
    faultCondition:
      'SBW_SHFTR_FF_LvrWrngMsg: 0x1B(Mode Change Override — 제어 중단 2DC+) / ' +
      '0x1F(Mode Change Failure 1 — 외력 간섭) / 0x1C(Mode Change Failure 2 — 방해 반복)',
    outputSig:
      'SBW_SHFTR_FF_ModePosInfo (0x0=N/A, 0x1=12시, 0x2=2시, 0x3=Invalid)',
  },
  'JG1-FRS-mode': {
    reqIds: 'JG1-FRS-mode-01~05',
    keyThresholds:
      'PowerOn 진입: SMK_TrmnlCtrlGrpStaBDCEV(ACC/ON) + HW IG1 / ' +
      'Sleep 진입: 키 OFF + 도어 닫힘 / 5단계: Initial→PowerOn→Standby→PrepareSleep→Sleep',
    safetyMech:
      '5단계 모드 전환 조건(SMK·IG·VCU CAN) 검증 + ' +
      'PowerOn 진입 시 변속단·회전·조명·햅틱·진단 기능 순차 활성화 (JG1-FRS-mode-01)',
    faultCondition:
      'PowerOn Mode 미진입: 변속단 신호·레버 회전·조명·햅틱·고장진단 비활성화 / ' +
      'CAN Timeout 시 이전 모드 유지 또는 Safe 기본 모드 진입',
    outputSig:
      'PowerOn 시 활성화: 변속단 신호 검출·송출 + 레버 회전 + 인디케이터 + 무드조명 + 햅틱 + 고장진단',
  },
  'JG1-FRS-light': {
    reqIds: 'JG1-FRS-light-01~34',
    keyThresholds:
      'Main CAN Timeout/BusOff → Back-up CAN 전환(JG1-FRS-light-03) / ' +
      '양쪽 CAN 동시 실패 → 하이라이트 소등·백라이트 유지 / ' +
      'Short-to-BAT·Short-to-GND·동시점등·정보불일치 1초 → DTC C154893',
    safetyMech:
      'Main CAN + Back-up CAN 이중화 수신 + 하이라이트 모니터링 전압 감시 + ' +
      '결함 시 하이라이트 전체 소등·백라이트 유지 (JG1-FRS-light-13)',
    faultCondition:
      'DTC C154893(Indicator Fault): 1)단정보-하이라이트 불일치 2)Short-to-BAT ' +
      '3)Short-to-GND 4)동시점등 — 검출 1초, 복귀: wake-up 시 재판단',
    outputSig:
      '하이라이트(P/R/N/D) + 백라이트 + 무드조명(R단=RED, BDC CAN, Fade In/Out, CAN Timeout 1500ms→소등)',
  },
  'JG1-FRS-dign': {
    reqIds: 'JG1-FRS-dign-01~19',
    keyThresholds:
      'B+ High >16.5V 2s→C110117 / B+ Low <8.5V 2s→C110216 / ' +
      'CAN BusOff 700ms→C160E88 / VCU Timeout 500ms→C161487 / CLU 500ms→C162887 / ' +
      'PDC 1500ms→C181287 / BDC 1500ms→C225387 / P버튼 Stuck 180s→C153364 / ' +
      'Lever Hall Duty <10% or >90% 1000ms→C225701 / EEPROM Checksum→C172144 / Motor Fault 1500ms→C225671',
    safetyMech:
      '전압·CAN·센서·인디케이터·ECU 다중 고장 검출 + EEPROM/MCU DTC 기록 + ' +
      '30회 sleep-wake-up 후 자동 해제 (JG1-FRS-dign-19)',
    faultCondition:
      '각 조건 만족 시 DTC 즉시 설정 + 복귀 조건 만족 시 즉시 해제 ' +
      '(EEPROM Checksum: wake-up 시 재확인, P버튼 Stuck: 180s 이상 유지)',
    outputSig:
      'DTC 기록(UDS 0x19 조회 가능) + LvrUnitSta 0x02(기능저하) → VCU 송출',
  },
  'JG1-FRS-hapt': {
    reqIds: 'JG1-FRS-hapt-01~05',
    keyThresholds:
      'IGN ON + VCU CAN 정상(Timeout 아닐 것) → R단 진입 감지 → 이전 단 불일치 시 햅틱(hapt-02) / ' +
      'R단 유지 중 SBW R 포지션 추가 조작 + 이전 SBW 포지션과 불일치 → 햅틱(hapt-04)',
    safetyMech:
      '이전 변속단·SBW 포지션 비교 조건 검증으로 중복 햅틱 방지 (hapt-03·05)',
    faultCondition:
      'VCU CAN Timeout → 햅틱 기능 비활성화(hapt-01) / R단 감지 실패 → 진입 피드백 누락',
    outputSig:
      '햅틱 진동 출력 (R단 진입 확인 피드백 / R단 추가 조작 감지 시 1회)',
  },
}

// ── Impact Analysis 기반 변경 프로파일 (베이스 차종 대비) ────────────────────
// ※ 실제 Impact Analysis Report 입수 시 각 필드 업데이트 필요
// changeType: 'new'=신규 설계/이력 없음, 'modified'=유사 설계+변경 존재, 'same'=동일 설계
// changeCount: 입력 인터페이스 및 요구사항 추가·삭제 수 (베이스 차종 대비)
// issueCount: 컴포넌트 관련 내부 + 필드 이슈 합산
interface ChangeProfile {
  changeType: 'new' | 'modified' | 'same'
  changeCount: number
  issueCount: number
}

// FRS 카테고리별 변경 프로파일 (JG1 SBW 컬럼식 레버 — 1세대 신규 개발 기준)
const FRS_CHANGE_PROFILE: Record<string, ChangeProfile> = {
  // 변속단 신호: 컬럼식 레버 신규 설계, 1chip2Die 이중화 센서 신규 적용
  'JG1-FRS-sens':  { changeType: 'new',      changeCount: 5, issueCount: 0 },
  // 레버 회전 전환: 모터 구동 회전 메커니즘 신규 도입
  'JG1-FRS-rotat': { changeType: 'new',      changeCount: 4, issueCount: 0 },
  // 동작 모드: 유사 아키텍처 적용, CAN 신호 일부 변경
  'JG1-FRS-mode':  { changeType: 'modified', changeCount: 3, issueCount: 1 },
  // 인디케이터/조명: 유사 설계 적용, 무드조명 사양 일부 추가
  'JG1-FRS-light': { changeType: 'modified', changeCount: 2, issueCount: 1 },
  // 고장 진단: 유사 DTC 구조, 신규 DTC 일부 추가
  'JG1-FRS-dign':  { changeType: 'modified', changeCount: 2, issueCount: 0 },
  // R단 햅틱: 유사 햅틱 설계, 트리거 조건 일부 변경
  'JG1-FRS-hapt':  { changeType: 'modified', changeCount: 1, issueCount: 0 },
}

// ── 변경 프로파일 → Occurrence 등급 변환 ─────────────────────────────────────
// O=1: 예방 조치(Preventive Control)로 고장 모드 완전 제거/배제 시
//   ※ E2E는 감지(Detection)이지 예방(Prevention)이 아님 → O에 영향 없음, D에 반영
function calcOccurrence(frsId: string | null, comp: string): number {
  // FRS 프로파일 우선 적용
  const profile = frsId ? FRS_CHANGE_PROFILE[frsId] : null

  // FRS 없는 경우: 유사 설계 변경 2개, 이슈 없음 기본값 → O=4
  if (!profile) return 4

  const { changeType, changeCount, issueCount } = profile

  switch (changeType) {
    case 'new':
      // 신규 디자인/신기술 — 이력 없음
      if (changeCount === 0) return 10  // 신기술, 개발 이력 전무
      if (changeCount >= 5) return 9    // 신규 요구사항 5개 이상, 고장 필연적
      if (changeCount >= 2) return 8    // 신규 요구사항 2~4개, 고장 발생 가능성 높음
      return 7                          // 신규 요구사항 1개, 고장 여부 불확실

    case 'modified':
      // 유사 디자인 + 변경 존재
      if (issueCount >= 4) return 6     // 변경 + 이슈 4개 이상, 잦은 고장
      if (issueCount >= 2) return 5     // 변경 + 이슈 2~3개, 간헐적 고장
      return 4                          // 변경 + 이슈 0~1개, 불확실한 고장

    case 'same':
      // 동일 디자인 — 변경 없음
      if (issueCount >= 1) return 3     // 이슈 1개 이상 존재, 불확실한 고장
      return 2                          // 이슈 0개, 고장 발생 이력 없음
  }
}

// ── 통합 Detection1 프로파일 (설계 유형 + 검증 계획 기반) ─────────────────────
// ※ 실제 테스트 계획 확정 시 각 필드 업데이트 필요
// designType: 'new'=신규 설계(CASE A), 'base'=베이스 차종 기반 설계(CASE B)
// CASE A — timing(DV/PV) × level(unit/integration/requirements) → D1 매핑
//   DV: unit=6 / integration=7 / requirements=8
//   PV: unit=3 / integration=4 / requirements=5
// CASE B — inputLayer × outputLayer × timing(DV/PV) → D1 매핑
//   Input=Register|BSP_Gen  + Output=BSP_Hand|APP → DV=5 / PV=8
//   Input=BSP_Hand|APP      + Output=임의          → DV=4 / PV=7
interface DetectionProfile {
  designType: 'new' | 'base'
  timing: 'DV' | 'PV'
  level?: 'unit' | 'integration' | 'requirements'   // CASE A 전용
  inputLayer?: 'register' | 'bsp_gen' | 'bsp_hand' | 'app'  // CASE B 전용
  outputLayer?: 'bsp_hand' | 'app' | 'other'                 // CASE B 전용
}

const FRS_DETECTION_PROFILE: Record<string, DetectionProfile> = {
  // CASE A: ASIL B 신규 설계 — DV SW 통합 테스트 기준 (D1=7)
  // ※ 실차 요구사항 검증(DV requirements) 적용 시 D1=8로 조정
  'JG1-FRS-sens':  { designType: 'new',  timing: 'DV', level: 'integration' },
  'JG1-FRS-rotat': { designType: 'new',  timing: 'DV', level: 'integration' },
  // CASE B: 베이스 차종 기반 수정 설계 — Input=APP, Output=APP, DV 기준 (D1=4)
  'JG1-FRS-mode':  { designType: 'base', timing: 'DV', inputLayer: 'app', outputLayer: 'app' },
  'JG1-FRS-light': { designType: 'base', timing: 'DV', inputLayer: 'app', outputLayer: 'app' },
  'JG1-FRS-dign':  { designType: 'base', timing: 'DV', inputLayer: 'app', outputLayer: 'app' },
  'JG1-FRS-hapt':  { designType: 'base', timing: 'DV', inputLayer: 'app', outputLayer: 'app' },
}

// ── 통합 Detection1 산출 함수 ──────────────────────────────────────────────────
function calcDetection(
  v: IcdVar, hazop: string,
  frsCtx: FrsContext | null, isE2E: boolean,
): number {
  const profile = frsCtx ? FRS_DETECTION_PROFILE[frsCtx.frsId] : null

  // ── 기본 D1: 설계 유형 + 검증 계획 기반 ──────────────────────────────────────
  let baseD: number
  if (!profile) {
    // FRS 없는 경우: 베이스 차종 기반 APP-to-APP DV 기준 → D1=4
    baseD = 4
  } else if (profile.designType === 'new') {
    // CASE A — 테스트 시점 × 레벨 매핑
    const caseA = {
      DV: { unit: 6, integration: 7, requirements: 8 },
      PV: { unit: 3, integration: 4, requirements: 5 },
    } as const
    baseD = caseA[profile.timing][profile.level ?? 'integration']
  } else {
    // CASE B — 입력 레이어 × 출력 레이어 × 시점 매핑
    const isInRegOrBspGen = profile.inputLayer === 'register' || profile.inputLayer === 'bsp_gen'
    const isOutBspHandOrApp = profile.outputLayer === 'bsp_hand' || profile.outputLayer === 'app'
    if (isInRegOrBspGen && isOutBspHandOrApp) {
      baseD = profile.timing === 'DV' ? 5 : 8
    } else if (!isInRegOrBspGen) {
      // Input=BSP_Handcoding or APP → 모든 Output 레이어
      baseD = profile.timing === 'DV' ? 4 : 7
    } else {
      // Register/BSP_Gen → 비해당 레이어 조합: 검증 적용 제외 → 기본값
      baseD = 6
    }
  }

  // ── 입증된 설계 솔루션 보정 (D1=1~2 범위로 개선) ─────────────────────────────
  // E2E CRC (AUTOSAR 표준 검증 메커니즘): CORRUPT/REVERSE 탐지에 적용
  //   고장 모드가 애플리케이션에 전달되지 않는 수준 → 강력한 시뮬레이션 검증(D1=2) 수준
  if (isE2E && (hazop === 'CORRUPT' || hazop === 'REVERSE')) {
    return Math.min(baseD, 2)
  }
  // DTC 타임아웃 감시: NO(신호 소실) → 규격화된 모니터링 메커니즘 (D1=3)
  if (hazop === 'NO' && frsCtx?.dtcTimeoutMs) {
    return Math.min(baseD, 3)
  }
  // 전압 임계값 감시: 전압 신호 → 하드웨어 계측 기반 (D1=3)
  if (frsCtx?.dtcVoltThresh) {
    return Math.min(baseD, 3)
  }

  return baseD
}

// ── 제어기능사양서 DTC 검출 조건 (2.5절 기반) ────────────────────────────────
interface DtcInfo { timeoutMs: number | null; dtcId: string | null; voltThresh: string | null }

function getDtcInfo(varName: string): DtcInfo {
  const v = varName
  // 전압 신호 — B+ 임계값 8.5V/16.5V (JG1-FRS-dign-05/06)
  if (/VIgn|BatVolt|IgnVolt|VoltSta|SupplyVolt/i.test(v))
    return { timeoutMs: 2000, dtcId: 'C110117/C110216', voltThresh: '저전압 8.5V↓ / 과전압 16.5V↑ (2초)' }
  // VCU 신호 — 500ms (JG1-FRS-dign-09)
  if (/^VCU_/i.test(v))
    return { timeoutMs: 500, dtcId: 'C161487', voltThresh: null }
  // CLU 신호 — 500ms (JG1-FRS-dign-10)
  if (/^CLU_/i.test(v))
    return { timeoutMs: 500, dtcId: 'C162887', voltThresh: null }
  // PDC 신호 — 1500ms (JG1-FRS-dign-11)
  if (/^PDC_|Warn_DrvStOcc|Warn_DrvDrSw/i.test(v))
    return { timeoutMs: 1500, dtcId: 'C181287', voltThresh: null }
  // BDC/SMK/무드조명/조명 신호 — 1500ms (JG1-FRS-dign-12)
  if (/^BDC_|^SMK_|^MoodLamp_|^Lamp_|^RKE_|DoorLock/i.test(v))
    return { timeoutMs: 1500, dtcId: 'C225387', voltThresh: null }
  // ICMU/SBCM 착좌/도어 신호 — 규정 없음 (FRS에 DTC 미명시)
  if (/^ICMU_|^SBCM_/i.test(v))
    return { timeoutMs: 1500, dtcId: null, voltThresh: null }
  // HU/USM 신호 — 규정 없음
  if (/^HU_|^USM_/i.test(v))
    return { timeoutMs: null, dtcId: null, voltThresh: null }
  // P버튼 Stuck — 180s (JG1-FRS-dign-14)
  if (/PButton|PSta|P_Sta/i.test(v))
    return { timeoutMs: 180000, dtcId: 'C153364', voltThresh: null }
  // 레버 홀 센서 — duty 10%~90%, 1000ms (JG1-FRS-dign-19)
  if (/HallSensor|LvrPos|LvrUnit|LvrWrng/i.test(v))
    return { timeoutMs: 1000, dtcId: 'C225701', voltThresh: null }
  // 인디케이터 — 1000ms (JG1-FRS-dign-15)
  if (/Indicator|HighLight|BackLight|LvrIndicator/i.test(v))
    return { timeoutMs: 1000, dtcId: 'C154893', voltThresh: null }
  // CAN Bus Off — 700ms (JG1-FRS-dign-08)
  if (/BusOff|CanFault/i.test(v))
    return { timeoutMs: 700, dtcId: 'C160E88', voltThresh: null }
  return { timeoutMs: null, dtcId: null, voltThresh: null }
}

// ── FRS 분류 매핑 ─────────────────────────────────────────────────────────────
function findFrsContext(swComponent: string, varName: string): FrsContext | null {
  const key = varName + '|' + swComponent

  // DID 서비스 컴포넌트는 신호명에 무관하게 진단 분류 (변수명으로 오분류 방지)
  if (/BswIF_Dcm_22|BswIF_Dcm_2E|BswIF_Dcm_27|BswIF_Dcm_31|BswIF_Dcm_RWDID/i.test(swComponent)) {
    const dtc = getDtcInfo(varName)
    return { frsId: 'JG1-FRS-dign', ...FRS_CATEGORIES['JG1-FRS-dign'],
             dtcTimeoutMs: dtc.timeoutMs, dtcVoltThresh: dtc.voltThresh, dtcId: dtc.dtcId }
  }

  // 안전 무관 신호 조기 제외 (Trunk, OTA, 도어락(잠금용), Odometer, 후석 도어)
  if (/^Trunk|^Trnk|TrnkTlgt|TrnkPassive/i.test(varName))
    return makeFrs('JG1-FRS-light', varName)   // S=4 천장
  if (/OTA_|OTAMsg|CrankInh|CCU_OTA/i.test(varName))
    return makeFrs('JG1-FRS-light', varName)   // OTA는 편의 수준
  if (/^Odo|OdoVal|Odometer/i.test(varName))
    return makeFrs('JG1-FRS-light', varName)   // 주행거리 표시
  if (/AsstDrSw|RrLftDrSw|RrRtDrSw|SSB_Strt|SSB_Stp/i.test(varName))
    return makeFrs('JG1-FRS-mode', varName)    // 동작모드 보조 신호, S=7 이하

  // CAN 메시지 수신 타임아웃 감시 플래그 — 동작 모드 감시 (S=7)
  // 접두어 ^BDC_숫자, ^CLU_숫자 등은 외부 ECU CAN 메시지 타임아웃 플래그
  if (/^BDC_\d|^CLU_\d|^PDC_\d|^SMK_\d|^MCU_\d|^ICC_\d|^SBCM_/i.test(varName))
    return makeFrs('JG1-FRS-mode', varName)
  if (/BDC\d+MsgTo|CLUMsgTo|PDC\d+MsgTo|SMK\d+MsgTo/i.test(varName))
    return makeFrs('JG1-FRS-mode', varName)

  // 1. 변속단 신호 / 센서 (ASIL B 최고 우선순위)
  // DriveSig*: 주/부 센서 CAN 신호 도착 감시 (ASIL B), *SActMsg*: 센서 액션 메시지 타임아웃
  if (/GearPosSta|PosSta|PosSnr|PosStuck|LvrPos|LvrUnit|LvrWrng|LeverWarning|LvrInd|LvrTyp|P_Sta|PButton|SHFTR_FF|DriveSig|SActMsg|EitherSensor|tmpPos/i.test(key) ||
      /ButtonMgt|PosMgt|MovMgt/i.test(swComponent)) {
    return makeFrs('JG1-FRS-sens', varName)
  }

  // 2. 레버 회전 전환 (ASIL B)
  // RotateState/DriveSta: 레버 회전 상태, MechaErr: 기구부 오류, Retry/Override: 위치 재시도/강제전환
  if (/RotateMode|RotateState|DriveSta|MechaErr|MechaError|RetryWarning|OverRideWarning|Naccept|EvDrvRdySta|PplPresence|DrvStOcc|DrvDrSw|SafetyMode|UtilModeAct|ModePosInfo|USM_SBW/i.test(key) ||
      /MotorControlMgt|MotorCtrl/i.test(swComponent)) {
    return makeFrs('JG1-FRS-rotat', varName)
  }

  // 3. 동작 모드
  // TrmnlCtrl: SMK 터미널 제어 그룹(시동/ACC), IgnSwSta/GrpStaBDCEV: 이그니션/BDC 그룹 상태
  // RKESig/SMKSig: 리모컨/스마트키 신호, DoorLockSta: 도어락 상태, ^Timeout$: 제네릭 타임아웃 플래그
  if (/TrmnlCtrl|Ign1In|PwrOnMode|IgnSta|IgnSwSta|PowerOn|SlpMd|WakeUp|RkeBtnReq|DrLockPsv|DoorLockPsv|DoorLockSta|GrpStaBDCEV|DrvRdySig|RKESig|SMKSig|ResetOpSta|USM06|VPCAMsg|^Timeout$/i.test(varName) ||
      /ECUModeMgt|VehicleReset|PwrMGT/i.test(swComponent)) {
    return makeFrs('JG1-FRS-mode', varName)
  }

  // 4. 조명 — Lmp(테일램프 약어), Lamp, MoodLamp, 조명 밝기, 버튼 조명, 야간 센서
  // IdtFlt/IdtSta: 인디케이터 고장/상태 (조명 범주)
  if (/IdtFlt|IdtSta|Lmp|Lamp|MoodLamp|MdLmp|SlvColor|SlvBrgt|FadeIn|FadeOut|AutoBright|AutoLtSnsr|NightSta|Indicator|BackLight|HighLight|Rheo|Illumi|IllAlways|BtnIllumi/i.test(varName) ||
      /IdtMgt|MoodControl/i.test(swComponent)) {
    return makeFrs('JG1-FRS-light', varName)
  }

  // 5. 진단 / E2E
  // ComCtrlMode/ECUSta/SessionState: 통신·ECU 상태 진단, SpecOption/update_enable: 설정값 관리
  if (/Crc|AlvCnt|E2E|BusOff|CrcVal|AlvCntVal|Fault|Diag|DtcMgt|ComCtrlMode|ECUSta|SessionState|SpecOption|update_enable/i.test(key) ||
      /DtcMgt|DIDMgt/i.test(swComponent)) {
    return makeFrs('JG1-FRS-dign', varName)
  }

  // 6. 햅틱
  if (/Hapt|Haptic|Vibrat/i.test(varName)) {
    return makeFrs('JG1-FRS-hapt', varName)
  }

  // 7. 컴포넌트 기반 폴백 — BswIF_CAN은 sens 아닌 mode로 (개별 신호 분류 우선)
  const compFrs: Record<string, string> = {
    CstAp_CANMGT: 'JG1-FRS-mode', BswIF_CAN: 'JG1-FRS-mode',
    CstAp_PwrMGT: 'JG1-FRS-mode', BswIF_IoHwAb: 'JG1-FRS-mode',
    CstAp_ECUModeMgt: 'JG1-FRS-mode', CstAp_VehicleReset_Mgt: 'JG1-FRS-mode',
    BswIF_WdgM: 'JG1-FRS-dign', BswIF_SafetyLib: 'JG1-FRS-dign',
    BswIF_Nvm: 'JG1-FRS-dign', CstAp_DtcMgt: 'JG1-FRS-dign',
    CstAp_IdtMgt: 'JG1-FRS-light', CstAp_MoodControlMgt: 'JG1-FRS-light',
    BswIF_Dcm_27_SA: 'JG1-FRS-dign', BswIF_Dcm_31_RC: 'JG1-FRS-dign',
  }
  const fallbackFrsId = compFrs[swComponent]
  if (fallbackFrsId) return makeFrs(fallbackFrsId, varName)

  return null
}

function makeFrs(frsId: string, varName: string): FrsContext {
  const dtc = getDtcInfo(varName)
  return { frsId, ...FRS_CATEGORIES[frsId],
           dtcTimeoutMs: dtc.timeoutMs, dtcVoltThresh: dtc.voltThresh, dtcId: dtc.dtcId }
}

// ── 컴포넌트 기본 컨텍스트 ──────────────────────────────────────────────────────
const COMP_CTX: Record<string, { s: number; fn: string; sysEffect: string }> = {
  CstAp_PwrMGT:          { s: 8,  fn: '전원 전압 감시 및 ECU 전원 상태 관리',           sysEffect: '저전압/과전압 보호 미동작으로 ECU 손상 및 SBW 기능 상실' },
  CstAp_CANMGT:          { s: 8,  fn: 'CAN 신호 수신/배포 및 기어 명령 처리',           sysEffect: '잘못된 기어 명령 또는 신호 손실로 SBW 변속 오류' },
  CstAp_ECUModeMgt:      { s: 7,  fn: 'ECU 동작 모드 전환 제어',                        sysEffect: '모드 전환 오류로 변속 중 ECU Sleep 진입 또는 기능 불완전 활성화' },
  CstAp_ButtonMgt:       { s: 9,  fn: '변속 버튼 입력 감지 및 기어 명령 생성',           sysEffect: '운전자 의도와 다른 기어 명령으로 의도치 않은 변속 또는 변속 불가' },
  CstAp_MotorControlMgt: { s: 9,  fn: '다이얼/스피어 모터 구동 위치 제어',               sysEffect: '모터 오동작으로 레버 목표 위치 미도달 또는 기구부 충돌' },
  CstAp_PosMgt:          { s: 9,  fn: '이중화 위치 센서 기반 기어 포지션 판정 (ASIL B)', sysEffect: '잘못된 기어 포지션 판정으로 의도치 않은 기어 변속 실행 (ASIL B 위반)' },
  CstAp_MovingMgt:       { s: 9,  fn: '레버 이동 완료 감지 (이중화 센서)',               sysEffect: '이동 미완료 상태의 조기 완료 판정으로 레버 중간 위치 고착' },
  CstAp_DtcMgt:          { s: 6,  fn: 'DTC 기록 및 진단 이력 관리',                     sysEffect: '안전 관련 고장 DTC 미기록으로 고장 추적 불가' },
  CstAp_IdtMgt:          { s: 4,  fn: 'PRND 인디케이터/조명 PWM 제어',                  sysEffect: '기어 상태 표시 오류로 운전자 기어 오인지 가능성' },
  CstAp_DIDMgt:          { s: 5,  fn: 'DID 데이터 읽기/쓰기 처리',                       sysEffect: '차량 옵션 설정값 오류로 SBW 특수 기능 불일치' },
  CstAp_VehicleReset_Mgt:{ s: 7,  fn: '차량 리셋 조건 감지 및 ECU 리셋 제어',            sysEffect: '불필요한 ECU 리셋 또는 필요한 리셋 미수행으로 SBW 상태 오염' },
  CstAp_MoodControlMgt:  { s: 3,  fn: '무드램프 색상/밝기 제어',                         sysEffect: '분위기 조명 오동작, 직접 안전 영향 없음' },
  BswIF_CAN:             { s: 9,  fn: 'CAN 메시지 송수신 및 E2E 보호 처리',              sysEffect: 'E2E 검증 실패로 오염된 기어 명령 처리 및 의도치 않은 변속' },
  BswIF_ECUModeCntl:     { s: 6,  fn: 'ComM 통신 모드 및 ECU 모드 연동',                 sysEffect: 'CAN 통신 비활성화로 초기 기어 명령 손실' },
  BswIF_IoHwAb:          { s: 8,  fn: 'ADC/디지털 I/O 하드웨어 추상화 계층',             sysEffect: '센서값 오전달로 CstAp_PosMgt/PwrMGT 오판단' },
  BswIF_Nvm:             { s: 5,  fn: 'EEPROM 비휘발성 데이터 읽기/쓰기',                sysEffect: 'NvM 오류로 부팅 시 잘못된 설정값 로딩' },
  BswIF_WdgM:            { s: 8,  fn: '소프트웨어 워치독 체크포인트 감시',                sysEffect: 'SW 실행 흐름 오류 감지 시 ECU 리셋으로 변속 기능 중단' },
  BswIF_SafetyLib:       { s: 9,  fn: '메모리 무결성/ECC 오류 감지',                     sysEffect: '메모리 변조 미감지로 ASIL B 위치 임계값 오염 및 기어 포지션 판정 오류' },
  BswIF_Dcm_22_2E_RWDID: { s: 5,  fn: 'DID 읽기/쓰기 서비스 (UDS 0x22/0x2E)',          sysEffect: '차량 설정 DID 오류로 SBW 동작 파라미터 불일치' },
  BswIF_Dcm_27_SA:       { s: 8,  fn: '보안 접근 인증 (UDS 0x27)',                       sysEffect: '인증 우회로 무단 ECU 캘리브레이션 변경 가능' },
  BswIF_Dcm_31_RC:       { s: 8,  fn: '루틴 제어/Secure Boot 검증 (UDS 0x31)',           sysEffect: 'Secure Boot 검증 실패로 변조된 SW 실행 가능' },
}
const DEFAULT_CTX = { s: 5, fn: 'SW 컴포넌트 기능 처리', sysEffect: 'SW 컴포넌트 오동작으로 SBW 기능 부분 영향' }

// ── Data Type 분류 (ISO 26262 HAZOP 필터링 기반) ──────────────────────────────
function getDataTypeCategory(v: IcdVar): 'bool' | 'uint' | 'sint' | 'float' | 'enum' | 'array' | 'struct' {
  const dt = (v.data_type ?? '').toLowerCase().trim()
  if (dt === 'bool' || dt === 'boolean') return 'bool'
  if (/^float|^double|^real/.test(dt)) return 'float'
  if (/^sint|^int(?!_)|^s\d+|^int$/.test(dt)) return 'sint'
  if (/^uint|^u\d+|^unsigned/.test(dt)) return 'uint'
  if (/enum|_e$/.test(dt)) return 'enum'
  if (/\[\d*\]|array/.test(dt)) return 'array'
  if (/struct/.test(dt)) return 'struct'
  // 신호명 패턴 폴백
  if (/Sta$|State$|Mode$|Req$|Cmd$|Status$/i.test(v.variable_name)) return 'enum'
  if (/Flg$|Flag$|En$|Enable$/i.test(v.variable_name)) return 'bool'
  return 'uint'  // 자동차 SW 기본 타입
}

// ── 통신 방식 분류 (Polling vs Interrupt) ────────────────────────────────────
function getCommType(v: IcdVar, meta: ReturnType<typeof parseMeta>): 'polling' | 'interrupt' | 'none' {
  if (v.variable_type === 'CAN_RX' || v.variable_type === 'CAN_TX')
    return meta.periodMs ? 'polling' : 'interrupt'
  if (v.variable_type === 'HW_INPUT' || v.variable_type === 'HW_OUTPUT')
    return 'polling'
  return 'none'
}

// ── HAZOP 가이드워드 결정 (Data Type × Communication Type 필터링 규칙) ──────────
function getHazopModes(v: IcdVar): string[] {
  const meta     = parseMeta(v.description)
  const dtCat    = getDataTypeCategory(v)
  const commType = getCommType(v, meta)
  const modes: string[] = []

  // [값의 이상] — Data Type별 적용 규칙
  switch (dtCat) {
    case 'bool':
      // Bool: Reverse(반전)·Corrupt(범위 외) 적용 / More·Less 해당없음
      modes.push('REVERSE', 'CORRUPT')
      break
    case 'uint':
    case 'enum':
      // Unsigned/Enum: More·Less·Corrupt 적용 / Reverse(부호 반전) 해당없음
      modes.push('MORE', 'LESS', 'CORRUPT')
      break
    case 'sint':
    case 'float':
      // Signed/Float: More·Less·Reverse(부호 반전)·Corrupt 모두 적용
      modes.push('MORE', 'LESS', 'REVERSE', 'CORRUPT')
      break
    case 'array':
      // 배열: Reverse(순서/비트 반전)·Corrupt 적용
      modes.push('REVERSE', 'CORRUPT')
      break
    case 'struct':
      // 구조체: 내부 변수별 개별 적용 — 전체 범위로 처리
      modes.push('MORE', 'LESS', 'REVERSE', 'CORRUPT')
      break
  }

  // [타이밍/기능의 이상] — Communication Type별 적용 규칙
  if (commType === 'polling') {
    // 주기성: No·AsWellAs·PartOf·Early·Late 모두 적용
    modes.push('NO', 'AS_WELL_AS', 'PART_OF', 'EARLY', 'LATE')
  } else if (commType === 'interrupt') {
    // 이벤트성: No·AsWellAs·Early·Late 적용 / PartOf 해당없음
    modes.push('NO', 'AS_WELL_AS', 'EARLY', 'LATE')
  } else {
    // SW_INTERNAL 등: 최소 No 적용
    modes.push('NO')
  }

  return modes
}

// ── DBC 메타데이터 파싱 ────────────────────────────────────────────────────────
function parseMeta(desc: string) {
  const msgM = desc.match(/\[DBC:\s*([^,]+),\s*sender=(\w+)\]/)
  const perM  = desc.match(/Period:\s*(\d+)ms/)
  const srcM  = desc.match(/(\w+)→(\w+)/)
  return {
    msgName:  msgM?.[1]?.trim() ?? '',
    sender:   msgM?.[2]?.trim() ?? '',
    periodMs: perM ? +perM[1] : null,
    srcComp:  srcM?.[1]?.trim() ?? '',
  }
}

// ── 실패 텍스트 생성 (FRS 컨텍스트 반영) ────────────────────────────────────────
function buildTexts(v: IcdVar, hazop: string, ctx: typeof DEFAULT_CTX, frsCtx: FrsContext | null) {
  const meta    = parseMeta(v.description)
  const sig     = v.variable_name
  const range   = v.signal_range && v.signal_range !== '-' ? ` [${v.signal_range}]` : ''
  const period  = meta.periodMs ? ` (${meta.periodMs}ms 주기)` : ''
  const src     = meta.sender || meta.srcComp || v.description.match(/BswIF_\w+|CstAp_\w+/)?.[0] || '외부 ECU'
  const isCanRx = v.variable_type === 'CAN_RX'
  const isHwIn  = v.variable_type === 'HW_INPUT'
  const isCanTx = v.variable_type === 'CAN_TX'

  // function_name: FRS ID와 기능명 포함
  let function_name: string
  if (frsCtx) {
    function_name = `[${frsCtx.frsId}] ${frsCtx.funcName} / ${sig}`
  } else if (isCanRx && meta.msgName) {
    function_name = `CAN 수신: ${sig}${period} — ${meta.msgName} (from ${src})`
  } else if (isHwIn) {
    function_name = `HW 입력: ${sig}${range}`
  } else if (isCanTx) {
    function_name = `CAN 송신: ${sig} — ${v.sw_component}→외부`
  } else {
    function_name = `SW 인터페이스: ${sig} — ${src}→${v.sw_component}`
  }

  // FRS DTC 조건 주석
  const dtcNote = frsCtx?.dtcId ? ` (FRS ${frsCtx.frsId}, DTC ${frsCtx.dtcId})` : ''
  const voltNote = frsCtx?.dtcVoltThresh ? ` [기준: ${frsCtx.dtcVoltThresh}]` : ''
  const timeoutNote = frsCtx?.dtcTimeoutMs
    ? ` (검출 기준: ${frsCtx.dtcTimeoutMs >= 60000 ? frsCtx.dtcTimeoutMs / 1000 + 's' : frsCtx.dtcTimeoutMs + 'ms'})`
    : ''

  const sysEffect = frsCtx?.sysEffect ?? ctx.sysEffect

  const rangeLabel  = (v.signal_range && v.signal_range !== '-') ? v.signal_range : '정의된 범위'
  const periodLabel = meta.periodMs ? `${meta.periodMs}ms 주기` : '정상 주기'
  const dtcSuffix   = frsCtx?.dtcId ? ` (DTC ${frsCtx.dtcId})` : ''
  const asilNote    = frsCtx?.isAsilB ? ' (ASIL B 필수)' : ''

  let failure_detail: string, effect_local: string, effect_system: string
  let potential_cause: string, preventive_action: string, detection_action: string

  switch (hazop) {
    // ── 값의 이상 ───────────────────────────────────────────────────────────────
    case 'MORE':
      failure_detail    = `from: ${rangeLabel} / to: 정상 범위 최댓값 초과 → ${sig}가 정상 범위 내 최댓값보다 높게 인식되는 경우${voltNote}`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 과도한 입력값으로 오동작 또는 포화 상태 진입`
      effect_system     = sysEffect
      potential_cause   = isCanRx
        ? `${src} ECU의 ${sig} 연산 오버플로우 또는 센서 포화로 최대 범위 초과 값 송출`
        : isHwIn ? `센서 전원 과전압 또는 ADC 채널 이상으로 ${sig} 측정값이 최대 범위 초과`
        : `${src}에서 ${sig} 계산 시 상한 클램핑 미적용으로 오버플로우 값 전달`
      preventive_action = `${sig} 수신값 상한 클램핑 및 Range Check 로직 구현${asilNote}`
      detection_action  = `${sig} 상한 초과 감지${dtcSuffix} 및 Unit Test 경계값(max+1) 검증`
      break

    case 'LESS':
      failure_detail    = `from: ${rangeLabel} / to: 정상 범위 최솟값 미만 → ${sig}가 정상 범위 내 최솟값보다 낮게 인식되는 경우${voltNote}`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 부족한 입력값으로 제어 응답 부족`
      effect_system     = sysEffect
      potential_cause   = isCanRx
        ? `${src} ECU의 ${sig} 산출 오류 또는 신호선 접촉불량으로 최솟값 미만 송출`
        : isHwIn ? `센서 전원 저하 또는 배선 단선으로 ${sig} ADC 측정값이 하한 미만`
        : `${src}에서 ${sig} 초기화 오류 또는 클리어 조건 미충족으로 하한 미만 값 전달`
      preventive_action = `${sig} 수신값 하한 클램핑 및 센서 Plausibility 병렬 확인${asilNote}`
      detection_action  = `${sig} 하한 이탈 감지${dtcSuffix} 및 대체값(Hold/Default) 적용`
      break

    case 'REVERSE':
      failure_detail    = `from: 정상 상태 / to: 반전 상태 → ${sig} 값의 참/거짓 반전 또는 부호 반전이 발생하는 경우`
      effect_local      = `${v.sw_component}의 ${sig} 기반 분기 로직이 반대 조건으로 실행되어 제어 방향 역전`
      effect_system     = sysEffect
      potential_cause   = isCanRx
        ? `CAN 버스 비트 오류 또는 ${src} ECU SW 버그로 ${sig} 플래그/부호 반전 송출`
        : isHwIn ? `HW 핀 노이즈 또는 Active High/Low 논리 설정 오류로 신호 반전`
        : `${src} 컴포넌트의 상태 플래그 오초기화 또는 경쟁 조건(race condition)`
      preventive_action = `${sig} 수신 후 Plausibility 체크 및 이중 변수 교차 검증${asilNote}`
      detection_action  = `${sig} 반전 감지${dtcSuffix} 및 연속 2회 이상 확인 후 처리`
      break

    case 'CORRUPT':
      failure_detail    = `from: ${rangeLabel} / to: out of range → ${sig}의 정상 범위를 벗어난 값(Invalid Data)이 유입되는 경우${voltNote}`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직에 정의되지 않은 입력값으로 제어 오동작`
      effect_system     = sysEffect
      potential_cause   = isCanRx
        ? `CAN 프레임 비트 오류 또는 ${src} SW 버그로 ${sig} 물리값 범위 초과 송출`
        : isHwIn ? `센서 전원 이상 또는 ADC 기준 전압 변동으로 ${sig} 비정상값 측정`
        : `${src}의 ${sig} 연산 오류 또는 변수 타입 오버플로우`
      preventive_action = `${sig} 수신값 물리 범위 검증(Range Check) 후 범위 외 시 이전 유효값 유지${asilNote}`
      detection_action  = `${sig} 범위 초과 감지${dtcSuffix} 즉시 설정 및 직전 유효값 Hold 로직 구현`
      break

    // ── 타이밍/기능의 이상 ────────────────────────────────────────────────────
    case 'NO': {
      const noTimeout = frsCtx?.dtcTimeoutMs ?? (meta.periodMs ? meta.periodMs * 3 : 500)
      const noTimeoutStr = noTimeout >= 60000 ? (noTimeout / 1000) + 's' : noTimeout + 'ms'
      failure_detail    = `from: ${periodLabel} 정상 수신 / to: 신호 미갱신·타임아웃(>${noTimeoutStr}) → ${sig}가 갱신되지 않거나 누락·타임아웃 발생하는 경우`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 ${sig} 직전 유효값 유지 또는 안전 기본값으로 동작`
      effect_system     = `${sig} 미수신 상태에서 ${sysEffect}`
      potential_cause   = isCanRx
        ? `${src} ECU 전원 오프, CAN Bus Off 또는 메시지 누락으로 ${sig} 미송출`
        : isHwIn ? `HW 핀 오픈(단선) 또는 센서 전원 차단으로 ${sig} 미입력`
        : `${src} 컴포넌트 비정상 종료 또는 실행 스케줄 누락으로 ${sig} 미갱신`
      preventive_action = `${sig} 수신 감시 타이머(${noTimeoutStr}) 설정 및 타임아웃 시 안전 기본값 적용${asilNote}`
      detection_action  = `${sig} 타임아웃 감지${dtcSuffix} 및 DTC 기록`
      break
    }

    case 'AS_WELL_AS': {
      failure_detail    = `from: 정상 ${periodLabel} / to: 의도보다 짧은 주기·과다 발생 → ${sig}가 정상보다 많은 빈도로 발생하는 경우`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 ${sig}를 과도하게 수신하여 처리 큐 포화 또는 중복 처리`
      effect_system     = `${sig} 과다 발생으로 CAN 버스 부하 증가 및 다른 신호 지연 유발`
      potential_cause   = isCanRx
        ? `${src} ECU의 ${sig} 전송 주기 설정 오류 또는 이벤트 중복 트리거`
        : `${src} 컴포넌트의 인터럽트 핸들러 중복 등록 또는 타이머 설정 오류`
      preventive_action = `${sig} 수신 주기 검증(최소 수신 간격 필터) 및 중복 신호 무시 로직 구현`
      detection_action  = `${sig} 수신 빈도 카운터 모니터링 및 임계 초과 시 경고 로그`
      break
    }

    case 'PART_OF': {
      failure_detail    = `from: 완전한 ${sig} 데이터 / to: 일부 데이터 누락 → ${sig}의 일부 정보가 빠진 상태로 수신되는 경우`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 불완전한 ${sig} 데이터로 부분적 제어 수행`
      effect_system     = `${sig} 데이터 불완전으로 일부 기능만 동작 — ${sysEffect}`
      potential_cause   = isCanRx
        ? `CAN 프레임 손상(일부 바이트 손실) 또는 멀티프레임 메시지 일부 미수신`
        : `${src} 컴포넌트의 배열/구조체 일부 필드 초기화 누락`
      preventive_action = `${sig} 수신 데이터 완전성 검증(CRC/E2E) 및 불완전 시 이전 유효값 유지`
      detection_action  = `${sig} E2E 보호 적용${dtcSuffix} 및 데이터 완전성 체크 실패 시 DTC`
      break
    }

    case 'EARLY': {
      failure_detail    = `from: 정상 타이밍 / to: 예상보다 이른 타이밍 → ${sig} 수신 또는 실행 타이밍이 예상보다 빠른 경우`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 준비 완료 전 ${sig}를 처리하여 이전 상태값으로 동작`
      effect_system     = `${sig} 조기 수신으로 다른 신호와의 동기화 오류 발생 — ${sysEffect}`
      potential_cause   = isCanRx
        ? `${src} ECU의 ${sig} 전송 시점 오류(초기화 완료 전 송출) 또는 클록 동기화 불일치`
        : `${src} 컴포넌트의 초기화 순서 오류로 ${sig} 조기 갱신`
      preventive_action = `${sig} 수신 후 유효성 확인(준비 상태 플래그 체크) 후 처리`
      detection_action  = `${sig} 수신 타이밍 모니터링 및 예상 범위 외 조기 수신 감지 로그`
      break
    }

    case 'LATE': {
      const lateTimeout = meta.periodMs ? meta.periodMs * 2 : 100
      const lateTimeoutStr = lateTimeout + 'ms'
      failure_detail    = `from: 정상 ${periodLabel} 수신 / to: 원래 주기보다 느린 주기로 신호 수신(>${lateTimeoutStr}) → ${sig} 수신 타이밍이 예상보다 느린 경우`
      effect_local      = `${v.sw_component}의 ${ctx.fn} 로직이 지연된 ${sig}로 제어 응답 지연`
      effect_system     = `${sig} 지연 수신으로 제어 타이밍 오류 — ${sysEffect}`
      potential_cause   = `CAN 버스 순간 과부하 또는 ${src} ECU 처리 지연으로 ${sig} 전송 주기 일시 초과`
      preventive_action = `${sig} 수신 지연 허용 마진 설정 및 지연 감지 시 이전 유효값 유지`
      detection_action  = `${sig} 수신 지연 감지 카운터 및 연속 지연 시${dtcSuffix} DTC`
      break
    }

    default:
      failure_detail = effect_local = effect_system = potential_cause = preventive_action = detection_action = '-'
  }

  // Option B: FRS 사양서 요구사항 세부 내용 반영 (제어기능사양서 2절 기반)
  if (frsCtx) {
    const spec = FRS_SPEC_DETAIL[frsCtx.frsId]
    if (spec) {
      // failure_detail에 사양서 임계값/결함 기준 추가 (LATE는 이미 timeout 명시)
      if (hazop !== 'LATE') {
        const thresh = spec.keyThresholds.split(' / ')[0]  // 첫 번째 핵심 임계값만 사용
        failure_detail += ` [${spec.reqIds}: ${thresh}]`
      }
      // preventive_action에 사양서 안전 메커니즘 추가
      preventive_action += `; 사양서 안전메커니즘(${spec.reqIds}): ${spec.safetyMech}`
      // detection_action에 사양서 결함 판정 조건 추가
      detection_action += `; 결함판정기준(${spec.reqIds}): ${spec.faultCondition}`
      // effect_system에 핵심 출력 신호 추가 (ASIL B 신호만)
      if (frsCtx.isAsilB) {
        effect_system += ` → 핵심 출력: ${spec.outputSig}`
      }
    }
  }

  return { function_name, failure_detail, effect_local, effect_system, potential_cause, preventive_action, detection_action }
}

// ── 신호별 심각도 산출 (Severity Criteria 2026 기준) ──────────────────────────
// S=10: 치명적 (배터리 열폭주 등) — SBW 미해당
// S=9 : 법규/안전 규제 위반 (ISO 26262 ASIL B)
// S=8 : 주 기능 완전 상실 (법규 위반 아님)
// S=7 : 주 기능 성능 저하
// S=6 : 2차 기능 완전 상실 (예: 햅틱 IC 부동작)
// S=5 : 2차 기능 성능 저하
// S=4 : 심각한 NVH/조작감 문제 (대부분 감지)
// S=3 : 중간 NVH/조작감 문제 (절반 감지)
// S=2 : 경미한 NVH/조작감 문제 (민감 고객만 감지)
// S=1 : 영향 없음 — effectSystem이 '-' 또는 영향 없음 표현
function getSignalSeverity(
  comp: string, varName: string, frsCtx: FrsContext | null,
  hazop: string, effectSystem: string,
): number {
  // Rule 1: 시스템 영향 없음 → S=1
  if (!effectSystem || effectSystem.trim() === '-' ||
      /영향 없음|아무런 영향|직접.*영향.*없음/i.test(effectSystem)) return 1

  const isValueFault   = ['MORE', 'LESS', 'REVERSE', 'CORRUPT'].includes(hazop)
  const isCompleteLoss = hazop === 'NO'
  // isDegradation: AS_WELL_AS, PART_OF, EARLY, LATE

  // ── FRS 카테고리 기반 (우선 적용) ──────────────────────────────────────────
  if (frsCtx) {
    const { frsId } = frsCtx
    switch (frsId) {
      case 'JG1-FRS-sens':
        // ASIL B 변속단 신호
        // 값 오류: 잘못된 기어값 전달 → ISO 26262 ASIL B 위반 (S=9)
        // 신호 소실(NO): 변속단 기능 완전 상실 (S=8)
        // 타이밍 저하: 변속단 성능 저하 (S=7)
        if (isValueFault)   return 9
        if (isCompleteLoss) return 8
        return 7

      case 'JG1-FRS-rotat':
        // ASIL B 레버 회전 전환
        // 값 오류: 잘못된 회전 상태 → ASIL B 위반 (S=9)
        // 소실: 레버 회전 기능 완전 상실 (S=8)
        // 저하: 회전 전환 성능 저하 (S=7)
        if (isValueFault)   return 9
        if (isCompleteLoss) return 8
        return 7

      case 'JG1-FRS-mode':
        // 동작 모드 (주 기능 제어)
        // 소실(NO): PowerOn 진입 불가 → 변속 기능 전체 비활성화 (S=8)
        // 저하: 모드 전환 지연·부분 기능 저하 (S=7)
        if (isCompleteLoss) return 8
        return 7

      case 'JG1-FRS-light':
        // PRND 인디케이터/무드조명 (2차 기능)
        // 소실(NO): 인디케이터 전체 소등 → 2차 기능 완전 상실 (S=6)
        // 값 오류: 잘못된 기어 표시 → 2차 기능 성능 저하 (S=5)
        // 타이밍: 표시 지연·깜빡임 → 심각한 불쾌감 (S=4)
        if (isCompleteLoss) return 6
        if (isValueFault)   return 5
        return 4

      case 'JG1-FRS-dign':
        // 고장 진단 (2차 안전 기능)
        // 소실(NO): DTC 전체 미기록 → 2차 기능 완전 상실 (S=6)
        // 기타: DTC 오기록·지연 → 2차 기능 성능 저하 (S=5)
        if (isCompleteLoss) return 6
        return 5

      case 'JG1-FRS-hapt':
        // R단 햅틱 (2차 편의 기능) — 사양 예시: "햅틱 IC 부동작" = S=6
        // 소실·값오류: 햅틱 미동작 → 2차 기능 완전 상실 (S=6)
        // 타이밍: 햅틱 타이밍 저하 → 2차 기능 성능 저하 (S=5)
        if (isCompleteLoss || isValueFault) return 6
        return 5
    }
  }

  // ── COMP_CTX 기반 (FRS 컨텍스트 없는 경우) ──────────────────────────────────
  const base = Math.min(COMP_CTX[comp]?.s ?? DEFAULT_CTX.s, 9) // S=10 SBW 미해당

  // 2차 기능 신호 (조명/편의/OTA/도어보조) — 2차 기능 기준 적용
  if (/Alrm|Burglar|FaceDetect|Ambient|MoodCtrl|Mood|Lamp|Lmp|Led|Dim|Bright|Fade|Color|Rgb|SlvColor|SlvBrgt|FadeIn|FadeOut|AutoLtSnsr|NightSta|Illumi|BtnIllumi|IllAlways|Trunk|Trnk|TrnkTlgt|OTA_|OTAMsg|CrankInh|Odometer|OdoVal|AsstDrSw|RrLftDrSw|RrRtDrSw|SSB_Strt|SSB_Stp|Rheo|Rhsta|Hapt|Haptic|Vibrat/i.test(varName)) {
    if (isCompleteLoss || isValueFault) return 6  // 2차 기능 완전 상실
    return 5                                        // 2차 기능 성능 저하
  }
  // 편의 UI 신호
  if (/MoodCtrl|SlvBrgt|HltLvl|BltLvl|AutoBright|RPWM|GPWM|BPWM/i.test(varName)) {
    if (isCompleteLoss) return 6
    return 4  // NVH/조작감 수준
  }
  // ASIL B 핵심 안전 신호 — 주 기능 기준 적용
  if (/GearPos|MotorAct|MotorStop|SysPwr|PosSnr|MovSnr|VoltFail|SbcFlt|BatUnder|BatOver|LvrPos|LvrUnit|PButton|ShiftAct|WdgTrigger|IgnSta|PowerOn|DrvRdy|BusOff/i.test(varName)) {
    if (isValueFault)   return 9
    if (isCompleteLoss) return 8
    return Math.max(7, base - 1)
  }
  // 기본: HAZOP 모드별 차등 적용
  if (isValueFault)   return base
  if (isCompleteLoss) return Math.max(1, base - 1)
  return Math.max(1, base - 2)
}

// ── S/O/D 산출 ─────────────────────────────────────────────────────────────────
function calcSOD(v: IcdVar, hazop: string, ctx: typeof DEFAULT_CTX, frsCtx: FrsContext | null, effectSystem: string) {
  const isE2E = /Crc|AlvCnt|E2E/i.test(v.variable_name)

  // ── Severity ────────────────────────────────────────────────────────────────
  const s = getSignalSeverity(v.sw_component, v.variable_name, frsCtx, hazop, effectSystem)

  // ── Occurrence ──────────────────────────────────────────────────────────────
  // Impact Analysis 기반: 컴포넌트 변경 규모 + 이슈 이력으로 결정
  // HAZOP 모드별 차등 없음 — 동일 FRS 카테고리는 동일 O
  // E2E는 Detection(D)에 반영, Occurrence(O)에 영향 없음
  const o = calcOccurrence(frsCtx?.frsId ?? null, v.sw_component)

  // ── Detection1 ──────────────────────────────────────────────────────────────
  // 설계 유형(CASE A/B) + 검증 계획(DV/PV × 테스트 레벨) 기반
  // 입증된 설계 솔루션(E2E, DTC 감시)은 baseD를 추가 개선
  const d = calcDetection(v, hazop, frsCtx, isE2E)

  // ── Confidence ──────────────────────────────────────────────────────────────
  let confidence = 0.60
  if (v.description.includes('[DBC:')) confidence += 0.15
  if (frsCtx) confidence += 0.15
  if (frsCtx?.dtcId) confidence += 0.08
  if (frsCtx?.isAsilB) confidence += 0.05

  return { s, o, d, confidence: Math.min(0.97, confidence) }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n▶ ICD 파이프라인 시작 (FRS 기반 — 설계 前 FMEA)')
  console.log(`  세션: ${SESSION_ID}`)
  console.log('  참조: JG1 SBW 제어기능사양서 (FRS 패턴 매핑)')

  // 1. ICD 변수 로드
  console.log('\n[1] ICD 변수 로드...')
  const inputVars = (await pool.query(`
    SELECT sw_component, variable_name, variable_type, direction,
           data_type, signal_range, unit, description
    FROM pre_fmea_icd_variables
    WHERE session_id = $1
      AND direction = 'Input'
      AND sw_component NOT IN (
        'COM', 'BswIF_Dcm_10_DSC', 'BswIF_Dcm_85_CDTCS', 'BswIF_Dcm_Service',
        'BswIF_Dcm_Services', 'BswIF_Dcm_19_RDTCI', 'BswIF_Dcm_28_CC',
        'CstAp_DIDMgtCstAp_DtcMgt', 'CstAP_DtcMgt', 'CstAp_CANMgt',
        'CstAp_MoodCntlMgt', 'Dcm', 'BswIF_EcuModeCntl'
      )
      AND LENGTH(variable_name) > 2
    ORDER BY sw_component, variable_type, variable_name
  `, [SESSION_ID])).rows as IcdVar[]

  const outputVars = (await pool.query(`
    SELECT sw_component, variable_name, variable_type, direction,
           data_type, signal_range, unit, description
    FROM pre_fmea_icd_variables
    WHERE session_id = $1
      AND direction = 'Output'
      AND variable_type IN ('CAN_TX', 'HW_OUTPUT', 'SW_INTERNAL')
      AND sw_component IN (
        'BswIF_CAN', 'BswIF_IoHwAb', 'CstAp_CANMGT', 'CstAp_MotorControlMgt',
        'CstAp_PwrMGT', 'CstAp_ECUModeMgt', 'CstAp_ButtonMgt'
      )
    ORDER BY sw_component, variable_name
  `, [SESSION_ID])).rows as IcdVar[]

  const allVars = [...inputVars, ...outputVars]
  console.log(`  입력 신호: ${inputVars.length}개, 출력 신호: ${outputVars.length}개, 합계: ${allVars.length}개`)

  // 2. FMEA 항목 생성
  console.log('\n[2] FMEA 항목 생성 중 (FRS 매핑)...')

  interface FmeaRow {
    sw_component: string; function_name: string; failure_mode: string
    failure_detail: string; effect_local: string; effect_system: string
    potential_cause: string; severity: number; occurrence: number; detection: number
    preventive_action: string; detection_action: string
    confidence_score: number; action_priority: string
  }

  const rows: FmeaRow[] = []
  const seen = new Set<string>()
  let frsHits = 0
  const frsDistribution: Record<string, number> = {}

  for (const v of allVars) {
    const ctx     = COMP_CTX[v.sw_component] ?? DEFAULT_CTX
    const hazops  = getHazopModes(v)
    const frsCtx  = findFrsContext(v.sw_component, v.variable_name)
    if (frsCtx) {
      frsHits++
      frsDistribution[frsCtx.frsId] = (frsDistribution[frsCtx.frsId] ?? 0) + 1
    }

    // 타임아웃 플래그 변수: 값의 이상(CORRUPT)과 누락(NO)만 의미 있음
    const isTimeoutFlag = /Timeout$|_To$|SigTo$/i.test(v.variable_name) && !v.description.includes('[DBC:')

    for (const hazop of hazops) {
      if (isTimeoutFlag && !['CORRUPT', 'NO'].includes(hazop)) continue

      const dedup = `${v.sw_component}|${v.variable_name}|${hazop}`
      if (seen.has(dedup)) continue
      seen.add(dedup)

      const texts = buildTexts(v, hazop, ctx, frsCtx)
      const { s, o, d, confidence } = calcSOD(v, hazop, ctx, frsCtx, texts.effect_system)
      const ap = calculateAP(s, o, d)

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
        confidence_score: confidence,
        action_priority: ap,
      })
    }
  }

  console.log(`  생성 완료: ${rows.length}개 항목 (FRS 매핑: ${frsHits}개 신호, ${Math.round(frsHits / allVars.length * 100)}%)`)

  // AP 분포
  const apDist: Record<string, number> = {}
  const compDist: Record<string, number> = {}
  for (const r of rows) {
    apDist[r.action_priority] = (apDist[r.action_priority] ?? 0) + 1
    compDist[r.sw_component]  = (compDist[r.sw_component]  ?? 0) + 1
  }

  // 3. DB 삽입
  console.log('\n[3] DB 삽입...')
  const client = await pool.connect()
  try {
    const del = await client.query(
      `DELETE FROM pre_fmea_items WHERE session_id=$1 AND source='icd'`,
      [SESSION_ID]
    )
    console.log(`  기존 icd 항목 삭제: ${del.rowCount}개`)

    await client.query('BEGIN')
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority,
          source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'icd','pending')`,
        [SESSION_ID, 'ICD-' + String(i + 1).padStart(4, '0'),
         r.sw_component, r.function_name, r.failure_mode, r.failure_detail,
         r.effect_local, r.effect_system, r.potential_cause,
         r.severity, r.occurrence, r.detection,
         r.preventive_action, r.detection_action,
         r.confidence_score, r.action_priority],
      )
    }
    await client.query('COMMIT')
    console.log(`  삽입 완료: ${rows.length}개 (source='icd')`)
  } catch (e) {
    await client.query('ROLLBACK'); throw e
  } finally {
    client.release()
  }

  // 4. 결과 리포트
  console.log('\n════════════════════════════════════════')
  console.log('ICD 파이프라인 완료 (FRS 기반)')
  console.log('════════════════════════════════════════')
  console.log(`\n총 생성 항목: ${rows.length}개`)
  console.log(`FRS 매핑: ${frsHits}개 신호 (${Math.round(frsHits / allVars.length * 100)}%)`)
  console.log('\n[FRS 분류별 신호 수]')
  for (const [frs, cnt] of Object.entries(frsDistribution).sort((a, b) => b[1] - a[1]))
    console.log(`  ${frs.padEnd(20)}: ${cnt}개 신호`)
  console.log('\n[AP 분포]')
  for (const [ap, cnt] of Object.entries(apDist).sort())
    console.log(`  ${ap}: ${cnt}개 (${Math.round(cnt / rows.length * 100)}%)`)
  console.log('\n[컴포넌트별 항목 수 (상위 15개)]')
  for (const [comp, cnt] of Object.entries(compDist).sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`  ${comp.padEnd(30)}: ${cnt}개`)

  // 샘플 (ASIL B 관련)
  console.log('\n[샘플 — ASIL B FRS-sens/rotat 항목]')
  const samples = rows.filter(r => r.function_name.includes('JG1-FRS-sens') || r.function_name.includes('JG1-FRS-rotat')).slice(0, 5)
  for (const r of samples) {
    console.log(`\n  [${r.sw_component}] ${r.failure_mode} | AP=${r.action_priority}`)
    console.log(`  function: ${r.function_name.slice(0, 80)}`)
    console.log(`  상세: ${r.failure_detail.slice(0, 100)}`)
    console.log(`  S${r.severity}/O${r.occurrence}/D${r.detection} confidence=${r.confidence_score.toFixed(2)}`)
  }

  await pool.end()
  console.log('\n✅ 완료')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
