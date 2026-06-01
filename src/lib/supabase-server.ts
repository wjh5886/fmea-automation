import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const USE_LOCAL = !process.env.SUPABASE_SERVICE_ROLE_KEY
const LOCAL_DIR = process.env.UPLOAD_DIR ?? './data/uploads'

// ── Local filesystem fallback ─────────────────────────────────────────────────
function localPath(storagePath: string) {
  return path.join(LOCAL_DIR, storagePath)
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

// ── Supabase client ───────────────────────────────────────────────────────────
function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const BUCKET = 'fmea-uploads'

// ── Storage API ───────────────────────────────────────────────────────────────
export async function storageUpload(storagePath: string, buffer: Buffer, mimeType?: string) {
  if (USE_LOCAL) {
    const fp = localPath(storagePath)
    ensureDir(fp)
    fs.writeFileSync(fp, buffer)
    return
  }
  const sb = getSupabaseServer()
  const { error } = await sb.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mimeType ?? 'application/octet-stream',
    upsert: true,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

export async function storageDownload(storagePath: string): Promise<Buffer> {
  if (USE_LOCAL) {
    const fp = localPath(storagePath)
    if (!fs.existsSync(fp)) throw new Error(`File not found: ${storagePath}`)
    return fs.readFileSync(fp)
  }
  const sb = getSupabaseServer()
  const { data, error } = await sb.storage.from(BUCKET).download(storagePath)
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}

export async function storageDelete(storagePath: string) {
  if (USE_LOCAL) {
    const fp = localPath(storagePath)
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    return
  }
  const sb = getSupabaseServer()
  await sb.storage.from(BUCKET).remove([storagePath])
}
