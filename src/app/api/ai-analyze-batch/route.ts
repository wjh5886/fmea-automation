import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type BatchItem = {
  id: string
  sw_unit_name: string
  category: string
  variable_name: string
  variable_type: string | null
  failure_mode: string
  failure_detail: string | null
  effect_module: string | null
  signal_range: string | null
}

export async function POST(req: NextRequest) {
  const { items, project_name }: { items: BatchItem[]; project_name?: string } = await req.json()

  const itemsText = items.map((item, idx) =>
    `[${idx}] SW Unit: ${item.sw_unit_name} | Category: ${item.category}
Variable: ${item.variable_name} (${item.variable_type ?? 'unknown'})
Range: ${item.signal_range ?? 'N/A'}
Failure Mode: ${item.failure_mode}
Detail: ${item.failure_detail ?? 'N/A'}
Effect on Module: ${item.effect_module ?? 'N/A'}`
  ).join('\n\n')

  const prompt = `You are an automotive SW FMEA expert specializing in Steer-by-Wire (SBW) systems.

Project: ${project_name ?? 'SBW SW FMEA'} (ISO 26262 ASIL-D)
SBW is safety-critical: steering angle/torque signal failures can cause loss of vehicle control.

Rating Guidelines (AIAG-VDA FMEA, 1-10):
Severity:
  10 = vehicle crash / loss of steering without warning
  7-9 = complete loss of SBW primary function
  4-6 = degraded steering performance, driver still functional
  1-3 = minor annoyance, no functional impact
Occurrence:
  8-10 = frequent / systematic design weakness
  5-7 = occasional / moderate complexity SW logic
  2-4 = rare / well-reviewed SW with unit tests
  1 = extremely unlikely / proven design
Detection:
  1-3 = strong runtime monitoring + CRC/range check + end-of-line test
  4-6 = partial diagnostic coverage
  7-9 = limited diagnostics, manual review only
  10 = no detection mechanism

Domain hints:
- Internal signals (SENDER): output to other modules → affects downstream → higher S when related to torque/angle
- External signals (RECEIVER): depends on correct input from outside ECU
- MORE/LESS failures on torque/angle variables → S=7-9
- STUCK/ERRATIC on control signals → S=6-8
- EARLY/LATE timing failures → S=4-6 typically
- CORRUPT on safety-relevant enum states → S=6-8

Analyze these ${items.length} FMEA items:

${itemsText}

Return ONLY a JSON array with exactly ${items.length} objects (no markdown, no explanation):
[{"idx":0,"severity":<1-10>,"occurrence":<1-10>,"detection":<1-10>,"effect_system":"<vehicle-level effect in Korean, 1 sentence>","preventive_action":"<design control in Korean>","detection_action":"<diagnostic method in Korean>"},...]`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
    const text = raw.replace(/^```[a-z]*\n?/m, '').replace(/\n?```$/m, '').trim()
    const results = JSON.parse(text) as {
      idx: number
      severity: number
      occurrence: number
      detection: number
      effect_system: string
      preventive_action: string
      detection_action: string
    }[]

    const mapped = results
      .map(r => ({ ...r, id: items[r.idx]?.id }))
      .filter(r => r.id)

    return NextResponse.json({ results: mapped })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
