import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const rows = await query('SELECT * FROM safety_goals WHERE project_id = $1 ORDER BY sg_id', [id])
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { sg_id, name, asil, description } = await req.json()
  const row = await queryOne(
    'INSERT INTO safety_goals (project_id, sg_id, name, asil, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [id, sg_id, name, asil ?? null, description ?? null],
  )
  return NextResponse.json(row, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { goal_id } = await req.json()
  await execute('DELETE FROM safety_goals WHERE id = $1 AND project_id = $2', [goal_id, id])
  return new NextResponse(null, { status: 204 })
}
