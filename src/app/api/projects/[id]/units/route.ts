import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const rows = await query('SELECT * FROM sw_units WHERE project_id = $1 ORDER BY name', [id])
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { name, description } = await req.json()
  const row = await queryOne(
    'INSERT INTO sw_units (project_id, name, description) VALUES ($1, $2, $3) RETURNING *',
    [id, name, description ?? null],
  )
  return NextResponse.json(row, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { unit_id } = await req.json()
  await execute('DELETE FROM sw_units WHERE id = $1 AND project_id = $2', [unit_id, id])
  return new NextResponse(null, { status: 204 })
}
