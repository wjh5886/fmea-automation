import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const [sessions, docs, items, gapRows] = await Promise.all([
    query('SELECT * FROM pre_fmea_sessions WHERE id = $1', [id]),
    query('SELECT * FROM pre_fmea_documents WHERE session_id = $1 ORDER BY created_at', [id]),
    query(
      'SELECT * FROM pre_fmea_items WHERE session_id = $1 ORDER BY item_no NULLS LAST, failure_mode, id',
      [id],
    ),
    query(
      `SELECT gap_type, COUNT(*) AS cnt FROM pre_fmea_gaps WHERE session_id = $1 GROUP BY gap_type`,
      [id],
    ),
  ])

  // Summarize gap counts for UI restoration after page refresh
  const bySource: Record<string, number> = {}
  for (const it of items) bySource[it.source as string] = (bySource[it.source as string] ?? 0) + 1

  const gapSummary = gapRows.length ? {
    missingItems:   Number(gapRows.find(r => r.gap_type === 'missing_item')?.cnt  ?? 0),
    sodDiffs:       Number(gapRows.find(r => r.gap_type === 'wrong_sod')?.cnt     ?? 0),
    missingActions: Number(gapRows.find(r => r.gap_type === 'missing_action')?.cnt ?? 0),
    totalGaps:      gapRows.reduce((s, r) => s + Number(r.cnt), 0),
    humanCount:  bySource['human']  ?? 0,
    aiCount:     bySource['ai']     ?? 0,
    matchedCount: Number((await query(
      "SELECT COUNT(*) AS cnt FROM pre_fmea_items WHERE session_id = $1 AND source = 'merged' AND human_override IS NOT NULL",
      [id],
    ))[0]?.cnt ?? 0),
    gaps: [],
  } : null

  return NextResponse.json({ session: sessions[0] ?? null, docs, items, gapSummary })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const fields = Object.keys(body)
  if (!fields.length) return NextResponse.json({ error: 'no fields' }, { status: 400 })
  const setClauses = fields.map((f, i) => `"${f}" = $${i + 2}`).join(', ')
  const values = fields.map(f => (body as Record<string, unknown>)[f])
  await execute(
    `UPDATE pre_fmea_sessions SET ${setClauses}, updated_at = now() WHERE id = $1`,
    [id, ...values],
  )
  return new NextResponse(null, { status: 204 })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  await execute('DELETE FROM pre_fmea_sessions WHERE id = $1', [id])
  return new NextResponse(null, { status: 204 })
}
