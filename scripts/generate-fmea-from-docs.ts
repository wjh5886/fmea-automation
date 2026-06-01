/**
 * 설계사양서 + 아키텍처 기반 직접 FMEA 생성 스크립트
 * Claude Code(claude-sonnet-4-6)가 문서를 분석하여 작성한 항목들을 DB에 삽입
 */
import pg from 'pg'

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db'
const pool = new pg.Pool({ connectionString: DB_URL })

type AP = 'VH' | 'H' | 'M' | 'L'
function calcAP(s: number, o: number, d: number): AP {
  if (s >= 9) {
    if (o >= 6) return 'VH'
    if (o >= 4) return d >= 6 ? 'VH' : 'H'
    if (o >= 2) return d >= 6 ? 'H' : 'M'
    return 'L'
  }
  if (s >= 7) {
    if (o >= 6) return d >= 6 ? 'VH' : 'H'
    if (o >= 4) return d >= 6 ? 'H' : 'M'
    if (o >= 2) return d >= 6 ? 'M' : 'L'
    return 'L'
  }
  if (s >= 5) {
    if (o >= 6) return d >= 6 ? 'H' : 'M'
    if (o >= 4) return d >= 6 ? 'M' : 'L'
    return 'L'
  }
  return 'L'
}

type FmeaRow = {
  sw_component: string
  function_name: string
  failure_mode: string
  failure_detail: string
  effect_local: string
  effect_system: string
  potential_cause: string
  severity: number
  occurrence: number
  detection: number
  preventive_action: string
  detection_action: string
  confidence_score: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 설계사양서 + 아키텍처 분석 결과 기반 FMEA 항목
// 각 항목은 실제 문서의 파라미터/로직/ASIL 등급을 반영함
// ─────────────────────────────────────────────────────────────────────────────
const FMEA_ITEMS: FmeaRow[] = [

  // ══════════════════════════════════════════════════════════════════
  // CstAp_PwrMGT [SwC100] / ASIL B — 전원 관리
  // V_IGN_OFF=4V, V_IGN_ON=7V, V_BAT_UNDER=8.5V, V_BAT_OVER=16.5V
  // V_LDO2_UNDER=3.5V, BDCEV_POWERON=1, BDCEV_READY=3
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_IgnStaChk — IGN 전압 기반 PowerOn 상태 판단',
    failure_mode: 'CORRUPT',
    failure_detail: 'CtApIgnStaChk_I_u2_VIgnVolt 값이 V_IGN_OFF(4V)와 V_IGN_ON(7V) 임계값 경계에서 불안정한 값으로 유지되어 PowerOnSta가 STD_ON/STD_OFF 사이에서 진동(chattering)함',
    effect_local: 'PowerOnSta 출력이 반복적으로 토글되어 ECU 모드 전환 로직 불안정',
    effect_system: 'SBW 시스템이 PowerOn ↔ PowerOff를 반복하여 기어 변속 기능 단속적 차단 → 운전자 변속 불가',
    potential_cause: 'IGN 전압 라인 노이즈 또는 배터리 과도상태(시동 시 전압 강하) 구간에서 ADC 값이 V_IGN_OFF(405U)~V_IGN_ON(762U) 범위를 반복 통과',
    severity: 8, occurrence: 4, detection: 4,
    preventive_action: 'IGN 전압 히스테리시스 폭 확대 및 디바운싱 타이머(V_IGN_STABLE: 50ms) 적용',
    detection_action: 'PowerOnSta 상태 토글 횟수 카운터 DTC 설정 및 Unit Test 경계값 검증',
    confidence_score: 0.90,
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_BatVoltChk — 배터리 저전압 감지 (V_BAT_UNDER=8.5V)',
    failure_mode: 'LESS',
    failure_detail: '배터리 전압이 V_BAT_UNDER(8.5V, 962u) 이하로 강하했음에도 저전압 감지 플래그가 설정되지 않아 정상 동작으로 오판단',
    effect_local: 'CstAp_PwrMGT의 저전압 보호 로직 미동작으로 ECU 내부 전압 불안정 지속',
    effect_system: '저전압 환경에서 모터 제어 오동작 또는 CAN 통신 오류 발생 → SBW 기어 포지션 불일치',
    potential_cause: 'ADC 캘리브레이션 오류 또는 V_BAT_UNDER_TIME_SET(2s) 타이머 조건 미달로 플래그 세트 지연',
    severity: 7, occurrence: 3, detection: 4,
    preventive_action: '배터리 전압 ADC 캘리브레이션 주기적 검증 및 V_BAT_UNDER 임계값 마진 확보',
    detection_action: '저전압 감지 DTC(U3003) 설정 및 배터리 전압 실측값 모니터링',
    confidence_score: 0.88,
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_BatVoltChk — 배터리 과전압 감지 (V_BAT_OVER=16.5V)',
    failure_mode: 'MORE',
    failure_detail: '배터리 전압이 V_BAT_OVER(16.5V, 1910u)를 초과했음에도 과전압 플래그가 미설정되어 과전압 보호 미동작',
    effect_local: '과전압 상태에서 ECU 내부 회로 및 액추에이터 손상 위험',
    effect_system: '모터 구동부 과부하 또는 CAN 트랜시버 손상으로 SBW 기능 완전 상실',
    potential_cause: 'V_BAT_OVER_TIME_SET(2s) 타이머 카운터 초기화 버그 또는 ADC 포화값 처리 오류',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: '과전압 임계값 검증 Unit Test 추가 및 HW 과전압 보호 회로 이중화',
    detection_action: '과전압 DTC 즉시 설정(타이머 없이) 및 HW 전압 모니터 출력 비교',
    confidence_score: 0.87,
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_Ldo2VoltChk — LDO2 저전압 감지 (V_LDO2_UNDER=3.5V)',
    failure_mode: 'LESS',
    failure_detail: 'LDO2 전압이 V_LDO2_UNDER(3.5V, 2866u) 미만으로 강하했으나 감지 실패로 내부 로직 전원 공급 불안정 미인지',
    effect_local: 'LDO2 기반 내부 로직 전압 부족으로 MCU 연산 오류 또는 메모리 오염',
    effect_system: 'SBW 전체 소프트웨어 오동작으로 기어 포지션 무결성 상실',
    potential_cause: 'SBC(System Basis Chip) 통신 오류 또는 LDO2 ADC 채널 배선 이상으로 실제 전압보다 높게 측정',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'SBC 상태 모니터링과 LDO2 측정값 교차 검증 로직 적용',
    detection_action: 'LDO2 언더볼트 DTC 즉시 설정 및 V_LDO2_UNDER_TIME_SET(1s) 내 복구 여부 확인',
    confidence_score: 0.86,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_CANMGT [SwC200] / ASIL B — CAN 통신 관리
  // BUSOFF_CHECK_TIME=70u, LVR_R/Nr/Null/Nd/D
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_CANBusOffChk — CAN Bus-Off 감지 및 복구',
    failure_mode: 'LATE',
    failure_detail: 'CAN Bus-Off 상태가 발생했으나 BUSOFF_CHECK_TIME(70u) 내에 감지되지 않아 복구 절차가 지연됨',
    effect_local: 'CAN 버스 통신 중단 상태 지속으로 수신 메시지 버퍼 오버플로우',
    effect_system: 'TCU의 기어 위치 명령(HTCU_GearSlctrDis) 수신 불가 → SBW 기어 변속 불가',
    potential_cause: 'Bus-Off 감지 인터럽트 우선순위 설정 오류 또는 CAN 컨트롤러 에러 레지스터 폴링 주기 초과',
    severity: 8, occurrence: 3, detection: 3,
    preventive_action: 'Bus-Off 감지 인터럽트 최고 우선순위 설정 및 CAN 에러 카운터 실시간 모니터링',
    detection_action: 'CAN Bus-Off DTC 즉시 설정 및 복구 시도 횟수 카운터 기록',
    confidence_score: 0.91,
  },
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_CANBusOffChk — Bus-Off 후 자동 복구',
    failure_mode: 'CORRUPT',
    failure_detail: 'Bus-Off 복구 후 잔류 오류 프레임으로 인해 LVR_Null(0x03) → LVR_D(0x05) 같은 기어 포지션 CAN 메시지가 변조된 값으로 수신됨',
    effect_local: 'CstAp_CANMGT가 잘못된 기어 위치 명령을 상위 로직에 전달',
    effect_system: '운전자 의도와 다른 기어 포지션(예: N→D 대신 N→R) 명령 실행 → 차량 안전사고 위험',
    potential_cause: 'Bus-Off 복구 직후 CAN 버퍼 플러시 미수행으로 이전 손상 프레임 처리',
    severity: 10, occurrence: 2, detection: 4,
    preventive_action: 'Bus-Off 복구 시 수신 버퍼 완전 초기화 및 첫 수신 메시지 유효성 검증 후 적용',
    detection_action: 'E2E/CRC 검증 실패 시 메시지 무효화 및 DTC 설정, 기어 포지션 Plausibility 체크',
    confidence_score: 0.89,
  },
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CAN 기어 포지션 수신 — LVR_R/Nr/Null/Nd/D 처리',
    failure_mode: 'MORE',
    failure_detail: '수신된 CAN 기어 위치 값이 정의된 범위(LVR_R=0x01~LVR_D=0x05) 외의 값(예: 0x06 이상)으로 수신되어 유효하지 않은 기어 상태로 처리',
    effect_local: 'CANMGT 내부 기어 상태 테이블 오염으로 잘못된 기어 포지션 출력',
    effect_system: '정의되지 않은 기어 상태로 인한 모터 제어 이상 동작',
    potential_cause: '송신 ECU(TCU)의 소프트웨어 버그 또는 CAN 프레임 비트 오류로 0x06+ 값 수신',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: '수신 기어 값 유효 범위(0x01~0x05) 화이트리스트 검증 후 기본값(LVR_Null) 적용',
    detection_action: '범위 외 값 감지 시 즉시 DTC 설정 및 이전 유효값 유지 처리',
    confidence_score: 0.92,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_ECUModeMgt [SwC300] / ASIL B — ECU 모드 관리
  // VEHICLE_POWER_POWER_OFF/ON, Sleep/Wakeup/Standby
  // WAKEUP_TIME=180s
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk — ECU 모드 전환 (OFF→ON→Sleep)',
    failure_mode: 'CORRUPT',
    failure_detail: 'ECU 모드 상태 머신이 VEHICLE_POWER_POWER_OFF(0)와 VEHICLE_POWER_POWER_ON(1) 사이에서 비정상 전환 발생 (예: ON 상태에서 직접 Sleep 진입)',
    effect_local: '모드 전환 시퀀스 이상으로 일부 컴포넌트 미초기화 또는 미해제 상태 발생',
    effect_system: 'SBW 부분 기능만 활성화된 상태로 동작하여 기어 변속 중 시스템 불완전 상태',
    potential_cause: '외부 ECU에서 동시 다발적 모드 변경 요청 수신 또는 상태 전환 우선순위 처리 오류',
    severity: 8, occurrence: 3, detection: 4,
    preventive_action: '모드 전환 상태 머신에 유효한 전환만 허용하는 트랜지션 테이블 검증 로직 추가',
    detection_action: '비유효 모드 전환 감지 DTC 및 Unit Test로 모든 상태 전환 경로 검증',
    confidence_score: 0.87,
  },
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk — Wakeup 타이머 관리 (WAKEUP_TIME=180s)',
    failure_mode: 'LATE',
    failure_detail: 'Wakeup 상태 진입 후 WAKEUP_TIME(180s=18000u) 타이머가 정상 만료되지 않아 Sleep 전환이 무한 지연됨',
    effect_local: 'ECU가 Wakeup 상태를 계속 유지하여 불필요한 전력 소비 지속',
    effect_system: '차량 주차 중 배터리 방전 위험, 재시동 후 SBW 초기화 오류 가능성',
    potential_cause: '타이머 카운터 변수 오버플로우 또는 주기적 리셋으로 인한 타이머 재시작',
    severity: 5, occurrence: 3, detection: 5,
    preventive_action: '타이머 변수 타입 범위 검증(uint32 최대값 대비) 및 타이머 독립 모니터링 추가',
    detection_action: '타이머 만료 watchdog 및 Wakeup 지속 시간 DTC 설정',
    confidence_score: 0.83,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_ButtonMgt [SwC500] / ASIL B — 버튼 입력 처리
  // SW1: ON(2356~2604u) OFF(804~889u)
  // SW2: ON(3156~3488u) OFF(1608u~)
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ButtonMgt',
    function_name: '변속 버튼 입력 처리 — P/R/N/D 스위치 전압 감지',
    failure_mode: 'CORRUPT',
    failure_detail: 'P/R/N/D 버튼의 ADC 전압값이 ON 범위(SW1: 2356~2604u)와 OFF 범위(804~889u) 중간의 불명확한 값으로 측정되어 잘못된 버튼 상태로 판정',
    effect_local: '의도하지 않은 기어 변속 명령 발생 또는 버튼 입력 무시',
    effect_system: '운전자가 P를 선택했으나 N 또는 D로 판정되어 차량 안전 위협',
    potential_cause: '버튼 접촉 불량, 스위치 기계적 마모 또는 EMI로 ADC 값이 중간값 유지',
    severity: 9, occurrence: 3, detection: 3,
    preventive_action: '버튼 디바운싱 시간 증가 및 ON/OFF 범위 사이 Dead-Zone 처리(무효 구간 정의)',
    detection_action: '버튼 상태 이중 샘플링 비교 및 중간값 지속 감지 DTC 설정',
    confidence_score: 0.91,
  },
  {
    sw_component: 'CstAp_ButtonMgt',
    function_name: '변속 버튼 입력 처리 — 복수 버튼 동시 입력',
    failure_mode: 'MORE',
    failure_detail: '두 개 이상의 변속 버튼(예: P + D)이 동시에 ON 전압 범위로 감지되어 복수 기어 명령이 동시 발생',
    effect_local: '복수 기어 명령 우선순위 처리 로직 오동작으로 불명확한 기어 출력',
    effect_system: '모터 제어 로직이 충돌하는 기어 명령을 수신하여 액추에이터 오동작 또는 정지',
    potential_cause: '전기적 합선 또는 소프트웨어에서 복수 입력 처리 로직 누락',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: '복수 버튼 동시 입력 감지 시 모든 입력 무효 처리 및 이전 기어 유지 로직 구현',
    detection_action: '복수 입력 감지 DTC 설정 및 Unit Test로 조합 시나리오 검증',
    confidence_score: 0.88,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_PosMgt [SwC800] / ASIL B — 위치 센서 관리 (최고 안전 중요도)
  // PosSnrRngFltMin=100u, PosSnrRngFltMax=900u
  // PosSnrGapFltMin=950u, PosSnrGapFltMax=1050u (센서 간 차이 허용범위)
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorFltChk — 위치 센서 범위 이상 감지',
    failure_mode: 'MORE',
    failure_detail: 'PositionSensor ADC 값이 PosSnrRngFltMax(900u)를 초과하는 값으로 지속 수신되나 범위 이상 감지 로직이 동작하지 않아 유효 값으로 처리',
    effect_local: '비정상 위치 센서 값이 기어 포지션 계산에 사용되어 오산출',
    effect_system: '실제 기어 레버 위치와 다른 포지션으로 SBW가 인식하여 잘못된 기어 변속 실행 → ASIL B 안전 위반',
    potential_cause: '위치 센서(포텐셔미터) 기계적 손상 또는 ADC 기준 전압 변동으로 900u 초과값 지속 발생',
    severity: 9, occurrence: 3, detection: 3,
    preventive_action: '범위 이상 감지 시 즉시 폴백(이전 유효값 유지) 및 안전 상태 진입 로직 구현',
    detection_action: '위치 센서 범위 이상 DTC 즉시 설정 및 센서 A/B 교차 검증으로 이상 센서 식별',
    confidence_score: 0.93,
  },
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorFltChk — 센서 간 Gap 이상 감지',
    failure_mode: 'CORRUPT',
    failure_detail: '이중화된 위치 센서 A와 B의 값 차이가 허용 범위(PosSnrGapFltMin=950u~PosSnrGapFltMax=1050u)를 벗어났음에도 Gap 이상 감지 미동작으로 단일 센서 값 사용 지속',
    effect_local: '한 센서가 고장난 상태에서 검증 없이 결함 센서 값으로 위치 계산',
    effect_system: '결함 있는 위치 정보로 모터 제어 → 기어 레버가 목표 위치에 도달하지 못하거나 초과 이동',
    potential_cause: '센서 커넥터 부분 접촉불량으로 센서 B 값이 드리프트하여 Gap이 허용 범위를 이탈',
    severity: 10, occurrence: 3, detection: 3,
    preventive_action: '센서 Gap 감지 즉시 양 센서 무효화 및 안전 상태(기어 잠금) 진입',
    detection_action: '센서 이중화 불일치 DTC(고우선순위) 설정 및 센서 Gap 연속 모니터링',
    confidence_score: 0.94,
  },
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorInfo — 기어 포지션 계산 및 출력',
    failure_mode: 'LESS',
    failure_detail: 'ADC 평균 필터링 과정에서 샘플 수 부족(센서 오류로 일부 샘플 제외)으로 실제 레버 위치보다 낮은 포지션 값 출력',
    effect_local: '기어 레버가 D 위치에 있으나 N 또는 R 위치로 계산되어 출력',
    effect_system: '운전자 의도와 반대 기어(R) 선택 위험 또는 의도치 않은 N 상태 유지로 차량 미동',
    potential_cause: '고속 레버 이동 중 일부 ADC 샘플이 범위 이상으로 필터에서 제외되어 평균값 왜곡',
    severity: 9, occurrence: 3, detection: 4,
    preventive_action: '유효 샘플 최소 수량 미달 시 포지션 값 업데이트 중단 및 이전 유효값 유지',
    detection_action: '유효 샘플 부족 감지 DTC 및 레버 이동 속도 모니터링으로 고속 이동 시 필터 파라미터 조정',
    confidence_score: 0.90,
  },
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorPosSet — P/R/N/D 목표 위치 설정',
    failure_mode: 'EARLY',
    failure_detail: '레버가 목표 포지션(예: D 구간)에 완전히 도달하기 전에 기어 변속 완료 신호가 조기 출력됨',
    effect_local: '모터 제어 로직이 변속 완료로 판단하고 모터 구동 조기 정지',
    effect_system: '레버가 정확한 기어 위치에 고정되지 않은 상태에서 D 기어 적용 → 실제로는 N에 걸쳐진 상태',
    potential_cause: 'PositionPosSet 판정 임계값이 실제 기계적 레버 도달 위치보다 좁게 설정되어 조기 판정',
    severity: 9, occurrence: 3, detection: 4,
    preventive_action: 'P/R/N/D 각 포지션 판정 구간을 기계적 공차 포함하여 충분한 마진으로 설정',
    detection_action: '변속 완료 후 레버 고정 위치 재확인 로직 및 모터 전류 모니터링으로 실제 고정 여부 확인',
    confidence_score: 0.89,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_MotorControlMgt [SwC700] / ASIL B — 모터 제어 관리
  // STATE: NO_ACTION/TURN_DIAL/TURN_SPHERE
  // MODE: OFF/NORMAL/UTILITY/SERVICE
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl — 다이얼 회전 모터 제어',
    failure_mode: 'MORE',
    failure_detail: '목표 다이얼 위치(DIAL_POSITION) 도달 후에도 모터가 계속 회전하여 기구적 정지 위치(End Stop)에 충돌',
    effect_local: '모터 과전류 및 기구부 손상으로 CstAp_MotorControlMgt 이상 상태 진입',
    effect_system: '기어 레버 물리적 파손으로 SBW 기능 완전 상실 및 수동 변속 불가',
    potential_cause: '위치 센서 피드백 루프 지연 또는 모터 제어 PID 파라미터 과조정(overshoot)으로 목표 위치 초과',
    severity: 8, occurrence: 3, detection: 4,
    preventive_action: 'End Stop 이전 소프트 리밋 설정 및 모터 전류 급증 감지 시 즉시 정지 로직 구현',
    detection_action: '모터 과전류 DTC 및 위치 오버슈트 감지 로직, 기계적 정지점 접근 경고 인터럽트',
    confidence_score: 0.91,
  },
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl — ECU 모드 전환 시 모터 동작',
    failure_mode: 'LATE',
    failure_detail: 'OFF_MODE→NORMAL_MODE 전환 시 모터 초기화가 완료되지 않은 상태에서 기어 변속 명령이 실행됨',
    effect_local: '초기화 미완료 모터 제어기에 명령 인가로 예측 불가한 모터 동작',
    effect_system: '초기화 중 의도치 않은 기어 레버 이동으로 주차 중 기어 빠짐 위험',
    potential_cause: 'ECUModeMgt의 모드 전환 완료 신호 지연 또는 MotorControl 초기화 완료 플래그 미확인',
    severity: 8, occurrence: 3, detection: 4,
    preventive_action: '모터 초기화 완료 플래그 확인 후에만 외부 변속 명령 수락하는 Ready 게이팅 로직 구현',
    detection_action: '초기화 미완료 상태에서의 명령 수신 DTC 및 초기화 시간 초과 감지',
    confidence_score: 0.88,
  },
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl — 모터 고장 감지 (TurnDialErrorDetection)',
    failure_mode: 'CORRUPT',
    failure_detail: 'MOTOR_FAULT_DETECTION 신호가 실제 고장이 없는 상황에서 오감지(False Positive)되어 정상 변속 중 모터 강제 정지',
    effect_local: '변속 동작 중 모터 정지로 레버가 중간 위치(기어 경계)에 고착',
    effect_system: '레버가 N/D 경계에 위치한 상태로 확정되지 않은 기어 상태 지속 → 예기치 않은 차량 거동',
    potential_cause: '모터 전류 측정 노이즈로 인한 과전류 오감지 또는 진단 임계값 과민 설정',
    severity: 8, occurrence: 4, detection: 4,
    preventive_action: '모터 고장 판정 임계값 노이즈 마진 포함 설정 및 연속 2회 이상 감지 시만 고장 처리',
    detection_action: '고장 감지 카운터 기반 DTC 설정 및 고장/정상 상태 전환 이력 기록',
    confidence_score: 0.87,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_MovingMgt [SwC900] / ASIL B — 이동 감지 관리
  // MovingSnrRngFltMin=100u, MovingSnrRngFltMax=900u
  // MovingSnrSnrGapFltMin=950u, MovingSnrSnrGapFltMax=1050u
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_MovingMgt',
    function_name: 'CtAp_MovingSensorIn — 이동 완료 감지',
    failure_mode: 'CORRUPT',
    failure_detail: '레버 이동 중 MovingSnr 센서 값이 MovingSnrRngFltMax(900u) 범위 내에 있으나 물리적으로 레버가 목표 위치에 미도달한 상태에서 이동 완료로 오판',
    effect_local: 'CstAp_MovingMgt가 이동 완료 신호를 모터 제어 로직에 조기 전달',
    effect_system: '레버가 정확한 P/R/N/D 위치에 미도달한 상태로 기어 확정 → 기어 슬립 또는 불완전 기어 체결',
    potential_cause: '이동 완료 판정 센서의 히스테리시스 부족 또는 기계적 진동으로 인한 센서 값 불안정',
    severity: 9, occurrence: 3, detection: 4,
    preventive_action: '이동 완료 판정에 위치 센서(CstAp_PosMgt)와 이동 센서(CstAp_MovingMgt) 모두 일치 조건 요구',
    detection_action: '이동 완료 후 위치 유지 시간 검증 및 센서 불일치 감지 DTC 설정',
    confidence_score: 0.88,
  },
  {
    sw_component: 'CstAp_MovingMgt',
    function_name: 'CtAp_MovingSensorIn — 센서 간 Gap 이상 감지 (MovingSnrSnrGapFlt)',
    failure_mode: 'LESS',
    failure_detail: '두 이동 센서 간 차이가 MovingSnrSnrGapFltMin(950u) 미만으로 감지되어 센서 쇼트(단락) 상태를 정상으로 오판',
    effect_local: '두 센서가 동일한 고장 값을 출력하는 공통 원인 고장(CCF)을 감지 불가',
    effect_system: 'ASIL B 이중화 요구사항 미충족 상태에서 동작 지속 → 잠재적 안전 기능 상실',
    potential_cause: '두 센서의 공통 배선 이상(GND 쇼트)으로 양쪽 센서가 동일한 낮은 값 출력',
    severity: 9, occurrence: 2, detection: 5,
    preventive_action: '센서 전원/GND 라인 물리적 분리 설계 및 최소 Gap 임계값 하한(950u) 0 케이스 별도 처리',
    detection_action: '센서 Gap 하한 이하 DTC 설정 및 센서 전원 라인 독립 모니터링',
    confidence_score: 0.86,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_HapticControlMgt [SwC600] / ASIL B — 햅틱 제어
  // SPI 통신, CAN_GEAR_POS_R=7, LVR_R=1
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_HapticControlMgt',
    function_name: 'CtAp_HapticControl — 기어 변속 시 햅틱 피드백 출력',
    failure_mode: 'CORRUPT',
    failure_detail: 'SPI 통신 오류로 햅틱 액추에이터에 잘못된 진동 패턴 명령(SELECT_PLAYBACK=9 외의 값)이 전달되어 비정상 진동 발생',
    effect_local: '햅틱 액추에이터 오동작으로 예상치 못한 강도/패턴의 진동',
    effect_system: '운전자가 잘못된 촉각 피드백으로 기어 변속 완료를 오인 → 추가 버튼 조작으로 이중 입력 발생',
    potential_cause: 'SPI 버스 노이즈 또는 DMA 전송 오류로 햅틱 파라미터 바이트 변조',
    severity: 5, occurrence: 3, detection: 5,
    preventive_action: 'SPI 전송 체크섬 검증 및 햅틱 명령 유효 범위(SELECT_PLAYBACK 정의값) 검증 후 전송',
    detection_action: 'SPI 오류 카운터 DTC 및 햅틱 응답 수신 확인(ACK) 로직 구현',
    confidence_score: 0.82,
  },
  {
    sw_component: 'CstAp_HapticControlMgt',
    function_name: 'CtAp_HapticControl — R 기어 선택 햅틱 (CAN_GEAR_POS_R=7 vs LVR_R=1)',
    failure_mode: 'LATE',
    failure_detail: 'VCU CAN 기어 포지션(CAN_GEAR_POS_R=7)과 레버 실제 위치(LVR_R=1) 비교 후 R 기어 확인 햅틱이 정상보다 늦게 출력됨 (500ms 이상 지연)',
    effect_local: '햅틱 피드백 지연으로 운전자 조작 확인 불가',
    effect_system: '피드백 지연으로 운전자가 R 기어 확인 전 추가 조작 시도 → 연속 명령 중복 발생',
    potential_cause: 'CAN 수신 지연 또는 햅틱 제어 태스크 우선순위 낮아 스케줄링 지연',
    severity: 4, occurrence: 3, detection: 5,
    preventive_action: '햅틱 피드백 출력 태스크 우선순위 상향 및 최대 응답 시간(100ms) 정의',
    detection_action: '햅틱 출력 지연 시간 모니터링 DTC 및 응답 시간 Unit Test 검증',
    confidence_score: 0.80,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_DtcMgt [SwC1200] / ASIL B — DTC 관리
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_DtcMgt',
    function_name: 'CtAp_DtcEnCndChk — DTC 활성화 조건 판단',
    failure_mode: 'CORRUPT',
    failure_detail: 'DTC 활성화 조건(Enable Condition) 판단 오류로 실제 고장이 발생했음에도 DTC가 저장되지 않거나 정상 상태에서 DTC가 과다 설정됨',
    effect_local: '고장 이력 미기록으로 향후 진단 불가 또는 False DTC로 불필요한 정비 유발',
    effect_system: '안전 관련 고장(위치 센서 이상, 전압 이상)의 DTC 미기록으로 ASIL B 안전 추적성 손실',
    potential_cause: 'Enable Condition 논리 오류(AND/OR 조건 반전) 또는 DTC 활성화 타이밍 경쟁 조건',
    severity: 7, occurrence: 3, detection: 4,
    preventive_action: 'DTC Enable Condition 로직 형식 검증(Formal Verification) 및 독립 리뷰 수행',
    detection_action: 'DTC 설정/미설정 조건 Unit Test 100% 커버리지 및 진단 툴 검증',
    confidence_score: 0.85,
  },
  {
    sw_component: 'CstAp_DtcMgt',
    function_name: 'CtAp_DtcEnCndChk — DTC NvM 저장',
    failure_mode: 'LATE',
    failure_detail: 'DTC 발생 후 NvM(비휘발성 메모리) 저장이 ECU 전원 차단 전까지 완료되지 않아 DTC 이력 소실',
    effect_local: '전원 차단 후 DTC 데이터 손실로 고장 이력 추적 불가',
    effect_system: '안전 관련 고장(CstAp_PosMgt 센서 이상 등) 이력 소실로 재발 방지 조치 불가',
    potential_cause: 'NvM 쓰기 큐 지연 또는 전원 차단 시 NvM 쓰기 완료 대기 로직 미구현',
    severity: 6, occurrence: 3, detection: 5,
    preventive_action: '전원 차단 감지 시 즉시 NvM 긴급 저장 루틴 실행 및 쓰기 완료 확인 후 전원 차단 허용',
    detection_action: 'NvM 쓰기 실패 카운터 및 DTC 저장 완료 플래그 검증',
    confidence_score: 0.84,
  },

  // ══════════════════════════════════════════════════════════════════
  // BswIF_CAN [SwC1300] / ASIL B — CAN BSW 인터페이스
  // E2E 보호, CRC/AlvCnt
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_CAN',
    function_name: 'CAN 메시지 수신 및 E2E 검증',
    failure_mode: 'CORRUPT',
    failure_detail: 'E2E 보호가 적용된 CAN 메시지(HTCU_04_10ms의 HTCU_Crc4Val)에서 CRC 오류가 감지되었으나 E2E 라이브러리가 해당 메시지를 유효로 처리',
    effect_local: 'CRC 오류 메시지가 상위 CstAp_CANMGT에 전달되어 오염된 기어 명령 처리',
    effect_system: '손상된 기어 위치 명령 실행으로 의도치 않은 기어 변속 → 차량 안전 위협',
    potential_cause: 'E2E Profile 구현 오류 또는 CRC 계산 모듈의 초기화 버그로 CRC 검증 로직 우회',
    severity: 10, occurrence: 2, detection: 3,
    preventive_action: 'E2E Profile 2 표준 구현 검증 및 독립 CRC 검증 라이브러리 사용',
    detection_action: 'E2E 오류 카운터 즉시 DTC 설정 및 오류 발생 메시지 ID/타임스탬프 기록',
    confidence_score: 0.93,
  },
  {
    sw_component: 'BswIF_CAN',
    function_name: 'CAN 수신 데이터 유효성 처리 — Alive Counter',
    failure_mode: 'LATE',
    failure_detail: 'HTCU_AlvCnt4Val 롤링 카운터가 예상 시퀀스에서 벗어났으나(지연 또는 순서 역전) 타임아웃 감지가 지연되어 오래된 메시지가 유효로 처리됨',
    effect_local: '타임아웃된 기어 포지션 명령이 최신 명령으로 처리되어 이전 상태로 복귀',
    effect_system: '이미 완료된 변속이 취소되거나 이전 기어 명령이 재실행되는 예측 불가 거동',
    potential_cause: 'CAN 버스 지연 급증 시 AlvCnt 시퀀스 불연속 발생 및 타임아웃 윈도우 미조정',
    severity: 8, occurrence: 3, detection: 4,
    preventive_action: 'AlvCnt 불연속 감지 즉시 메시지 무효화 및 타임아웃 윈도우를 메시지 주기의 3배로 설정',
    detection_action: 'AlvCnt 시퀀스 오류 DTC 및 수신 주기 이탈 감지 로직',
    confidence_score: 0.88,
  },

  // ══════════════════════════════════════════════════════════════════
  // BswIF_WdgM / BswIF_SafetyLib — 워치독 및 안전 라이브러리
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_WdgM',
    function_name: '소프트웨어 워치독 관리 — 주기적 서비싱',
    failure_mode: 'LATE',
    failure_detail: '태스크 우선순위 역전 또는 무한 루프로 인해 워치독 서비싱(Servicing) 주기가 만료되어 ECU 강제 리셋 발생',
    effect_local: 'ECU 리셋으로 모든 SW 컴포넌트 재초기화 필요',
    effect_system: '기어 변속 동작 중 ECU 리셋 발생 시 레버가 중간 위치에 고착될 수 있음',
    potential_cause: 'CstAp_MotorControlMgt 또는 BswIF_CAN의 블로킹 연산으로 워치독 서비싱 태스크 지연',
    severity: 8, occurrence: 3, detection: 3,
    preventive_action: '워치독 서비싱 태스크 최고 우선순위 보장 및 모든 태스크의 실행 시간 상한 정의',
    detection_action: '워치독 리셋 이벤트 DTC 기록 및 재부팅 원인 분석 로그 NvM 저장',
    confidence_score: 0.87,
  },
  {
    sw_component: 'BswIF_SafetyLib',
    function_name: '안전 라이브러리 — 메모리 무결성 검증',
    failure_mode: 'CORRUPT',
    failure_detail: '소프트웨어 실행 중 스택 오버플로우 또는 메모리 경계 침범으로 CstAp_PosMgt의 위치 임계값 변수가 변조됨',
    effect_local: '위치 임계값 변조로 잘못된 기어 포지션 판정 기준 적용',
    effect_system: '변조된 임계값으로 잘못된 기어 위치 계산 → ASIL B 안전 기능 무결성 상실',
    potential_cause: '재귀 함수의 스택 깊이 초과 또는 배열 인덱스 범위 초과로 인접 메모리 변조',
    severity: 10, occurrence: 2, detection: 4,
    preventive_action: 'MISRA-C 준수로 동적 메모리 금지, 스택 크기 정적 분석 및 스택 카나리 패턴 적용',
    detection_action: '메모리 보호 유닛(MPU) 활성화 및 핵심 변수 CRC 주기적 검증',
    confidence_score: 0.90,
  },

  // ══════════════════════════════════════════════════════════════════
  // CstAp_IdtMgt [SwC400] / ASIL B — 조명 제어
  // DIM_TIME 상태별 PWM 듀티 제어
  // ══════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_IdtMgt',
    function_name: 'CtAp_IdtCntl — 환경 조도 기반 PWM 밝기 제어',
    failure_mode: 'MORE',
    failure_detail: 'DIM_TIME_NIGHT(3) 상태에서 적용되어야 할 낮은 PWM 듀티 대신 DIM_TIME_DAY(1)의 높은 PWM 듀티(WELCOME_PWM_DUTY=33u)가 지속 출력됨',
    effect_local: '야간 환경에서 SBW 조명이 과도하게 밝아 운전자 눈부심 유발',
    effect_system: '운전자 시야 방해로 운전 안전성 저하 (안전 중요도 낮음)',
    potential_cause: 'DIM_TIME 상태값 수신 CAN 메시지(BCM) 수신 실패로 기본값(DAY) 유지',
    severity: 3, occurrence: 4, detection: 5,
    preventive_action: 'DIM_TIME CAN 메시지 타임아웃 시 안전 기본값(EARLY_NIGHT) 적용',
    detection_action: 'BCM 메시지 타임아웃 감지 DTC 및 조도 센서 로컬 측정값 보조 활용',
    confidence_score: 0.80,
  },
]

