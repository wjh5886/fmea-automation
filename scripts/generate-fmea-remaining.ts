/**
 * 나머지 컴포넌트 사양서 기반 FMEA 항목 추가 (기존 25개에 추가).
 *
 * 사양서 근거 (SWE3 파일 기준):
 *   SWE3_1: CstAp_ECUModeMgt(SwC300), CstAp_IdtMgt(SwC400), CstAp_ButtonMgt(SwC500),
 *            CstAp_MotorControlMgt(SwC700), CstAp_PosMgt(SwC800)
 *   SWE3_2: CstAp_DIDMgt(SwC1100), CstAp_DtcMgt(SwC1200)
 *   SWE3_3: BswIF_ECUModeCntl(SwC1400), BswIF_IoHwAb(SwC2300)
 *   SWE3_4: BswIF_NvM(SwC2400), BswIF_SafetyLib(SwC2500), BswIF_WdgM(SwC2700),
 *            CstAP_VehicleReset_Mgt(SwC13000)
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

const items: FmeaItem[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_ECUModeMgt [SwC300] / ASIL B
  // 사양서(SwU300.2): SysPwrSta·TrmnlCtrlGrpStaBDCEV·DiagSession·MotorActivation
  //   ·IntTailLmpOnReqFlag·DriveSta 6개 입력 → EcuStaFlag(WAKEUP/STANDBY/SLEEP) 출력
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk / EcuStaFlag 진리표',
    failure_mode: 'CORRUPT',
    failure_detail: 'SysPwrSta=OFF·TrmnlCtrlGrpStaBDCEV=OFF·SwkCndErrSta=OFF·DiagSession=DEFAULT·SleepIoSta=OFF인데 EcuStaFlag=EXTER_ECU_WAKEUP 출력 (조건 2열 오판정)',
    effect_local: 'IGN-OFF 후에도 ECU가 WAKEUP 상태 유지 → LdoStaChk, RxMainCAN 등 주기 태스크 계속 수행',
    effect_system: '정상 IGN-OFF 후 ECU 미슬립 → 암전류 증가로 배터리 방전; 변속기 제어 로직 비정상 활성',
    potential_cause: 'SysPwrSta 조건 체크 전 MotorActivation이 STD_ON인 경우 이전 조건 탈출 지연; 조건 우선순위 구현 오류',
    severity: 7, occurrence: 2, detection: 4,
    preventive_action: '사양서 진리표 조건 순서(SysPwrSta=ON 최우선) 구현 정확성 검토; 단위 테스트 전 케이스 추가',
    detection_action: 'IGN-OFF 후 EcuStaFlag=WAKEUP 지속 시 DTC(암전류 진단); ECU 슬립 전환 타임아웃 감시',
  },
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk / SleepIoSta 진단모드',
    failure_mode: 'MORE',
    failure_detail: 'DiagSession=EXTENDED(진단 암전류 모드)에서 SleepIoSta=ON 조건 없이도 EcuStaFlag=EXTER_ECU_STANDBY가 SLEEP으로 잘못 전이됨',
    effect_local: '진단 세션 중 ECU 슬립 전환 → 진단 통신 중단',
    effect_system: '진단 장비와 통신 단절 → OTA 업데이트·DTC 소거·파라미터 설정 실패',
    potential_cause: 'DiagSession=EXTENDED 조건 체크 로직이 SleepIoSta 판정보다 낮은 우선순위로 구현됨',
    severity: 5, occurrence: 2, detection: 5,
    preventive_action: 'DiagSession=EXTENDED 중 Sleep 전환 금지 조건을 EcuStaFlag 전이 로직 앞에 추가',
    detection_action: 'DiagSession=EXTENDED 중 EcuStaFlag=SLEEP 전이 발생 시 즉시 DTC 등록',
  },
  {
    sw_component: 'CstAp_ECUModeMgt',
    function_name: 'CtAp_ECUModeChk / MotorActivation 연계',
    failure_mode: 'LATE',
    failure_detail: 'MotorActivation=STD_OFF 조건 충족 후 EcuStaFlag=STANDBY 전환이 100ms 이상 지연',
    effect_local: 'WAKEUP 상태 지속으로 CAN 수신 태스크·조명 태스크 불필요 수행',
    effect_system: '모터 정지 후 불필요한 전류 소비; 슬립 전환 실패 시 WdgM 타임아웃 트리거',
    potential_cause: 'CtAp_ECUModeChk는 클라이언트 호출(Server 포트) 방식 → 호출 빈도 낮으면 판정 지연',
    severity: 5, occurrence: 3, detection: 5,
    preventive_action: 'MotorActivation=OFF 이벤트 발생 시 CtAp_ECUModeChk 즉시 호출 트리거 설계',
    detection_action: 'MotorActivation=OFF 후 EcuStaFlag 변화까지 시간 측정; 100ms 초과 시 DTC',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_IdtMgt [SwC400] / ASIL B
  // 사양서(SwU400.1 CtAp_DimLvlSet): HltDimLvl·BltDimLvl 결정
  //   입력: MainCANBusOffSta·AutoBrightSta·AutoLtSnrNightSta·AvTailLmpSta·CLU01MsgTo·EcuSta
  //   Timeout 시 → 기본 밝기(HIGHLIGHT_X_LED_ON_LOW) 출력
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_IdtMgt',
    function_name: 'CtAp_DimLvlSet / HltDimLvl',
    failure_mode: 'MORE',
    failure_detail: 'CAN Bus-OFF 또는 CLU01 Timeout 발생 시 HltDimLvl이 HIGHLIGHT_LED_ON_LOW로 낮아져야 하나 최대값으로 유지됨',
    effect_local: '변속기 기어 표시 LED가 밤에도 최대 밝기로 고착',
    effect_system: '야간 운전 중 과도한 인스트루먼트 클러스터 조명 → 운전자 시야 방해; 법규 위반 가능',
    potential_cause: 'timeoutCondition 플래그 평가 전 PreviousHltDimLvl 갱신 순서 오류 → Timeout 조건 미반영',
    severity: 4, occurrence: 2, detection: 5,
    preventive_action: 'CtAp_DimLvlSet Timeout 경로(timeoutCondition=ON) 단위 테스트; 최대값 클램핑 검증',
    detection_action: 'CAN Bus-OFF 후 HltDimLvl=최대값 지속 시 DID 진단 항목으로 기록',
  },
  {
    sw_component: 'CstAp_IdtMgt',
    function_name: 'CtAp_DimLvlSet / AutoBrightSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'AutoBrightSta=AUTO_BRIGHT_INITIAL인데 BltDimLvl이 0(최소)이 아닌 이전 값으로 유지됨',
    effect_local: '자동 밝기 초기화 조건에서 잘못된 백라이트 밝기 적용',
    effect_system: '시동 초기 기어 표시부 밝기 불일치 → 사용자 혼란; 야간/주간 전환 시 급격한 밝기 변화',
    potential_cause: '사양서 조건: AutoBrightSta==AUTO_BRIGHT_INITIAL || PreviousBltDimLvl==0 → 초기화 분기 미실행',
    severity: 3, occurrence: 3, detection: 6,
    preventive_action: 'AutoBrightSta 초기값 설정 시 BltDimLvl 동시 초기화 로직 검토; INITIAL 상태 진입 조건 명확화',
    detection_action: 'ECU 부팅 후 AutoBrightSta=INITIAL 상태에서 BltDimLvl 값 검증 DID 항목 추가',
  },
  {
    sw_component: 'CstAp_IdtMgt',
    function_name: 'CtAp_DimLvlSet / EcuSta 연계',
    failure_mode: 'LESS',
    failure_detail: 'EcuSta=WAKEUP이 아닌 상태(STANDBY/SLEEP)에서 DimLvlSet 태스크가 수행되어 최소 밝기 출력이 안 됨',
    effect_local: 'ECU STANDBY 중에도 LED 조명 출력 → 불필요한 전류 소비',
    effect_system: 'IGN-OFF 후 변속기 인디케이터 LED 점등 지속 → 배터리 방전',
    potential_cause: 'DimLvlSet runnable 비활성화 조건에 EcuSta 체크 미포함; 태스크 스케줄러 설정 오류',
    severity: 4, occurrence: 3, detection: 5,
    preventive_action: 'CtAp_DimLvlSet runnable 실행 조건에 EcuSta=WAKEUP 게이팅 추가',
    detection_action: 'EcuSta=STANDBY 중 DimLvl 출력 활성 상태 감지; 진단 DID(0xFD08) 모니터링',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_ButtonMgt [SwC500] / ASIL B
  // 사양서(SwU500.1 CtAp_ParkSWIn, SwU500.2 CtAp_PButtonSet):
  //   P_SW1_Raw·P_SW2_Raw → PButtonSta / PButtonStuck / PButtonFault 결정
  //   PButtonStuck: SW1>OnMin AND SW2>OnMin (두 스위치 동시 ON)
  //   PButtonFault: 두 스위치 모두 OFF 상태가 PSwFltTime 초과
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_ButtonMgt',
    function_name: 'CtAp_PButtonSet / PButtonStuck',
    failure_mode: 'CORRUPT',
    failure_detail: 'P_SW1_Raw 또는 P_SW2_Raw 중 하나만 OnMin 이상인데 PButtonStuck=STD_ON 오출력 (AND 조건 오구현)',
    effect_local: 'PButtonStuck=ON 오출력 → P 버튼 고착 DTC 오설정',
    effect_system: 'P 버튼 정상 작동 중 Stuck 고장 오판정 → 변속 레버 P 위치 이동 거부',
    potential_cause: '사양서: SW1>OnMin AND SW2>OnMin 조건을 OR로 오구현; 비트 연산 오류',
    severity: 7, occurrence: 2, detection: 5,
    preventive_action: 'CtAp_PButtonSet PButtonStuck 조건을 AND 게이트로 단위 테스트; 코드 리뷰',
    detection_action: 'PButtonStuck=ON 시 P_SW1_Raw·P_SW2_Raw 원시값 동시 로깅 및 단일 입력 여부 확인',
  },
  {
    sw_component: 'CstAp_ButtonMgt',
    function_name: 'CtAp_PButtonSet / PButtonFault 타이머',
    failure_mode: 'EARLY',
    failure_detail: 'SW1·SW2 모두 OFF인데 PSwFltTime 미도달 상태에서 PButtonFault=STD_ON 조기 출력',
    effect_local: 'P 버튼 미고장 상태에서 PButtonFault=ON 오출력 → 버튼 고장 DTC 오등록',
    effect_system: 'P 버튼 고장 오감지로 P 위치 변속 기능 비활성화 → 운전자 P 버튼 사용 불가',
    potential_cause: 'PSwFltrTime 카운터가 10ms 주기 기준 초기화 없이 이전 이벤트 값 누적; 타이머 파라미터 오설정',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'SW1·SW2 중 하나라도 ON 되면 PSwFltrTime 즉시 0으로 초기화하는 로직 검토',
    detection_action: 'PButtonFault=ON 시 P_SW1_Raw·P_SW2_Raw 값 확인; 두 값 모두 OFF 아니면 타이머 오류 DTC',
  },
  {
    sw_component: 'CstAp_ButtonMgt',
    function_name: 'CtAp_ParkSWIn / P_SW Raw',
    failure_mode: 'MORE',
    failure_detail: 'P_SW1_Raw ADC 값이 실제 버튼 미입력 상태인데 InterSwOnMin_1 이상으로 잘못 측정됨',
    effect_local: 'PButtonSta=BUTTON_ON 오출력 (SW1만 온으로 오판)',
    effect_system: '운전자 버튼 누름 없이 P 위치 변속 명령 발생 → 주행 중 P 위치 이동 시도',
    potential_cause: '버튼 스위치 접점 노이즈 또는 IoHwAb ADC 채널 그라운드 루프에 의한 전압 유입',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'P 버튼 ADC 입력에 HW 디바운스 회로(RC 필터) 및 SW 디바운싱 타이머 이중 적용',
    detection_action: 'PButtonSta=ON 시 차량 속도 신호 교차 검증; 고속 주행 중 P 명령 발생 시 즉시 무효화',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_MotorControlMgt [SwC700] / ASIL B
  // 사양서(SwU700.1 CtAp_MotorControl):
  //   Step_EN=1 → MotorActivation=OFF (역관계 주의!)
  //   Sphere_State: tmp_Position 100~210=DIAL_POSITION, 790~900=SPHERE_POSITION, 기타=MOVING
  //   오류 복구: TurnDialErrorDetection → FirstRetry → SecondRetry
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl / Step_EN vs MotorActivation',
    failure_mode: 'CORRUPT',
    failure_detail: 'Step_EN=1(모터 정지 명령)인데 MotorActivation=STD_ON으로 잘못 출력됨 (역논리 오구현)',
    effect_local: 'MotorActivation=ON 오출력 → CtAp_ECUModeChk가 WAKEUP 상태 불필요 유지',
    effect_system: '모터 정지 명령에도 ECU WAKEUP 유지 → 슬립 전환 불가; 암전류 증가',
    potential_cause: '사양서: Step_EN==1 → MotorActivation=OFF, Step_EN≠1 → MotorActivation=ON (역논리) 반대로 구현',
    severity: 6, occurrence: 2, detection: 4,
    preventive_action: 'CtAp_MotorControl Step_EN → MotorActivation 역논리 관계 단위 테스트 필수 작성',
    detection_action: 'Step_EN=1 상태에서 MotorActivation=ON 지속 시 DTC 등록; ECU 모드 전환 실패 감지',
  },
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl / Sphere_State 위치 판정',
    failure_mode: 'CORRUPT',
    failure_detail: 'tmp_Position=150(정상 DIAL_POSITION 범위 100~210)인데 Sphere_State=MOVING으로 잘못 판정됨',
    effect_local: 'Warning.RetryWarning_Dial·LeverWarning_Dial 초기화 미수행',
    effect_system: '레버가 DIAL 위치(변속 완료)에 있음에도 MOVING 판정 → 불필요한 재시도(Retry) 로직 실행 → 모터 진동',
    potential_cause: 'tmp_Position 경계값(100, 210) 비교 시 등호 포함 여부 오류 (< 대신 ≤ 사용 누락)',
    severity: 7, occurrence: 2, detection: 5,
    preventive_action: '위치 범위 경계값 포함(≤) 조건 코드 검토; 경계값(100, 210, 790, 900) 단위 테스트',
    detection_action: 'tmp_Position과 Sphere_State 값 불일치 감지; RetryWarning 카운터 비정상 증가 감시',
  },
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl / TurnDialErrorDetection',
    failure_mode: 'LATE',
    failure_detail: '모터 이동량 이상(DeltaRetry 조건) 감지 후 TurnDialErrorDetection 오류 플래그 설정이 지연됨',
    effect_local: '오류 감지 지연으로 FirstRetry 시작 타이밍 늦어짐',
    effect_system: '변속 실패 후 재시도(Retry) 지연 → 레버가 중간 위치에 대기 시간 증가 → 운전자 혼란',
    potential_cause: 'DeltaRetry 계산(DeltaRetrySphere→DeltaRetry 함수 순서)에서 이전 주기 값이 사용됨',
    severity: 6, occurrence: 3, detection: 5,
    preventive_action: 'RCtApMotorControl_10ms 내 함수 실행 순서(ChkMotorAction→DeltaRetry→ErrorDetection) 검토',
    detection_action: '변속 명령 후 완료까지 최대 허용 시간 타임아웃 DTC; RetryWarning 카운터 임계 초과 감시',
  },
  {
    sw_component: 'CstAp_MotorControlMgt',
    function_name: 'CtAp_MotorControl / SecondRetry',
    failure_mode: 'MORE',
    failure_detail: '2차 재시도(SecondRetry) 후에도 위치 미달성 시 Warning 카운터가 임계값 초과하여 모터 영구 정지 명령',
    effect_local: 'MotorActivation=OFF 강제 유지 → 모터 완전 정지',
    effect_system: '기어 레버가 목표 위치에 미달한 채 모터 잠금 → 변속 불가 상태 고착',
    potential_cause: '기계적 부하 증가(저온·오염) 시 두 번의 Retry 시도로도 목표 위치 미달성',
    severity: 8, occurrence: 3, detection: 4,
    preventive_action: '저온 환경 SecondRetry 토크 프로파일 설계; 재시도 횟수 파라미터 환경 조건별 튜닝',
    detection_action: 'SecondRetry 실패 시 DTC(기어 변속 불가) 등록; NvM에 위치 오류 이력 저장',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_PosMgt [SwC800] / ASIL B
  // 사양서(SwU800.1 CtAp_PositionSensorFltChk):
  //   PosSnrRngFlt: PosSnrRaw < 100u 또는 > 900u → 범위 이탈 고장
  //   PosSnrGapFlt: PosSnrRaw1+Raw2 < 950u 또는 > 1050u → 두 센서 합산 편차 고장
  //   AbnormalFlt: PositionSensorPosSet에서 전달된 비정상 위치 플래그
  //   위치 판정: P/R/Nr/N/Nd/D 각각 Sensor1·Sensor2 범위 조건으로 결정
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorFltChk / PosSnrRngFlt',
    failure_mode: 'MORE',
    failure_detail: 'PosSnrRaw1 = 950u (정상 범위 100~900 초과) → PosSnrRngFlt=ON 출력되어야 하나 OFF 유지',
    effect_local: '위치 센서 범위 이탈 고장 미감지 → 비정상 Raw 값으로 기어 위치 판정',
    effect_system: '잘못된 기어 위치(예: D 위치인데 R로 판정) → 인터락 오작동 → 주행 중 R 위치 허용',
    potential_cause: '사양서 범위 체크 조건 (PosSnrRaw < PosSnrRngFltMin 또는 > Max) 비교 연산자 오류',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: '경계값(100u, 900u) 포함 여부 단위 테스트; 정적 분석으로 비교 연산자 검증',
    detection_action: 'PosSnrRaw 값이 100u~900u 범위 이탈 시 즉시 DTC 등록; MotorControl에 안전값(정지) 전달',
  },
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorFltChk / PosSnrGapFlt',
    failure_mode: 'LESS',
    failure_detail: 'PosSnrRaw1+Raw2 합산이 950u 미만인데 PosSnrGapFlt=OFF 유지 (두 센서 합산 이상 미감지)',
    effect_local: '두 위치 센서 불일치(센서 1개 고장) 상태에서 위치 판정 계속 수행',
    effect_system: '단일 고장 센서 기반 기어 위치 판정 → 잘못된 D/R 위치 출력 → 차량 안전 기능 저하',
    potential_cause: 'PosSnrGapFlt 계산식에서 Raw2 입력이 항상 0으로 읽히는 채널 오배선으로 합산이 낮아짐',
    severity: 9, occurrence: 2, detection: 4,
    preventive_action: 'PosSnrRaw1·Raw2 각각 범위 정상 AND 합산 범위 정상 조건 독립 검사 설계',
    detection_action: 'PosSnrRaw1·Raw2 개별 및 합산 값 DID 진단 항목 노출; 합산 950u 미만 시 즉시 DTC',
  },
  {
    sw_component: 'CstAp_PosMgt',
    function_name: 'CtAp_PositionSensorPosSet / 기어 위치 판정',
    failure_mode: 'CORRUPT',
    failure_detail: 'PosSnrRaw1이 D 범위(Snr1: 760~840u)이지만 PosSnrRaw2가 Nd 범위에 있어 GearPosSta=PositionFault 출력',
    effect_local: 'Sensor1·Sensor2 범위 불일치로 PositionFault 판정 → AbnormalFlt=ON 전달',
    effect_system: 'Sensor2 노이즈로 인한 일시적 불일치 → D 위치 정상인데 PositionFault 출력 → 변속 금지',
    potential_cause: '위치 판정 시 센서 1·2 조건을 AND로 체크하여 일시적 노이즈도 Fault로 처리',
    severity: 7, occurrence: 3, detection: 5,
    preventive_action: 'PosDetectTime(70ms) 필터 시간 내 연속 불일치 조건에서만 Fault 판정; 단발 노이즈 무시',
    detection_action: 'GearPosSta=PositionFault 발생 시 Raw1·Raw2 값 스냅샷 저장; 70ms 내 복구 시 노이즈 DTC',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_DIDMgt [SwC1100] / ASIL B
  // 사양서(SwU1100.1 CtAp_DIDSet):
  //   DID 0xFD00~0xFD08 등 진단 데이터 NvM 읽기/쓰기 관리
  //   SleepModeSta 조건에서 DID 세트 수행
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_DIDMgt',
    function_name: 'CtAp_DIDSet / NvM Write',
    failure_mode: 'CORRUPT',
    failure_detail: 'DID 0xFD07(위치 센서 보정값) NvM 쓰기 중 전원 차단으로 데이터 부분 기록됨',
    effect_local: 'NvM 내 DID 데이터 불완전 → 다음 ECU 부팅 시 보정값 복구 실패',
    effect_system: '위치 센서 보정값 손실 → 기어 위치 판정 오류 → P/R/N/D 위치 인식 불가',
    potential_cause: 'IGN-OFF 중 NvM 쓰기 미완료; NvM WriteAll 타임아웃 내 쓰기 불완전',
    severity: 7, occurrence: 2, detection: 5,
    preventive_action: 'NvM 쓰기 완료 확인(WriteJobFinished 콜백) 후 ECU 슬립 허가; 쓰기 보호 블록 설계',
    detection_action: 'ECU 부팅 시 NvM CRC 검증; 불일치 시 DTC(0xFD07 데이터 손상) 및 기본값 복원',
  },
  {
    sw_component: 'CstAp_DIDMgt',
    function_name: 'CtAp_DIDSet / SleepModeSta 연계',
    failure_mode: 'LATE',
    failure_detail: 'SleepModeSta=ON 후 DID 세트 작업이 완료되지 않은 채 ECU 슬립 전환 시도',
    effect_local: '미완료 DID 쓰기 작업 중단 → NvM 데이터 불완전',
    effect_system: '진단 데이터(DTC 스냅샷, 보정값) 손실 → 차후 A/S 진단 시 이력 확인 불가',
    potential_cause: 'SleepModeSta 처리 우선순위가 DID 쓰기 완료 대기 로직보다 높게 설정됨',
    severity: 5, occurrence: 3, detection: 5,
    preventive_action: 'SleepModeSta=ON 시 진행 중인 NvM Write 작업 완료 후 슬립 허가 게이팅 추가',
    detection_action: 'ECU 슬립 직전 NvM 쓰기 완료 여부 확인; 미완료 DID 항목 DTC 등록',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAp_DtcMgt [SwC1200] / ASIL B
  // 사양서(SwU1200.1 CtAp_DtcEnCndChk):
  //   DTC Enable 조건: SysPwrSta=ON AND BatStbSta=ON AND EcuSta<SLEEP → CondHoldTimer 증가
  //   CondHoldTimer >= 100 → DTC Enable 확정 (1초)
  //   EmergencyStop 명령 수신 시 DtcSet_EmergencyStop 저장
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAp_DtcMgt',
    function_name: 'CtAp_DtcEnCndChk / CondHoldTimer',
    failure_mode: 'EARLY',
    failure_detail: 'SysPwrSta=OFF 또는 BatStbSta=OFF인데 CondHoldTimer가 초기화되지 않고 누적되어 1초 미만에 DTC Enable 확정',
    effect_local: '시동 초기 불안정 구간에서 DTC Enable → 정상화 과정의 일시적 고장도 DTC 등록',
    effect_system: '불필요한 DTC 등록 → 오진단 이력 축적 → 정비소 방문 시 불필요한 부품 교체',
    potential_cause: 'SysPwrSta·BatStbSta 조건 불만족 시 CondHoldTimer 초기화(=0) 코드 누락',
    severity: 4, occurrence: 3, detection: 6,
    preventive_action: '사양서: 조건 불만족 시 CondHoldTimer=0 명시 → 구현 코드에 else 분기 초기화 추가',
    detection_action: 'CondHoldTimer 100 도달 시점에 SysPwrSta·BatStbSta 이전 이력 검증',
  },
  {
    sw_component: 'CstAp_DtcMgt',
    function_name: 'CtAp_DtcEnCndChk / EmergencyStop',
    failure_mode: 'CORRUPT',
    failure_detail: 'EmergencyStop 명령이 수신되지 않았는데 DtcSet_EmergencyStop 값이 이전 세션 값으로 오복원됨 (NvM 이전값)',
    effect_local: '이전 운행의 EmergencyStop 이력이 현 세션에 활성화됨',
    effect_system: 'EmergencyStop 오활성으로 모터 제어 비상 정지 트리거 → 정상 운행 중 변속 기능 중단',
    potential_cause: 'ECU 부팅 시 DtcSet_EmergencyStop NvM 복원 후 초기화 단계 누락',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'ECU 부팅 초기화 루틴에 DtcSet_EmergencyStop=0 명시적 초기화 추가',
    detection_action: 'ECU 부팅 후 EmergencyStop 상태 DID 쿼리; 비정상 활성 시 즉시 DTC 및 초기화',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BswIF_ECUModeCntl [SwC1400] / ASIL B
  // 사양서(SwU1400.1 CtAp_EcuModeCntl):
  //   SleepIoSta, MainCanBusOffSta, SubCanBusOffSta 결정
  //   WakeupEvent: GCAN_RX_POLL, PCAN_RX_POLL → EcuM_SetWakeupEvent 호출
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_ECUModeCntl',
    function_name: 'CtAp_EcuModeCntl / SleepIoSta',
    failure_mode: 'CORRUPT',
    failure_detail: 'SysPwrSta가 이전 주기 OFF→현재 ON으로 변화했는데 SleepIoSta=STD_ON으로 잘못 유지됨',
    effect_local: 'SleepIoSta=ON 오지속 → DiagSession 슬립 허가 조건 오판정',
    effect_system: 'IGN-ON 후에도 슬립 IO 상태 유지 → DTC Enable 조건(EcuSta<Sleep) 불충족 → DTC 미활성',
    potential_cause: 'SleepIoSta 결정 로직에서 이전 SysPwrSta 값 기준으로 업데이트하는 구현 오류',
    severity: 5, occurrence: 2, detection: 5,
    preventive_action: 'SysPwrSta 상태 전이(OFF→ON) 감지 시 SleepIoSta 즉시 클리어 로직 추가',
    detection_action: 'IGN-ON 후 SleepIoSta=ON 지속 시간 > 100ms 이면 DTC; DiagCondition 활성 여부 교차 검증',
  },
  {
    sw_component: 'BswIF_ECUModeCntl',
    function_name: 'CtAp_EcuModeCntl / WakeupEvent',
    failure_mode: 'LESS',
    failure_detail: 'PCAN_RX_POLL Wakeup 이벤트 수신 시 EcuM_SetWakeupEvent 미호출로 ECU 슬립 상태 유지',
    effect_local: 'CAN 메시지 수신에도 ECU 미웨이크업 → RxMainCAN 태스크 미수행',
    effect_system: 'VCU·SMK 메시지 수신 불가 → 원격 시동·스마트키 인증 실패',
    potential_cause: 'WakeupEventValidated runnable에서 PCAN_RX_POLL 조건 분기 누락; 조건식 오류',
    severity: 7, occurrence: 2, detection: 5,
    preventive_action: 'PCAN·GCAN Wakeup 이벤트 각각 단위 테스트; EcuM_SetWakeupEvent 호출 여부 검증',
    detection_action: 'PCAN 메시지 수신 인터럽트와 EcuM Wakeup 상태 불일치 감지 → DTC 등록',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BswIF_IoHwAb [SwC2300] / ASIL B
  // 사양서(SwU2300.1 CtIoHwAb_IntfIn):
  //   PWM 센서 측정(POS_SENS_1/2, MOV_SENS_1/2), ADC 수집(ReadAllADCInputs)
  //   ADC_FB_12(SBC 피드백), ADC_FB_2(LDO2 전압)
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_IoHwAb',
    function_name: 'CtIoHwAb_IntfIn / PWMI_POS_SENS_1',
    failure_mode: 'CORRUPT',
    failure_detail: 'POS_SENS_1 PWM 입력 측정 중 ICU 채널 포화(ActiveTime > PeriodTime)로 PosSnrRaw1 계산값 오버플로우',
    effect_local: 'PosSnrRaw1 = 0xFFFF 비정상값 → CtAp_PosMgt가 범위 이탈(>900u)로 PosSnrRngFlt=ON 판정',
    effect_system: '정상 레버 위치에서 위치 센서 고장 오감지 → 변속 금지 → 레버 잠금',
    potential_cause: 'ICU ActiveTime 측정값이 PeriodTime보다 클 때 클램핑 처리 없이 나눗셈 수행',
    severity: 9, occurrence: 2, detection: 3,
    preventive_action: 'ActiveTime >= PeriodTime 조건 시 결과값 클램핑(1000u) 또는 0u 처리 로직 추가',
    detection_action: 'PosSnrRaw1 > 1000u 즉시 비정상 플래그 설정; ICU 캡처값 원시 데이터 DID 노출',
  },
  {
    sw_component: 'BswIF_IoHwAb',
    function_name: 'CtIoHwAb_IntfIn / ReadAllADCInputs',
    failure_mode: 'LATE',
    failure_detail: 'ReadAllADCInputs 수행 중 ADC 변환 완료 인터럽트 지연으로 VBatVolt·VIgnVolt 값이 이전 주기 값으로 사용됨',
    effect_local: 'PwrMGT 컴포넌트에 이전 주기 전압값 전달 → 전압 상태 판정 1주기(10ms) 지연',
    effect_system: '급격한 전압 변동(IGN-OFF, 배터리 순간 저하) 시 1주기 지연으로 보호 동작 지연',
    potential_cause: 'ADC DMA 전송 완료 전 ReadAllADCInputs 리턴으로 이전 버퍼 값 사용',
    severity: 6, occurrence: 3, detection: 5,
    preventive_action: 'ADC DMA 완료 플래그 확인 후 버퍼 읽기; DMA 완료 인터럽트 기반 데이터 갱신 설계',
    detection_action: 'ADC 변환 완료 타임아웃(10ms) 초과 시 DTC; VBatVolt 연속 2주기 동일값 감지',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BswIF_WdgM [SwC2700] / ASIL B
  // 사양서: 각 유닛별 WdgM CheckpointReached 호출 → 논리적 감시
  //   CP_ILS012(LdoStaChk), CP_ILS020(PosMgt), 기타 CP
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_WdgM',
    function_name: 'WdgM / LogicalSupervision CheckpointReached',
    failure_mode: 'LESS',
    failure_detail: 'CtAp_LdoStaChk(CP_ILS012) 또는 CtAp_PositionSensorFltChk(CP_ILS020) 체크포인트 호출이 누락됨',
    effect_local: 'WdgM 논리 감시 실패 → WdgM이 해당 유닛을 비활성(정지) 상태로 판정',
    effect_system: 'WdgM 감시 실패 → ECU 소프트 리셋 트리거 → 주행 중 ECU 재시작 → 변속 기능 일시 중단',
    potential_cause: '태스크 실행 지연으로 CheckpointReached 호출 시간 초과; WdgM 타임아웃 설정이 너무 짧음',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'WdgM 타임아웃 파라미터를 태스크 최대 실행 시간 + 여유(20%) 기반으로 설정',
    detection_action: 'WdgM 알람 발생 시 DTC(WdgM 타임아웃) 등록; 어떤 CP에서 실패했는지 이력 저장',
  },
  {
    sw_component: 'BswIF_WdgM',
    function_name: 'WdgM / 하드웨어 Watchdog 갱신',
    failure_mode: 'LATE',
    failure_detail: '시스템 부하 증가로 WdgM HW 워치독 갱신(Trigger) 주기가 설정 시간을 초과함',
    effect_local: 'HW 워치독 타임아웃 → ECU 하드 리셋',
    effect_system: '주행 중 ECU 강제 재시작 → 변속기 전기적 잠금 일시 해제 후 P 위치 강제 복귀',
    potential_cause: '고부하 태스크(모터 제어, CAN 처리) 실행 시간 증가로 WdgM 태스크 선점 지연',
    severity: 8, occurrence: 2, detection: 5,
    preventive_action: 'WdgM Trigger 태스크를 최고 우선순위로 설정; CPU 부하율 80% 이하 설계',
    detection_action: 'WdgM HW Trigger 지연 DTC; 리셋 원인(HW WD 타임아웃) NvM 저장 및 부팅 시 보고',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BswIF_SafetyLib [SwC2500] / ASIL B
  // 사양서(SwU2500.1 CtSafetyLib): 메모리 체크섬, 스택 모니터링, 레지스터 테스트
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'BswIF_SafetyLib',
    function_name: 'CtSafetyLib / RAM 체크섬',
    failure_mode: 'CORRUPT',
    failure_detail: 'RAM 영역 체크섬 검증 실패 시 SafetyLib가 오류를 보고하지 않고 체크섬을 갱신하여 손상 은폐',
    effect_local: 'RAM 데이터 손상이 은폐됨 → 손상된 변수 기반으로 ASIL B 기능 계속 수행',
    effect_system: '손상된 위치 데이터·전압 판정 변수 기반 동작 → 안전 기능(SysPwrSta, GearPosSta) 신뢰성 손실',
    potential_cause: '체크섬 불일치 시 SafetyLib 내 오류 보고 경로 대신 갱신 경로 실행 (조건 분기 오류)',
    severity: 9, occurrence: 1, detection: 4,
    preventive_action: '체크섬 불일치 시 즉시 오류 플래그 설정 후 갱신 금지; 코드 리뷰 및 MC/DC 커버리지 테스트',
    detection_action: 'SafetyLib 오류 플래그 주기 폴링; DTC(RAM 무결성 오류) 등록 후 ECU 안전 모드 전환',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CstAP_VehicleReset_Mgt [SwC13000] / ASIL B
  // 사양서(SwU13000.1 CtAp_VehicleReset_Asw_Timer):
  //   타이머 리소스 관리, OneShotSet·OneShotExpired 포트
  //   RE_VehicleReset_Asw_Timer_Resource(): 타이머 카운터 증분 및 만료 이벤트 처리
  // ══════════════════════════════════════════════════════════════════════════
  {
    sw_component: 'CstAP_VehicleReset_Mgt',
    function_name: 'CtAp_VehicleReset_Asw_Timer / OneShotSet',
    failure_mode: 'MORE',
    failure_detail: '타이머 OneShotSet 설정 시 current_count가 초기화되지 않아 즉시 만료 이벤트 발생',
    effect_local: '타이머 설정 직후 OneShotExpired 즉시 트리거',
    effect_system: '차량 리셋 대기 시간 0으로 단축 → ECU 예약 리셋이 즉시 실행 → 예상치 못한 시점에 ECU 재시작',
    potential_cause: '사양서: OneShotSet 시 "Reset the count to 0" 명시 → 구현에서 초기화 코드 누락',
    severity: 8, occurrence: 2, detection: 4,
    preventive_action: 'OneShotSet 콜백 내 current_count=0 초기화 명시적 구현 및 단위 테스트',
    detection_action: 'OneShotSet 호출 직후 OneShotExpired 이벤트 발생 시 DTC; 타이머 경과 시간 검증',
  },
  {
    sw_component: 'CstAP_VehicleReset_Mgt',
    function_name: 'CtAp_VehicleReset_Asw_Timer / 타이머 경쟁',
    failure_mode: 'CORRUPT',
    failure_detail: 'RE_VehicleReset_Asw_Timer_Resource 실행 중 RE_SET_VehicleReset_Timer_Period 동시 호출로 타이머 값 불일치',
    effect_local: '타이머 설정값과 카운터 값 동기화 실패 → 잘못된 만료 시간',
    effect_system: '차량 리셋 타이밍 오류 → 리셋이 너무 이르거나 늦게 실행',
    potential_cause: '타이머 리소스에 대한 AUTOSAR 임계 구역(Critical Section) 보호 미적용',
    severity: 6, occurrence: 2, detection: 5,
    preventive_action: 'RE_VehicleReset_Asw_Timer_Resource 및 RE_SET_VehicleReset_Timer_Period 간 SuspendAllInterrupts/ResumeAllInterrupts 적용',
    detection_action: '타이머 만료 시각 로깅; 설정 기간 대비 실제 만료 시간 오차 > 10ms 시 DTC',
  },

]

// ── 삽입 (기존 AI 항목에 추가) ───────────────────────────────────────────────
async function main() {
  const client = await pool.connect()
  try {
    const total = items.length
    console.log(`\n▶ 나머지 컴포넌트 FMEA 항목 추가 (총 ${total}개)`)

    await client.query('BEGIN')

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

    // 현재 전체 AI 항목 수
    const countRes = await pool.query(
      "SELECT COUNT(*) FROM pre_fmea_items WHERE session_id=$1 AND source='ai'",
      [SESSION_ID],
    )
    const totalAI = countRes.rows[0].count

    console.log(`\n✅ 추가 완료: ${total}개 (총 AI 항목: ${totalAI}개)`)
    console.log('\n[이번 추가 AP 분포]')
    Object.entries(apDist).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}개`))
    console.log('\n[이번 추가 컴포넌트별]')
    Object.entries(compDist)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`  ${k.padEnd(40)}: ${v}개`))
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ error:', e)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
