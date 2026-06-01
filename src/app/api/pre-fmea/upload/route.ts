import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { storageUpload } from '@/lib/supabase-server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { session_id, doc_type, filename, mime_type, size, data_base64 } = await req.json()

    if (!session_id || !doc_type || !filename || !data_base64) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 })
    }

    const safeFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._\-가-힣]/g, '_')}`
    const storagePath = `${session_id}/${doc_type}/${safeFilename}`

    const fileBuffer = Buffer.from(data_base64, 'base64')
    await storageUpload(storagePath, fileBuffer, mime_type ?? undefined)

    // design_spec, architecture는 누적 / 나머지는 교체
    const ACCUMULATE = new Set(['design_spec', 'architecture'])
    if (!ACCUMULATE.has(doc_type)) {
      await execute(
        'DELETE FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = $2',
        [session_id, doc_type],
      )
    }

    const doc = await queryOne(
      `INSERT INTO pre_fmea_documents (session_id, doc_type, filename, storage_path, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [session_id, doc_type, filename, storagePath,
       JSON.stringify({ size: size ?? fileBuffer.length, mime_type: mime_type ?? null })],
    )

    return NextResponse.json(doc)
  } catch (e) {
    console.error('[pre-fmea/upload]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
