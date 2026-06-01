/**
 * Claude Code 직접 생성 스크립트 — API 크레딧 없이 이 대화에서 분석한 내용으로 FMEA 항목 생성.
 * SBW ICD 변수 × HAZOP × SBW 도메인 지식 기반.
 */
import pg from 'pg'
import { calculateAP } from '../src/lib/ap-calculator.js'

const SESSION_ID = process.argv[2] ?? '263a3e7c-460a-4a2f-998d-99f079137c3f'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db' })

type FM = 'MORE' | 'LESS' | 'CORRUPT' | 'EARLY' | 'LATE'
interface FmeaItem {
  sw_component: string
  function_name: string
  failure_mode: FM
  failure_detail: string
  effect_local: string
  effect_system: string
  potential_cause: string
  severity: number
  occurrence: number
  detection: number
  preventive_action: string
  detection_action: string
}

// ── AP 계산 래퍼 ──────────────────────────────────────────────────────────────
function ap(s: number, o: number, d: number) { return calculateAP(s, o, d) }

// ── FMEA 항목 정의 ─────────────────────────────────────────────────────────────
const items: FmeaItem[] = [

  // ══════════════════════════════════════════════════════
  // CstAp_MotorControlMgt — 모터 제어 (최고 안전 등급 ASIL B)
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'MotorFaultPinChek',
    failure_mode: 'CORRUPT',
    failure_detail: '모터 드라이버 Fault 핀 신호가 실제 고장 상태임에도 정상(STD_OFF=0)으로 잘못 판정됨',
    effect_local: 'CstAp_MotorControlMgt가 모터 고장을 감지하지 못하고 모터 구동 지속',
    effect_system: '모터 과열·손상 상태에서 변속 레버 작동 지속 → 기계적 손상 및 화재 위험',
    potential_cause: 'IoHwAb ADC 채널 노이즈 또는 단선으로 핀 레벨 오판독; H/W 인터럽트 폴링 주기 불일치',
    severity: 9, occurrence: 2, detection: 4,
    preventive_action: '모터 드라이버 Fault 핀에 풀업/풀다운 저항 설계 및 디바운스 로직 적용',
    detection_action: 'MotorFaultPinChek 신호 Range Check + 모터 전류 교차 검증 (Safety Mechanism)',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'VPC_SafetyModeStaFlag',
    failure_mode: 'CORRUPT',
    failure_detail: 'VPC Safety Mode 상태 신호가 Off(0x0) 상태인데 On(0x1)으로 잘못 수신됨',
    effect_local: 'MotorControlMgt가 불필요하게 Safety Mode 진입 → 모터 잠금',
    effect_system: '차량 주행 중 SBW 변속 불가 → 운전자 조작 불능 상태 발생',
    potential_cause: 'CstAp_CANMGT의 VPCAMsg 신호 파싱 오류; CAN 메시지 E2E 검증 우회',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'Safety Mode 전환 전 이중 검증 로직 (메인/서브 CAN 교차 확인)',
    detection_action: '진단 DTC(DTC_FD54) Safety Mode 비정상 진입 검출',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'VPC_SafetyModeStaFlag',
    failure_mode: 'LESS',
    failure_detail: 'VPC Safety Mode 신호가 On 상태여야 하는데 Off로 수신됨 (안전 모드 미진입)',
    effect_local: '위험 상황에서 모터 미잠금 → 의도치 않은 변속 가능',
    effect_system: '차량 이상 상태(고전압 누전 등)에서 SBW 계속 동작 → 2차 사고 위험',
    potential_cause: 'VPC CAN 메시지 Timeout 또는 신호 누락; Gateway 신호 변환 오류',
    severity: 9, occurrence: 2, detection: 4,
    preventive_action: 'VPC 신호 Timeout 시 기본값(Safety On)으로 Fail-Safe 처리',
    detection_action: '진단 MCU_01_Timeout 발생 시 DTC 저장 및 경고',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'DIR',
    failure_mode: 'CORRUPT',
    failure_detail: '모터 방향 제어 신호(DIR)가 반전됨 (0→1 또는 1→0으로 잘못 출력)',
    effect_local: 'MotorControlMgt가 반대 방향으로 모터 구동',
    effect_system: 'SBW 레버가 의도한 기어(예: D) 대신 반대 방향(예: R)으로 이동 → 급가속·충돌 위험',
    potential_cause: 'IoHwAb GPIO 출력 레지스터 쓰기 오류; 인터럽트 처리 중 레이스 컨디션',
    severity: 9, occurrence: 2, detection: 4,
    preventive_action: '모터 방향 출력 후 위치 센서(MovingMgt) 교차 검증; 방향 출력 전 안전 조건 확인',
    detection_action: 'Hall 센서 피드백과 DIR 명령 불일치 시 즉시 모터 정지 Safety Mechanism',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'EN',
    failure_mode: 'CORRUPT',
    failure_detail: '모터 Enable 신호(EN)가 비활성(0)이어야 할 때 활성(1)으로 잘못 출력됨',
    effect_local: '정지 명령 후에도 모터가 계속 구동됨',
    effect_system: '목표 기어 위치 초과 이동 → 레버 기계적 충돌 및 의도치 않은 기어 체결',
    potential_cause: 'MotorActivation 신호 OFF 명령이 EN 출력에 반영되지 않는 타이밍 결함',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'EN 신호와 MotorActivation 간 동기화 검증; 위치 도달 후 EN 즉시 비활성화',
    detection_action: 'MotorStopSig 전송 후 EN 상태 모니터링; 불일치 시 DTC 생성',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'MotorActivation',
    failure_mode: 'CORRUPT',
    failure_detail: 'MotorActivation 신호가 정지(STD_OFF) 상태인데 활성(STD_ON)으로 CAN에 송신됨',
    effect_local: 'CstAp_CANMGT가 모터 활성 상태로 잘못 인식',
    effect_system: '클러스터에 변속 진행 중 표시; 실제 미작동 상태에서 추가 변속 명령 허용',
    potential_cause: 'MotorActivation 플래그 초기화 누락; 컴포넌트 재시작 시 이전 상태 유지',
    severity: 7, occurrence: 3, detection: 4,
    preventive_action: 'MotorActivation 신호 출력 전 실제 모터 전류 확인 후 전송',
    detection_action: '모터 전류 피드백과 MotorActivation 상태 교차 진단',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'MotorStopSig',
    failure_mode: 'LESS',
    failure_detail: 'MotorStopSig가 전송되지 않아 모터 정지 명령 미전달',
    effect_local: 'CstAp_CANMGT가 모터 정지 상태를 인식하지 못함',
    effect_system: '기어 위치 도달 후에도 모터 계속 구동 → 기계 과부하 및 레버 손상',
    potential_cause: '모터 위치 완료 판정 로직 오류; 센서 피드백 손실로 완료 미판정',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: '타이머 기반 Watchdog: 최대 구동 시간 초과 시 강제 정지',
    detection_action: 'MotorSnsFlt 또는 MovingHallSensorFailure 발생 시 DTC 저장',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'DrvDrSwStaSBCM',
    failure_mode: 'CORRUPT',
    failure_detail: '운전석 도어 스위치 상태(DrvDrSwStaSBCM)가 Open인데 Close로 수신됨',
    effect_local: 'MotorControlMgt가 도어 열림을 감지 못하고 모터 구동 허용',
    effect_system: '도어 열린 상태에서 SBW 레버 이동 시 운전자 끼임 위험',
    potential_cause: 'SBCM CAN 메시지 E2E 오류 또는 신호 고착',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: '도어 개폐 조건에 따른 모터 동작 금지 Safety Mechanism 구현',
    detection_action: 'DrvDrSwStaSBCM Plausibility 검사: SBCM 원시 신호와 교차 비교',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'DrvStOccSta',
    failure_mode: 'CORRUPT',
    failure_detail: '운전자 착좌 감지 신호(DrvStOccSta)가 UnSeated인데 Seated로 잘못 수신됨',
    effect_local: '운전자 미착좌 상태에서 모터 구동 허용',
    effect_system: '탑승객 부재 시 의도치 않은 SBW 동작 → 물리적 간섭 위험',
    potential_cause: 'PDC_FD_01 메시지 Timeout 또는 시트 센서 오작동',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'DrvStOccSta Timeout 시 Fail-Safe: 착좌 없음으로 처리',
    detection_action: 'PDC01Timeout DTC 발생 시 즉각 경보',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'FaceDetectStat',
    failure_mode: 'CORRUPT',
    failure_detail: 'ICC 얼굴 인식 결과(FaceDetectStat)가 Not Detected인데 Detected로 수신됨',
    effect_local: '얼굴 미인식 상태에서 모터 동작 허용 조건 충족으로 잘못 판단',
    effect_system: '비인가 탑승자가 SBW 조작 가능 상태 → 보안 취약',
    potential_cause: 'ICC_02 메시지 전송 지연 또는 ICC 인식 알고리즘 오동작',
    severity: 6, occurrence: 3, detection: 5,
    preventive_action: '얼굴 인식 결과 복수 프레임 연속 확인 후 판정 (디바운싱)',
    detection_action: 'ICC_02_Timeout DTC + FaceDetectStat Invalid(0x3) 검출 로직',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'MotorSnsFlt',
    failure_mode: 'CORRUPT',
    failure_detail: '이동 센서 고장 플래그(MotorSnsFlt)가 Fault인데 정상으로 수신됨',
    effect_local: '센서 고장 상태에서 모터 구동 계속',
    effect_system: '위치 피드백 없이 모터 구동 → 목표 위치 초과, 기어 오작동',
    potential_cause: 'Hall 센서 단선 또는 CstAp_MovingMgt 통신 오류',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: '홀 센서 이중화 또는 Encoder 교차 검증',
    detection_action: '이동량 vs. 펄스 카운트 불일치 시 즉시 DTC 생성',
  },
  {
    sw_component: 'CstAp_MotorControlMgt', function_name: 'LedInitFlag',
    failure_mode: 'LESS',
    failure_detail: 'LED 초기화 완료 플래그(LedInitFlag)가 미전송되어 MotorControl 시작 조건 미충족',
    effect_local: '모터 제어 초기화 시퀀스가 완료되지 않아 변속 동작 불가',
    effect_system: '부팅 후 SBW 변속 불가 → 사용자 불편, P 기어 고착',
    potential_cause: 'CstAp_IdtMgt LED 초기화 루틴 오류 또는 시간 초과',
    severity: 6, occurrence: 3, detection: 3,
    preventive_action: 'LED 초기화 타임아웃 설정 및 대체 경로(초기화 없이 모터 허용) 검토',
    detection_action: 'POR 후 LedInitFlag 미수신 시 경고 DTC',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_ECUModeMgt — ECU 모드 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ECUModeMgt', function_name: 'DriveSta',
    failure_mode: 'CORRUPT',
    failure_detail: '드라이브 준비 상태(DriveSta)가 False인데 True로 잘못 수신됨',
    effect_local: 'ECUModeMgt가 차량 미운행 상태에서 모터 활성화 허용',
    effect_system: '정차 중 의도치 않은 SBW 변속 허용 → 차량 움직임 발생 가능',
    potential_cause: 'DrvRdySig CAN 신호 E2E 오류; VCU 상태 신호 지연',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: '드라이브 준비 신호 메인/서브 CAN 이중 검증 필수',
    detection_action: 'DriveSigMainTo/SubTo Timeout 시 DriveSta=False로 Fail-Safe',
  },
  {
    sw_component: 'CstAp_ECUModeMgt', function_name: 'DriveSta',
    failure_mode: 'LATE',
    failure_detail: '드라이브 준비 신호(DriveSta) 업데이트가 기준 주기(10ms)보다 늦게 수신됨',
    effect_local: 'ECUModeMgt의 주행 상태 판단 지연',
    effect_system: '가속 시작 시점에 SBW가 D 기어 허용 지연 → 차량 응답성 저하',
    potential_cause: 'VCU_01_10ms CAN 메시지 전송 지연; Gateway 라우팅 지연',
    severity: 7, occurrence: 3, detection: 4,
    preventive_action: '10ms 주기 타이머로 메시지 수신 감시; Timeout 임계값 설정',
    detection_action: 'DeVCU01Timeout 신호로 DTC 기록',
  },
  {
    sw_component: 'CstAp_ECUModeMgt', function_name: 'TrmnlCtrlGrpStaBDCEV',
    failure_mode: 'CORRUPT',
    failure_detail: '단자 제어 그룹 상태가 Ready(0x3)인데 Off(0x0)로 수신됨',
    effect_local: 'ECUModeMgt가 시스템을 Sleep 상태로 잘못 전환',
    effect_system: '주행 중 SBW ECU Sleep 진입 → 모든 변속 기능 정지',
    potential_cause: 'SMK_03 CAN 메시지 200ms Timeout; Gateway E2E 오류',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'SMK03 Timeout 발생 시 이전 상태 유지(Hold Last) 로직 적용',
    detection_action: 'SMK03MsgToFlag → DTC_ECUModeSta 비정상 기록',
  },
  {
    sw_component: 'CstAp_ECUModeMgt', function_name: 'BDC02MsgTo',
    failure_mode: 'CORRUPT',
    failure_detail: 'BDC02 메시지 Timeout 플래그가 Off인데 On으로 잘못 판정됨',
    effect_local: 'ECUModeMgt가 BDC 통신 이상으로 오인하여 Standby 모드 진입',
    effect_system: '도어 잠금/열림 관련 모드 전환 오동작; SBW 동작 제한',
    potential_cause: 'CAN 버스 일시적 노이즈로 메시지 손실; Timeout 임계값 너무 짧음',
    severity: 7, occurrence: 3, detection: 4,
    preventive_action: 'Timeout 카운터에 히스테리시스 적용 (연속 N회 미수신 시 판정)',
    detection_action: 'BDC02Timeout DTC 기록 및 CAN 버스 상태 모니터링',
  },
  {
    sw_component: 'CstAp_ECUModeMgt', function_name: 'EcuStaFlag',
    failure_mode: 'CORRUPT',
    failure_detail: 'ECU 상태 플래그가 Wakeup(1) 상태인데 Sleep(4)로 잘못 전환됨',
    effect_local: 'CstAp_PwrMGT에 잘못된 전력 관리 명령 전달',
    effect_system: '부적절한 시점의 ECU Sleep → CAN 통신 중단, 기능 손실',
    potential_cause: 'CstAp_ECUModeMgt Sleep 조건 판정 로직 오류',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: 'Sleep 진입 전 모터 비활성화 및 기어 안전 위치 확인 필수',
    detection_action: 'EcuSta 전환 시 전제 조건(모터 OFF, 기어 P) 검증',
  },
  {
    sw_component: 'CstAp_ECUModeMgt', function_name: 'MotorActivation',
    failure_mode: 'MORE',
    failure_detail: 'ECUModeMgt 수신 MotorActivation 신호가 STD_ON(1) 이상으로 범위 초과',
    effect_local: '유효하지 않은 모터 활성화 값으로 인한 상태 불일치',
    effect_system: 'ECUModeMgt 모드 전환 로직 오류 발생 → 비정상 ECU 상태',
    potential_cause: '메모리 손상 또는 포인터 오류로 MotorActivation 변수 덮어쓰기',
    severity: 7, occurrence: 2, detection: 3,
    preventive_action: 'MotorActivation 수신값 Range Check (0 or 1만 유효)',
    detection_action: '유효범위 초과 시 DTC 기록 및 기본값(0) 사용',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_CANMGT — CAN 관리 (핵심 인터페이스)
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_CANMGT', function_name: 'DrvRdySig',
    failure_mode: 'CORRUPT',
    failure_detail: 'EV 드라이브 준비 신호(DrvRdySig)가 EV Drivable(0x1)인데 Error Indicator(0x3)로 수신됨',
    effect_local: 'CstAp_CANMGT가 차량 주행 불가로 판단 → DriveSta=False 전달',
    effect_system: '실제 주행 가능 상태에서 변속 제한 → 가속 불가, 주행 중단',
    potential_cause: 'VCU_01 CAN 메시지 E2E 오류; CGW 신호 변환 오류',
    severity: 8, occurrence: 3, detection: 4,
    preventive_action: 'DrvRdySig 연속 N회 Error Indicator 확인 후 판정 (디바운싱)',
    detection_action: 'Mcu_E2E_Return 오류 카운터 임계값 도달 시 DTC',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'DrvRdySig',
    failure_mode: 'LATE',
    failure_detail: 'VCU_01(10ms 주기) DrvRdySig가 기준 주기 초과하여 늦게 수신됨',
    effect_local: 'CANMGT의 드라이브 준비 판단 지연',
    effect_system: '출발 시점에 변속 제한 지속 → 차량 응답성 저하',
    potential_cause: 'VCU_01 메시지 전송 지연; CAN 버스 부하 과다',
    severity: 7, occurrence: 3, detection: 3,
    preventive_action: 'VCU_01 Timeout 임계값 20ms(2주기) 설정',
    detection_action: 'DeVCU01Timeout 플래그 ON 시 DTC 기록',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'GearPosSta',
    failure_mode: 'CORRUPT',
    failure_detail: '기어 위치 상태(GearPosSta) 값이 실제 D 위치(5)인데 P 위치(6)로 잘못 수신됨',
    effect_local: 'CstAp_CANMGT가 잘못된 기어 위치를 CstAp_IdtMgt 및 클러스터로 전달',
    effect_system: '클러스터에 잘못된 기어 표시; 자동 주차 로직 오작동',
    potential_cause: 'VCU_01 CAN 신호 비트 오류; 기어 위치 센서 오판독',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: '기어 위치 변화 유효성 검사 (P→D 직접 전환 금지 등)',
    detection_action: 'GearPosSta 상태 전환 패턴 모니터링; 비정상 전환 DTC',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'USM06Msg',
    failure_mode: 'CORRUPT',
    failure_detail: 'Column SBW 회전 모드 변경 요청(USM06Msg)이 Activation(0)인데 Invalid(3)로 수신됨',
    effect_local: 'CstAp_CANMGT가 회전 모드 요청을 무시하고 이전 상태 유지',
    effect_system: 'Column SBW 회전 기능 동작 불가 → 사용자 모드 변경 불가',
    potential_cause: 'HU_USM_06_00ms 메시지 E2E 오류; CGW 신호 처리 오류',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'USM06Msg Invalid 연속 수신 시 이전 명령 유지 또는 기본값 적용',
    detection_action: 'AlvCntFlt/CrcFlt 진단으로 USM 통신 품질 모니터링',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'USM06Msg',
    failure_mode: 'EARLY',
    failure_detail: 'Column SBW 회전 명령(USM06Msg)이 조작 전 예상보다 빠르게(6ms 미만) 수신됨',
    effect_local: '이전 동작 완료 전 새 회전 명령 처리로 중첩 동작 발생',
    effect_system: 'Column SBW 회전 동작 오버랩 → 기계 충돌 또는 모터 과부하',
    potential_cause: 'HU 시스템 빠른 연속 전송; 6ms 주기 미준수',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: '이전 회전 완료 확인 후 신규 명령 수락하는 인터록 로직',
    detection_action: '명령 수신 간격 모니터링; 기준 주기 미만 수신 시 경고',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'VPCAMsg',
    failure_mode: 'CORRUPT',
    failure_detail: 'VPC Safety Mode 신호(VPCAMsg.SafetyModeSta)가 On(0x1)인데 Off(0x0)로 수신됨',
    effect_local: 'CstAp_CANMGT의 VPC_SafetyModeStaFlag가 Off로 설정됨',
    effect_system: 'VPC 안전 모드 미진입으로 인한 모터 제어 안전 기능 손실',
    potential_cause: 'CCU_VPC CAN 메시지 오류; R_CS_RxMainCAN_VPC_FD_Msg 수신 처리 버그',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'Safety Mode 신호 수신 불확실 시 기본값 On으로 Fail-Safe',
    detection_action: 'MCU_01_Timeout 발생 시 VPC Safety Mode On 강제 적용',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'Mcu_E2E_Return',
    failure_mode: 'CORRUPT',
    failure_detail: 'MCU CAN E2E 검증 결과가 E2E_P_OK(0x00)인데 E2E_P_WRONGSEQUENCE로 반환됨',
    effect_local: 'CstAp_CANMGT가 MCU_01 메시지를 무효로 처리',
    effect_system: 'VPC, OTA 관련 명령 무시 → 기능 손실',
    potential_cause: '서브 CAN Alive Counter 불일치; 메시지 재전송 처리 오류',
    severity: 7, occurrence: 3, detection: 2,
    preventive_action: 'E2E 라이브러리 설정 파라미터 재검토 (시퀀스 윈도우 크기)',
    detection_action: 'Mcu_E2E_Return ≠ E2E_P_OK 횟수 카운팅 → 임계 초과 시 DTC',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'SMK_PwrOnModeSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'SMK 전원 모드 신호가 Power On Normal Mode(0x1)인데 Off Mode(0x0)로 수신됨',
    effect_local: 'CstAp_CANMGT가 Mood Lamp에 Off Mode 명령 전달',
    effect_system: '전원 ON 상태에서 Mood Lamp 소등 → 사용자 불편',
    potential_cause: 'BDC_FD_SMK_03_200ms Timeout; SMK_03_Timeout 플래그 오판',
    severity: 4, occurrence: 3, detection: 4,
    preventive_action: 'SMK03 Timeout 시 이전 모드 유지(Hold Last Valid)',
    detection_action: 'SMK03MsgToFlag DTC 기록',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'MainCANBusOFF',
    failure_mode: 'CORRUPT',
    failure_detail: 'Main CAN Bus-Off 신호가 정상(OFF)인데 Bus-Off(ON)로 잘못 수신됨',
    effect_local: 'CstAp_CANMGT가 Main CAN Bus 오프로 판단하여 CAN 통신 재초기화 시도',
    effect_system: '정상 CAN 통신 중단 → 전체 SBW CAN 인터페이스 리셋',
    potential_cause: 'BswIF_EcuModeCntl Bus-Off 감지 로직 오탐; 순간적 CAN 에러 카운터 초과',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: 'Bus-Off 판정 전 연속 N회 에러 확인 (히스테리시스)',
    detection_action: 'MainCANBusOFFSta 상태 변화 이력 DTC 기록',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'SubCANBusOFF',
    failure_mode: 'CORRUPT',
    failure_detail: 'Sub CAN Bus-Off 신호가 OFF인데 ON으로 잘못 수신됨',
    effect_local: 'Sub CAN 통신 재초기화로 DrvRdySig 등 서브 CAN 신호 일시 손실',
    effect_system: 'VCU 드라이브 준비 신호 손실 → DriveSta 판정 오류',
    potential_cause: 'Sub CAN 선로 간섭 또는 터미네이터 불량',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: 'Sub CAN Bus-Off 복구 시 최신 신호 재요청(Request-Response) 처리',
    detection_action: 'SubCANBusOFFSta DTC 기록 및 Sub CAN 재초기화 횟수 모니터링',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'AlvCntFlt',
    failure_mode: 'CORRUPT',
    failure_detail: 'Alive Counter 고장 플래그(AlvCntFlt)가 OFF인데 ON으로 잘못 판정됨',
    effect_local: 'CstAp_DIDMgt에 불필요한 AlvCnt 오류 기록',
    effect_system: '정상 메시지 수신 중 DTC 오기록 → 진단 신뢰성 저하',
    potential_cause: 'AlvCnt 비교 로직 경계값 처리 오류 (0xFF→0x00 롤오버 미처리)',
    severity: 5, occurrence: 3, detection: 3,
    preventive_action: 'AlvCnt 롤오버 처리 로직 검증 (0xFF 다음은 0x00이 정상)',
    detection_action: '진단 세션에서 AlvCnt 이력 모니터링',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'OTA_crank_inh',
    failure_mode: 'CORRUPT',
    failure_detail: 'OTA 크랭킹 억제 신호(OTA_crank_inh)가 미설정인데 설정 상태로 수신됨',
    effect_local: 'ECU가 크랭킹 억제 상태로 진입하여 시동 불가',
    effect_system: 'OTA 업데이트 미수행 중 시동 차단 → 운전자 차량 출발 불가',
    potential_cause: 'CCU_MCU_01 메시지 오류; OTA 플래그 초기화 누락',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'OTA 크랭킹 억제 조건 이중 확인 (OTA 실제 진행 중인지 검증)',
    detection_action: 'MCU_01_Timeout + OTA 진행 상태 교차 확인',
  },
  {
    sw_component: 'CstAp_CANMGT', function_name: 'ModePosInfo',
    failure_mode: 'CORRUPT',
    failure_detail: 'SBW 모드 위치 정보(ModePosInfo)가 잘못된 값으로 송신됨',
    effect_local: 'SBW_SHFTR_FF_01 메시지로 잘못된 기어 위치 정보 전송',
    effect_system: '연결된 변속기 제어기(TCU)가 잘못된 기어 위치 수신 → 변속 이상',
    potential_cause: '기어 위치 코딩 오류; 프로토콜 버전 불일치',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'ModePosInfo 전송 전 유효 범위 검사 및 체크섬 적용',
    detection_action: 'TCU 측 기어 위치 응답과 교차 검증',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_PwrMGT — 전원 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_PwrMGT', function_name: 'VBatVolt',
    failure_mode: 'MORE',
    failure_detail: '배터리 전압 ADC 값(VBatVolt)이 실제 전압보다 높게 측정됨 (과전압으로 오판)',
    effect_local: 'CstAp_PwrMGT가 과전압(VBatOverSta) 상태로 판단',
    effect_system: 'ECU가 불필요하게 저전력 모드 진입 또는 시스템 보호 모드 동작',
    potential_cause: 'ADC 기준 전압 불안정; 배터리 전압 분배 저항 편차',
    severity: 7, occurrence: 2, detection: 3,
    preventive_action: 'ADC 측정값 이동 평균 필터 적용 (N샘플 평균)',
    detection_action: 'VBatVolt 다중 샘플 검증; 임계값 초과 지속 시간 조건 추가',
  },
  {
    sw_component: 'CstAp_PwrMGT', function_name: 'VBatVolt',
    failure_mode: 'LESS',
    failure_detail: '배터리 전압 ADC 값이 실제보다 낮게 측정됨 (저전압으로 오판)',
    effect_local: 'CstAp_PwrMGT가 저전압(VBatUnderSta) 상태 판정',
    effect_system: '정상 배터리 상태에서 ECU 비상 저전력 모드 진입 → SBW 기능 제한',
    potential_cause: 'ADC 채널 누설전류; 접지 저항 불량',
    severity: 7, occurrence: 2, detection: 3,
    preventive_action: '저전압 판정 전 디바운싱 시간 확보 (연속 500ms 이상)',
    detection_action: 'VBatNorSta/VBatUnderSta DTC 기록',
  },
  {
    sw_component: 'CstAp_PwrMGT', function_name: 'VIgnVolt',
    failure_mode: 'CORRUPT',
    failure_detail: 'IGN1 전압 측정값(VIgnVolt)이 비정상 값으로 수신됨',
    effect_local: 'CstAp_PwrMGT가 IGN 상태 오판 → 잘못된 전원 상태 전환',
    effect_system: 'IGN ON 상태에서 ECU가 Sleep 진입 시도 → 변속 기능 중단',
    potential_cause: 'IoHwAb ADC 채널 오염; 전압 분배 회로 불량',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: 'VIgnVolt와 CAN IGN 신호(SMK_TrmnlCtrlGrpStaBDCEV) 교차 검증',
    detection_action: 'IGN ADC와 CAN IGN 상태 불일치 시 DTC 생성',
  },
  {
    sw_component: 'CstAp_PwrMGT', function_name: 'SbcFlt',
    failure_mode: 'LESS',
    failure_detail: 'SBC 고장 신호(SbcFlt)가 Fault(1) 상태인데 Normal(0)으로 수신됨',
    effect_local: 'CstAp_PwrMGT가 SBC 고장을 감지하지 못함',
    effect_system: 'SBC 고장 지속 → 모터 드라이버 전원 불안정 → 모터 오작동',
    potential_cause: 'IoHwAb SBC Fault 핀 판독 오류; 핀 쇼트로 항상 Low 상태',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: 'SBC Fault 핀 풀업 저항 설계; 이중 Fault 감지 경로',
    detection_action: 'SbcFlt Plausibility: 모터 전류 이상 시 교차 확인',
  },
  {
    sw_component: 'CstAp_PwrMGT', function_name: 'VBatOverSta',
    failure_mode: 'CORRUPT',
    failure_detail: '배터리 과전압 상태(VBatOverSta)가 None인데 Over Voltage로 잘못 판정됨',
    effect_local: 'CstAp_PwrMGT → CstAp_DIDMgt에 과전압 DID 기록',
    effect_system: '정상 배터리 상태에서 과전압 DTC 오기록 → 진단 오판',
    potential_cause: 'VBatVolt ADC 스파이크 노이즈; 임계값 설정 오류',
    severity: 5, occurrence: 3, detection: 4,
    preventive_action: '과전압 판정 임계값 재검토; 필터링 강화',
    detection_action: 'VBatOverSta DTC 발생 빈도 모니터링',
  },
  {
    sw_component: 'CstAp_PwrMGT', function_name: 'SysPwrSta',
    failure_mode: 'CORRUPT',
    failure_detail: '시스템 전원 상태(SysPwrSta)가 POWER_OFF인데 POWER_ON으로 오전달됨',
    effect_local: 'CstAp_DIDMgt가 잘못된 전원 상태 기록',
    effect_system: '전원 오프 상태에서 SBW 기능 유지 시도 → 불필요한 소비 전류',
    potential_cause: 'SysPwrSta 플래그 클리어 누락; ECU 종료 시퀀스 불완전',
    severity: 5, occurrence: 2, detection: 4,
    preventive_action: 'ECU Power Off 시퀀스: SysPwrSta 클리어 후 Sleep 진입',
    detection_action: '전원 Off 후 CAN 통신 활성 여부 모니터링',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_ButtonMgt — P버튼 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ButtonMgt', function_name: 'Raw',
    failure_mode: 'MORE',
    failure_detail: 'P버튼 ADC 측정값(Raw)이 정상 범위(0~4095) 초과 또는 상위 임계값(2604u) 초과',
    effect_local: 'CstAp_ButtonMgt가 P버튼 눌림 상태를 잘못 판정',
    effect_system: '실제 P버튼 미조작 상태에서 P 기어 진입 명령 발생 → 급제동',
    potential_cause: 'ADC 채널 단락; 버튼 저항 회로 단선으로 풀업 전압 직접 인가',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'P버튼 ADC 상한 임계값 Range Check 및 2중 ADC 측정 비교',
    detection_action: 'Raw 값 비정상 범위 연속 감지 시 PButtonFault = ON 처리',
  },
  {
    sw_component: 'CstAp_ButtonMgt', function_name: 'Raw',
    failure_mode: 'LESS',
    failure_detail: 'P버튼 ADC 값이 정상보다 낮게 측정됨 (하한 임계값 미달)',
    effect_local: 'P버튼 눌림 인식 실패 또는 오동작',
    effect_system: '실제 P버튼 조작 시 P 기어 진입 불가 → 주차 기능 실패',
    potential_cause: 'ADC 채널 단선; 버튼 접점 산화로 저항값 증가',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: '버튼 ADC 하한 감지 로직; 두 센서 교차 확인(EitherSensorError)',
    detection_action: 'Raw 값 하한 이하 연속 감지 시 EitherSensorError = ON',
  },
  {
    sw_component: 'CstAp_ButtonMgt', function_name: 'PButtonSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'P버튼 상태(PButtonSta)가 미조작(false)인데 조작(true)으로 송신됨',
    effect_local: 'CstAp_CANMGT가 P 기어 진입 명령 전달',
    effect_system: '주행 중 의도치 않은 P 기어 전환 시도 → 변속기 손상 또는 급정차',
    potential_cause: '소프트웨어 디바운싱 부족; ADC 스파이크를 버튼 눌림으로 오인',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'P버튼 판정 시 차속 조건(V<5km/h) + 연속 N회 확인 인터록',
    detection_action: 'PButtonSta 변화 시 차속 조건 로그; 비정상 전환 DTC',
  },
  {
    sw_component: 'CstAp_ButtonMgt', function_name: 'PButtonStuck',
    failure_mode: 'LESS',
    failure_detail: 'P버튼 고착 감지 플래그(PButtonStuck)가 고착 상태인데 정상으로 오전달됨',
    effect_local: 'CstAp_CANMGT가 P버튼 고착 상태를 인식하지 못함',
    effect_system: '버튼 고착 상태 지속 → P 기어 계속 입력됨 → 주행 불가',
    potential_cause: 'PButtonStuck 판정 시간 임계값 너무 길거나 카운터 리셋 오류',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: '버튼 눌림 지속 시간 임계값(예: 30초) 이상 시 고착 판정',
    detection_action: 'PButtonStuck = ON 시 DTC 기록; 클러스터 경고 표시',
  },
  {
    sw_component: 'CstAp_ButtonMgt', function_name: 'PButtonFault',
    failure_mode: 'CORRUPT',
    failure_detail: 'P버튼 고장 플래그(PButtonFault)가 정상(OFF)인데 고장(ON)으로 잘못 송신됨',
    effect_local: 'CstAp_CANMGT가 P버튼 고장으로 판단 → P 버튼 기능 비활성화',
    effect_system: '정상 P버튼이 고장 처리되어 주차 기능 불가 → 사용자 불편',
    potential_cause: 'ADC 노이즈를 고장으로 오판정; EitherSensorError 과민 반응',
    severity: 6, occurrence: 3, detection: 4,
    preventive_action: 'PButtonFault 판정에 히스테리시스 및 지속 시간 조건 추가',
    detection_action: 'PButtonFault ON 시 진단 모드에서 Raw ADC 값 기록',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_IdtMgt — 인디케이터 / LED 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_IdtMgt', function_name: 'GearPosSta',
    failure_mode: 'CORRUPT',
    failure_detail: '기어 위치 상태(GearPosSta)가 실제 D(0x5)인데 N(0x3)으로 수신됨',
    effect_local: 'CstAp_IdtMgt가 N 위치 LED를 점등',
    effect_system: '클러스터/SBW 인디케이터에 잘못된 기어 위치 표시 → 운전자 오인',
    potential_cause: 'GearPosSta 신호 인코딩 오류; CstAp_CANMGT 파싱 버그',
    severity: 6, occurrence: 2, detection: 4,
    preventive_action: 'GearPosSta 유효 전환 순서 검증 (R→N→D 등 순차 전환)',
    detection_action: 'GearPosSta vs. 실제 모터 위치 교차 검증 DTC',
  },
  {
    sw_component: 'CstAp_IdtMgt', function_name: 'BltDimLvl',
    failure_mode: 'MORE',
    failure_detail: 'Backlight 밝기 레벨(BltDimLvl)이 최대값(65535) 초과 또는 비정상적으로 높은 값',
    effect_local: 'CstAp_IdtMgt가 LED에 과전류 인가 시도',
    effect_system: 'SBW 인디케이터 LED 과발열 및 수명 단축; 눈부심 유발',
    potential_cause: 'IoHwAb PWM 레지스터 오버플로우; 밝기 계산 로직 오류',
    severity: 4, occurrence: 3, detection: 4,
    preventive_action: 'BltDimLvl 상한 클리핑 처리 (max_duty = 65535 범위 제한)',
    detection_action: 'PWM duty cycle 상한 초과 시 기본값(50%) 적용',
  },
  {
    sw_component: 'CstAp_IdtMgt', function_name: 'BltDimLvl',
    failure_mode: 'LESS',
    failure_detail: 'Backlight 밝기 레벨이 0에 가까운 값으로 설정됨 (소등 상태)',
    effect_local: 'LED 전원 공급 부족으로 인디케이터 미점등',
    effect_system: '야간 운전 시 기어 위치 인디케이터 불가시 → 운전자 안전 위협',
    potential_cause: '밝기 계산 언더플로우; RhstaLvlSta 기반 자동 조도 오판',
    severity: 5, occurrence: 3, detection: 3,
    preventive_action: '최소 밝기 하한값 설정 (min_duty > 0)',
    detection_action: 'DutyRate 모니터링 DID 통해 실제 PWM 값 진단',
  },
  {
    sw_component: 'CstAp_IdtMgt', function_name: 'IdtFltSta',
    failure_mode: 'CORRUPT',
    failure_detail: '인디케이터 고장 상태(IdtFltSta)가 정상(OFF)인데 고장(ON)으로 오전달됨',
    effect_local: 'CstAp_CANMGT가 인디케이터 고장으로 DTC 기록',
    effect_system: '정상 LED 상태에서 고장 DTC 오기록 → 불필요한 A/S 조치',
    potential_cause: 'LED 점멸 타이밍 중 순간 전류 이상 감지 오판',
    severity: 4, occurrence: 3, detection: 4,
    preventive_action: 'IdtFlt 판정에 연속 N회(예: 3회) 이상 이상 감지 조건 추가',
    detection_action: '진단 모드에서 LED 전류 실측값 확인',
  },
  {
    sw_component: 'CstAp_IdtMgt', function_name: 'AutoBrightSta',
    failure_mode: 'CORRUPT',
    failure_detail: '자동 밝기 상태(AutoBrightSta)가 On이어야 할 때 Off로 수신됨',
    effect_local: '자동 밝기 조절 비활성화로 고정 밝기 동작',
    effect_system: '주야간 자동 밝기 조절 미작동 → 주간 야간에 밝기 부적절',
    potential_cause: 'CLU_01_20ms CAN Timeout; AutoBrightSta 신호 비트 오류',
    severity: 3, occurrence: 3, detection: 5,
    preventive_action: 'AutoBrightSta Timeout 시 마지막 유효값 유지',
    detection_action: 'CLU01Timeout DTC 기록',
  },
  {
    sw_component: 'CstAp_IdtMgt', function_name: 'TotalAlvCntFlt',
    failure_mode: 'CORRUPT',
    failure_detail: '전체 Alive Counter 오류 플래그(TotalAlvCntFlt)가 OFF인데 ON으로 잘못 판정됨',
    effect_local: 'CstAp_IdtMgt가 AlvCnt 오류로 인한 표시 동작 변경',
    effect_system: '불필요한 CAN 통신 오류 경고 표시; 진단 혼선',
    potential_cause: '초기화 시점의 AlvCnt 시작값 불일치 (0 vs 비0)',
    severity: 4, occurrence: 3, detection: 4,
    preventive_action: 'ECU 초기화 시 AlvCnt 기준값 동기화 프로시저 추가',
    detection_action: '진단 도구로 AlvCnt 실시간 값 모니터링',
  },

  // ══════════════════════════════════════════════════════
  // BswIF_CAN — BSW CAN 인터페이스
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_CAN', function_name: 'DrvRdySig',
    failure_mode: 'CORRUPT',
    failure_detail: 'BSW CAN에서 드라이브 준비 신호 데이터가 비트 오류로 손상됨',
    effect_local: 'CstAp_CANMGT 수신 DrvRdySig 값 비정상',
    effect_system: '드라이브 준비 상태 오판 → 변속 허용/차단 오동작',
    potential_cause: 'CAN 버스 EMC 간섭; CRC 검출 한계 초과 연속 오류',
    severity: 8, occurrence: 2, detection: 2,
    preventive_action: 'E2E Profile 2 적용 (CRC + AlvCnt); 쉴드 케이블 적용',
    detection_action: 'E2E 오류 카운터 → DTC; BSW CAN 에러 통계 진단',
  },
  {
    sw_component: 'BswIF_CAN', function_name: 'Ign1InStaSig',
    failure_mode: 'CORRUPT',
    failure_detail: 'IGN1 상태 신호(Ign1InStaSig)가 On이어야 할 때 Off로 수신됨',
    effect_local: 'BswIF_CAN이 IGN1 Off로 판단하여 슬립 트리거 전달',
    effect_system: 'IGN ON 상태에서 ECU 슬립 진입 → 전체 SBW 기능 중단',
    potential_cause: 'WAKE_UP_BDC_FD_07 메시지 Timeout; 웨이크업 신호 노이즈',
    severity: 8, occurrence: 2, detection: 3,
    preventive_action: 'IGN 상태를 하드웨어 IGN 전압 측정과 병행 확인',
    detection_action: 'VIgnVolt ADC와 Ign1InStaSig 불일치 시 DTC',
  },
  {
    sw_component: 'BswIF_CAN', function_name: 'RotateModeChangeReq',
    failure_mode: 'CORRUPT',
    failure_detail: 'Column SBW 회전 모드 변경 요청이 Activation(0)인데 Deactivation(1)으로 수신됨',
    effect_local: 'BswIF_CAN이 반대 회전 모드 명령 전달',
    effect_system: '사용자가 회전 활성화 요청했는데 비활성화 처리됨',
    potential_cause: 'HU_USM_06_00ms 신호 비트 반전; 파싱 인덱스 오류',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'RotateModeChangeReq 신호 파싱 검증 테스트 케이스 추가',
    detection_action: 'HU 요청 vs. NVM 저장 회전 모드 불일치 시 DTC',
  },
  {
    sw_component: 'BswIF_CAN', function_name: 'DrvDrSwSta',
    failure_mode: 'CORRUPT',
    failure_detail: '운전석 도어 스위치 상태(DrvDrSwSta)가 Close인데 Open으로 수신됨',
    effect_local: 'BswIF_CAN이 도어 열림 상태를 CstAp_CANMGT에 전달',
    effect_system: '도어 닫힘 상태에서 ECU가 도어 열림 관련 안전 제한 적용',
    potential_cause: 'WAKE_UP_BDC_FD 메시지 비트 오류; 도어 스위치 회로 노이즈',
    severity: 5, occurrence: 3, detection: 4,
    preventive_action: '도어 상태 신호 디바운싱 (연속 3회 동일값)',
    detection_action: '도어 상태 변화 이력 DTC 기록',
  },
  {
    sw_component: 'BswIF_CAN', function_name: 'SMK_PwrOnModeSta',
    failure_mode: 'LATE',
    failure_detail: 'SMK 전원 모드 신호(SMK_PwrOnModeSta)가 200ms 주기를 초과하여 늦게 수신됨',
    effect_local: 'BswIF_CAN에서 SMK_03_Timeout 플래그 ON 발생',
    effect_system: 'ECUModeMgt 모드 전환 지연; Mood Lamp 점등 지연',
    potential_cause: 'BDC_FD_SMK_03 메시지 CAN 버스 충돌; Gateway 처리 지연',
    severity: 4, occurrence: 3, detection: 3,
    preventive_action: 'SMK_03 Timeout 200ms → 최대 허용 지연 3주기(600ms) 설정',
    detection_action: 'SMK03Timeout DTC + 발생 빈도 통계',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_DtcMgt — DTC 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_DtcMgt', function_name: 'PSw1State',
    failure_mode: 'CORRUPT',
    failure_detail: 'P버튼 스위치1 상태(PSw1State)가 정상값 범위를 벗어난 값으로 수신됨',
    effect_local: 'CstAp_DtcMgt가 잘못된 스위치 상태로 DTC 판정',
    effect_system: 'P버튼 관련 DTC 오기록 → 불필요한 진단 경보',
    potential_cause: 'ADC 변환 오류 또는 버튼 회로 개방',
    severity: 5, occurrence: 3, detection: 4,
    preventive_action: 'PSw1State 유효 범위 클램핑 로직',
    detection_action: '진단 세션에서 PSw1State 실시간 모니터링',
  },
  {
    sw_component: 'CstAp_DtcMgt', function_name: 'MainSActMsgToFlag',
    failure_mode: 'CORRUPT',
    failure_detail: 'Main Shift Actuator 메시지 Timeout 플래그가 Off인데 On으로 잘못 판정됨',
    effect_local: 'CstAp_DtcMgt가 불필요한 Timeout DTC 기록',
    effect_system: '정상 통신 중 진단 오류 기록 → 차량 A/S 혼선',
    potential_cause: '메시지 수신 타이머 초기화 오류; 인터럽트 처리 지연',
    severity: 4, occurrence: 3, detection: 3,
    preventive_action: 'Timeout 타이머 리셋 시점 검토; 첫 메시지 수신 전 타이머 동작 방지',
    detection_action: '진단 도구로 Timeout 발생 빈도 및 패턴 분석',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_DIDMgt — DID 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_DIDMgt', function_name: 'P_BltDimLvl',
    failure_mode: 'MORE',
    failure_detail: 'P 위치 Backlight 밝기 DID 값(P_BltDimLvl)이 최대값(65535) 초과',
    effect_local: 'CstAp_DIDMgt에 비정상 밝기 DID 값 저장',
    effect_system: '진단 도구에서 비정상 DID 값 조회 → 오진단',
    potential_cause: '밝기 레벨 계산 오버플로우',
    severity: 3, occurrence: 3, detection: 5,
    preventive_action: 'DID 저장 전 uint16 범위(0~65535) 클램핑',
    detection_action: '진단 $22 서비스로 DID 값 범위 확인',
  },
  {
    sw_component: 'CstAp_DIDMgt', function_name: 'MainCANBusOFFSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'Main CAN Bus-Off 상태 DID(MainCANBusOFFSta)가 정상인데 Bus-Off로 기록됨',
    effect_local: 'CstAp_DIDMgt에 잘못된 Bus-Off 이력 저장',
    effect_system: '진단 이력 오염 → 실제 Bus-Off 발생 시 이력 분석 어려움',
    potential_cause: 'CAN 에러 카운터 순간 초과 후 복구 시 DID 미클리어',
    severity: 4, occurrence: 2, detection: 4,
    preventive_action: 'Bus-Off 복구 후 DID 상태 자동 클리어 로직',
    detection_action: '진단 $19 서비스로 DID 이력 교차 확인',
  },

  // ══════════════════════════════════════════════════════
  // BswIF_IoHwAb — 하드웨어 추상화 입출력
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_IoHwAb', function_name: 'SbcFlt',
    failure_mode: 'CORRUPT',
    failure_detail: 'SBC Fault 핀 상태(SbcFlt)가 Normal인데 Fault로 잘못 읽힘',
    effect_local: 'BswIF_IoHwAb가 SBC 고장 신호를 CstAp_PwrMGT에 잘못 전달',
    effect_system: '정상 SBC 상태에서 전원 관리 Fail-Safe 동작 → 모터 전원 차단',
    potential_cause: 'GPIO 입력 핀 노이즈; 풀업/풀다운 저항 값 오설계',
    severity: 7, occurrence: 2, detection: 3,
    preventive_action: 'SbcFlt 핀에 하드웨어 디바운싱 RC 필터 적용',
    detection_action: 'SbcFlt 신호 연속 5ms 이상 지속 시에만 Fault 판정',
  },
  {
    sw_component: 'BswIF_IoHwAb', function_name: 'ADC_P_BTN_2',
    failure_mode: 'MORE',
    failure_detail: 'P버튼 2채널 ADC 값(ADC_P_BTN_2)이 정상 범위(0~4095) 초과',
    effect_local: 'IoHwAb가 비정상 ADC 값을 상위 레이어에 전달',
    effect_system: 'P버튼 오작동 판정 가능성',
    potential_cause: 'ADC 채널 입력 전압 이상; 기준 전압 불안정',
    severity: 6, occurrence: 2, detection: 3,
    preventive_action: 'ADC 입력 보호 회로 (클램프 다이오드) 추가',
    detection_action: 'ADC 값 하드웨어 포화 시 소프트웨어 Range Check로 검출',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_MoodControlMgt — Mood Lamp 제어
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_MoodControlMgt', function_name: 'BPWM',
    failure_mode: 'MORE',
    failure_detail: 'Blue PWM 출력값(BPWM)이 최대 범위(65535) 초과하여 비정상 듀티 출력',
    effect_local: 'Mood Lamp Blue 채널 과구동',
    effect_system: 'RGB LED 과전류로 색상 재현 불량 및 LED 수명 단축',
    potential_cause: ' 색상 계산 오버플로우; SlvColor_X 입력값 비정상',
    severity: 3, occurrence: 3, detection: 4,
    preventive_action: 'PWM 출력값 상한 클리핑 (uint16 max)',
    detection_action: 'PWM duty 모니터링 DID로 실제 출력 확인',
  },
  {
    sw_component: 'CstAp_MoodControlMgt', function_name: 'MdLmpFadeSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'Mood Lamp 페이드 상태(MdLmpFadeSta)가 Off인데 On으로 잘못 수신됨',
    effect_local: 'MoodControlMgt가 불필요한 페이드 애니메이션 실행',
    effect_system: 'Mood Lamp 동작 이상; 전력 낭비',
    potential_cause: 'BDC_FD_05_200ms CAN 신호 오수신',
    severity: 3, occurrence: 3, detection: 5,
    preventive_action: 'MdLmpFadeSta 상태 변화 조건 검증',
    detection_action: 'Mood Lamp 상태 모니터링',
  },

  // ══════════════════════════════════════════════════════
  // CstAp_VehicleReset_Mgt — 차량 리셋 관리
  // ══════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_VehicleReset_Mgt', function_name: 'ResetReqForOthersFlag',
    failure_mode: 'CORRUPT',
    failure_detail: '타 ECU 리셋 요청 플래그(ResetReqForOthersFlag)가 Off인데 On으로 잘못 트리거됨',
    effect_local: 'CstAp_VehicleReset_Mgt가 불필요한 리셋 명령 전파',
    effect_system: '연결된 ECU들의 예기치 않은 리셋 → 일시적 기능 손실',
    potential_cause: '리셋 조건 판정 오류; 메모리 초기화 미완료',
    severity: 7, occurrence: 2, detection: 3,
    preventive_action: '리셋 명령 전 이중 확인 로직 (Watchdog 트리거 + 소프트웨어 플래그)',
    detection_action: '리셋 이벤트 카운터 DTC 기록',
  },
]