async function main() {
  console.log(`\n▶ 설계사양서 기반 FMEA 직접 생성`)
  console.log(`  세션: ${SESSION_ID}`)
  console.log(`  생성 항목: ${FMEA_ITEMS.length}개`)

  const client = await pool.connect()
  try {
    // 기존 AI 항목 삭제
    await client.query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [SESSION_ID])
    console.log(`\n  기존 AI 항목 삭제 완료`)

    await client.query('BEGIN')
    for (let i = 0; i < FMEA_ITEMS.length; i++) {
      const row = FMEA_ITEMS[i]
      const s = row.severity, o = row.occurrence, d = row.detection
      const ap = calcAP(s, o, d)
      const item_no = String(i + 1).padStart(4, '0')

      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [SESSION_ID, item_no, row.sw_component, row.function_name, row.failure_mode,
         row.failure_detail, row.effect_local, row.effect_system, row.potential_cause,
         s, o, d, row.preventive_action, row.detection_action,
         row.confidence_score, ap],
      )
    }
    await client.query('COMMIT')

    await client.query(
      "UPDATE pre_fmea_sessions SET status = 'generated', updated_at = now() WHERE id = $1",
      [SESSION_ID],
    )

    // 결과 요약
    const apDist: Record<string, number> = {}
    const compDist: Record<string, number> = {}
    for (const row of FMEA_ITEMS) {
      const ap = calcAP(row.severity, row.occurrence, row.detection)
      apDist[ap] = (apDist[ap] ?? 0) + 1
      compDist[row.sw_component] = (compDist[row.sw_component] ?? 0) + 1
    }

    console.log(`\n✅ DB 삽입 완료: ${FMEA_ITEMS.length}개\n`)
    console.log('[AP 분포]')
    for (const [ap, cnt] of Object.entries(apDist).sort()) {
      console.log(`  ${ap}: ${cnt}개`)
    }
    console.log('\n[SW 컴포넌트별 항목 수]')
    for (const [comp, cnt] of Object.entries(compDist).sort()) {
      console.log(`  ${comp}: ${cnt}개`)
    }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error('❌', e); process.exit(1) })
