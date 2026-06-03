/**
 * ICD 자동 생성: DBC + 아키텍처 docx + SW 설계사양서 3종 매칭으로 ICD 변수 생성.
 * ICD 파일이 없을 때 대체 경로.
 *
 * 매칭 우선순위:
 *   1. 아키텍처 인터페이스 → 변수명/방향/컴포넌트 결정
 *   2. DBC 파일 → CAN 신호 메타데이터(범위, 단위, 주기) 보강
 *   3. 설계사양서(spec) → 신호명 언급 구간 추출 → description 보강
 */
import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { query, execute } from '@/lib/db'
import { storageDownload } from '@/lib/supabase-server'
import {
  parseDbcRich,
  parseArchInterfaces,
  buildIcdFromArch,
  isValidVariableName,
  type BuiltIcdVariable,
} from '@/lib/arch-parser'

async function saveVariables(session_id: string, vars: BuiltIcdVariable[]): Promise<void> {
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
}

// 설계사양서에서 신호명 언급 구간을 추출하여 1줄 설명 반환
function extractSignalDescFromSpec(specText: string, signalName: string): string | null {
  if (!specText || !signalName) return null
  const lines = specText.split('\n')
  const re = new RegExp(`\\b${signalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const idx = lines.findIndex(l => re.test(l))
  if (idx < 0) return null
  // 해당 줄 + 다음 2줄을 합쳐 최대 120자
  const snippet = lines.slice(idx, idx + 3).join(' ').replace(/\s+/g, ' ').trim()
  return snippet.length > 10 ? snippet.slice(0, 120) : null
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    const sessions = await query('SELECT * FROM pre_fmea_sessions WHERE id = $1', [session_id])
    if (!sessions.length) return NextResponse.json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })

    // 1. 문서 일괄 조회 (아키텍처 필수, DBC + 사양서 선택)
    const [archDocs, dbcDocs, specDocs] = await Promise.all([
      query("SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'architecture' ORDER BY created_at", [session_id]),
      query("SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'dbc_file' ORDER BY created_at DESC LIMIT 1", [session_id]),
      query("SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'design_spec' ORDER BY created_at", [session_id]),
    ])

    if (!archDocs.length) {
      return NextResponse.json({ error: '시스템 아키텍처 파일이 업로드되지 않았습니다.' }, { status: 400 })
    }

    // 2. DBC 파싱
    const dbcFilename = dbcDocs.length ? String(dbcDocs[0].filename ?? '') : null
    const dbcMap: ReturnType<typeof parseDbcRich> = dbcDocs.length
      ? parseDbcRich((await storageDownload(String(dbcDocs[0].storage_path))).toString('utf-8'))
      : new Map()

    // 3. 아키텍처 문서 파싱
    const allInterfaces: ReturnType<typeof parseArchInterfaces> = []
    const archFilenames: string[] = []
    for (const doc of archDocs) {
      const buf = await storageDownload(String(doc.storage_path))
      const filename = String(doc.filename ?? '')
      archFilenames.push(filename)
      let text = ''
      if (filename.toLowerCase().match(/\.docx?$/)) {
        const result = await mammoth.extractRawText({ buffer: buf })
        text = result.value
      } else {
        text = buf.toString('utf-8')
      }
      allInterfaces.push(...parseArchInterfaces(text))
    }

    if (!allInterfaces.length) {
      return NextResponse.json({ error: '아키텍처 파일에서 인터페이스를 추출할 수 없습니다. docx 형식인지 확인하세요.' }, { status: 422 })
    }

    // 4. ICD 변수 빌드 + 유효성 필터
    const vars = buildIcdFromArch(allInterfaces, dbcMap)
      .filter(v => isValidVariableName(v.variable_name))

    if (!vars.length) {
      return NextResponse.json({ error: 'ICD 변수를 생성하지 못했습니다.' }, { status: 422 })
    }

    // 5. 설계사양서에서 신호 설명 보강 (텍스트 검색 기반, Claude API 불필요)
    let specText = ''
    let specEnrichCount = 0
    if (specDocs.length) {
      const parts: string[] = []
      for (const doc of specDocs) {
        const buf = await storageDownload(String(doc.storage_path))
        const filename = String(doc.filename ?? '')
        if (filename.toLowerCase().match(/\.docx?$/)) {
          const result = await mammoth.extractRawText({ buffer: buf })
          parts.push(result.value)
        } else if (!filename.toLowerCase().endsWith('.pdf')) {
          parts.push(buf.toString('utf-8'))
        }
      }
      specText = parts.join('\n')

      for (const v of vars) {
        const specDesc = extractSignalDescFromSpec(specText, v.variable_name)
        if (specDesc) {
          v.description = v.description
            ? `${v.description} | [사양서] ${specDesc}`
            : `[사양서] ${specDesc}`
          specEnrichCount++
        }
      }
    }

    // 6. DB 저장
    await saveVariables(session_id, vars)

    // 7. 통계
    const byComp: Record<string, number> = {}
    const byType: Record<string, number> = {}
    let dbcMatchCount = 0
    for (const v of vars) {
      byComp[v.sw_component] = (byComp[v.sw_component] ?? 0) + 1
      byType[v.variable_type] = (byType[v.variable_type] ?? 0) + 1
      if (v.description.includes('[DBC:')) dbcMatchCount++
    }

    return NextResponse.json({
      count: vars.length,
      source: 'arch+dbc+spec',
      archFiles: archFilenames,
      dbcFile: dbcFilename,
      dbcMatchCount,
      specEnrichCount,
      interfaceCount: allInterfaces.length,
      components: Object.entries(byComp)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      typeDistribution: byType,
    })
  } catch (e) {
    console.error('[pre-fmea/icd-build]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
