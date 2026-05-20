import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── 고장 모드 정의 ──────────────────────────────────────────────────────────
const CONCEPT_MODES: Record<string, string> = {
  LESS:    '{func}이(가) 요구 시점에 수행되지 않음 [기능 미수행]',
  CORRUPT: '{func}이(가) 부정확하게 수행됨 — 잘못된 결과 생성 [기능 부정확]',
  MORE:    '{func}이(가) 요청 없이 또는 잘못된 조건에서 수행됨 [비의도적 수행]',
  LATE:    '{func}이(가) 규정 시간보다 늦게 수행됨 [기능 지연]',
}

const CONCEPT_SEV: Record<string, Record<string, number>> = {
  Safety:        { LESS: 9, CORRUPT: 8, MORE: 10, LATE: 8 },
  Control:       { LESS: 7, CORRUPT: 7, MORE: 8,  LATE: 6 },
  Monitor:       { LESS: 5, CORRUPT: 5, MORE: 4,  LATE: 4 },
  Communication: { LESS: 6, CORRUPT: 6, MORE: 6,  LATE: 7 },
  Default:       { LESS: 6, CORRUPT: 6, MORE: 7,  LATE: 5 },
}
const CONCEPT_OCC: Record<string, number> = { LESS: 3, CORRUPT: 4, MORE: 2, LATE: 3 }
const CONCEPT_DET: Record<string, number> = { LESS: 4, CORRUPT: 5, MORE: 7, LATE: 5 }

// ── PDF 텍스트에서 기능 추출 (휴리스틱) ──────────────────────────────────────
const BOILERPLATE = ['본 문서', 'SL CORPORATION', '현대자동차', '기아', 'UTC+9',
  '비밀유지', '무단 전재', '정보자산', 'Page ', 'Export of', 'Produced by', 'Exported from']
const SKIP_SECTIONS = ['I/O Table', 'Data Flow', '상세 Description', '개요', '목적',
  '약어', '참조 문서', '시스템 개요', '외부 인터페이스', '내부 인터페이스']

function extractFunctionsHeuristic(text: string): Array<{ name: string; description: string; category: string }> {
  const funcs: Array<{ name: string; description: string; category: string }> = []
  const seen = new Set<string>()

  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.length < 5 || t.length > 120) continue
    if (BOILERPLATE.some(b => t.includes(b))) continue
    if (SKIP_SECTIONS.some(s => t.includes(s))) continue

    // N.N 섹션 패턴 (예: "3.1 기어 위치 제어")
    const secMatch = t.match(/^\d+\.\d+\s+(.+)/)
    if (secMatch) {
      const name = secMatch[1]
        .replace(/\.{3,}.*$/, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      if (name.length > 4 && name.length < 60 && !seen.has(name)) {
        seen.add(name)
        const cat = name.includes('안전') || name.includes('Safety') ? 'Safety'
          : name.includes('통신') || name.includes('CAN') ? 'Communication'
          : name.includes('진단') || name.includes('모니터') ? 'Monitor'
          : 'Control'
        funcs.push({ name, description: `${name} 기능`, category: cat })
      }
    }
  }

  return funcs.slice(0, 30)
}

