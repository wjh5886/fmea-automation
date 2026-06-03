import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

const VALID_MODES = ['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE', 'STUCK', 'ERRATIC', 'N/A']

async function ensureUnits(rows: Record<string, unknown>[], projectId: string) {
  const existing = await query<{ id: string; name: string }>(
    'SELECT id, name FROM sw_units WHERE project_id = $1', [projectId],
  )
  const unitMap = new Map(existing.map(u => [u.name, u.id]))

  const newNames = [...new Set(
    rows.map(r => String(r.SW_Unit ?? r['SW Unit'] ?? '')).filter(Boolean),
  )]
  for (const name of newNames) {
    if (!unitMap.has(name)) {
      const row = await queryOne<{ id: string }>(
        'INSERT INTO sw_units (project_id, name) VALUES ($1, $2) RETURNING id',
        [projectId, name],
      )
      if (row) unitMap.set(name, row.id)
    }
  }
  return unitMap
}

function parseRows(rows: Record<string, unknown>[], projectId: string, unitMap: Map<string, string>) {
  return rows.map(r => {
    const swUnitName = String(r.SW_Unit ?? r['SW Unit'] ?? '')
    const failureMode = String(r.Failure_Mode ?? r['Failure Mode'] ?? r.FailureMode ?? '')
    return {
      project_id: projectId,
      sw_unit_id: unitMap.get(swUnitName) ?? null,
      item_no: String(r.No ?? r.item_no ?? '') || null,
      category: (['External', 'Internal'].includes(String(r.Category ?? '')) ? String(r.Category) : null),
      variable_name: String(r.Variable ?? r.variable_name ?? ''),
      variable_type: String(r.Type ?? r.variable_type ?? '') || null,
      failure_mode: VALID_MODES.includes(failureMode) ? failureMode : null,
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
    }
  }).filter(i => i.variable_name)
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 })
  }

  const { rows, project_id } = await req.json()
  if (!rows?.length || !project_id) {
    return NextResponse.json({ error: 'Missing rows or project_id' }, { status: 400 })
  }

  const unitMap = await ensureUnits(rows, project_id)
  const items = parseRows(rows, project_id, unitMap)

  let inserted = 0
  for (const item of items) {
    await query(
      `INSERT INTO fmea_items
       (project_id, sw_unit_id, item_no, category, variable_name, variable_type,
        failure_mode, failure_detail, effect_module, effect_system, effect_safety_goal,
        severity, occurrence, detection, preventive_action, detection_action,
        cm_required, countermeasure, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'draft')`,
      [item.project_id, item.sw_unit_id, item.item_no, item.category, item.variable_name,
       item.variable_type, item.failure_mode, item.failure_detail, item.effect_module,
       item.effect_system, item.effect_safety_goal, item.severity, item.occurrence,
       item.detection, item.preventive_action, item.detection_action, item.cm_required,
       item.countermeasure],
    )
    inserted++
  }

  return NextResponse.json({ inserted, total: items.length })
}
