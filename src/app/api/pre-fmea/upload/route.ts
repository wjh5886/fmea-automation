import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function POST(req: NextRequest) {
  try {
    const { session_id, doc_type, filename, mime_type, size, data_base64 } = await req.json()

    if (!session_id || !doc_type || !filename || !data_base64) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 })
    }

    const fileBuffer = Buffer.from(data_base64, 'base64')
    const storagePath = `${session_id}/${doc_type}/${Date.now()}_${filename}`

    // 1. Upload to Supabase Storage (server-side)
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/pre-fmea-docs/${storagePath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': mime_type || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: fileBuffer,
      },
    )

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      return NextResponse.json(
        { error: `Storage 업로드 실패 (${uploadRes.status}): ${errText}` },
        { status: 500 },
      )
    }

    // 2. Delete existing doc of same type
    await fetch(
      `${SUPABASE_URL}/rest/v1/pre_fmea_documents?session_id=eq.${session_id}&doc_type=eq.${doc_type}`,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    )

    // 3. Insert document record
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pre_fmea_documents`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        session_id,
        doc_type,
        filename,
        storage_path: storagePath,
        metadata: { size: size ?? fileBuffer.length, mime_type: mime_type || null },
      }),
    })

    if (!insertRes.ok) {
      const errText = await insertRes.text()
      return NextResponse.json(
        { error: `DB 저장 실패 (${insertRes.status}): ${errText}` },
        { status: 500 },
      )
    }

    const rows = await insertRes.json()
    const doc = Array.isArray(rows) ? rows[0] : rows

    return NextResponse.json(
      doc ?? {
        id: crypto.randomUUID(),
        session_id,
        doc_type,
        filename,
        storage_path: storagePath,
        parsed_text: null,
        metadata: { size: size ?? fileBuffer.length, mime_type: mime_type || null },
        created_at: new Date().toISOString(),
      },
    )
  } catch (e) {
    console.error('[pre-fmea/upload]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
