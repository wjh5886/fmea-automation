import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { calculateAPSafe } from '@/lib/ap-calculator'

function normalize(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '').replace(/[^a-z0-9가-힣]/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const { session_id, merged_ids } = await req.json() as { session_id: string; merged_ids: string[] }
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })
    if (!Array.isArray(merged_ids) || !merged_ids.length)
      return NextResponse.json({ error: 'merged_ids required' }, { status: 400 })

    // 선택된 merged 항목 조회
    const mergedItems = await query(
      `SELECT * FROM pre_fmea_items WHERE session_id = $1 AND source = 'merged' AND id = ANY($2)`,
      [session_id, merged_ids],
    )

    // icd 항목 전체 조회 — (sw_component, failure_mode) 매칭용
    const icdItems = await query(
      `SELECT id, sw_component, failure_mode FROM pre_fmea_items WHERE session_id = $1 AND source IN ('ai','icd')`,
      [session_id],
    )
    const icdMap = new Map<string, string>() // key → id
    for (const it of icdItems) {
      icdMap.set(`${normalize(it.sw_component)}__${it.failure_mode ?? ''}`, String(it.id))
    }

    let updated = 0, added = 0

    for (const m of mergedItems) {
      const ho = m.human_override as Record<string, unknown> | null
      const key = `${normalize(m.sw_component)}__${m.failure_mode ?? ''}`
      const icdId = icdMap.get(key)

      if (ho && icdId) {
        // 매칭 항목: icd SOD를 전문가 값으로 업데이트
        const s = ho.human_severity as number ?? m.severity
        const o = ho.human_occurrence as number ?? m.occurrence
        const d = ho.human_detection as number ?? m.detection
        await execute(
          `UPDATE pre_fmea_items
           SET severity=$1, occurrence=$2, detection=$3, action_priority=$4,
               review_status='accepted', updated_at=now()
           WHERE id=$5`,
          [s, o, d, calculateAPSafe(s, o, d), icdId],
        )
        updated++
      } else if (!icdId) {
        // 전문가 전용 누락 항목: 새 icd 항목으로 추가
        await execute(
          `INSERT INTO pre_fmea_items
           (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
            effect_local, effect_system, effect_sg, potential_cause, severity, occurrence, detection,
            preventive_action, detection_action, confidence_score, action_priority, source, review_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1.0,$16,'icd','accepted')`,
          [session_id,
           `H-${String(added + 1).padStart(3, '0')}`,
           m.sw_component, m.function_name, m.failure_mode, m.failure_detail,
           m.effect_local, m.effect_system, m.effect_sg ?? null, m.potential_cause,
           m.severity, m.occurrence, m.detection,
           m.preventive_action, m.detection_action,
           calculateAPSafe(m.severity, m.occurrence, m.detection)],
        )
        added++
      }
    }

    return NextResponse.json({ updated, added, total: updated + added })
  } catch (e) {
    console.error('[apply-enhancement]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
