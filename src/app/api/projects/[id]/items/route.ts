import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute, getPool } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const rows = await query(
    `SELECT fi.*,
       json_build_object('id', su.id, 'name', su.name) AS sw_units,
       json_build_object('id', sg.id, 'sg_id', sg.sg_id, 'name', sg.name, 'asil', sg.asil) AS safety_goals,
       json_build_object('id', sm.id, 'sm_id', sm.sm_id, 'name', sm.name) AS safety_mechanisms
     FROM fmea_items fi
     LEFT JOIN sw_units su ON su.id = fi.sw_unit_id
     LEFT JOIN safety_goals sg ON sg.id = fi.safety_goal_id
     LEFT JOIN safety_mechanisms sm ON sm.id = fi.safety_mechanism_id
     WHERE fi.project_id = $1
     ORDER BY fi.item_no NULLS LAST, fi.variable_name`,
    [id],
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  // bulk insert
  if (Array.isArray(body)) {
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const inserted: unknown[] = []
      for (const item of body) {
        const { rows } = await client.query(
          `INSERT INTO fmea_items (project_id, sw_unit_id, item_no, category, variable_name, variable_type,
            failure_mode, failure_detail, effect_module, effect_system, effect_safety_goal,
            severity, occurrence, detection, preventive_action, detection_action,
            cm_required, countermeasure, status, ai_generated)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING *`,
          [id, item.sw_unit_id ?? null, item.item_no ?? null, item.category ?? null,
           item.variable_name, item.variable_type ?? null, item.failure_mode ?? null,
           item.failure_detail ?? null, item.effect_module ?? null, item.effect_system ?? null,
           item.effect_safety_goal ?? null, item.severity ?? null, item.occurrence ?? null,
           item.detection ?? null, item.preventive_action ?? null, item.detection_action ?? null,
           item.cm_required ?? null, item.countermeasure ?? null,
           item.status ?? 'draft', item.ai_generated ?? false],
        )
        inserted.push(rows[0])
      }
      await client.query('COMMIT')
      return NextResponse.json({ inserted: inserted.length }, { status: 201 })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
  // single insert
  const item = body
  const row = await queryOne(
    `INSERT INTO fmea_items (project_id, sw_unit_id, item_no, category, variable_name, variable_type,
      failure_mode, failure_detail, effect_module, effect_system, effect_safety_goal,
      severity, occurrence, detection, preventive_action, detection_action, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [id, item.sw_unit_id ?? null, item.item_no ?? null, item.category ?? null,
     item.variable_name, item.variable_type ?? null, item.failure_mode ?? null,
     item.failure_detail ?? null, item.effect_module ?? null, item.effect_system ?? null,
     item.effect_safety_goal ?? null, item.severity ?? null, item.occurrence ?? null,
     item.detection ?? null, item.preventive_action ?? null, item.detection_action ?? null,
     item.status ?? 'draft'],
  )
  return NextResponse.json(row, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { item_id, ...patch } = await req.json()
  // rpn and rpn_after are GENERATED ALWAYS columns — cannot be set directly
  delete patch.rpn
  delete patch.rpn_after
  const fields = Object.keys(patch)
  if (!fields.length) return NextResponse.json({ error: 'no fields' }, { status: 400 })

  const setClauses = fields.map((f, i) => `"${f}" = $${i + 2}`).join(', ')
  const values = fields.map(f => (patch as Record<string, unknown>)[f])
  const row = await queryOne(
    `UPDATE fmea_items SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`,
    [item_id, ...values],
  )
  return NextResponse.json(row)
}

export async function DELETE(req: NextRequest) {
  const { item_id } = await req.json()
  await execute('DELETE FROM fmea_items WHERE id = $1', [item_id])
  return new NextResponse(null, { status: 204 })
}
