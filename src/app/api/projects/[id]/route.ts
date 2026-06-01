import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const [project, units, sgs, sms, total, filled, high_rpn] = await Promise.all([
    queryOne('SELECT * FROM projects WHERE id = $1', [id]),
    query('SELECT * FROM sw_units WHERE project_id = $1 ORDER BY name', [id]),
    query('SELECT * FROM safety_goals WHERE project_id = $1 ORDER BY sg_id', [id]),
    query('SELECT * FROM safety_mechanisms WHERE project_id = $1 ORDER BY sm_id', [id]),
    queryOne<{ count: string }>('SELECT COUNT(*) FROM fmea_items WHERE project_id = $1', [id]),
    queryOne<{ count: string }>(
      'SELECT COUNT(*) FROM fmea_items WHERE project_id=$1 AND severity IS NOT NULL AND occurrence IS NOT NULL AND detection IS NOT NULL', [id]),
    queryOne<{ count: string }>(
      'SELECT COUNT(*) FROM fmea_items WHERE project_id=$1 AND rpn >= 100', [id]),
  ])
  return NextResponse.json({
    project, units, sgs, sms,
    stats: {
      total: Number(total?.count ?? 0),
      filled: Number(filled?.count ?? 0),
      high_rpn: Number(high_rpn?.count ?? 0),
    },
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  await execute('DELETE FROM projects WHERE id = $1', [id])
  return new NextResponse(null, { status: 204 })
}