// ── AI로 기능 추출 ────────────────────────────────────────────────────────────
async function extractFunctionsAI(text: string, projectName: string): Promise<Array<{ name: string; description: string; category: string }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('no key')

  const client = new Anthropic({ apiKey, timeout: 20000, maxRetries: 0 })
  const sample = text.slice(0, 8000)

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `다음은 ${projectName} 제어기능사양서 일부입니다. SW 기능(Function) 목록을 JSON 배열로 추출하세요.
각 항목: {"name":"기능명","description":"한줄설명","category":"Safety|Control|Monitor|Communication"}
Safety=안전관련, Control=제어, Monitor=진단/모니터링, Communication=통신
최대 20개, JSON만 반환.

${sample}`,
    }],
  })

  const raw = (msg.content[0] as { text: string }).text
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('parse failed')
  return JSON.parse(match[0])
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const projectName  = formData.get('project_name') as string
  const vehicleModel = formData.get('vehicle_model') as string
  const specFile     = formData.get('spec_file') as File | null
  const functionsJson = formData.get('functions_json') as string ?? '[]'

  // 1. PDF 파싱
  let docText = ''
  if (specFile && specFile.size > 0) {
    const buf = Buffer.from(await specFile.arrayBuffer())
    const ext = specFile.name.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') {
      const pdfParse = await import('pdf-parse')
      const parseFn = (pdfParse as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default ?? pdfParse
      const data = await parseFn(buf)
      docText = data.text
    } else if (ext === 'txt') {
      docText = buf.toString('utf-8')
    }
  }

  // 2. 기능 추출
  let functions: Array<{ name: string; description: string; category: string }> = JSON.parse(functionsJson)
  if (functions.length === 0 && docText) {
    try {
      functions = await extractFunctionsAI(docText, projectName)
    } catch {
      functions = extractFunctionsHeuristic(docText)
    }
  }
  if (functions.length === 0) {
    return NextResponse.json({ error: '기능을 추출할 수 없습니다. 기능을 직접 입력해주세요.' }, { status: 400 })
  }

  // 3. Supabase 프로젝트 생성
  const { data: proj, error: projErr } = await sb.from('projects').insert({
    name: projectName, vehicle_model: vehicleModel,
    description: `개념 FMEA — ${specFile?.name ?? '수동입력'}`,
  }).select('id').single()
  if (projErr || !proj) return NextResponse.json({ error: projErr?.message }, { status: 500 })
  const projectId = proj.id

  // 4. SW 유닛 생성 (카테고리별)
  const categories = [...new Set(functions.map(f => f.category))]
  const unitMap: Record<string, string> = {}
  for (const cat of categories) {
    const { data: unit } = await sb.from('sw_units').insert({
      project_id: projectId,
      name: `${cat}_Functions`,
      description: `${cat} 카테고리 기능`,
    }).select('id').single()
    if (unit) unitMap[cat] = unit.id
  }

  // 5. FMEA 항목 삽입
  const rows = []
  for (const func of functions) {
    const sevTable = CONCEPT_SEV[func.category] ?? CONCEPT_SEV.Default
    const dbCat = func.category === 'Communication' ? 'External' : 'Internal'
    for (const fm of Object.keys(CONCEPT_MODES)) {
      rows.push({
        project_id: projectId,
        sw_unit_id: unitMap[func.category] ?? null,
        category: dbCat,
        variable_name: func.name,
        variable_type: func.category,
        failure_mode: fm,
        failure_detail: CONCEPT_MODES[fm].replace('{func}', func.name),
        potential_cause: fm === 'LESS'    ? 'SW 로직 오류, 입력 신호 누락, 전원/통신 장애'
                       : fm === 'CORRUPT' ? '연산 로직 결함, 잘못된 파라미터, 센서 오류'
                       : fm === 'MORE'    ? '상태 머신 오류, 조건 검사 누락, 경쟁 조건(race condition)'
                       :                   'CPU 과부하, 통신 지연, 타이머 설정 오류',
        effect_system: `${func.name} ${fm === 'LESS' ? '미수행으로 인한 시스템 기능 상실'
                       : fm === 'CORRUPT' ? '오동작으로 인한 잘못된 시스템 상태'
                       : fm === 'MORE'    ? '비의도적 수행으로 인한 시스템 오류'
                       :                   '지연 수행으로 인한 타이밍 오류'}`,
        severity:   sevTable[fm],
        occurrence: CONCEPT_OCC[fm],
        detection:  CONCEPT_DET[fm],
        preventive_action: '설계 검토(Design Review), 코드 정적 분석, 단위 테스트',
        ai_generated: false,
        status: 'draft',
      })
    }
  }

  const { error: insertErr } = await sb.from('fmea_items').insert(rows)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({
    project_id: projectId,
    functions: functions.length,
    items: rows.length,
    status: 'done',
  })
}
