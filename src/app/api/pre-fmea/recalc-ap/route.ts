import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { calculateAPSafe } from '@/lib/ap-calculator'

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    const items = await query(
      'SELECT id, severity, occurrence, detection FROM pre_fmea_items WHERE session_id = $1',
      [session_id],
    )

    let updated = 0
    for (const item of items) {
      const ap = calculateAPSafe(item.severity, item.occurrence, item.detection)
      await execute(
        'UPDATE pre_fmea_items SET action_priority = $1 WHERE id = $2',
        [ap, item.id],
      )
      if (ap) updated++
    }

    // AP 분포 집계
    const dist = await query(
      `SELECT action_priority, COUNT(*) AS cnt
       FROM pre_fmea_items WHERE session_id = $1 AND action_priority IS NOT NULL
       GROUP BY action_priority ORDER BY action_priority`,
      [session_id],
    )

    return NextResponse.json({
      total: items.length,
      updated,
      distribution: dist.reduce<Record<string, number>>((acc, r) => {
        acc[String(r.action_priority)] = Number(r.cnt)
        return acc
      }, {}),
    })
  } catch (e) {
    console.error('[pre-fmea/recalc-ap]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