// ── DB 저장 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ FMEA 항목 생성 시작 (총 ${items.length}개)`)

  const client = await pool.connect()
  try {
    // 기존 AI 항목 삭제
    await client.query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [SESSION_ID])
    console.log('  기존 AI 항목 삭제 완료')

    await client.query('BEGIN')

    const byComp: Record<string, number> = {}
    const byAP: Record<string, number> = {}

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const action_priority = ap(it.severity, it.occurrence, it.detection)
      byComp[it.sw_component] = (byComp[it.sw_component] ?? 0) + 1
      byAP[action_priority] = (byAP[action_priority] ?? 0) + 1

      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [SESSION_ID, String(i + 1).padStart(4, '0'),
         it.sw_component, it.function_name, it.failure_mode,
         it.failure_detail, it.effect_local, it.effect_system, it.potential_cause,
         it.severity, it.occurrence, it.detection,
         it.preventive_action, it.detection_action,
         0.85, action_priority],
      )
    }

    await client.query('COMMIT')

    console.log(`\n✅ 삽입 완료: ${items.length}개`)
    console.log('\n[AP 분포]')
    for (const [k, v] of Object.entries(byAP).sort()) console.log(`  ${k}: ${v}개`)
    console.log('\n[컴포넌트별 항목 수]')
    for (const [k, v] of Object.entries(byComp).sort()) console.log(`  ${k.padEnd(35)}: ${v}개`)

    await execute_session_update(client)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

async function execute_session_update(client: pg.PoolClient) {
  await client.query(
    "UPDATE pre_fmea_sessions SET status = 'generated', updated_at = now() WHERE id = $1",
    [SESSION_ID],
  )
}

main().catch(e => { console.error('❌', e); process.exit(1) })
