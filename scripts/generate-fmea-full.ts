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

type Row = {
  sw_component: string; function_name: string; failure_mode: string
  failure_detail: string; effect_local: string; effect_system: string
  potential_cause: string; severity: number; occurrence: number; detection: number
  preventive_action: string; detection_action: string; confidence_score: number
}

const ITEMS: Row[] = [

  // ══════════════════════════════════════════════════════
  // CstAp_PwrMGT [SwC100] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_PwrMGT', function_name:'CtAp_IgnStaChk — IGN 전압 PowerOn 판단 (V_IGN_OFF=4V, V_IGN_ON=7V)',
    failure_mode:'CORRUPT', failure_detail:'VIgnVolt이 V_IGN_OFF(405U)~V_IGN_ON(762U) 사이에서 진동하여 PowerOnSta가 ON/OFF 사이에서 chattering 발생',
    effect_local:'PowerOnSta 반복 토글로 ECU 모드 전환 로직 불안정', effect_system:'SBW 시스템이 PowerOn↔Off를 반복하여 변속 기능 단속 차단',
    potential_cause:'시동 시 배터리 전압 강하 구간에서 ADC 값이 임계값을 반복 통과', severity:8, occurrence:4, detection:4,
    preventive_action:'IGN 전압 히스테리시스 폭 확대 및 디바운싱 타이머 적용', detection_action:'PowerOnSta 토글 카운터 DTC 설정 및 경계값 Unit Test', confidence_score:0.90 },

  { sw_component:'CstAp_PwrMGT', function_name:'CtAp_BatVoltChk — 배터리 저전압 감지 (V_BAT_UNDER=8.5V)',
    failure_mode:'LESS', failure_detail:'배터리 전압이 V_BAT_UNDER(962u) 이하이나 V_BAT_UNDER_TIME_SET(2s) 타이머 미만으로 저전압 플래그 미설정',
    effect_local:'저전압 보호 로직 미동작으로 ECU 전압 불안정 지속', effect_system:'저전압 환경에서 모터 오동작 또는 CAN 통신 오류로 SBW 기어 불일치',
    potential_cause:'ADC 캘리브레이션 오류 또는 타이머 재시작 버그', severity:7, occurrence:3, detection:4,
    preventive_action:'ADC 캘리브레이션 주기 검증 및 V_BAT_UNDER 마진 확보', detection_action:'저전압 DTC(U3003) 설정 및 배터리 전압 실측 모니터링', confidence_score:0.88 },

  { sw_component:'CstAp_PwrMGT', function_name:'CtAp_BatVoltChk — 배터리 과전압 감지 (V_BAT_OVER=16.5V)',
    failure_mode:'MORE', failure_detail:'배터리 전압이 V_BAT_OVER(1910u)를 초과했으나 V_BAT_OVER_TIME_SET(2s) 카운터 초기화 버그로 과전압 플래그 미설정',
    effect_local:'과전압 보호 미동작으로 ECU 및 액추에이터 손상 위험', effect_system:'모터 구동부 과부하 또는 CAN 트랜시버 손상으로 SBW 기능 상실',
    potential_cause:'타이머 카운터 변수 오버플로우 또는 과전압 이벤트 중 카운터 리셋', severity:8, occurrence:2, detection:4,
    preventive_action:'과전압 타이머 없이 즉시 감지하는 HW 보호 회로 이중화', detection_action:'과전압 DTC 즉시 설정 및 HW 전압 모니터 비교 검증', confidence_score:0.87 },

  { sw_component:'CstAp_PwrMGT', function_name:'CtAp_Ldo2VoltChk — LDO2 저전압 감지 (V_LDO2_UNDER=3.5V)',
    failure_mode:'LESS', failure_detail:'LDO2 전압이 V_LDO2_UNDER(2866u) 미만으로 강하했으나 SBC 통신 오류로 감지 실패',
    effect_local:'LDO2 기반 내부 로직 전압 부족으로 MCU 연산 오류 또는 메모리 오염', effect_system:'SBW 전체 SW 오동작으로 기어 포지션 무결성 상실',
    potential_cause:'SBC 통신 오류 또는 LDO2 ADC 채널 배선 이상', severity:9, occurrence:2, detection:3,
    preventive_action:'SBC 상태와 LDO2 측정값 교차 검증 로직 적용', detection_action:'LDO2 언더볼트 DTC 즉시 설정 및 V_LDO2_UNDER_TIME_SET(1s) 내 복구 확인', confidence_score:0.86 },

  { sw_component:'CstAp_PwrMGT', function_name:'CtAp_BatVoltChk — 배터리 정상 복구 판단 (V_BAT_NORMAL_MIN=9V)',
    failure_mode:'EARLY', failure_detail:'배터리 전압이 V_BAT_NORMAL_MIN(9V)에 도달하자마자 V_BAT_NORMAL_TIME_SET(1s) 안정화 시간 미충족 상태에서 정상으로 조기 판정',
    effect_local:'정상 판정 후 곧바로 다시 저전압 감지되어 상태 진동 발생', effect_system:'전원 상태 불안정으로 ECU 모드가 정상↔보호 사이를 반복하여 SBW 동작 신뢰성 저하',
    potential_cause:'배터리 전압 회복 직후 부하 급증으로 재강하, 안정화 타이머 미적용', severity:6, occurrence:4, detection:5,
    preventive_action:'V_BAT_NORMAL_TIME_SET(1s) 내 전압 유지 확인 후 정상 판정', detection_action:'전압 상태 전환 이력 DTC 및 1초 안정화 검증 로직 Unit Test', confidence_score:0.85 },

  // ══════════════════════════════════════════════════════
  // CstAp_CANMGT [SwC200] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_CANMGT', function_name:'CtAp_CANBusOffChk — CAN Bus-Off 감지 (BUSOFF_CHECK_TIME=70u)',
    failure_mode:'LATE', failure_detail:'CAN Bus-Off 발생 후 BUSOFF_CHECK_TIME(70u) 초과하여 감지 지연',
    effect_local:'CAN 버스 중단 상태 지속으로 수신 버퍼 오버플로우', effect_system:'TCU 기어 명령(HTCU_GearSlctrDis) 수신 불가로 SBW 변속 불가',
    potential_cause:'Bus-Off 감지 인터럽트 우선순위 설정 오류 또는 폴링 주기 초과', severity:8, occurrence:3, detection:3,
    preventive_action:'Bus-Off 감지 인터럽트 최고 우선순위 설정 및 CAN 에러 카운터 실시간 모니터링', detection_action:'CAN Bus-Off DTC 즉시 설정 및 복구 시도 횟수 기록', confidence_score:0.91 },

  { sw_component:'CstAp_CANMGT', function_name:'Bus-Off 복구 후 메시지 유효성 처리',
    failure_mode:'CORRUPT', failure_detail:'Bus-Off 복구 후 버퍼 플러시 미수행으로 잔류 오염 프레임의 LVR 기어 값 처리',
    effect_local:'오염된 기어 명령이 상위 로직에 전달됨', effect_system:'운전자 의도와 다른 기어(예: N→R) 실행으로 차량 안전 위협',
    potential_cause:'Bus-Off 복구 직후 버퍼 초기화 로직 누락', severity:10, occurrence:2, detection:4,
    preventive_action:'Bus-Off 복구 시 수신 버퍼 완전 초기화 및 첫 메시지 CRC 검증 후 적용', detection_action:'E2E 검증 실패 DTC 및 기어 Plausibility 체크', confidence_score:0.89 },

  { sw_component:'CstAp_CANMGT', function_name:'CAN 기어 포지션 수신 — LVR 범위 검증 (LVR_R=0x01~LVR_D=0x05)',
    failure_mode:'MORE', failure_detail:'수신된 LVR 값이 정의 범위(0x01~0x05) 외의 값(0x06+)으로 수신되어 미정의 기어 상태 처리',
    effect_local:'CANMGT 기어 상태 테이블 오염으로 잘못된 포지션 출력', effect_system:'미정의 기어로 모터 제어 이상 동작 또는 안전 상태 미진입',
    potential_cause:'TCU 소프트웨어 버그 또는 CAN 프레임 비트 오류', severity:9, occurrence:2, detection:3,
    preventive_action:'수신 LVR 값 화이트리스트 검증(0x01~0x05) 후 범위 외 시 기본값(LVR_Null) 적용', detection_action:'범위 외 값 즉시 DTC 설정 및 직전 유효값 유지', confidence_score:0.92 },

  { sw_component:'CstAp_CANMGT', function_name:'KEY_LOCK/TRUNK_LOCK 상태 처리',
    failure_mode:'CORRUPT', failure_detail:'KEY_LOCK(1u) 또는 TRUNK_LOCK(2u) 상태가 잘못 해제되어 잠금 중 기어 변속 명령이 수행됨',
    effect_local:'잠금 조건 무시로 불필요한 기어 변속 실행', effect_system:'차량 주차/잠금 상태에서 의도치 않은 기어 이동으로 차량 움직임 위험',
    potential_cause:'잠금 상태 플래그 변수 초기화 오류 또는 잠금 해제 조건 AND/OR 로직 반전', severity:8, occurrence:3, detection:4,
    preventive_action:'잠금 상태 이중 변수 저장 및 두 변수 모두 잠금 해제 시에만 기어 명령 수락', detection_action:'잠금 중 기어 명령 감지 DTC 및 Unit Test로 모든 잠금 조건 검증', confidence_score:0.88 },

  // ══════════════════════════════════════════════════════
  // CstAp_ECUModeMgt [SwC300] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_ECUModeMgt', function_name:'CtAp_ECUModeChk — ECU 모드 전환 상태 머신',
    failure_mode:'CORRUPT', failure_detail:'VEHICLE_POWER_POWER_ON(1)에서 직접 Sleep 진입 등 비유효 상태 전환 발생',
    effect_local:'모드 전환 시퀀스 오류로 일부 컴포넌트 미초기화 또는 미해제', effect_system:'SBW 부분 기능만 활성화된 불완전 상태로 동작',
    potential_cause:'복수 ECU 모드 변경 요청 동시 수신 또는 상태 전환 우선순위 처리 오류', severity:8, occurrence:3, detection:4,
    preventive_action:'모드 전환 트랜지션 테이블 기반 유효 전환만 허용', detection_action:'비유효 모드 전환 DTC 및 Unit Test로 모든 전환 경로 검증', confidence_score:0.87 },

  { sw_component:'CstAp_ECUModeMgt', function_name:'Wakeup 타이머 관리 (WAKEUP_TIME=180s)',
    failure_mode:'LATE', failure_detail:'Wakeup 진입 후 WAKEUP_TIME(18000u) 타이머가 미만료되어 Sleep 전환 무한 지연',
    effect_local:'ECU Wakeup 상태 유지로 불필요한 전력 소비 지속', effect_system:'주차 중 배터리 방전 및 재시동 후 SBW 초기화 오류 가능성',
    potential_cause:'타이머 카운터 오버플로우 또는 주기적 리셋으로 타이머 재시작', severity:5, occurrence:3, detection:5,
    preventive_action:'타이머 변수 타입 범위 검증 및 독립 타이머 모니터링 추가', detection_action:'타이머 만료 watchdog 및 Wakeup 지속 시간 DTC', confidence_score:0.83 },

  { sw_component:'CstAp_ECUModeMgt', function_name:'Sleep 진입 조건 판단 (Exter_ECU_Sleep=4)',
    failure_mode:'EARLY', failure_detail:'Sleep 진입 조건(모든 외부 ECU Sleep 요청) 미충족 상태에서 조기 Sleep 진입',
    effect_local:'활성 통신 중 CAN 비활성화로 메시지 손실', effect_system:'변속 진행 중 ECU Sleep으로 모터 제어 중단 및 레버 중간 위치 고착',
    potential_cause:'Sleep 조건 플래그 OR/AND 로직 오류 또는 외부 ECU 상태 업데이트 지연', severity:7, occurrence:3, detection:4,
    preventive_action:'Sleep 전 모든 활성 작업 완료 확인(기어 변속 완료, 통신 종료) 후 Sleep 허용', detection_action:'조기 Sleep 감지 DTC 및 Sleep 조건 Unit Test', confidence_score:0.85 },

  // ══════════════════════════════════════════════════════
  // CstAp_ButtonMgt [SwC500] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_ButtonMgt', function_name:'변속 버튼 ADC 감지 — SW1 ON 범위(2356~2604u)',
    failure_mode:'CORRUPT', failure_detail:'SW1 ADC 값이 ON(2356~2604u)과 OFF(804~889u) 중간값으로 지속되어 버튼 상태 오판단',
    effect_local:'의도치 않은 기어 변속 명령 발생 또는 버튼 입력 무시', effect_system:'운전자가 P를 선택했으나 N 또는 D로 판정되어 안전 위협',
    potential_cause:'버튼 기계적 마모 또는 EMI로 ADC 값이 Dead-Zone에 유지', severity:9, occurrence:3, detection:3,
    preventive_action:'ON/OFF 사이 Dead-Zone 정의 및 디바운싱 시간 증가', detection_action:'중간값 지속 감지 DTC 및 이중 샘플링 비교', confidence_score:0.91 },

  { sw_component:'CstAp_ButtonMgt', function_name:'복수 버튼 동시 입력 처리',
    failure_mode:'MORE', failure_detail:'P+D 버튼 동시 ON으로 복수 기어 명령 동시 발생',
    effect_local:'기어 명령 우선순위 충돌로 불명확한 기어 출력', effect_system:'모터 제어가 충돌 명령을 수신하여 액추에이터 오동작',
    potential_cause:'전기적 합선 또는 복수 입력 처리 로직 누락', severity:8, occurrence:2, detection:4,
    preventive_action:'복수 버튼 동시 입력 감지 시 모든 입력 무효화 및 이전 기어 유지', detection_action:'복수 입력 DTC 및 조합 시나리오 Unit Test', confidence_score:0.88 },

  { sw_component:'CstAp_ButtonMgt', function_name:'SW2 OFF 범위 감지 (InterSwOffMin_2=1608u~)',
    failure_mode:'LESS', failure_detail:'SW2 ADC 값이 OFF 범위(1608u) 미만으로 측정되어 버튼 미입력 시 입력으로 오판단',
    effect_local:'운전자 미조작 시 기어 변속 명령 발생', effect_system:'의도치 않은 자동 기어 변속으로 차량 예기치 않은 거동',
    potential_cause:'SW2 배선 단락 또는 풀다운 저항 불량으로 ADC 하한값 이탈', severity:8, occurrence:2, detection:4,
    preventive_action:'풀다운 저항 이중화 및 SW2 ADC 하한 임계값 마진 확보', detection_action:'ADC 하한 이탈 DTC 및 버튼 미입력 상태 검증', confidence_score:0.86 },

  // ══════════════════════════════════════════════════════
  // CstAp_HapticControlMgt [SwC600] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_HapticControlMgt', function_name:'SPI 햅틱 명령 전송 (SELECT_PLAYBACK=9)',
    failure_mode:'CORRUPT', failure_detail:'SPI 노이즈로 햅틱 액추에이터에 SELECT_PLAYBACK(9) 외의 값 전달되어 비정상 진동 발생',
    effect_local:'햅틱 오동작으로 예상치 못한 강도/패턴의 진동', effect_system:'운전자가 잘못된 촉각 피드백으로 기어 변속 오인 → 추가 버튼 조작',
    potential_cause:'SPI DMA 전송 오류 또는 버스 노이즈로 파라미터 변조', severity:5, occurrence:3, detection:5,
    preventive_action:'SPI 전송 체크섬 검증 및 유효 파라미터 범위 검증 후 전송', detection_action:'SPI 오류 카운터 DTC 및 햅틱 ACK 응답 확인', confidence_score:0.82 },

  { sw_component:'CstAp_HapticControlMgt', function_name:'R기어 햅틱 피드백 (CAN_GEAR_POS_R=7 vs LVR_R=1 일치 확인)',
    failure_mode:'LATE', failure_detail:'VCU CAN 기어 포지션(7)과 레버 위치(LVR_R=1) 일치 확인 후 R기어 햅틱이 500ms 이상 지연 출력',
    effect_local:'햅틱 지연으로 운전자 조작 확인 불가', effect_system:'피드백 지연으로 추가 조작 시도 → 연속 명령 중복',
    potential_cause:'햅틱 태스크 우선순위 낮아 스케줄링 지연', severity:4, occurrence:3, detection:5,
    preventive_action:'햅틱 출력 태스크 우선순위 상향 및 최대 응답시간(100ms) 정의', detection_action:'햅틱 응답 시간 모니터링 DTC 및 Unit Test', confidence_score:0.80 },

  { sw_component:'CstAp_HapticControlMgt', function_name:'GO_VIBRATION_CMD 실행 타이밍',
    failure_mode:'EARLY', failure_detail:'기어 변속 완료 확인 전 GO_VIBRATION_CMD(1) 명령이 조기 실행되어 변속 진행 중 완료 피드백 출력',
    effect_local:'변속 미완료 시점에 완료 진동 출력', effect_system:'운전자가 변속 완료로 오인하여 레버에서 손을 떼거나 주행 시작',
    potential_cause:'변속 완료 조건 확인 없이 시간 기반 트리거로 햅틱 명령 실행', severity:6, occurrence:3, detection:4,
    preventive_action:'CstAp_PosMgt 변속 완료 플래그 확인 후 GO_VIBRATION_CMD 실행', detection_action:'변속 완료 플래그 연동 Unit Test 및 타이밍 검증', confidence_score:0.83 },

  // ══════════════════════════════════════════════════════
  // CstAp_MotorControlMgt [SwC700] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_MotorControlMgt', function_name:'다이얼 회전 모터 — 목표 위치 초과 (DIAL_POSITION)',
    failure_mode:'MORE', failure_detail:'DIAL_POSITION 도달 후 모터가 계속 회전하여 기구적 End Stop 충돌',
    effect_local:'모터 과전류 및 기구부 손상으로 이상 상태 진입', effect_system:'기어 레버 물리적 파손으로 SBW 기능 완전 상실',
    potential_cause:'위치 피드백 루프 지연 또는 PID 과조정(overshoot)', severity:8, occurrence:3, detection:4,
    preventive_action:'소프트 리밋 설정 및 모터 전류 급증 감지 시 즉시 정지', detection_action:'모터 과전류 DTC 및 End Stop 접근 경고 인터럽트', confidence_score:0.91 },

  { sw_component:'CstAp_MotorControlMgt', function_name:'모드 전환 중 모터 초기화 (OFF_MODE→NORMAL_MODE)',
    failure_mode:'LATE', failure_detail:'NORMAL_MODE 전환 시 모터 초기화 완료 전 기어 변속 명령 수신으로 비정상 동작',
    effect_local:'미초기화 모터 제어기에 명령 인가로 예측 불가 동작', effect_system:'초기화 중 의도치 않은 레버 이동으로 주차 중 기어 빠짐 위험',
    potential_cause:'초기화 완료 플래그 확인 없이 외부 명령 수락', severity:8, occurrence:3, detection:4,
    preventive_action:'초기화 완료 플래그 확인 후에만 외부 명령 수락 (Ready 게이팅)', detection_action:'초기화 미완료 중 명령 수신 DTC 및 초기화 시간 초과 감지', confidence_score:0.88 },

  { sw_component:'CstAp_MotorControlMgt', function_name:'TurnDialErrorDetection — 고장 감지 오감지 (False Positive)',
    failure_mode:'CORRUPT', failure_detail:'MOTOR_FAULT_DETECTION 신호가 실제 고장 없이 오감지되어 정상 변속 중 모터 강제 정지',
    effect_local:'변속 중 모터 정지로 레버 중간 위치 고착', effect_system:'N/D 경계 고착으로 확정되지 않은 기어 상태 지속',
    potential_cause:'전류 측정 노이즈 또는 진단 임계값 과민 설정', severity:8, occurrence:4, detection:4,
    preventive_action:'고장 판정 임계값 노이즈 마진 포함 설정 및 2회 연속 감지 시만 처리', detection_action:'고장 감지 카운터 DTC 및 고장/정상 전환 이력 기록', confidence_score:0.87 },

  { sw_component:'CstAp_MotorControlMgt', function_name:'STATE_TURN_SPHERE — 스피어 회전 모터 제어',
    failure_mode:'LESS', failure_detail:'SPHERE_POSITION 목표 도달 이전에 스피어 회전 모터 구동력이 부족하여 목표 위치 미달',
    effect_local:'스피어 레버가 목표 위치에 미도달하여 물리적 잠금 미완료', effect_system:'기어 포지션 물리적 확정 불가로 SBW 기어 슬립 또는 오정렬',
    potential_cause:'배터리 저전압 시 모터 구동 전류 부족 또는 마찰 증가로 토크 부족', severity:7, occurrence:3, detection:4,
    preventive_action:'저전압 시 모터 출력 보상 로직 및 토크 충분성 확인 후 완료 판정', detection_action:'위치 도달 실패 DTC 및 모터 전류-위치 상관 모니터링', confidence_score:0.85 },

  { sw_component:'CstAp_MotorControlMgt', function_name:'UTILITY_MODE/SERVICE_MODE 전환 처리',
    failure_mode:'CORRUPT', failure_detail:'일반 NORMAL_MODE 중 UTILITY_MODE(2) 또는 SERVICE_MODE(3) 조건 미충족 상태에서 모드 전환 발생',
    effect_local:'진단/서비스 모드에서 일반 변속 제어 로직이 비활성화됨', effect_system:'운전자가 인지하지 못한 상태에서 모터 제어 동작 변경으로 비정상 변속',
    potential_cause:'모드 전환 조건 로직 오류 또는 진단 툴 미연결 상태에서의 모드 강제 전환', severity:7, occurrence:2, detection:4,
    preventive_action:'UTILITY/SERVICE MODE 전환 시 진단 툴 연결 확인 및 차량 정지 조건 필수 확인', detection_action:'비정상 모드 전환 DTC 및 모드 이력 NvM 기록', confidence_score:0.84 },

  // ══════════════════════════════════════════════════════
  // CstAp_PosMgt [SwC800] / ASIL B (최고 안전 중요도)
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_PosMgt', function_name:'CtAp_PositionSensorFltChk — 센서 범위 이상 감지 (PosSnrRngFltMax=900u)',
    failure_mode:'MORE', failure_detail:'PositionSensor ADC가 PosSnrRngFltMax(900u) 초과 지속됐으나 범위 이상 감지 미동작으로 유효값 처리',
    effect_local:'비정상 위치 값으로 기어 포지션 오산출', effect_system:'실제 레버 위치와 다른 포지션으로 잘못된 기어 변속 실행 (ASIL B 위반)',
    potential_cause:'위치 센서 기계적 손상 또는 ADC 기준 전압 변동', severity:9, occurrence:3, detection:3,
    preventive_action:'범위 이상 감지 즉시 폴백(이전 유효값 유지) 및 안전 상태 진입', detection_action:'위치 센서 범위 이상 DTC 즉시 설정 및 센서 A/B 교차 검증', confidence_score:0.93 },

  { sw_component:'CstAp_PosMgt', function_name:'CtAp_PositionSensorFltChk — 센서 Gap 이상 (PosSnrGapFltMin=950u~Max=1050u)',
    failure_mode:'CORRUPT', failure_detail:'이중화 센서 A/B 차이가 Gap 허용범위(950~1050u) 이탈했으나 감지 미동작으로 결함 센서 값 사용',
    effect_local:'한 센서 고장 상태에서 검증 없이 결함값으로 위치 계산', effect_system:'결함 위치 정보로 모터 제어 → 레버 목표 위치 미도달 또는 초과',
    potential_cause:'센서 커넥터 부분 접촉불량으로 센서 B 값 드리프트', severity:10, occurrence:3, detection:3,
    preventive_action:'센서 Gap 감지 즉시 양 센서 무효화 및 기어 잠금 안전 상태 진입', detection_action:'센서 이중화 불일치 DTC(고우선순위) 및 연속 Gap 모니터링', confidence_score:0.94 },

  { sw_component:'CstAp_PosMgt', function_name:'CtAp_PositionSensorInfo — ADC 평균 필터링',
    failure_mode:'LESS', failure_detail:'고속 레버 이동 중 일부 샘플 제외로 필터 평균값이 실제 위치보다 낮게 산출',
    effect_local:'D 위치 레버가 N 또는 R로 계산 출력', effect_system:'운전자 의도와 반대 기어 선택 또는 N 유지로 차량 미동',
    potential_cause:'ADC 샘플 유효성 검사에서 고속 이동 중 샘플 다수 제외', severity:9, occurrence:3, detection:4,
    preventive_action:'유효 샘플 최소 수량 미달 시 포지션 업데이트 중단 및 이전값 유지', detection_action:'유효 샘플 부족 DTC 및 레버 이동 속도 연동 필터 파라미터 조정', confidence_score:0.90 },

  { sw_component:'CstAp_PosMgt', function_name:'CtAp_PositionSensorPosSet — 기어 위치 판정 조기 완료',
    failure_mode:'EARLY', failure_detail:'레버가 목표 D 포지션 완전 도달 전 변속 완료 신호 조기 출력',
    effect_local:'모터 제어가 변속 완료로 판단하고 구동 조기 정지', effect_system:'레버가 N/D 경계에 위치한 상태로 D 기어 적용됨',
    potential_cause:'포지션 판정 임계값이 기계적 공차 미포함으로 조기 판정', severity:9, occurrence:3, detection:4,
    preventive_action:'P/R/N/D 판정 구간을 기계적 공차 포함 충분한 마진으로 설정', detection_action:'변속 완료 후 위치 재확인 로직 및 모터 전류로 실제 고정 확인', confidence_score:0.89 },

  { sw_component:'CstAp_PosMgt', function_name:'CtAp_PositionSensorFltChk — 범위 최솟값 이상 (PosSnrRngFltMin=100u)',
    failure_mode:'LESS', failure_detail:'PositionSensor ADC가 PosSnrRngFltMin(100u) 미만으로 측정되나 하한 이상 감지 로직 미동작',
    effect_local:'비정상 낮은 센서 값으로 기어 포지션 최솟값으로 오산출', effect_system:'레버가 P 위치에 있으나 R 또는 최하단 위치로 오인식되어 오동작',
    potential_cause:'센서 전원 단락 또는 ADC 채널 GND 이상으로 최솟값 이탈', severity:9, occurrence:2, detection:3,
    preventive_action:'센서 하한 이탈 즉시 안전 상태 진입 및 센서 전원 상태 병렬 확인', detection_action:'하한 이탈 DTC 즉시 설정 및 HW 센서 진단', confidence_score:0.90 },

  // ══════════════════════════════════════════════════════
  // CstAp_MovingMgt [SwC900] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_MovingMgt', function_name:'CtAp_MovingSensorIn — 이동 완료 오판단',
    failure_mode:'CORRUPT', failure_detail:'MovingSnr 값이 정상 범위이나 레버 미도달 상태에서 이동 완료로 오판',
    effect_local:'이동 완료 신호 조기 전달로 모터 구동 조기 정지', effect_system:'레버가 정확한 P/R/N/D 위치에 미고착 상태로 기어 확정',
    potential_cause:'이동 완료 판정 히스테리시스 부족 또는 기계적 진동', severity:9, occurrence:3, detection:4,
    preventive_action:'PosMgt와 MovingMgt 양쪽 모두 완료 조건 충족 시에만 완료 판정', detection_action:'이동 완료 후 위치 유지 시간 검증 DTC', confidence_score:0.88 },

  { sw_component:'CstAp_MovingMgt', function_name:'MovingSnr Gap 이상 감지 (MovingSnrSnrGapFltMin=950u)',
    failure_mode:'LESS', failure_detail:'두 이동 센서 간 차이가 950u 미만(쇼트 상태)이나 정상으로 오판',
    effect_local:'공통 원인 고장(CCF) 감지 불가로 이중화 기능 무력화', effect_system:'ASIL B 이중화 요구사항 미충족 상태 동작으로 안전 기능 무결성 위험',
    potential_cause:'두 센서 공통 배선 GND 쇼트로 동일 낮은 값 출력', severity:9, occurrence:2, detection:5,
    preventive_action:'센서 전원/GND 물리적 분리 및 최소 Gap 하한 0 케이스 별도 처리', detection_action:'센서 Gap 하한 DTC 및 센서 전원 라인 독립 모니터링', confidence_score:0.86 },

  { sw_component:'CstAp_MovingMgt', function_name:'MovingFltTime 타이머 — 이동 이상 감지 (MovingFltTime=200u)',
    failure_mode:'LATE', failure_detail:'레버 이동 이상 상태가 MovingFltTime(200u=2s) 이내 해소되었다가 반복되어 이상 감지가 지속 지연됨',
    effect_local:'간헐적 이동 이상이 누적되어 기계적 손상 진행 중에도 DTC 미설정', effect_system:'기계적 손상 누적으로 SBW 기어 변속 기능 점진적 저하',
    potential_cause:'MovingFltTime 타이머 리셋 조건이 이상 해소 즉시 리셋으로 간헐적 이상 누적 미감지', severity:7, occurrence:4, detection:5,
    preventive_action:'이상 발생 횟수 카운터 추가하여 반복 이상 누적 감지 로직 구현', detection_action:'이상 발생 카운터 기반 DTC 및 이상 이력 NvM 기록', confidence_score:0.83 },

  // ══════════════════════════════════════════════════════
  // CstAp_MoodControlMgt [SwC1000] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_MoodControlMgt', function_name:'CtAp_ColorSet — SlvXVal/SlvYVal 색상 테이블 변환',
    failure_mode:'CORRUPT', failure_detail:'입력된 SlvXVal/SlvYVal이 색상 테이블 범위를 벗어난 인덱스로 MoodRed/Green/Blue 오산출',
    effect_local:'조명 색상이 정의되지 않은 색상으로 출력', effect_system:'운전자 조명 혼란 유발 (안전 직접 영향 낮음)',
    potential_cause:'CGW에서 수신된 SlvXVal/SlvYVal CAN 값이 테이블 인덱스 범위 초과', severity:3, occurrence:3, detection:5,
    preventive_action:'색상 테이블 접근 전 인덱스 범위 클램핑 및 기본 색상값 설정', detection_action:'범위 초과 인덱스 감지 DTC 및 기본값 출력', confidence_score:0.80 },

  { sw_component:'CstAp_MoodControlMgt', function_name:'SlvFadeInOut — Fade In/Out 제어 (SlvFadeInOutOn=2)',
    failure_mode:'LESS', failure_detail:'SlvFadeInOutOn(2) 명령에도 불구하고 Fade In 효과 미동작으로 조명이 즉시 점등',
    effect_local:'조명 점등 시 Fade 효과 없이 급격한 밝기 변화', effect_system:'사용자 경험 저하, 안전 직접 영향 없음',
    potential_cause:'SPI 통신으로 SlvFadeInOut 명령 전달 실패 또는 슬레이브 모듈 응답 오류', severity:2, occurrence:3, detection:6,
    preventive_action:'SPI 명령 전송 후 슬레이브 ACK 확인 및 재전송 로직 구현', detection_action:'SPI 응답 타임아웃 감지 및 로컬 오류 로그 기록', confidence_score:0.77 },

  { sw_component:'CstAp_MoodControlMgt', function_name:'MoodTargetBd=10u 밝기 목표 달성',
    failure_mode:'MORE', failure_detail:'MoodTargetBd(10u) 목표 밝기보다 높은 PWM 출력으로 과도 밝기 지속',
    effect_local:'조명 과도 밝기로 LED 수명 단축', effect_system:'야간 운전 시 운전자 시야 방해 가능성',
    potential_cause:'PWM 듀티 계산 오류 또는 MoodTargetBd 파라미터 변조', severity:3, occurrence:2, detection:5,
    preventive_action:'PWM 출력 상한 클램핑 및 MoodTargetBd 파라미터 유효성 검증', detection_action:'PWM 상한 초과 감지 DTC', confidence_score:0.78 },

  // ══════════════════════════════════════════════════════
  // CstAp_DtcMgt [SwC1200] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_DtcMgt', function_name:'CtAp_DtcEnCndChk — DTC 활성화 조건 판단',
    failure_mode:'CORRUPT', failure_detail:'DTC Enable Condition 논리 오류로 실제 고장 시 DTC 미저장 또는 정상 시 과다 설정',
    effect_local:'고장 이력 미기록 또는 False DTC로 불필요한 정비 유발', effect_system:'안전 관련 고장 DTC 미기록으로 ASIL B 안전 추적성 손실',
    potential_cause:'Enable Condition AND/OR 조건 반전 또는 타이밍 경쟁 조건', severity:7, occurrence:3, detection:4,
    preventive_action:'Enable Condition 로직 형식 검증 및 독립 리뷰 수행', detection_action:'DTC 설정/미설정 조건 Unit Test 100% 커버리지', confidence_score:0.85 },

  { sw_component:'CstAp_DtcMgt', function_name:'DTC NvM 저장 — 전원 차단 시 긴급 저장',
    failure_mode:'LATE', failure_detail:'DTC 발생 후 ECU 전원 차단 전 NvM 저장 미완료로 DTC 이력 소실',
    effect_local:'전원 차단 후 DTC 데이터 손실로 고장 이력 추적 불가', effect_system:'안전 관련 고장 이력 소실로 재발 방지 조치 불가',
    potential_cause:'NvM 쓰기 큐 지연 또는 전원 차단 시 쓰기 완료 대기 로직 미구현', severity:6, occurrence:3, detection:5,
    preventive_action:'전원 차단 감지 시 즉시 NvM 긴급 저장 및 쓰기 완료 후 전원 차단 허용', detection_action:'NvM 쓰기 실패 카운터 및 저장 완료 플래그 검증', confidence_score:0.84 },

  { sw_component:'CstAp_DtcMgt', function_name:'DTC Snapshot 데이터 (SNAPSHOT_0xFD50_SIZE=18u) 수집',
    failure_mode:'CORRUPT', failure_detail:'DTC 발생 시점 Snapshot 데이터(18바이트) 수집 중 다른 인터럽트로 일부 바이트가 다른 시점 값으로 혼재',
    effect_local:'Snapshot 데이터 불일치로 고장 분석 시 오해석', effect_system:'잘못된 Snapshot으로 고장 원인 오진단 → 잘못된 수정 조치',
    potential_cause:'Snapshot 수집 중 인터럽트 허용으로 데이터 일관성 깨짐', severity:5, occurrence:3, detection:5,
    preventive_action:'Snapshot 수집 시 임계 구역(Critical Section) 보호하여 원자적 수집', detection_action:'Snapshot 데이터 CRC 검증 추가', confidence_score:0.82 },

  // ══════════════════════════════════════════════════════
  // BswIF_CAN [SwC1300] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_CAN', function_name:'E2E CRC 검증 — HTCU_Crc4Val/AlvCnt4Val',
    failure_mode:'CORRUPT', failure_detail:'E2E 라이브러리 초기화 버그로 CRC 오류 메시지를 유효로 처리',
    effect_local:'오염된 기어 명령이 CstAp_CANMGT에 전달', effect_system:'손상된 기어 위치 명령으로 의도치 않은 기어 변속',
    potential_cause:'E2E Profile 구현 오류 또는 CRC 계산 모듈 초기화 버그', severity:10, occurrence:2, detection:3,
    preventive_action:'E2E Profile 2 표준 구현 검증 및 독립 CRC 라이브러리 사용', detection_action:'E2E 오류 카운터 즉시 DTC 및 오류 메시지 ID/타임스탬프 기록', confidence_score:0.93 },

  { sw_component:'BswIF_CAN', function_name:'AlvCnt 롤링 카운터 순서 검증',
    failure_mode:'LATE', failure_detail:'AlvCnt 불연속(지연/역전) 시 타임아웃 감지 지연으로 오래된 메시지 유효 처리',
    effect_local:'타임아웃된 기어 명령이 최신으로 처리되어 이전 상태 복귀', effect_system:'완료된 변속이 취소되거나 이전 명령 재실행',
    potential_cause:'CAN 버스 지연 급증 시 AlvCnt 불연속 및 타임아웃 윈도우 미조정', severity:8, occurrence:3, detection:4,
    preventive_action:'AlvCnt 불연속 즉시 메시지 무효화 및 타임아웃 윈도우를 주기 3배로 설정', detection_action:'AlvCnt 시퀀스 오류 DTC 및 수신 주기 이탈 감지', confidence_score:0.88 },

  { sw_component:'BswIF_CAN', function_name:'INIT_VALUE 초기값 처리 — VCU_GEAR_POS_STA 초기값(9u)',
    failure_mode:'CORRUPT', failure_detail:'ECU 초기화 시 VCU 기어 포지션 초기값(9u=미정의)이 실제 유효값으로 오처리되어 초기 기어 상태 오판단',
    effect_local:'CAN 메시지 미수신 상태에서 미정의 기어 포지션(9u)으로 동작 시작', effect_system:'초기 기어 상태 불일치로 부팅 직후 잘못된 기어 변속 명령 실행',
    potential_cause:'초기값과 유효 기어값 구분 로직 미구현으로 초기값 9u를 유효값으로 처리', severity:7, occurrence:3, detection:4,
    preventive_action:'CAN 첫 수신 완료 플래그 구현 및 미수신 상태에서 기어 명령 보류 처리', detection_action:'초기화 중 기어 명령 수신 DTC 및 부팅 시퀀스 Unit Test', confidence_score:0.86 },

  // ══════════════════════════════════════════════════════
  // BswIF_ECUModeCntl [SwC1400] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_ECUModeCntl', function_name:'ComM 모드 전환 — COMM_MODE_NO_COM→FULL_COM',
    failure_mode:'LATE', failure_detail:'IGN ON 후 COMM_MODE_NO_COM(0)→COMM_MODE_FULL_COM(2) 전환이 지연되어 CAN 통신 활성화 늦음',
    effect_local:'CAN 활성화 지연으로 초기 TCU 기어 명령 수신 불가', effect_system:'부팅 직후 기어 명령 손실로 SBW 초기 포지션 불일치',
    potential_cause:'ComM 모드 전환 조건(RTE 초기화 완료=1) 대기 지연 또는 DEM 주기 미시작', severity:6, occurrence:3, detection:4,
    preventive_action:'ComM 전환 타임아웃 정의 및 전환 지연 시 강제 전환 로직 구현', detection_action:'ComM 전환 지연 DTC 및 CAN 활성화 시간 모니터링', confidence_score:0.84 },

  { sw_component:'BswIF_ECUModeCntl', function_name:'진단 세션 관리 — DIAG_SESSION_DEFAULT(1) 전환',
    failure_mode:'CORRUPT', failure_detail:'진단 세션이 DIAG_SESSION_QUIESCENT(4) 또는 DIAG_SESSION_SLEEP(5) 상태에서 정상 복귀 없이 Default Session 미전환',
    effect_local:'진단 세션 고착으로 일반 ECU 기능 제한 지속', effect_system:'진단 세션 중 일반 기어 변속 명령 처리 불가',
    potential_cause:'세션 전환 타이머 만료 누락 또는 세션 종료 명령 미수신', severity:6, occurrence:2, detection:4,
    preventive_action:'진단 세션 최대 유지 시간 설정 및 타임아웃 시 자동 Default 전환', detection_action:'세션 상태 타임아웃 DTC 및 세션 이력 기록', confidence_score:0.82 },

  { sw_component:'BswIF_ECUModeCntl', function_name:'DEM 진단 주기 관리 — DEM_CYCLE_STATE',
    failure_mode:'CORRUPT', failure_detail:'DEM_CYCLE_STATE_START(0)→END(1) 전환 오류로 DTC 진단 주기가 비정상 종료되어 DTC 카운터 오산출',
    effect_local:'DTC 발생 횟수 카운터 오류로 잘못된 DTC 상태 기록', effect_system:'안전 관련 DTC 미설정 또는 오설정으로 고장 추적 오류',
    potential_cause:'DEM 주기 시작/종료 호출 순서 오류 또는 태스크 스케줄링 이상', severity:6, occurrence:3, detection:4,
    preventive_action:'DEM 주기 시작/종료 호출 원자적 처리 및 순서 검증', detection_action:'DEM 주기 오류 DTC 및 Unit Test 검증', confidence_score:0.82 },

  // ══════════════════════════════════════════════════════
  // BswIF_IoHwAb [SwC2300] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_IoHwAb', function_name:'CtIoHwAb_IntfIn — SBC_FLT/SBC_INT 디지털 입력 읽기',
    failure_mode:'CORRUPT', failure_detail:'SBC_FLT(System Basis Chip Fault) 디지털 입력값이 반전되어 SBC 정상 상태를 고장으로 오판단',
    effect_local:'SBC 고장 오감지로 SBC Watchdog 모드 변경 또는 ECU 리셋 트리거', effect_system:'불필요한 ECU 리셋으로 SBW 기능 중단 및 레버 중간 위치 고착 가능',
    potential_cause:'SBC_FLT 핀 Active Low/High 논리 설정 오류 또는 풀업 저항 미설정으로 신호 반전', severity:7, occurrence:3, detection:4,
    preventive_action:'SBC_FLT Active Low/High 논리 HW 설계와 SW 설정 일치 검증', detection_action:'SBC_FLT 상태 실제 SBC 상태와 교차 검증 Unit Test', confidence_score:0.85 },

  { sw_component:'BswIF_IoHwAb', function_name:'ICU 측정 — 위치 센서 PWM 듀티 사이클 취득',
    failure_mode:'LESS', failure_detail:'ICU_MEASURE_STATE가 START→RUNNING 전환 후 GetAllDutyCycles() 결과가 0으로 리턴되어 PWM 기반 위치 측정값 소실',
    effect_local:'위치 센서 PWM 듀티 미취득으로 CstAp_PosMgt에 0값 전달', effect_system:'위치 센서 0값으로 기어 포지션이 최소값(P 또는 오류 상태)으로 판정',
    potential_cause:'ICU 모듈 클럭 미활성화 또는 PWM 신호 첫 주기 측정 중 측정 시작 타이밍 오류', severity:9, occurrence:3, detection:3,
    preventive_action:'ICU 모듈 초기화 완료 확인 후 측정 시작 및 첫 주기 결과 유효성 검증', detection_action:'ICU 결과 0값 감지 DTC 즉시 설정 및 ADC 백업 경로 확인', confidence_score:0.87 },

  { sw_component:'BswIF_IoHwAb', function_name:'HwAbIntfInValidChk — ADC 입력 유효성 검사',
    failure_mode:'CORRUPT', failure_detail:'ReadAllADCInputs() 후 HwAbIntfInValidChk()에서 유효성 검사 실패 시 이전 주기 값 대신 0으로 초기화하여 전달',
    effect_local:'ADC 유효성 실패 시 0값 전파로 하위 컴포넌트 오동작', effect_system:'위치 센서/버튼 입력 0값으로 SBW 기어 포지션 및 버튼 상태 오판단',
    potential_cause:'ADC 유효성 실패 처리 로직에서 이전값 유지 대신 0 초기화 적용', severity:8, occurrence:3, detection:4,
    preventive_action:'ADC 유효성 실패 시 이전 유효값 유지(Hold Last Valid) 로직 구현', detection_action:'ADC 유효성 실패 DTC 및 실패 지속 시간 모니터링', confidence_score:0.87 },

  // ══════════════════════════════════════════════════════
  // BswIF_NvM [SwC2400] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_NvM', function_name:'CtNvM — SPEC_OPTION_ReadBlock() 초기 읽기',
    failure_mode:'LATE', failure_detail:'ECU 부팅 시 SPEC_OPTION_ReadBlock() 읽기가 l_EepReadSpecOp=OFF 조건 미충족으로 지연되어 SpecOptinState 초기값 미설정',
    effect_local:'SpecOptinState 초기값 미설정으로 특수 기능 옵션 적용 전 기본값으로 동작', effect_system:'차종 옵션에 따른 SBW 특수 기능(모드 제한 등) 미적용으로 불완전한 기능 제공',
    potential_cause:'l_EepReadSpecOp 플래그 초기화 오류 또는 NvM 읽기 우선순위 낮아 첫 주기 내 미완료', severity:5, occurrence:3, detection:5,
    preventive_action:'부팅 시 SPEC_OPTION 읽기 완료를 ECU 초기화 완료 조건에 포함', detection_action:'NvM 읽기 완료 플래그 검증 DTC 및 초기화 시간 모니터링', confidence_score:0.81 },

  { sw_component:'BswIF_NvM', function_name:'CtNvM — NVM_RotateModeSig 쓰기 (ChangeEventFlag)',
    failure_mode:'CORRUPT', failure_detail:'CtApNVM_ChangeEventFlag 변경 감지 시 SPEC_PimWriteBuf 값이 이전 주기 값으로 덮어써져 잘못된 값이 EEP에 저장됨',
    effect_local:'잘못된 RotateMode 설정값 비휘발성 저장', effect_system:'ECU 재부팅 후 잘못된 회전 모드로 SBW 동작하여 운전자 설정 손실',
    potential_cause:'100ms 주기 쓰기 처리 중 태스크 선점으로 WriteBuffer가 변경되기 전 이전값 사용', severity:4, occurrence:3, detection:5,
    preventive_action:'NvM 쓰기 버퍼 임계 구역 보호 및 쓰기 완료 확인 후 ChangeEventFlag 해제', detection_action:'NvM 쓰기 데이터 검증(Read-after-Write) 및 불일치 DTC', confidence_score:0.80 },

  // ══════════════════════════════════════════════════════
  // BswIF_Sbc [SwC2600] / ASIL B — System Basis Chip
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_Sbc', function_name:'CtSbc — SBC WDG 모드 설정 (SLOW/FAST/OFF)',
    failure_mode:'CORRUPT', failure_detail:'WdgMode 파라미터가 SBC_WDG_MODE_SLOW(1)/FAST(2)/OFF(0) 외의 값으로 전달되어 SBC WDG 모드가 의도와 다르게 설정됨',
    effect_local:'SBC WDG 모드 오설정으로 WDG 트리거 주기 불일치', effect_system:'WDG 트리거 주기 오설정으로 불필요한 ECU 리셋 또는 WDG 감시 기능 무력화',
    potential_cause:'WdgMode 파라미터 전달 과정에서 변수 타입 캐스팅 오류 또는 기본값 초기화 오류', severity:7, occurrence:2, detection:4,
    preventive_action:'WdgMode 파라미터 입력 검증(0/1/2만 허용) 및 기본값 SLOW 적용', detection_action:'SBC 통신 후 설정값 읽기 확인(Read-back) 및 불일치 DTC', confidence_score:0.85 },

  { sw_component:'BswIF_Sbc', function_name:'RCtSbc_Tle9263_Wdg_Trigger — SPI WDG 트리거',
    failure_mode:'LATE', failure_detail:'SPI 전송 지연으로 WDG 트리거 데이터(0x83u/0x84u 또는 0x83u/0x06u)가 SBC WDG 만료 시간 이후 도달',
    effect_local:'WDG 트리거 지연으로 SBC가 ECU 리셋 실행', effect_system:'기어 변속 동작 중 ECU 리셋으로 레버 중간 위치 고착 가능',
    potential_cause:'고우선순위 인터럽트 과다 발생으로 SPI 전송 태스크 지연', severity:8, occurrence:3, detection:3,
    preventive_action:'WDG 트리거 SPI 전송 최고 우선순위 보장 및 트리거 주기를 WDG 만료 시간의 70% 이내로 설정', detection_action:'SPI 전송 지연 감지 DTC 및 WDG 트리거 성공/실패 카운터', confidence_score:0.88 },

  // ══════════════════════════════════════════════════════
  // BswIF_WdgM [SwC2700] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_WdgM', function_name:'CtWdgM — 소프트웨어 워치독 체크포인트 트리거',
    failure_mode:'LATE', failure_detail:'태스크 우선순위 역전 또는 무한 루프로 워치독 서비싱 주기 만료 → ECU 강제 리셋',
    effect_local:'ECU 리셋으로 모든 SW 컴포넌트 재초기화 필요', effect_system:'기어 변속 중 리셋 시 레버 중간 위치 고착 가능',
    potential_cause:'CstAp_MotorControlMgt 또는 BswIF_CAN 블로킹 연산으로 WdgM 태스크 지연', severity:8, occurrence:3, detection:3,
    preventive_action:'WdgM 태스크 최고 우선순위 보장 및 모든 태스크 실행 시간 상한 정의', detection_action:'WDG 리셋 이벤트 DTC 기록 및 재부팅 원인 NvM 저장', confidence_score:0.87 },

  { sw_component:'BswIF_WdgM', function_name:'LOGICAL_SUPERVISION_35 — 체크포인트 논리 감시',
    failure_mode:'CORRUPT', failure_detail:'체크포인트 35의 논리 감시 조건이 정상 실행 경로에서 미충족되어 WdgM이 SW 실행 흐름 오류로 오판단',
    effect_local:'정상 동작 중 SW 실행 흐름 오류 감지로 안전 조치 실행(ECU 리셋 또는 제한 모드 진입)', effect_system:'정상 변속 중 불필요한 안전 조치로 SBW 기능 중단',
    potential_cause:'체크포인트 조건 정의 오류 또는 최적화 컴파일러에 의한 실행 경로 변경', severity:7, occurrence:2, detection:4,
    preventive_action:'체크포인트 조건 컴파일러 최적화 영향 검토 및 volatile 선언으로 보호', detection_action:'논리 감시 실패 DTC 및 실행 경로 Trace 분석', confidence_score:0.83 },

  // ══════════════════════════════════════════════════════
  // BswIF_SafetyLib [SwC2500] / ASIL B
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_SafetyLib', function_name:'메모리 무결성 검증 — 스택 오버플로우',
    failure_mode:'CORRUPT', failure_detail:'스택 오버플로우 또는 배열 인덱스 범위 초과로 CstAp_PosMgt의 위치 임계값 변수 변조',
    effect_local:'위치 임계값 변조로 잘못된 기어 포지션 판정 기준 적용', effect_system:'변조된 임계값으로 잘못된 위치 계산 → ASIL B 안전 기능 무결성 상실',
    potential_cause:'재귀 함수 스택 깊이 초과 또는 배열 범위 초과로 인접 메모리 변조', severity:10, occurrence:2, detection:4,
    preventive_action:'MISRA-C 준수로 동적 메모리 금지, 스택 크기 정적 분석, 스택 카나리 패턴 적용', detection_action:'MPU 활성화 및 핵심 변수 CRC 주기적 검증', confidence_score:0.90 },

  { sw_component:'BswIF_SafetyLib', function_name:'DetErrorHook — CANNM/FEE ECC 오류 처리',
    failure_mode:'CORRUPT', failure_detail:'FEE ECC 오류 감지 시 DetErrorHook에서 오류 유형 분류 로직 오류로 ECC Double-Bit 오류를 Single-Bit로 오분류',
    effect_local:'Double-Bit ECC 오류(데이터 오염)를 수정 가능한 Single-Bit로 오분류하여 오염 데이터 사용 지속', effect_system:'EEPROM 데이터 오염으로 NvM 저장 데이터(DTC, 캘리브레이션) 오독으로 SW 오동작',
    potential_cause:'ECC 오류 상태 레지스터 비트 파싱 오류 또는 오류 유형 매핑 테이블 오류', severity:8, occurrence:2, detection:4,
    preventive_action:'ECC 오류 유형 파싱 로직 독립 리뷰 및 ECC 오류 주입 테스트 수행', detection_action:'Double-Bit ECC 감지 즉시 고우선순위 DTC 설정 및 안전 상태 진입', confidence_score:0.86 },

  // ══════════════════════════════════════════════════════
  // BswIF_Dcm_19_RDTCI [SwC1600] / ASIL B — DTC 읽기
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_Dcm_19_RDTCI', function_name:'DTC BatteryVoltageHigh 상태 설정 (U3003_A3)',
    failure_mode:'CORRUPT', failure_detail:'SetEventStatus(FAILED) 호출 조건이 Argument 값이 아닌 다른 변수와의 경쟁 조건으로 PASSED/FAILED 상태가 반전 설정됨',
    effect_local:'배터리 과전압 DTC가 실제 고장 시 PASSED로, 정상 시 FAILED로 설정됨', effect_system:'진단 툴에서 배터리 과전압 DTC 오진단으로 잘못된 수리 조치',
    potential_cause:'인터럽트 비보호 구간에서 Argument 변수 값 변경으로 DTC 상태 반전', severity:6, occurrence:3, detection:4,
    preventive_action:'SetEventStatus 호출 시 Argument 값 임계 구역 보호', detection_action:'DTC 상태 Unit Test 및 배터리 전압과 DTC 상태 상관 검증', confidence_score:0.83 },

  { sw_component:'BswIF_Dcm_19_RDTCI', function_name:'DTC 0x200 Snapshot 데이터 출력',
    failure_mode:'LESS', failure_detail:'PrimaryEventMemory에서 TargetDTC 검색 실패로 Snapshot 데이터 미반환 (빈 데이터 반환)',
    effect_local:'진단 툴의 Snapshot 읽기 응답이 빈 데이터로 반환됨', effect_system:'고장 발생 시점 환경 데이터 미확보로 재발 원인 분석 불가',
    potential_cause:'DTC ID 비교 로직 오류 또는 EventMemory 인덱스 범위 초과', severity:4, occurrence:3, detection:5,
    preventive_action:'DTC 검색 로직 및 EventMemory 인덱스 경계값 Unit Test', detection_action:'Snapshot 빈 데이터 반환 감지 로그 기록', confidence_score:0.79 },

  // ══════════════════════════════════════════════════════
  // BswIF_Dcm_27_SA [SwC1800] / ASIL B — 보안 접근
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_Dcm_27_SA', function_name:'GetSeed_L9 — 시드 생성 (CsmRandomGenerate)',
    failure_mode:'CORRUPT', failure_detail:'CsmRandomGenerate 오류로 seed_value_L9[0~7]이 이전 요청의 시드값 재사용 또는 고정값 출력',
    effect_local:'시드 재사용으로 예측 가능한 시드 노출', effect_system:'공격자가 시드를 예측하여 보안 접근 무력화 → 무단 ECU 접근 가능',
    potential_cause:'CsmRandomGenerate 내부 난수 생성기 시드 미초기화 또는 엔트로피 부족', severity:8, occurrence:2, detection:5,
    preventive_action:'난수 생성기 하드웨어 엔트로피 소스 사용 및 시드 생성 후 이전 시드와 동일값 재사용 방지', detection_action:'시드 반복 감지 DTC 및 보안 감사 로그 기록', confidence_score:0.85 },

  { sw_component:'BswIF_Dcm_27_SA', function_name:'전자 서명 검증 (SIGNATURE_VERIFY_FINISH=0x02)',
    failure_mode:'CORRUPT', failure_detail:'CRYPTO_E_VER_OK(0x00) 반환 조건 오류로 서명 검증 실패 시에도 보안 접근 허용',
    effect_local:'서명 검증 실패 시 보안 접근 허용으로 무단 진단 접근 가능', effect_system:'무단 ECU 칼리브레이션 또는 기능 활성화로 SBW 안전 설정 변경 위험',
    potential_cause:'CRYPTO_E_VER_OK(0x00) 비교 로직 반전(!=로 작성해야 할 것을 ==로 작성)', severity:9, occurrence:1, detection:4,
    preventive_action:'서명 검증 결과 비교 로직 독립 코드 리뷰 및 침투 테스트 수행', detection_action:'보안 접근 시도 DTC 기록 및 실패 횟수 제한(Lockout) 구현', confidence_score:0.88 },

  // ══════════════════════════════════════════════════════
  // BswIF_Dcm_28_CC [SwC1900] / ASIL B — 통신 제어
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_Dcm_28_CC', function_name:'통신 제어 — DCM_DISABLE_RX_TX_NORMAL(0x03) 적용',
    failure_mode:'CORRUPT', failure_detail:'진단 세션 중 DCM_DISABLE_RX_TX_NORMAL(0x03) 명령 수신 시 CAN RX만 비활성화되고 TX가 계속 활성화되어 정보 노출',
    effect_local:'진단 중 예상치 않은 CAN TX 메시지 지속 송출', effect_system:'진단 중 SBW 기어 상태 메시지 외부 노출 및 다른 ECU의 불필요한 반응 유발',
    potential_cause:'CommunicationControl 처리 로직에서 RX/TX 비트 마스크 적용 오류', severity:5, occurrence:2, detection:5,
    preventive_action:'RX/TX 비활성화 마스크 적용 Unit Test로 모든 모드 조합 검증', detection_action:'진단 중 예상 외 TX 감지 DTC', confidence_score:0.81 },

  // ══════════════════════════════════════════════════════
  // BswIF_Dcm_31_RC [SwC2000] / ASIL B — 루틴 제어/Secure Boot
  // ══════════════════════════════════════════════════════
  { sw_component:'BswIF_Dcm_31_RC', function_name:'HSM Secure Boot 검증 (HSM_SECUREBOOT_ENABLE=2)',
    failure_mode:'CORRUPT', failure_detail:'HSM_SECUREBOOT_NOT_PERFORMED(12) 상태에서 Secure Boot 검증 미수행으로 변조된 SW가 부팅됨',
    effect_local:'변조된 SW가 Secure Boot 검증 없이 실행', effect_system:'악의적으로 변조된 SBW SW가 기어 포지션 조작 등 안전 기능 침해 가능',
    potential_cause:'HSM 초기화 실패 또는 Secure Boot 결과 확인 로직에서 미수행 상태 처리 누락', severity:9, occurrence:1, detection:4,
    preventive_action:'HSM_SECUREBOOT_NOT_PERFORMED 상태에서 ECU 동작 완전 차단 및 부팅 거부', detection_action:'Secure Boot 미수행 DTC 즉시 설정 및 HSM 상태 부팅 시 필수 확인', confidence_score:0.89 },

  { sw_component:'BswIF_Dcm_31_RC', function_name:'Boot Bank A/B 전환 (BOOT_START_ADDR_BANK_A=0x10028000)',
    failure_mode:'CORRUPT', failure_detail:'Bank A(0x10028000)에서 Bank B(0x12028000)로 부팅 전환 시 CMAC 키 검증(CMAC_KEY_NUM=101) 실패를 무시하고 전환 실행',
    effect_local:'미검증 Bank B SW가 실행되어 SW 무결성 보장 불가', effect_system:'검증되지 않은 SW로 SBW 안전 기능 오동작 가능',
    potential_cause:'CMAC 검증 결과 처리 로직에서 SEEDKEY_FAIL(1) 케이스 누락', severity:8, occurrence:1, detection:3,
    preventive_action:'CMAC 검증 실패 시 Bank 전환 거부 및 현재 Bank 유지 로직 필수 구현', detection_action:'CMAC 검증 실패 DTC 및 Boot Bank 전환 이력 기록', confidence_score:0.86 },

  // ══════════════════════════════════════════════════════
  // CstAp_IdtMgt [SwC400] / ASIL B — 조명 제어
  // ══════════════════════════════════════════════════════
  { sw_component:'CstAp_IdtMgt', function_name:'CtAp_IdtCntl — 조도 기반 PWM 밝기 제어',
    failure_mode:'MORE', failure_detail:'DIM_TIME_NIGHT(3) 상태에서 DIM_TIME_DAY(1) PWM 듀티(WELCOME_PWM_DUTY=33u)가 지속 출력',
    effect_local:'야간 환경에서 조명 과도 밝기로 운전자 눈부심', effect_system:'운전자 시야 방해로 안전성 저하',
    potential_cause:'DIM_TIME CAN 메시지(BCM) 수신 실패로 기본값(DAY) 유지', severity:3, occurrence:4, detection:5,
    preventive_action:'DIM_TIME 메시지 타임아웃 시 안전 기본값(EARLY_NIGHT) 적용', detection_action:'BCM 메시지 타임아웃 DTC 및 조도 센서 보조 활용', confidence_score:0.80 },

  { sw_component:'CstAp_IdtMgt', function_name:'CtAp_IdtCntlCdtChk — 조명 제어 조건 확인',
    failure_mode:'CORRUPT', failure_detail:'조명 제어 활성화 조건(PowerOn 상태) 확인 로직 오류로 PowerOff 상태에서도 조명 PWM 출력 지속',
    effect_local:'전원 Off 상태에서 조명 지속으로 배터리 방전 유발', effect_system:'주차 중 SBW 조명 지속으로 배터리 방전 및 재시동 불가 위험',
    potential_cause:'PowerOn 상태 플래그 확인 조건 반전(OFF를 ON으로 오해석)', severity:5, occurrence:3, detection:4,
    preventive_action:'PowerOn 조건 확인 Unit Test 및 Sleep 진입 시 조명 강제 OFF 로직 추가', detection_action:'PowerOff 상태 중 조명 출력 감지 DTC', confidence_score:0.82 },

  { sw_component:'CstAp_IdtMgt', function_name:'CtAp_IdtFltChk — 조명 하드웨어 고장 감지',
    failure_mode:'LESS', failure_detail:'LED 단선 또는 PWM 출력 핀 고장 시 CtAp_IdtFltChk에서 고장 미감지로 정상 동작으로 오판',
    effect_local:'조명 하드웨어 고장 미인지로 DTC 미설정', effect_system:'야간 운전 중 SBW 조명 소등으로 기어 상태 시각적 확인 불가',
    potential_cause:'조명 피드백 핀 연결 누락 또는 고장 감지 전류 임계값 오설정', severity:3, occurrence:3, detection:6,
    preventive_action:'조명 구동 후 피드백 전류 측정으로 정상 동작 확인 로직 구현', detection_action:'조명 고장 DTC 및 진단 툴 읽기 지원', confidence_score:0.78 },
]

