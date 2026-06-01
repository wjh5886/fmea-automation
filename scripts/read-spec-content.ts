/**
 * 업로드된 설계사양서 텍스트를 읽어 콘솔에 출력.
 * Supabase Storage에서 다운로드 후 mammoth로 docx 추출.
 */
import mammoth from 'mammoth'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: resolve(__dirname, '../.env.local') })

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db',
    ssl: false,
  })

  // 문서 목록 조회
  const res = await pool.query(`
    SELECT doc_type, filename, storage_path
    FROM pre_fmea_documents
    WHERE session_id = $1
    ORDER BY doc_type, created_at
  `, [SESSION_ID])

  console.log('\n=== 업로드된 문서 목록 ===')
  for (const r of res.rows) {
    console.log(`[${r.doc_type}] ${r.filename}`)
    console.log(`  storage_path: ${r.storage_path}`)
  }

  const specDocs = res.rows.filter((r: any) => r.doc_type === 'design_spec')
  if (!specDocs.length) {
    console.log('\n❌ 설계사양서(design_spec)가 없습니다.')
    await pool.end()
    return
  }

  // Supabase 연결
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.log('\n⚠ Supabase 환경변수 없음 — .env.local 확인 필요')
    await pool.end()
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  for (const doc of specDocs) {
    console.log(`\n\n${'='.repeat(80)}`)
    console.log(`파일: ${doc.filename}`)
    console.log('='.repeat(80))

    const { data, error } = await supabase.storage
      .from('fmea-documents')
      .download(doc.storage_path)

    if (error || !data) {
      console.log(`❌ 다운로드 실패: ${error?.message}`)
      continue
    }

    const buf = Buffer.from(await data.arrayBuffer())
    const filename: string = doc.filename ?? ''

    let text = ''
    if (filename.toLowerCase().match(/\.docx?$/)) {
      const result = await mammoth.extractRawText({ buffer: buf })
      text = result.value
    } else {
      text = buf.toString('utf-8')
    }

    console.log(text.slice(0, 50000))  // 최대 50000자 출력
    if (text.length > 50000) {
      console.log(`\n... (총 ${text.length}자, 처음 50000자만 표시)`)
    }
  }

  await pool.end()
}

main().catch(console.error)
