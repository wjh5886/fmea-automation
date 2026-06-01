import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { storageDelete } from '@/lib/supabase-server'

export async function DELETE(req: NextRequest) {
  const { doc_id } = await req.json()
  if (!doc_id) return NextResponse.json({ error: 'doc_id required' }, { status: 400 })

  const doc = await queryOne<{ storage_path: string }>(
    'SELECT storage_path FROM pre_fmea_documents WHERE id = $1', [doc_id],
  )
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (doc.storage_path) {
    await storageDelete(doc.storage_path).catch(() => null)
  }

  await execute('DELETE FROM pre_fmea_documents WHERE id = $1', [doc_id])
  return new NextResponse(null, { status: 204 })
}
