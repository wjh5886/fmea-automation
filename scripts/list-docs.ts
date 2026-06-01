import { query } from '../src/lib/db.js'

const rows = await query(`
  SELECT doc_type, filename, storage_path
  FROM pre_fmea_documents 
  WHERE session_id='263a3e7c-460a-4a2f-998d-99f079137c3f'
  ORDER BY doc_type, created_at
`, [])

for (const r of rows) {
  console.log(`[${r.doc_type}] ${r.filename}`)
  console.log(`  → ${r.storage_path}`)
}

process.exit(0)
