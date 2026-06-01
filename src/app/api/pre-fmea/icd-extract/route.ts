import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { query, execute, getPool } from '@/lib/db'
import { storageDownload } from '@/lib/supabase-server'
import { parseDbcBuffer } from '@/lib/dbc-parser'
import type { IcdVariable } from '@/lib/icd-parser'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function saveVariables(session_id: string, vars: IcdVariable[]): Promise<void> {
  await execute('DELETE FROM pre_fmea_icd_variables WHERE session_id = $1', [session_id])
  const pool = getPool()
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    for (const v of vars) {
      await dbClient.query(
        `INSERT INTO pre_fmea_icd_variables
         (session_id, sw_component, variable_name, variable_type, direction, data_type, signal_range, unit, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [session_id, v.sw_component, v.variable_name, v.variable_type, v.direction,
         v.data_type, v.signal_range, v.unit, v.description, v.sort_order],
      )
    }
    await dbClient.query('COMMIT')
  } catch (e) {
    await dbClient.query('ROLLBACK')
    throw e
  } finally {
    dbClient.release()
  }
}

// ── DBC 기반 추출 ─────────────────────────────────────────────────────────────
async function extractFromDbc(session_id: string): Promise<NextResponse> {
  const dbcDocs = await query(
    "SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'dbc_file' ORDER BY created_at DESC LIMIT 1",
    [session_id],
  )
  if (!dbcDocs.length) {
    return NextResponse.json({ error: 'DBC 파일이 업로드되지 않았습니다.' }, { status: 400 })
  }

  const buf = await storageDownload(String(dbcDocs[0].storage_path))
  const vars = parseDbcBuffer(buf)

  if (!vars.length) {
    return NextResponse.json({ error: 'DBC 파일에서 시그널을 찾을 수 없습니다.' }, { status: 422 })
  }

  await saveVariables(session_id, vars)

  const groups: Record<string, number> = {}
  for (const v of vars) {
    const k = v.sw_component ?? '(미지정)'
    groups[k] = (groups[k] ?? 0) + 1
  }

  return NextResponse.json({
    count: vars.length,
    source: 'dbc',
    filename: String(dbcDocs[0].filename),
    components: Object.entries(groups).map(([name, count]) => ({ name, count })),
  })
}

// ── 설계사양서 AI 추출 ────────────────────────────────────────────────────────
async function extractFromSpec(session_id: string, itemName: string): Promise<NextResponse> {
  const specDocs = await query(
    "SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'design_spec' ORDER BY created_at",
    [session_id],
  )
  if (!specDocs.length) {
    return NextResponse.json({ error: 'SW 설계사양서가 업로드되지 않았습니다.' }, { status: 400 })
  }

  // 텍스트 추출 (PDF 제외 — 텍스트만으로도 충분)
  const parts: string[] = []
  for (const doc of specDocs) {
    const buf = await storageDownload(String(doc.storage_path))
    const filename = String(doc.filename ?? '')
    if (filename.toLowerCase().match(/\.docx?$/)) {
      const result = await mammoth.extractRawText({ buffer: buf })
      parts.push(`=== ${filename} ===\n${result.value}`)
    } else if (!filename.toLowerCase().endsWith('.pdf')) {
      parts.push(`=== ${filename} ===\n${buf.toString('utf-8')}`)
    }
  }

  if (!parts.length) {
    return NextResponse.json({ error: '텍스트 추출 가능한 설계사양서가 없습니다 (PDF는 지원하지 않음).' }, { status: 422 })
  }

  const specText = parts.join('\n\n').slice(0, 30000) // 토큰 제한

  const prompt = `아래는 [${itemName}] 시스템의 SW 설계사양서입니다.
이 문서에서 SW 컴포넌트 간 인터페이스 변수(신호, 함수 인자, 공유 메모리 변수 등)를 모두 추출하세요.

[설계사양서]
${specText}

[출력 형식]
JSON 배열만 출력하세요 (마크다운·설명 없이):
[
  {
    "sw_component": "변수를 소유하거나 송신하는 SW 컴포넌트명",
    "variable_name": "변수명 또는 시그널명 (원문 그대로)",
    "variable_type": "Input 또는 Output 또는 Internal",
    "data_type": "uint8 / bool / float32 / sint16 등 (모르면 null)",
    "signal_range": "유효 범위 예: 0~7 (모르면 null)",
    "unit": "단위 예: rpm, deg, % (없으면 null)",
    "description": "변수 설명 한 줄 (문서에서 발췌)"
  }
]

[규칙]
- 문서에 명시된 변수/신호만 포함하세요. 추측으로 만들지 마세요.
- 변수명은 원문 표기를 그대로 사용하세요.
- 동일 변수가 여러 컴포넌트에 나오면 송신(Output) 측 컴포넌트를 sw_component로 사용하세요.
- 최소 10개 이상 추출하세요.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
  let extracted: Record<string, unknown>[]
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    extracted = JSON.parse(cleaned)
    if (!Array.isArray(extracted)) throw new Error('Expected array')
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText.slice(0, 300) }, { status: 500 })
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const vars: IcdVariable[] = extracted
    .filter(it => str(it.variable_name))
    .map((it, i) => ({
      sw_component:  str(it.sw_component),
      variable_name: str(it.variable_name)!,
      variable_type: str(it.variable_type),
      direction:     null,
      data_type:     str(it.data_type),
      signal_range:  str(it.signal_range),
      unit:          str(it.unit),
      description:   str(it.description),
      sort_order:    i,
    }))

  await saveVariables(session_id, vars)

  const groups: Record<string, number> = {}
  for (const v of vars) {
    const k = v.sw_component ?? '(미지정)'
    groups[k] = (groups[k] ?? 0) + 1
  }

  return NextResponse.json({
    count: vars.length,
    source: 'spec',
    components: Object.entries(groups).map(([name, count]) => ({ name, count })),
  })
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { session_id, source } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })
    if (source !== 'dbc' && source !== 'spec') {
      return NextResponse.json({ error: 'source must be "dbc" or "spec"' }, { status: 400 })
    }

    const sessions = await query('SELECT * FROM pre_fmea_sessions WHERE id = $1', [session_id])
    if (!sessions.length) return NextResponse.json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
    const itemName = String(sessions[0].item_name ?? 'SBW')

    if (source === 'dbc')  return extractFromDbc(session_id)
    return extractFromSpec(session_id, itemName)
  } catch (e) {
    console.error('[pre-fmea/icd-extract]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