async function main() {
  console.log(`\n▶ 설계사양서/아키텍처 기반 전체 컴포넌트 FMEA 생성`)
  console.log(`  세션: ${SESSION_ID}`)
  console.log(`  생성 항목: ${ITEMS.length}개`)

  const compSet = new Set(ITEMS.map(i => i.sw_component))
  console.log(`  커버 컴포넌트: ${compSet.size}개`)

  const client = await pool.connect()
  try {
    await client.query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [SESSION_ID])
    console.log(`  기존 AI 항목 삭제 완료`)

    await client.query('BEGIN')
    for (let i = 0; i < ITEMS.length; i++) {
      const row = ITEMS[i]
      const s = row.severity, o = row.occurrence, d = row.detection
      const ap = calcAP(s, o, d)
      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [SESSION_ID, String(i+1).padStart(4,'0'), row.sw_component, row.function_name,
         row.failure_mode, row.failure_detail, row.effect_local, row.effect_system,
         row.potential_cause, s, o, d, row.preventive_action, row.detection_action,
         row.confidence_score, ap],
      )
    }
    await client.query('COMMIT')

    await client.query(
      "UPDATE pre_fmea_sessions SET status='generated', updated_at=now() WHERE id=$1",
      [SESSION_ID],
    )

    const apDist: Record<string,number> = {}
    const compDist: Record<string,number> = {}
    for (const row of ITEMS) {
      const ap = calcAP(row.severity, row.occurrence, row.detection)
      apDist[ap] = (apDist[ap]??0)+1
      compDist[row.sw_component] = (compDist[row.sw_component]??0)+1
    }

    console.log(`\n✅ DB 삽입 완료: ${ITEMS.length}개\n`)
    console.log('[AP 분포]')
    for (const [ap, cnt] of Object.entries(apDist).sort()) console.log(`  ${ap}: ${cnt}개`)
    console.log('\n[SW 컴포넌트별 항목 수]')
    for (const [comp, cnt] of Object.entries(compDist).sort()) console.log(`  ${comp.padEnd(30)}: ${cnt}개`)
  } catch(e) {
    await client.query('ROLLBACK'); throw e
  } finally {
    client.release(); await pool.end()
  }
}
main().catch(e => { console.error('❌', e); process.exit(1) })
