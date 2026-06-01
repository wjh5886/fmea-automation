import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const rows = await query('SELECT * FROM projects ORDER BY created_at DESC')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { name, description, vehicle_model } = await req.json()
  const row = await queryOne(
    `INSERT INTO projects (name, description, vehicle_model)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, description ?? null, vehicle_model ?? null],
  )
  return NextResponse.json(row, { status: 201 })
}
