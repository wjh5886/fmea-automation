import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { calculateAPSafe } from '@/lib/ap-calculator'

function normalize(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '').replace(/[^a-z0-9가-힣]/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    const [aiItems, humanItems] = await Promise.all([
      query("SELECT * FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai' ORDER BY item_no", [session_id]),
      query("SELECT * FROM pre_fmea_items WHERE session_id = $1 AND source = 'human' ORDER BY item_no", [session_id]),
    ])

    if (!humanItems.length) {
      return NextResponse.json({ error: 'Gap 분석을 먼저 실행하세요 (인간 항목 없음).' }, { status: 400 })
    }

    // Human lookup by (normalized_component, failure_mode) — first row per key wins
    const humanMap = new Map<string, typeof humanItems[0]>()
    for (const h of humanItems) {
      const key = `${normalize(h.sw_component)}__${h.failure_mode ?? ''}`
      if (!humanMap.has(key)) humanMap.set(key, h)
    }

    type MergedItem = {
      session_id: string
      item_no: string
      sw_component: unknown
      function_name: unknown
      failure_mode: unknown
      failure_detail: unknown
      effect_local: unknown
      effect_system: unknown
      potential_cause: unknown
      severity: unknown
      occurrence: unknown
      detection: unknown
      preventive_action: unknown
      detection_action: unknown
      confidence_score: number
      action_priority: string | null
      review_status: string
      human_override: Record<string, unknown> | null
    }

    const merged: MergedItem[] = []
    const usedHumanKeys = new Set<string>()

    // AI 항목 처리: 인간 항목과 매칭 시 병합, 미매칭 시 신뢰도 하향
    for (const ai of aiItems) {
      const key = `${normalize(ai.sw_component)}__${ai.failure_mode ?? ''}`
      const human = humanMap.get(key)

      if (human) {
        usedHumanKeys.add(key)
        // 인간 SOD 우선, AI의 상세 설명 활용
        const mS = human.severity   ?? ai.severity
        const mO = human.occurrence ?? ai.occurrence
        const mD = human.detection  ?? ai.detection
        merged.push({
          session_id,
          item_no: '',
          sw_component:      human.sw_component ?? ai.sw_component,
          function_name:     human.function_name ?? ai.function_name,
          failure_mode:      ai.failure_mode,
          failure_detail:    ai.failure_detail ?? human.failure_detail,
          effect_local:      human.effect_local ?? ai.effect_local,
          effect_system:     human.effect_system ?? ai.effect_system,
          potential_cause:   ai.potential_cause,
          severity:          mS,
          occurrence:        mO,
          detection:         mD,
          preventive_action: human.preventive_action ?? ai.preventive_action,
          detection_action:  human.detection_action  ?? ai.detection_action,
          confidence_score:  Math.min(1.0, Number(ai.confidence_score ?? 0.8) * 1.1),
          action_priority:   calculateAPSafe(mS, mO, mD),
          review_status:     'accepted',
          human_override: {
            ai_severity:    ai.severity,
            ai_occurrence:  ai.occurrence,
            ai_detection:   ai.detection,
            human_severity:   human.severity,
            human_occurrence: human.occurrence,
            human_detection:  human.detection,
          },
        })
      } else {
        // 인간 FMEA에 없는 AI 항목 — 신뢰도 하향 후 유지
        merged.push({
          session_id,
          item_no: '',
          sw_component:      ai.sw_component,
          function_name:     ai.function_name,
          failure_mode:      ai.failure_mode,
          failure_detail:    ai.failure_detail,
          effect_local:      ai.effect_local,
          effect_system:     ai.effect_system,
          potential_cause:   ai.potential_cause,
          severity:          ai.severity,
          occurrence:        ai.occurrence,
          detection:         ai.detection,
          preventive_action: ai.preventive_action,
          detection_action:  ai.detection_action,
          confidence_score:  Math.max(0.3, Number(ai.confidence_score ?? 0.8) * 0.7),
          action_priority:   calculateAPSafe(ai.severity, ai.occurrence, ai.detection),
          review_status:     'pending',
          human_override:    null,
        })
      }
    }

    // 인간 항목 중 AI에 없는 항목 추가 — (sw_component, failure_mode) 기준 중복 제거
    const seenHumanOnly = new Set<string>()
    for (const h of humanItems) {
      const key = `${normalize(h.sw_component)}__${h.failure_mode ?? ''}`
      if (!usedHumanKeys.has(key) && !seenHumanOnly.has(key)) {
        seenHumanOnly.add(key)
        merged.push({
          session_id,
          item_no: '',
          sw_component:      h.sw_component,
          function_name:     h.function_name,
          failure_mode:      h.failure_mode,
          failure_detail:    h.failure_detail,
          effect_local:      h.effect_local,
          effect_system:     h.effect_system,
          potential_cause:   null,
          severity:          h.severity,
          occurrence:        h.occurrence,
          detection:         h.detection,
          preventive_action: h.preventive_action,
          detection_action:  h.detection_action,
          confidence_score:  1.0,
          action_priority:   calculateAPSafe(h.severity, h.occurrence, h.detection),
          review_status:     'accepted',
          human_override:    null,
        })
      }
    }

    // 병합 항목 번호 재부여: accepted 먼저, pending 후
    merged.sort((a, b) => {
      if (a.review_status === b.review_status) return 0
      return a.review_status === 'accepted' ? -1 : 1
    })
    merged.forEach((m, i) => { m.item_no = String(i + 1).padStart(3, '0') })

    // DB 저장
    await query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'merged'", [session_id])

    for (const m of merged) {
      await query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, action_priority, source, review_status, human_override)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'merged',$17,$18)`,
        [m.session_id, m.item_no, m.sw_component, m.function_name, m.failure_mode,
         m.failure_detail, m.effect_local, m.effect_system, m.potential_cause,
         m.severity, m.occurrence, m.detection, m.preventive_action, m.detection_action,
         m.confidence_score, m.action_priority, m.review_status,
         m.human_override ? JSON.stringify(m.human_override) : null],
      )
    }

    await query(
      `UPDATE pre_fmea_sessions
       SET status = 'upgraded', doc_version = doc_version + 1, updated_at = now()
       WHERE id = $1`,
      [session_id],
    )

    const humanMatched = usedHumanKeys.size
    const humanUniqueTotal = humanMap.size
    return NextResponse.json({
      mergedCount:   merged.length,
      humanMatched,
      humanOnly:     seenHumanOnly.size,
      aiOnly:        aiItems.length - humanMatched,
      humanUniqueTotal,
      acceptedCount: merged.filter(m => m.review_status === 'accepted').length,
      pendingCount:  merged.filter(m => m.review_status === 'pending').length,
    })
  } catch (e) {
    console.error('[pre-fmea/enhance]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
