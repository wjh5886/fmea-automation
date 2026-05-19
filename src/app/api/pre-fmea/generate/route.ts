import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Supabase helpers (server-side, no proxy) ──────────────────────────────────
async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })
  return res.json()
}

async function sbPatch(path: string, body: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
}

async function sbInsert(table: string, rows: Record<string, unknown>[]) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  })
}

// ── File download from Storage ────────────────────────────────────────────────
async function downloadFile(storagePath: string): Promise<Buffer> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/pre-fmea-docs/${storagePath}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  )
  if (!res.ok) throw new Error(`Storage download failed: ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

// ── Parse document ────────────────────────────────────────────────────────────
async function parseDocx(buf: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf })
  return result.value
}

// ── Build Claude messages for PDF or text ────────────────────────────────────
type ClaudeMessage = Anthropic.Messages.MessageParam

function buildMessages(filename: string, buf: Buffer, mime: string): ClaudeMessage[] {
  const isPdf = mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    return [{
      role: 'user',
      content: [
        {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: buf.toString('base64'),
          },
        },
        { type: 'text', text: FMEA_PROMPT },
      ],
    }]
  }

  return [{
    role: 'user',
    content: `${FMEA_PROMPT}\n\n--- 설계사양서 내용 ---\n${buf.toString('utf-8')}`,
  }]
}

// ── FMEA generation prompt ─────────────────────────────────────────────────────
const FMEA_PROMPT = `당신은 ISO 26262 인증 전문가이자 SW FMEA 전문가입니다.
위에 제공된 SW 설계사양서를 분석하여 체계적인 사전 FMEA 항목을 생성해주세요.

## 분석 기준

### HAZOP Guide Words (SW 고장 형태)
- MORE: 입력/출력 값이 정상 범위보다 크거나 높은 경우
- LESS: 입력/출력 값이 정상 범위보다 작거나 낮은 경우
- CORRUPT: 데이터가 손상되거나 잘못된 값을 포함하는 경우
- EARLY: 이벤트/신호가 예상보다 빨리 발생하는 경우
- LATE: 이벤트/신호가 예상보다 늦게 발생하는 경우
- STUCK: 값이 변하지 않고 고착되는 경우
- ERRATIC: 값이 불규칙하거나 예측 불가능하게 변동하는 경우

### Severity (심각도, S) 기준 (1~10)
- 10: 안전 관련 사고 (충돌, 부상, 사망)
- 7~9: 시스템 기능 상실 (핵심 기능 불가)
- 4~6: 성능 저하 (부분 기능 손상)
- 1~3: 미미한 영향 (사용자 불편 수준)

### Occurrence (발생도, O) 기준 (1~10)
- 9~10: 빈번히 발생 (≥1회/1000시간)
- 6~8: 가끔 발생
- 3~5: 드물게 발생
- 1~2: 거의 발생 안 함

### Detection (검출도, D) 기준 (1~10)
- 1~2: 확실한 자동 감지 (진단 커버리지 ≥99%)
- 3~4: 높은 감지 가능성
- 5~6: 보통 수준의 감지
- 7~8: 낮은 감지 가능성
- 9~10: 감지 불가 (런타임 진단 없음)

## 출력 형식

반드시 아래 JSON 배열만 출력하세요 (설명이나 마크다운 없이):

[
  {
    "sw_component": "SW 컴포넌트명 (예: TorqueSensor_Driver)",
    "function_name": "해당 기능명 (한국어, 명사형)",
    "failure_mode": "MORE|LESS|CORRUPT|EARLY|LATE|STUCK|ERRATIC 중 하나",
    "failure_detail": "구체적인 고장 내용 (한국어, 1~2문장)",
    "effect_local": "모듈 수준 영향 (한국어, 1문장)",
    "effect_system": "시스템/차량 수준 영향 (한국어, 1문장)",
    "potential_cause": "잠재적 원인 (한국어, 1~2문장)",
    "severity": 숫자(1~10),
    "occurrence": 숫자(1~10),
    "detection": 숫자(1~10),
    "preventive_action": "예방 설계 조치 (한국어, 1문장)",
    "detection_action": "검출/진단 방법 (한국어, 1문장)",
    "confidence_score": 0.0~1.0 (이 항목의 AI 분석 확신도)
  }
]

## 요구사항
- 설계사양서에 있는 각 SW 기능/모듈에 대해 모든 적용 가능한 HAZOP guide word를 적용하세요
- 최소 15개 이상의 FMEA 항목을 생성하세요
- 안전 관련 기능은 반드시 포함하세요
- ISO 26262 ASIL 요구사항을 고려하세요
- 각 항목의 confidence_score는 설계사양서에서 해당 기능 정보를 얼마나 명확하게 파악했는지를 나타냅니다`

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    // 1. Fetch session and design-spec document
    const [sessions, docs] = await Promise.all([
      sbGet(`pre_fmea_sessions?id=eq.${session_id}&select=*`),
      sbGet(`pre_fmea_documents?session_id=eq.${session_id}&doc_type=eq.design_spec&select=*`),
    ])

    const session = sessions?.[0]
    const specDoc = docs?.[0]

    if (!session) return NextResponse.json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
    if (!specDoc) return NextResponse.json({ error: 'SW 설계사양서가 업로드되어 있지 않습니다.' }, { status: 400 })
    if (!specDoc.storage_path) return NextResponse.json({ error: '문서 경로가 없습니다.' }, { status: 400 })

    // 2. Download file from Storage
    const fileBuf = await downloadFile(specDoc.storage_path)
    const filename: string = specDoc.filename ?? ''
    const mime: string = specDoc.metadata?.mime_type ?? ''

    // 3. Build Claude messages (parse DOCX to text, PDF stays as document)
    let messages: ClaudeMessage[]
    if (filename.toLowerCase().endsWith('.docx') || filename.toLowerCase().endsWith('.doc')) {
      const text = await parseDocx(fileBuf)
      messages = [{
        role: 'user',
        content: `${FMEA_PROMPT}\n\n--- 설계사양서 내용 ---\n${text}`,
      }]
    } else {
      messages = buildMessages(filename, fileBuf, mime)
    }

    // 4. Call Claude API
    const aiResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages,
    })

    const rawText = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : ''

    // 5. Parse JSON (strip markdown fences if present)
    let aiItems: Record<string, unknown>[]
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      aiItems = JSON.parse(cleaned)
      if (!Array.isArray(aiItems)) throw new Error('Expected array')
    } catch {
      console.error('Claude raw response:', rawText.slice(0, 500))
      return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText.slice(0, 500) }, { status: 500 })
    }

    // 6. Prepare rows — trim strings, clamp numbers
    const clamp = (v: unknown, lo: number, hi: number): number | null => {
      const n = Number(v)
      if (!isFinite(n)) return null
      return Math.min(hi, Math.max(lo, Math.round(n)))
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const VALID_FM = ['MORE','LESS','CORRUPT','EARLY','LATE','STUCK','ERRATIC']

    const rows = aiItems.map((it, idx) => ({
      session_id,
      item_no: String(idx + 1).padStart(3, '0'),
      sw_component:      str(it.sw_component),
      function_name:     str(it.function_name),
      failure_mode:      VALID_FM.includes(String(it.failure_mode)) ? String(it.failure_mode) : null,
      failure_detail:    str(it.failure_detail),
      effect_local:      str(it.effect_local),
      effect_system:     str(it.effect_system),
      potential_cause:   str(it.potential_cause),
      severity:          clamp(it.severity, 1, 10),
      occurrence:        clamp(it.occurrence, 1, 10),
      detection:         clamp(it.detection, 1, 10),
      preventive_action: str(it.preventive_action),
      detection_action:  str(it.detection_action),
      confidence_score:  Math.min(1, Math.max(0, Number(it.confidence_score) || 0)),
      source:            'ai' as const,
      review_status:     'pending' as const,
    }))

    // 7. Delete existing AI items and insert fresh ones
    await fetch(`${SUPABASE_URL}/rest/v1/pre_fmea_items?session_id=eq.${session_id}&source=eq.ai`, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })

    const insertRes = await sbInsert('pre_fmea_items', rows)
    if (!insertRes.ok) {
      const errText = await insertRes.text()
      return NextResponse.json({ error: `DB 저장 실패: ${errText}` }, { status: 500 })
    }

    // 8. Update session status to 'generated'
    await sbPatch(`pre_fmea_sessions?id=eq.${session_id}`, {
      status: 'generated',
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({ count: rows.length, total: aiItems.length })
  } catch (e) {
    console.error('[pre-fmea/generate]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
