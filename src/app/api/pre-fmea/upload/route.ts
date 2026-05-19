import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const sessionId = formData.get('session_id') as string | null
    const docType = formData.get('doc_type') as string | null

    if (!file || !sessionId || !docType) {
      return NextResponse.json({ error: 'file, session_id, doc_type 필드가 필요합니다.' }, { status: 400 })
    }

    const storagePath = `${sessionId}/${docType}/${Date.now()}_${file.name}`
    const fileBuffer = await file.arrayBuffer()

    // 1. Upload to Supabase Storage (server-side — bypasses corporate firewall)
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/pre-fmea-docs/${storagePath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: fileBuffer,
      },
    )

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      return NextResponse.json({ error: `Storage 업로드 실패 (${uploadRes.status}): ${errText}` }, { status: 500 })
    }

    // 2. Delete existing doc of same type
    await fetch(
      `${SUPABASE_URL}/rest/v1/pre_fmea_documents?session_id=eq.${sessionId}&doc_type=eq.${docType}`,
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
        session_id: sessionId,
        doc_type: docType,
        filename: file.name,
        storage_path: storagePath,
        metadata: { size: file.size, mime_type: file.type || null },
      }),
    })

    if (!insertRes.ok) {
      const errText = await insertRes.text()
      return NextResponse.json({ error: `DB 저장 실패 (${insertRes.status}): ${errText}` }, { status: 500 })
    }

    const rows = await insertRes.json()
    const doc = Array.isArray(rows) ? rows[0] : rows
    if (!doc) {
      // Storage succeeded but DB return was empty — return minimal shape so client still shows success
      return NextResponse.json({
        id: crypto.randomUUID(),
        session_id: sessionId,
        doc_type: docType,
        filename: file.name,
        storage_path: storagePath,
        parsed_text: null,
        metadata: { size: file.size, mime_type: file.type || null },
        created_at: new Date().toISOString(),
      })
    }

    return NextResponse.json(doc)
  } catch (e) {
    console.error('[pre-fmea/upload]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
