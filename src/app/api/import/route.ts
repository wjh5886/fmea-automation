import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const VALID_MODES = ['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE', 'STUCK', 'ERRATIC', 'N/A']

function parseRows(rows: Record<string, unknown>[], projectId: string, unitMap: Map<string, string>) {
  return rows.map((r) => {
    const swUnitName = String(r.SW_Unit ?? r['SW Unit'] ?? '')
    const failureMode = String(r.Failure_Mode ?? r['Failure Mode'] ?? r.FailureMode ?? '')
    return {
      project_id: projectId,
      sw_unit_id: unitMap.get(swUnitName) ?? null,
      item_no: String(r.No ?? r.item_no ?? '') || null,
      category: (['External', 'Internal'].includes(String(r.Category ?? '')) ? String(r.Category) : null) as 'External' | 'Internal' | null,
      variable_name: String(r.Variable ?? r.variable_name ?? ''),
      variable_type: String(r.Type ?? r.variable_type ?? '') || null,
      failure_mode: (VALID_MODES.includes(failureMode) ? failureMode : null) as string | null,
      failure_detail: String(r.Detail ?? r.failure_detail ?? '') || null,
      effect_module: String(r.Effect_Module ?? r['Effect Module'] ?? '') || null,
      effect_system: String(r.Effect_System ?? r['Effect System'] ?? '') || null,
      effect_safety_goal: String(r.Effect_SG ?? r['Effect SG'] ?? '') || null,
      severity: r.S ? Number(r.S) : null,
      occurrence: r.O ? Number(r.O) : null,
      detection: r.D ? Number(r.D) : null,
      preventive_action: String(r.Preventive ?? r.preventive_action ?? '') || null,
      detection_action: String(r.Detection ?? r.detection_action ?? '') || null,
      cm_required: r.CM_Required != null ? Boolean(r.CM_Required) : null,
      countermeasure: String(r.Countermeasure ?? '') || null,
      status: 'draft' as const,
    }
  }).filter(i => i.variable_name)
}

async function ensureUnits(rows: Record<string, unknown>[], projectId: string) {
  const { data: existing } = await supabase.from('sw_units').select('*').eq('project_id', projectId)
  const unitMap = new Map((existing ?? []).map((u: { name: string; id: string }) => [u.name, u.id]))

  const newNames = [...new Set(rows.map((r: Record<string, unknown>) => String(r.SW_Unit ?? r['SW Unit'] ?? '')).filter(Boolean))]
  for (const name of newNames) {
    if (!unitMap.has(name)) {
      const { data } = await supabase.from('sw_units').insert([{ project_id: projectId, name }]).select().single()
      if (data) unitMap.set(name, data.id)
    }
  }
  return unitMap
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''

  let rows: Record<string, unknown>[] = []
  let projectId = ''

  if (contentType.includes('application/json')) {
    const body = await req.json()
    rows = body.rows
    projectId = body.project_id
  } else {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 })
  }

  if (!rows?.length || !projectId) return NextResponse.json({ error: 'Missing rows or project_id' }, { status: 400 })

  const unitMap = await ensureUnits(rows, projectId)
  const items = parseRows(rows, projectId, unitMap)

  let inserted = 0
  const batchSize = 100
  for (let i = 0; i < items.length; i += batchSize) {
    const { error } = await supabase.from('fmea_items').insert(items.slice(i, i + batchSize))
    if (!error) inserted += Math.min(batchSize, items.length - i)
  }

  return NextResponse.json({ inserted, total: items.length })
}
