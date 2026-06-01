import { NextRequest, NextResponse } from 'next/server'
import { storageDownload } from '@/lib/supabase-server'

type Params = { params: Promise<{ path: string[] }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { path } = await params
  const storagePath = path.join('/')
  try {
    const buf = await storageDownload(storagePath)
    return new NextResponse(buf.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
