import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'

export async function GET() {
  const rows = await query(`
    SELECT s.*,
      COUNT(p.id) FILTER (WHERE p.source IN ('ai', 'icd')) AS item_count
    FROM pre_fmea_sessions s
    LEFT JOIN pre_fmea_items p ON p.session_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { name, reference_project_id, item_name } = await req.json()
  const row = await queryOne(
    'INSERT INTO pre_fmea_sessions (name, reference_project_id, item_name) VALUES ($1, $2, $3) RETURNING *',
    [name, reference_project_id ?? null, item_name ?? 'SBW'],
  )
  return NextResponse.json(row, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const { session_id } = await req.json()
  await execute('DELETE FROM pre_fmea_sessions WHERE id = $1', [session_id])
  return new NextResponse(null, { status: 204 })
}
