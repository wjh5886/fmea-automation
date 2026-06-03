import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { storageDownload } from '@/lib/supabase-server'
import { parseIcdExcel } from '@/lib/icd-parser'

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    // Find the uploaded ICD document for this session
    const icdDocs = await query(
      "SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'icd_file' ORDER BY created_at DESC LIMIT 1",
      [session_id],
    )
    if (!icdDocs.length) {
      return NextResponse.json({ error: 'ICD 파일이 업로드되지 않았습니다.' }, { status: 400 })
    }
    const doc = icdDocs[0]

    // Download and parse
    const buf = await storageDownload(String(doc.storage_path))
    const vars = await parseIcdExcel(buf)

    if (!vars.length) {
      return NextResponse.json({ error: 'ICD 파일에서 변수를 찾을 수 없습니다. 헤더 행(변수명, Variable 등)이 있는지 확인하세요.' }, { status: 422 })
    }

    // Replace existing variables for this session
    await execute('DELETE FROM pre_fmea_icd_variables WHERE session_id = $1', [session_id])

    for (const v of vars) {
      await query(
        `INSERT INTO pre_fmea_icd_variables
         (session_id, sw_component, variable_name, variable_type, direction, data_type, signal_range, unit, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [session_id, v.sw_component, v.variable_name, v.variable_type, v.direction,
         v.data_type, v.signal_range, v.unit, v.description, v.sort_order],
      )
    }

    // Return summary grouped by component
    const groups: Record<string, number> = {}
    for (const v of vars) {
      const k = v.sw_component ?? '(컴포넌트 미지정)'
      groups[k] = (groups[k] ?? 0) + 1
    }

    return NextResponse.json({
      count: vars.length,
      components: Object.entries(groups).map(([name, cnt]) => ({ name, count: cnt })),
      filename: doc.filename,
    })
  } catch (e) {
    console.error('[pre-fmea/icd-parse]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET: return cached variables for a session
export async function GET(req: NextRequest) {
  const session_id = req.nextUrl.searchParams.get('session_id')
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

  const vars = await query(
    'SELECT * FROM pre_fmea_icd_variables WHERE session_id = $1 ORDER BY sort_order',
    [session_id],
  )

  const groups: Record<string, Record<string, unknown>[]> = {}
  for (const v of vars) {
    const k = String(v.sw_component ?? '(미지정)')
    if (!groups[k]) groups[k] = []
    groups[k].push(v)
  }

  return NextResponse.json({ count: vars.length, groups })
}
