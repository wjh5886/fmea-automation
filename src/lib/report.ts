import type { FmeaItem, SafetyGoal } from './supabase'

export type ReportComponent = {
  name: string
  count: number
  maxS: number
  avgRpn: number
  maxRpn: number
  sgCount: number
}

export type ReportTopRisk = {
  component: string
  variableName: string
  failureMode: string | null
  effectSg: string | null
  s: number
  o: number
  d: number
  rpn: number
}

export type ReportSgBreakdown = {
  sgId: string
  desc: string
  asil: string | null
  count: number
  maxS: number
}

export type ReportFmVar = {
  component: string
  variableName: string
  s: number
  rpn: number
}

export type ReportFmDistribution = {
  key: string
  label: string
  count: number
  sgCount: number
  maxS: number
  pct: number
  impl: string[]
  sm: string
  topVars: ReportFmVar[]
}

export type ReportInsight = {
  type: 'danger' | 'warn' | 'info'
  text: string
}

export type ReportSmChecklistItem = {
  component: string
  variableName: string
  failureMode: string | null
  effectSg: string | null
  s: number
  rpn: number
  sm: string
}

export type ReportSummary = {
  total: number
  sgViolations: number
  highS: number
  veryHighS: number
  avgRpn: number
  maxRpn: number
  sDistribution: Record<number, number>
  components: ReportComponent[]
  topRisks: ReportTopRisk[]
  sgBreakdown: ReportSgBreakdown[]
  fmDistribution: ReportFmDistribution[]
  insights: ReportInsight[]
  smChecklist: ReportSmChecklistItem[]
}

const FM_ORDER = ['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE', 'STUCK', 'ERRATIC'] as const

const FM_LABELS: Record<string, string> = {
  MORE: 'MORE (값 과다/초과)',
  LESS: 'LESS (값 과소/부족)',
  CORRUPT: 'CORRUPT (비정상/손상된 값)',
  EARLY: 'EARLY (타이밍 빠름/조기 발생)',
  LATE: 'LATE (타이밍 늦음/지연 발생)',
  STUCK: 'STUCK (값 고착/갱신 안됨)',
  ERRATIC: 'ERRATIC (불규칙/노이즈성 변동)',
}

const SM_SUGGEST: Record<string, string> = {
  MORE: '상한 범위 체크 + Last-valid 유지',
  LESS: '하한 범위 체크 + Degraded Mode',
  CORRUPT: 'Whitelist/CRC 검증 + Default 분기 안전 처리',
  EARLY: '최소 주기/시퀀스 체크 + 워치독 타이머',
  LATE: '수신 타임아웃 모니터 + DTC',
  STUCK: 'Alive Counter/Stuck-at 검출 + Fail-safe 천이',
  ERRATIC: '디바운스/히스테리시스 + 연속 N회 확인 후 반영',
}

const FM_IMPL: Record<string, string[]> = {
  MORE: [
    '상한값(Max) 범위 체크 로직 구현 (입력 수신 직후 적용)',
    '이상값 수신 시 이전 유효값(Last-valid) 유지 또는 최대 클램핑 처리',
    '연속 N 사이클 이상 감지 시 DTC 발생 (노이즈 오검출 방지)',
    '플러서빌리티 체크: 관련 신호와 상호 비교하여 물리적 불가능 조합 감지',
  ],
  LESS: [
    '하한값(Min) 범위 체크 로직 구현',
    '저전압 조건 감지 시 기능 제한 모드(Degraded Mode) 전환 로직',
    '이상값 수신 시 안전 방향(Fail-safe)으로 제어값 치환',
    '연속 이상 감지 카운터 + DTC 발생',
  ],
  CORRUPT: [
    '허용 상태 Whitelist 검증 (정의 범위 외 값 → 즉시 Fault 처리)',
    'CRC / Checksum 검증 로직 구현 (수신부에서 우선 적용)',
    'Switch-case의 default 케이스에 에러 처리 및 안전 상태 천이 구현',
    '반복 발생 시 DTC 발생 및 통신 이상 보고',
  ],
  EARLY: [
    '신호별 최소 발생 주기/순서(Sequence) 정의 및 체크 로직 구현',
    '예상보다 이른 이벤트 수신 시 무시 또는 보류(Hold) 처리',
    '워치독/타이머 기반으로 비정상 조기 트리거 감지',
    '연속 이상 감지 시 DTC 발생 및 로깅',
  ],
  LATE: [
    '수신 타임아웃 감시: 마지막 수신 후 일정 시간 내 재수신 없으면 Fault 플래그 셋',
    'Alive Counter / Message Counter 체크 구현',
    'Fault 검출 시 안전 상태(Default/Limp-home)로 천이하는 핸들러 필수',
    'DTC 발생 및 지연 이력 로깅 구현',
  ],
  STUCK: [
    'Alive Counter / Toggle Bit 기반 갱신 여부 감시',
    '동일 값이 N 사이클 이상 유지될 경우 Stuck-at 의심 플래그 셋',
    'Stuck 검출 시 안전 상태(Default/Limp-home)로 천이하는 핸들러 필수',
    'DTC 발생 및 CAN 에러 로깅 구현',
  ],
  ERRATIC: [
    '디바운스(Debounce) 로직 적용 — 짧은 시간 내 반복 변동 무시',
    '히스테리시스 적용으로 경계값 부근 채터링 방지',
    '연속 N회 동일 경향 확인 후에만 값 반영',
    '빈번한 변동 감지 시 DTC 발생 및 로깅',
  ],
}

