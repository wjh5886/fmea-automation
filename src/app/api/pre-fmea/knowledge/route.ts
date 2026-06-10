import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

export async function GET() {
  try {
    const rows = await query(
      `SELECT id, content, content_type, quality_score, usage_count, metadata, created_at
       FROM pre_fmea_knowledge
       ORDER BY usage_count DESC, quality_score DESC, created_at DESC`,
      [],
    )
    return NextResponse.json(rows)
  } catch (e) {
    console.error('[knowledge GET]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await execute('DELETE FROM pre_fmea_knowledge WHERE id = $1', [id])
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error('[knowledge DELETE]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
