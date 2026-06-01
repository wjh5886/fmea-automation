/**
 * SW 설계사양서(SWE3) 기반 FMEA 항목 생성 스크립트.
 *
 * 각 항목은 사양서의 실제 유닛 설계 로직(진리표·임계값·조건분기)을 분석하여 작성됨:
 *   - CstAp_PwrMGT: CtAp_IgnStaChk / CtAp_LdoStaChk / CtAp_SysStaChk / CtAp_VbatStaChk
 *   - CstAp_CANMGT: CtAp_CANBusOffChk / RX 신호 Timeout 처리
 *   - CstAp_MovingMgt: CtAp_MovingSensorIn / CtAp_PositionSensorIn (이동/위치 센서)
 *   - CstAp_MoodControlMgt: CtAp_ColorSet / CtAp_MoodControl (RGB LED PWM)
 *   - BswIF_CAN: CtAp_RxMainCAN (CAN 메시지 수신/Timeout)
 */
import pg from 'pg'
import { calculateAP } from '../src/lib/ap-calculator.js'

const SESSION_ID = process.argv[2] ?? '263a3e7c-460a-4a2f-998d-99f079137c3f'
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db',
})

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

function ap(s: number, o: number, d: number) { return calculateAP(s, o, d) }

// ── 사양서 기반 FMEA 항목 ─────────────────────────────────────────────────────
const items: FmeaItem[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_PwrMGT [SwC100] / ASIL B
  // 사양서 근거: CtAp_IgnStaChk(SwU100.1), CtAp_LdoStaChk(SwU100.2),
  //             CtAp_SysStaChk(SwU100.3), CtAp_VbatStaChk(SwU100.4)
  // ══════════════════════════════════════════════════════════════════════════

  // ── CtAp_IgnStaChk (SwU100.1) ─────────────────────────────────────────────
  // 사양서: VIgnVolt ≤ V_IGN_OFF(4V) & TrmnlCtrlGrpStaBDCEV == BDCEV_POWERON → PowerOnSta=STD_ON
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_IgnStaChk / VIgnVolt',
    failure_mode: 'MORE',
    failure_detail: 'VIgnVolt ADC 값이 실제 전압(≤4V)보다 높게 측정되어 V_IGN_ON(7V) 이상으로 잘못 판정됨',
    effect_local: 'TrmnlCtrlGrpStaBDCEV 조건과 무관하게 PowerOnSta=STD_ON 출력 → IGN-OFF 상태에서 ECU 활성화 유지',
    effect_system: '실제 IGN-OFF임에도 SBW 시스템이 PowerON 상태로 유지 → 배터리 방전 및 변속 잠금 해제 오작동',
    potential_cause: 'IoHwAb ADC 채널 오프셋 에러 또는 전압 분배 저항 노화로 인한 측정값 편차',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'ADC 채널 주기적 자가진단 및 V_IGN 히스테리시스 범위(4~7V) 이중 검증 로직 적용',
    detection_action: 'CtAp_IgnStaChk PowerOnSta와 TrmnlCtrlGrpStaBDCEV 교차 검증; SysPwrSta 변화 모니터링',
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_IgnStaChk / TrmnlCtrlGrpStaBDCEV',
    failure_mode: 'CORRUPT',
    failure_detail: 'TrmnlCtrlGrpStaBDCEV 신호가 BDCEV_OFF(0x0)인데 BDCEV_POWERON(0x1)으로 잘못 수신됨',
    effect_local: 'V_IGN_OFF ≤ VIgnVolt < V_IGN_ON 구간(이전값 유지 조건)에서도 PowerOnSta=STD_ON으로 오판정',
    effect_system: 'IGN 전압 불안정 구간에서 ECU가 불필요하게 PowerON → 모터 구동 허가 조건 오활성화',
    potential_cause: 'CAN BDC 메시지 비트 플립(EMI), 수신 버퍼 덮어쓰기 오류',
    severity: 8, occurrence: 2, detection: 5,
    preventive_action: 'TrmnlCtrlGrpStaBDCEV CAN 신호 E2E CRC 검증 적용; BDCEV 상태 전이 유효성 검사',
    detection_action: 'SMK 메시지 수신 후 이전 상태와 비교하여 비정상 전이 감지 (예: OFF→READY 즉시 전이)',
  },

  // ── CtAp_LdoStaChk (SwU100.2) ─────────────────────────────────────────────
  // 사양서: VBatStbSta=ON & EcuSta=WAKEUP & Ldo2OnVolt ≤ 3.5V → Ldo2FltSta=ON, SbcFltSta=ON
  //         SbcFlt가 1초 이상 STD_ON → SbcFltSta=ON
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_LdoStaChk / Ldo2OnVolt',
    failure_mode: 'LESS',
    failure_detail: 'Ldo2OnVolt가 실제 4.8V 이상인데 3.5V 이하로 잘못 측정되어 Ldo2FltSta=STD_ON 출력',
    effect_local: 'LDO2 정상 상태에서 Ldo2FltSta=ON 오출력 → SbcFltSta=ON 연쇄 발생',
    effect_system: 'SbcFlt 오감지 → CtAp_SysStaChk에서 SysPwrSta=OFF 출력 → 정상 운행 중 시스템 전원 차단',
    potential_cause: 'IoHwAb Ldo2OnVolt ADC 채널 단락 또는 접지 분리로 인한 저전압 오측정',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'LDO2 전압 측정 경로에 이중화 ADC 채널 설계; 3.5V~4.8V 사이 이전값 유지 로직 확인',
    detection_action: 'Ldo2OnVolt와 VBatVolt 상관관계 교차검증; 동시 발생 시 ADC 고장으로 DTC 설정',
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_LdoStaChk / SbcFlt 타이머',
    failure_mode: 'EARLY',
    failure_detail: 'SBC Fault 핀이 순간 글리치(< 1초)로 ON 되었으나, 타이머 카운터 오류로 1초 미만에서 SbcFltSta=ON 출력',
    effect_local: 'SBC 일시적 노이즈로 인한 불필요한 SbcFltSta=ON → SysPwrSta 불필요 차단',
    effect_system: '실제 SBC 고장이 아님에도 SysPwrSta=OFF → 주행 중 변속 레버 잠금 및 P 위치 강제 복귀',
    potential_cause: '10ms 주기 runnable 실행 지연으로 타이머 카운터(100u = 1s) 오동작',
    severity: 8, occurrence: 3, detection: 5,
    preventive_action: 'SBC Fault 디바운스 타이머(1s = 100 * 10ms)를 WdgM 체크포인트와 연동하여 검증',
    detection_action: 'SbcFlt 지속 시간 로깅; 1초 미만 SbcFltSta=ON 발생 시 DTC(NoPubDtcSet) 등록',
  },

  // ── CtAp_SysStaChk (SwU100.3) ─────────────────────────────────────────────
  // 사양서: SbcFlt=ON → SysPwrSta=Power_OFF (우선순위 최고)
  //         SbcFlt=OFF & PowerOnSta=ON → SysPwrSta=Power_ON
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_SysStaChk / SysPwrSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'SbcFlt=OFF & PowerOnSta=ON 조건인데 SysPwrSta=Power_OFF(0) 출력 (우선순위 로직 오류)',
    effect_local: 'SysPwrSta=OFF → CtAp_MotorControl·CtAp_ECUModeChk·CtAp_DimLvlSet 등 18개 하위 컴포넌트 동작 중단',
    effect_system: '정상 주행 조건에서 갑작스러운 전원 차단 → 변속 레버 전기적 잠금 → 운전자 변속 불가',
    potential_cause: 'SbcFlt 포트 읽기 RTE 에러(RTE_E_OK 이외 값) 시 SbcFlt=STD_ON으로 간주하는 방어로직 누락',
    severity: 9, occurrence: 1, detection: 4,
    preventive_action: 'RTE 포트 읽기 리턴값 검사 추가; RTE_E_OK 이외일 때 이전 SbcFltSta 값 유지 처리',
    detection_action: 'SysPwrSta 출력 변화 이벤트 로깅; CtAp_DimLvlSet 입력 감시로 SysPwrSta=OFF 불시 감지',
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_SysStaChk / SysPwrSta',
    failure_mode: 'LATE',
    failure_detail: 'SbcFlt=ON 발생 후 SysPwrSta=Power_OFF 출력까지 10ms 이상 지연 (태스크 우선순위 역전)',
    effect_local: 'SBC 고장 감지와 시스템 전원 차단 사이 구간에서 모터 제어 지속',
    effect_system: 'SBC 과열·손상 상태에서 모터 구동 지속 → 하드웨어 손상 위험',
    potential_cause: 'CtAp_SysStaChk runnable 주기 태스크가 높은 우선순위 태스크에 선점되어 지연',
    severity: 8, occurrence: 2, detection: 6,
    preventive_action: 'CtAp_SysStaChk를 ASIL B 전용 높은 우선순위 태스크에 할당; 태스크 지연 WdgM 모니터링',
    detection_action: 'SbcFlt 발생 시각과 SysPwrSta=OFF 반영 시각 타임스탬프 비교; 10ms 초과 시 DTC 등록',
  },

  // ── CtAp_VbatStaChk (SwU100.4) ─────────────────────────────────────────────
  // 사양서: VBatVolt ≤ 8.5V → 2초 후 BatUnderSta=ON / VBatVolt ≥ 16.5V → 2초 후 BatOverSta=ON
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_VbatStaChk / VBatVolt',
    failure_mode: 'LESS',
    failure_detail: 'VBatVolt ADC 값이 실제 배터리 전압(예: 12V)보다 낮게 측정되어 8.5V(V_BAT_UNDER) 이하로 오판정',
    effect_local: '2초 타이머 후 BatUnderSta=ON 출력 → 저전압 경보 DTC 오설정',
    effect_system: '정상 전압에서 저전압 오감지 → 시스템 보호 모드 진입 → P 기어 강제 복귀 및 모터 구동 금지',
    potential_cause: 'VBatVolt ADC 채널 내부 기준전압 드리프트; 커넥터 접촉 저항 증가로 전압 강하 오측정',
    severity: 7, occurrence: 3, detection: 4,
    preventive_action: 'VBatVolt ADC 자가진단 주기 수행; 9V~16V 정상 범위 초기화 시 검증',
    detection_action: '배터리 전류값(외부 센서)과 VBatVolt 교차 검증; 2초 타이머 내 복구 시 오감지로 판단',
  },
  {
    sw_component: 'CstAp_PwrMGT',
    function_name: 'CtAp_VbatStaChk / VBatVolt',
    failure_mode: 'MORE',
    failure_detail: 'VBatVolt가 실제 16.5V(V_BAT_OVER) 이상인데 정상 범위(9~16V)로 잘못 측정됨 → BatOverSta=OFF 유지',
    effect_local: '과전압 상태에서 BatOverSta=OFF 오출력 → 과전압 보호 미동작',
    effect_system: '과전압에 의한 ECU 내부 소자 손상 및 LDO 과부하 → SBC 고장 유발',
    potential_cause: 'ADC 입력 다이오드 클램핑 미작동; 고전압 차단 필터 회로 불량',
    severity: 8, occurrence: 2, detection: 5,
    preventive_action: 'VBatVolt 과전압 감지를 HW 비교기(독립 회로)로 이중화; ADC 상한 클램프 회로 설계',
    detection_action: 'BatOverSta와 독립 HW 과전압 인터럽트 핀 상태 교차 검증',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_CANMGT [SwC200] / ASIL B
  // 사양서 근거: CtAp_CANBusOffChk(SwU200.1), BUSOFF_CHECK_TIME 타이머
  // ══════════════════════════════════════════════════════════════════════════

  // ── CtAp_CANBusOffChk (SwU200.1) ──────────────────────────────────────────
  // 사양서: MainCANBusOFF=ON → 타이머 증가 → BUSOFF_CHECK_TIME 도달 시 MainCANBusOFFSta=ON
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_CANBusOffChk / MainCANBusOFF',
    failure_mode: 'LATE',
    failure_detail: 'Main CAN Bus-OFF 발생 후 BUSOFF_CHECK_TIME 초과해도 MainCANBusOFFSta=ON 출력이 지연됨',
    effect_local: 'MainCANBusOFFSta 비정상 지연 → 상위 컴포넌트의 CAN 복구 절차 지연',
    effect_system: 'VCU 기어 위치 신호(GearPosSta), DrvRdySig 수신 지연 → P 위치 인터락 기능 지연',
    potential_cause: '10ms 태스크 지연으로 MainCANBusOFF_TimeCounter 증분 누락; BUSOFF_CHECK_TIME 파라미터 오설정',
    severity: 7, occurrence: 2, detection: 5,
    preventive_action: 'BUSOFF_CHECK_TIME 파라미터 설계 검토; 타이머 카운터 WdgM 논리적 감시 적용',
    detection_action: 'MainCANBusOFFSta 출력 지연 시간 모니터링; CAN 컨트롤러 Bus-OFF 인터럽트와 비교',
  },
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_CANBusOffChk / SubCANBusOFF',
    failure_mode: 'CORRUPT',
    failure_detail: 'Sub(Backup) CAN Bus-OFF가 아닌데 SubCANBusOFFSta=ON으로 잘못 출력됨 (타이머 카운터 미초기화)',
    effect_local: 'SubCANBusOFFSta 오출력 → 백업 CAN 경로 비정상 비활성화',
    effect_system: 'Main CAN Bus-OFF 발생 시 Sub CAN 대체 경로 사용 불가 → 변속 신호 완전 단절',
    potential_cause: 'SubCANBusOFF_TimeCounter가 이전 Bus-OFF 이벤트 후 초기화되지 않은 채 누적',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'SubCANBusOFF 조건 클리어 시 카운터 즉시 초기화 로직 검토; 컴파일 시 정적 분석',
    detection_action: 'SubCANBusOFF 핀 상태(BswIF_CAN)와 SubCANBusOFFSta 값 불일치 감지 DTC',
  },

  // CAN 신호 Timeout (BDC_02, VCU_FF_01 기반)
  // 사양서: RCtAp_RxMainCAN_BDC_02_200ms_Timeout → Ign1InStaSigTo=ON
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_RxMainCAN / BDC_02 Timeout',
    failure_mode: 'LATE',
    failure_detail: 'BDC_02 메시지(200ms 주기)가 Timeout 되었으나 Ign1InStaSigTo=ON 출력이 200ms 이상 지연됨',
    effect_local: 'Ign1InStaSig 유효성 플래그 오지연 → CtAp_IgnStaChk가 유효하지 않은 IGN 신호로 PowerOnSta 판정',
    effect_system: 'BDC 통신 단절 상태에서 IGN 상태 오판정 → 변속기 제어 전원 잘못된 유지/차단',
    potential_cause: 'COM 레이어 Timeout 콜백 등록 누락 또는 AUTOSAR COM 타임아웃 파라미터 오설정',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'BDC_02 메시지 Timeout 파라미터(200ms) AUTOSAR COM 설정 검토; 콜백 등록 코드 리뷰',
    detection_action: 'Ign1InStaSigTo 설정까지 지연 시간 측정; 200ms 초과 시 DTC(CAN 통신 고장) 등록',
  },
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_RxMainCAN / VCU_FF_01 Timeout',
    failure_mode: 'MORE',
    failure_detail: 'VCU_FF_01(10ms 주기) 메시지 정상 수신 중인데 GearPosSigTo=ON으로 오설정됨',
    effect_local: 'GearPosSigTo 오판정 → CstAp_CANMGT가 기어 위치 신호를 유효하지 않은 것으로 처리',
    effect_system: '정상 VCU 통신 중 변속 금지 조건 활성화 → 운전자 변속 불가',
    potential_cause: 'VCU_FF_01 Indication 콜백과 Timeout 콜백 동시 트리거 시 레이스컨디션으로 GearPosSigTo 오설정',
    severity: 8, occurrence: 2, detection: 5,
    preventive_action: 'Indication / Timeout 콜백 간 임계 구역 보호(인터럽트 마스킹); 콜백 순서 보장 설계',
    detection_action: 'GearPosSigTo=ON 시 VCU_FF_01 메시지 수신 카운터 교차 검증; 불일치 시 DTC 등록',
  },
  {
    sw_component: 'CstAp_CANMGT',
    function_name: 'CtAp_RxMainCAN / SMK_PwrOnModeSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'SMK_PwrOnModeSta 신호가 실제 PowerOn 상태가 아닌데 PowerOn(0x2)으로 수신됨',
    effect_local: 'CstAp_CANMGT가 SMK 메시지 구조체(CanMsg_SMK)에 잘못된 PwrOnModeSta 전달',
    effect_system: 'IGN 상태가 Off인데 SBW 시스템이 PowerOn으로 판단 → 불필요한 ECU 활성화 및 배터리 소모',
    potential_cause: 'SMK CAN 메시지 암호화 비활성화 상태에서 외부 신호 간섭; 수신 버퍼 공유 오류',
    severity: 7, occurrence: 2, detection: 5,
    preventive_action: 'SMK 메시지 MAC(Message Authentication Code) 또는 E2E Profile 적용',
    detection_action: 'SMK_PwrOnModeSta와 TrmnlCtrlGrpStaBDCEV 상태 일치 여부 교차 검증',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_MovingMgt [SwC900] / ASIL B
  // 사양서 근거: CtAp_MovingSensorIn(SwU900.1) - MovSnrRngFlt, MovSnrGapFlt
  //             CtAp_PositionSensorIn(SwU900.2) - PosSnrRaw1/2 계산
  // ══════════════════════════════════════════════════════════════════════════

  {
    sw_component: 'CstAp_MovingMgt',
    function_name: 'CtAp_MovingSensorIn / MovSnrRaw1',
    failure_mode: 'MORE',
    failure_detail: 'MovSnrRaw1 ADC 값이 MovingSnrRngFltMax 초과 → MovingSnrRngFlt=ON 출력 (범위 초과 고장)',
    effect_local: 'MovingSnrRngFlt 플래그 설정 → 이동 센서 신뢰성 상실 판정',
    effect_system: '이동 센서 고장 상태에서 CtAp_MotorControl이 위치 피드백 없이 모터 구동 → 물리적 스토퍼 충돌',
    potential_cause: '이동 센서 전원 과전압으로 출력 포화; IoHwAb ADC 입력 클램핑 미적용',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: '이동 센서 출력 범위 HW 필터 적용; MovingSnrRngFltMin~Max 범위 파라미터 설계 검토',
    detection_action: 'MovingSnrRngFlt=ON 즉시 DTC 등록 및 모터 정지 명령; MovSnrRaw1/2 동시 범위 이탈 확인',
  },
  {
    sw_component: 'CstAp_MovingMgt',
    function_name: 'CtAp_MovingSensorIn / MovSnrGapFlt',
    failure_mode: 'CORRUPT',
    failure_detail: 'MovSnrRaw1과 MovSnrRaw2 합산(MovingSnrSum)이 정상 범위인데 GapFlt=ON 오출력 (오버플로우 미처리)',
    effect_local: '사양서: InputMovingSnr1GFlt > (UINT32_size - InputMovingSnr2GFlt) 조건 오판정 → GapFlt=ON',
    effect_system: 'GapFlt 오감지로 이동 센서 무효화 → 위치 제어 전환 실패 → 변속 레버 중간 위치 고착',
    potential_cause: 'UINT32 덧셈 오버플로우 체크 로직 누락 (uint32 + uint32 > 0xFFFFFFFF 시 wrap-around)',
    severity: 9, occurrence: 2, detection: 4,
    preventive_action: '사양서 조건 "InputMovingSnr1GFlt > (UINT32_size - InputMovingSnr2GFlt)" 구현 시 오버플로우 방지 코드 추가',
    detection_action: 'MovSnrGapFlt=ON 시 MovSnrRaw1·Raw2 원시값 동시 로깅 및 합산값 범위 재검증',
  },
  {
    sw_component: 'CstAp_MovingMgt',
    function_name: 'CtAp_PositionSensorIn / PosSnrRaw1',
    failure_mode: 'CORRUPT',
    failure_detail: 'PosSnrRaw1 계산식 오류: ActiveTime/PeriodTime 나눗셈에서 PeriodTime=0일 때 0u 출력 안 됨 (Division by Zero)',
    effect_local: 'PosSnrRaw1 비정상 값 출력 (예: 최대값 0xFFFF) → 위치 계산 오류',
    effect_system: '잘못된 위치 값 기반 모터 제어 → 레버가 목표 위치 초과 이동 → 기계적 충돌 및 모터 손상',
    potential_cause: '센서 신호 입력 없을 때(PeriodTime=0) 나눗셈 예외 처리 누락',
    severity: 9, occurrence: 2, detection: 4,
    preventive_action: '사양서: PeriodTime=0 시 PosSnrRaw=0u 출력 조건 구현 검토 및 코드 리뷰',
    detection_action: 'PosSnrRaw1 계산값이 유효 범위(0~1000) 벗어날 시 즉시 0u로 클램핑 및 DTC 등록',
  },
  {
    sw_component: 'CstAp_MovingMgt',
    function_name: 'CtAp_MovingSensorIn / VoltageFailure',
    failure_mode: 'LESS',
    failure_detail: '이동 센서 공급전압 이상으로 MovingSensorIn_VoltageFailure=ON 출력되어야 하나 STD_OFF 유지',
    effect_local: '센서 전압 고장 미감지 → 비정상 센서 값으로 위치 제어 계속 수행',
    effect_system: '전압 이상 센서로부터 잘못된 위치 피드백 → 모터 오구동 → SBW 물리적 고장',
    potential_cause: '센서 전원 모니터링 경로의 ADC 채널 단선으로 항상 정상 전압 읽힘',
    severity: 9, occurrence: 2, detection: 5,
    preventive_action: '센서 공급전압 모니터링을 독립 HW 회로로 이중화; IoHwAb 전압 진단 유닛 설계',
    detection_action: 'MovingSensorIn_VoltageFailure=OFF 상태에서 MovSnrRaw 값 비정상 패턴 감지 시 DTC',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_MoodControlMgt [SwC1000] / ASIL B
  // 사양서 근거: CtAp_ColorSet(SwU1000.1), CtAp_MoodControl(SwU1000.2)
  //             RGB LED PWM(RPWM/GPWM/BPWM) 출력, 밝기/색상 제어
  // ══════════════════════════════════════════════════════════════════════════

  {
    sw_component: 'CstAp_MoodControlMgt',
    function_name: 'CtAp_MoodControl / RPWM·GPWM·BPWM',
    failure_mode: 'MORE',
    failure_detail: '분위기 조명 PWM 출력(RPWM/GPWM/BPWM)이 설정값보다 높게 출력되어 LED 최대 밝기 고착',
    effect_local: 'RGB LED 전류 과다 → LED 수명 단축 및 열 발생',
    effect_system: '야간 운전 중 과도한 조명 눈부심 → 운전자 시야 방해 (간접 안전 리스크)',
    potential_cause: 'PWM 듀티 계산 레지스터 오버플로우; BswIF_IoHwAb PWM 채널 초기화 오류',
    severity: 4, occurrence: 3, detection: 5,
    preventive_action: 'PWM 출력값 최대값 클램핑(255u) 코드 리뷰; BswIF_IoHwAb PWM 레지스터 초기화 검증',
    detection_action: 'RPWM/GPWM/BPWM 출력값이 설정 범위 초과 시 DTC(DID 관련) 등록',
  },
  {
    sw_component: 'CstAp_MoodControlMgt',
    function_name: 'CtAp_MoodControl / SlvBrgtnsVal',
    failure_mode: 'CORRUPT',
    failure_detail: 'BDC_05 메시지의 SlvBrgtnsVal(슬레이브 밝기) 값이 수신 Timeout 후에도 이전 값으로 유지됨',
    effect_local: 'BDC_05 Timeout 시 SlvBrgtnsVal 이전값 고착 → Fade-in/Fade-out 미수행',
    effect_system: 'IGN-OFF 후에도 분위기 조명 유지 → 배터리 방전 유발 (장기 주차 시)',
    potential_cause: 'BDC_05 Timeout 콜백에서 SlvBrgtnsVal를 0으로 초기화하는 로직 누락',
    severity: 4, occurrence: 3, detection: 6,
    preventive_action: 'BDC_05 Timeout 시 SlvBrgtnsVal=0(최소 밝기) 또는 기본값으로 설정하는 fail-safe 추가',
    detection_action: 'BDC_05 Timeout 발생 후 SlvBrgtnsVal 값 변화 없음 감지 시 경고 DTC 등록',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BswIF_CAN [SwC1300] / ASIL B
  // 사양서 근거: CtAp_RxMainCAN(SwU1300.1) - 메시지 수신/Timeout 처리
  //             VCU_FF_01(10ms), BDC_02/04/05(200ms), SMK_02/03(200ms)
  // ══════════════════════════════════════════════════════════════════════════

  {
    sw_component: 'BswIF_CAN',
    function_name: 'CtAp_RxMainCAN / BDC_04 Timeout',
    failure_mode: 'LATE',
    failure_detail: 'BDC_04 메시지(200ms 주기) Timeout 발생 후 BDC_04_200ms_Timeout=ON 출력 지연 (>200ms)',
    effect_local: '알람 관련 신호(BDC_04) 상태 갱신 지연 → 알람 출력 판단 오류',
    effect_system: '차량 경보 상태(도어/시트벨트 등) 미반영 → SBW 관련 안전 경보 지연',
    potential_cause: 'COM 레이어 BDC_04 타임아웃 설정이 실제 메시지 주기(200ms)보다 짧게 설정됨',
    severity: 5, occurrence: 2, detection: 5,
    preventive_action: 'BDC_04 COM Timeout 파라미터를 메시지 주기(200ms) + 허용 오차(50ms)로 설정',
    detection_action: 'BDC_04 수신 카운터와 Timeout 카운터 차이 모니터링',
  },
  {
    sw_component: 'BswIF_CAN',
    function_name: 'CtAp_RxMainCAN / VCU_FF_01 E2E',
    failure_mode: 'CORRUPT',
    failure_detail: 'VCU_FF_01 메시지 E2E(MsgGr_E2E_PCAN_VCU_01) 검증 실패 시 GearPosSig 값이 이전 프레임 값으로 유지됨',
    effect_local: 'E2E 오류 시 stale 기어 위치 값 사용 → GearPosSta 신뢰성 저하',
    effect_system: '실제 기어 위치와 다른 GearPosSta로 인터락 조건 오판정 → P 위치 오인식으로 주행 중 P 허용',
    potential_cause: 'E2E 검증 실패 시 안전값(Safe Value) 적용 로직 미구현; 이전 값 그대로 사용',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'E2E 검증 실패 시 GearPosSig=Invalid(0xFF) 또는 안전값 적용 코드 추가; AUTOSAR E2E Profile 2 적용',
    detection_action: 'E2E 오류 카운터 임계값 초과 시 즉시 DTC 등록 및 안전 모드 전환',
  },
  {
    sw_component: 'BswIF_CAN',
    function_name: 'CtAp_RxMainCAN / SMK_02 Timeout',
    failure_mode: 'MORE',
    failure_detail: 'SMK_02(200ms) Timeout 조건이 아닌데 SMK_02_200ms_Timeout=ON으로 잘못 설정됨',
    effect_local: 'SMK 스마트키 신호 유효성 오판정 → TrmnlCtrlGrpStaBDCEV 신뢰성 하락',
    effect_system: 'SMK 오류로 인한 불필요한 PowerOn 거부 → 스마트키 정상 인증에도 시동 불가',
    potential_cause: 'SMK_02 Indication 콜백 미등록으로 Timeout 플래그가 Indication 수신 후에도 초기화되지 않음',
    severity: 6, occurrence: 2, detection: 4,
    preventive_action: 'SMK_02 Indication 콜백 내 SMK_02_200ms_Timeout=OFF 초기화 코드 존재 여부 검토',
    detection_action: 'SMK_02_Timeout=ON 상태에서 SMK_02 메시지 수신 카운터 증가 감지 시 콜백 누락 DTC',
  },
  {
    sw_component: 'BswIF_CAN',
    function_name: 'CtAp_RxMainCAN / BDC_05 Timeout',
    failure_mode: 'CORRUPT',
    failure_detail: 'BDC_05 Timeout 발생 시 AvTailLmpSigTo·IntTailLmpOnReqSigTo·AutoLtSnrNightSigTo 중 일부만 ON 설정됨',
    effect_local: '분위기 조명 제어 신호(AvTailLmpSig, IntTailLmpOnReqSig, AutoLtSnrNightSig) 비일관성',
    effect_system: '테일 램프 연동 분위기 조명이 일부만 오프 → 야간 조명 불균일',
    potential_cause: 'BDC_05_Timeout 콜백에서 3개 SigTo를 모두 ON 설정하는 코드 중 일부 라인 누락',
    severity: 3, occurrence: 2, detection: 6,
    preventive_action: 'BDC_05 Timeout 콜백 내 3개 SigTo 동시 설정 코드 정적 분석 및 단위 테스트',
    detection_action: 'BDC_05 Timeout 후 3개 SigTo 값 일치 여부 체크 로직 추가',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_ECUModeMgt (사양서 파일 2 참조)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk / EcuSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'EcuSta가 ECU_STANDBY(3) 상태인데 ECU_WAKEUP(1)으로 잘못 출력됨',
    effect_local: 'Standby 상태에서 WAKEUP 모드 동작 → LdoStaChk가 잘못된 EcuSta 기반 Ldo2FltSta 판정',
    effect_system: 'ECU Standby 중 Ldo2FltSta 오판정 → SBC 고장 오감지 → 불필요한 전원 차단',
    potential_cause: 'ECU 모드 전이 로직에서 STANDBY→WAKEUP 전이 조건이 엄격하지 않아 조건 오충족',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: 'ECU 모드 전이 상태 머신 진입 조건 검토; STANDBY 상태에서 WAKEUP 전이 허가 조건 강화',
    detection_action: 'EcuSta 전이 이력 로깅; STANDBY→WAKEUP 직접 전이 발생 시 DTC 등록',
  },
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk / SysPwrSta 연계',
    failure_mode: 'LATE',
    failure_detail: 'SysPwrSta=Power_OFF 수신 후 ECU 슬립 모드 전환이 지연됨 (>100ms)',
    effect_local: 'ECU 슬립 전환 지연 → 불필요한 전류 소모',
    effect_system: 'IGN-OFF 후 배터리 방전 가속화; WakeUp 소스 감지 오류 발생 가능',
    potential_cause: 'CtAp_ECUModeChk runnable 주기 내 SysPwrSta 변화 감지 지연; AUTOSAR 모드 전환 대기 시간 설정 오류',
    severity: 5, occurrence: 3, detection: 5,
    preventive_action: 'SysPwrSta=OFF 이벤트 기반 즉시 슬립 전환 트리거 설계; AUTOSAR SchM 모드 전환 최대 지연 설정',
    detection_action: 'SysPwrSta=OFF 이후 ECU 전류 프로파일 모니터링; 100ms 초과 시 슬립 전환 실패 DTC',
  },

]

// ── 삽입 ────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect()
  try {
    const total = items.length
    console.log(`\n▶ 사양서 기반 FMEA 항목 생성 시작 (총 ${total}개)`)

    await client.query('BEGIN')

    // 기존 AI 항목 삭제
    await client.query(
      "DELETE FROM pre_fmea_items WHERE session_id=$1 AND source='ai'",
      [SESSION_ID],
    )
    console.log('  기존 AI 항목 삭제 완료')

    const apDist: Record<string, number> = {}
    const compDist: Record<string, number> = {}

    for (const item of items) {
      const apVal = ap(item.severity, item.occurrence, item.detection)
      apDist[apVal] = (apDist[apVal] ?? 0) + 1
      compDist[item.sw_component] = (compDist[item.sw_component] ?? 0) + 1

      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause,
          severity, occurrence, detection, action_priority,
          preventive_action, detection_action,
          source, review_status, confidence_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ai','pending',0.90)`,
        [
          SESSION_ID, item.sw_component, item.function_name,
          item.failure_mode, item.failure_detail,
          item.effect_local, item.effect_system, item.potential_cause,
          item.severity, item.occurrence, item.detection, apVal,
          item.preventive_action, item.detection_action,
        ],
      )
    }

    await client.query('COMMIT')

    console.log(`\n✅ 삽입 완료: ${total}개`)
    console.log('\n[AP 분포]')
    Object.entries(apDist).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}개`))
    console.log('\n[컴포넌트별 항목 수]')
    Object.entries(compDist)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`  ${k.padEnd(40)}: ${v}개`))

    // 세션 상태 업데이트
    await pool.query("UPDATE pre_fmea_sessions SET status='generated' WHERE id=$1", [SESSION_ID])
    console.log('\n세션 상태: generated')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ error:', e)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
