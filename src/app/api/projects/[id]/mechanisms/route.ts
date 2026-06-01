import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const rows = await query('SELECT * FROM safety_mechanisms WHERE project_id = $1 ORDER BY sm_id', [id])
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { sm_id, name, type, diagnostic_coverage, description, related_sg_id } = await req.json()
  const row = await queryOne(
    `INSERT INTO safety_mechanisms (project_id, sm_id, name, type, diagnostic_coverage, description, related_sg_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, sm_id, name, type ?? null, diagnostic_coverage ?? null, description ?? null, related_sg_id ?? null],
  )
  return NextResponse.json(row, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { mechanism_id } = await req.json()
  await execute('DELETE FROM safety_mechanisms WHERE id = $1 AND project_id = $2', [mechanism_id, id])
  return new NextResponse(null, { status: 204 })
}