const isSgViolation = (sg: string | null | undefined): sg is string =>
  !!sg && !['X', '-', ''].includes(sg.trim())

export function buildReportSummary(items: FmeaItem[], sgs: SafetyGoal[]): ReportSummary {
  const total = items.length

  const sgViolations = items.filter(i => isSgViolation(i.effect_safety_goal)).length
  const highS = items.filter(i => (i.severity ?? 0) >= 8).length
  const veryHighS = items.filter(i => (i.severity ?? 0) >= 9).length
  const rpns = items.map(i => i.rpn ?? 0)
  const avgRpn = total ? Math.round((rpns.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0
  const maxRpn = rpns.length ? Math.max(...rpns) : 0

  const sDistribution: Record<number, number> = {}
  for (const i of items) {
    const s = i.severity ?? 0
    sDistribution[s] = (sDistribution[s] ?? 0) + 1
  }

  // ── 컴포넌트별 리스크 ──
  const compMap = new Map<string, FmeaItem[]>()
  for (const i of items) {
    const name = i.sw_units?.name ?? '미분류'
    if (!compMap.has(name)) compMap.set(name, [])
    compMap.get(name)!.push(i)
  }
  const components: ReportComponent[] = [...compMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rows]) => {
      const crRpns = rows.map(r => r.rpn ?? 0)
      return {
        name,
        count: rows.length,
        maxS: Math.max(...rows.map(r => r.severity ?? 0)),
        avgRpn: Math.round((crRpns.reduce((a, b) => a + b, 0) / crRpns.length) * 10) / 10,
        maxRpn: Math.max(...crRpns),
        sgCount: rows.filter(r => isSgViolation(r.effect_safety_goal)).length,
      }
    })

  // ── Top 15 ──
  const topRisks: ReportTopRisk[] = [...items]
    .sort((a, b) => (b.rpn ?? 0) - (a.rpn ?? 0))
    .slice(0, 15)
    .map(r => ({
      component: r.sw_units?.name ?? '미분류',
      variableName: r.variable_name ?? '',
      failureMode: r.failure_mode,
      effectSg: r.effect_safety_goal,
      s: r.severity ?? 0,
      o: r.occurrence ?? 0,
      d: r.detection ?? 0,
      rpn: r.rpn ?? 0,
    }))

  // ── SG 위반 현황 ──
  const sgMap = new Map<string, FmeaItem[]>()
  for (const i of items) {
    if (isSgViolation(i.effect_safety_goal)) {
      const key = i.effect_safety_goal!.trim()
      if (!sgMap.has(key)) sgMap.set(key, [])
      sgMap.get(key)!.push(i)
    }
  }
  const sgBreakdown: ReportSgBreakdown[] = [...sgMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sgId, rows]) => {
      const sg = sgs.find(s => s.sg_id === sgId)
      return {
        sgId,
        desc: sg?.name ?? '',
        asil: sg?.asil ?? null,
        count: rows.length,
        maxS: Math.max(...rows.map(r => r.severity ?? 0)),
      }
    })

  // ── FM 분포 ──
  const fmMap = new Map<string, FmeaItem[]>()
  for (const i of items) {
    const fm = (i.failure_mode ?? '').trim().toUpperCase()
    if (!FM_ORDER.includes(fm as (typeof FM_ORDER)[number])) continue
    if (!fmMap.has(fm)) fmMap.set(fm, [])
    fmMap.get(fm)!.push(i)
  }
  const fmDistribution: ReportFmDistribution[] = FM_ORDER.filter(key => fmMap.has(key)).map(key => {
    const rows = fmMap.get(key)!
    return {
      key,
      label: FM_LABELS[key],
      count: rows.length,
      sgCount: rows.filter(r => isSgViolation(r.effect_safety_goal)).length,
      maxS: Math.max(...rows.map(r => r.severity ?? 0)),
      pct: total ? Math.round((rows.length / total) * 1000) / 10 : 0,
      impl: FM_IMPL[key],
      sm: SM_SUGGEST[key],
      topVars: [...rows]
        .filter(r => (r.severity ?? 0) >= 8)
        .sort((a, b) => (b.rpn ?? 0) - (a.rpn ?? 0))
        .slice(0, 5)
        .map(r => ({
          component: r.sw_units?.name ?? '미분류',
          variableName: r.variable_name ?? '',
          s: r.severity ?? 0,
          rpn: r.rpn ?? 0,
        })),
    }
  })

  // ── 인사이트 ──
  const insights: ReportInsight[] = []
  if (fmDistribution.length) {
    const topFm = fmDistribution.reduce((a, b) => (b.count > a.count ? b : a))
    insights.push({
      type: 'info',
      text: `가장 빈번한 고장 유형은 '${topFm.label}' (${topFm.count}건, ${topFm.pct}%)입니다.`,
    })
  }
  const compsBySg = [...components].sort((a, b) => b.sgCount - a.sgCount)
  if (compsBySg.length && compsBySg[0].sgCount > 0) {
    const top = compsBySg[0]
    insights.push({
      type: 'warn',
      text: `SG 위반이 가장 많은 컴포넌트는 '${top.name}'으로 ${top.sgCount}건입니다. 해당 컴포넌트의 인터페이스 처리 로직을 우선 검토하세요.`,
    })
  }
  if (veryHighS > 0) {
    insights.push({
      type: 'danger',
      text: `S≥9 항목이 ${veryHighS}개(${total ? Math.round((veryHighS / total) * 1000) / 10 : 0}%)입니다. Safety Goal과 직결되므로 SM 설계 시 ASIL B 수준 진단 커버리지(DC ≥ 90%)를 확보하세요.`,
    })
  }
  const asilBSgIds = sgBreakdown.filter(sg => sg.asil === 'B').map(sg => sg.sgId)
  if (asilBSgIds.length) {
    insights.push({
      type: 'danger',
      text: `ASIL B Safety Goal(${asilBSgIds.join(', ')}) 위반 항목이 존재합니다. SM 구현 후 FMEA D' 값 재계산이 필요합니다.`,
    })
  }
  if (highS > 0) {
    insights.push({
      type: 'info',
      text: `S≥8 고위험 항목 ${highS}개에 대해 아래 Safety Mechanism 구현 체크리스트를 활용하여 구현 현황을 점검하세요.`,
    })
  }

  // ── SM 체크리스트 (S≥8) ──
  const smChecklist: ReportSmChecklistItem[] = [...items]
    .filter(i => (i.severity ?? 0) >= 8)
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || (b.rpn ?? 0) - (a.rpn ?? 0))
    .slice(0, 40)
    .map(r => {
      const fm = (r.failure_mode ?? '').trim().toUpperCase()
      return {
        component: r.sw_units?.name ?? '미분류',
        variableName: r.variable_name ?? '',
        failureMode: r.failure_mode,
        effectSg: r.effect_safety_goal,
        s: r.severity ?? 0,
        rpn: r.rpn ?? 0,
        sm: SM_SUGGEST[fm] ?? '-',
      }
    })

  return {
    total,
    sgViolations,
    highS,
    veryHighS,
    avgRpn,
    maxRpn,
    sDistribution,
    components,
    topRisks,
    sgBreakdown,
    fmDistribution,
    insights,
    smChecklist,
  }
}
