import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { patches } = await req.json() as {
    patches: Array<{
      b_id: string
      a_severity: number | null; a_occurrence: number | null; a_detection: number | null
      a_effect_system: string | null; a_preventive_action: string | null
    }>
  }

  const results = await Promise.all(
    patches.map(p => {
      const update: Record<string, unknown> = {}
      if (p.a_severity   != null) update.severity          = p.a_severity
      if (p.a_occurrence != null) update.occurrence        = p.a_occurrence
      if (p.a_detection  != null) update.detection         = p.a_detection
      if (p.a_effect_system     != null) update.effect_system     = p.a_effect_system
      if (p.a_preventive_action != null) update.preventive_action = p.a_preventive_action
      if (!Object.keys(update).length) return Promise.resolve(false)
      return sb.from('fmea_items').update(update).eq('id', p.b_id).then(r => !r.error)
    })
  )

  return NextResponse.json({ applied: results.filter(Boolean).length })
}
