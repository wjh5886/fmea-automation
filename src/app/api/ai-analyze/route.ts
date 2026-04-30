import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { item, sw_unit_name, project_name } = await req.json()

  const prompt = `You are an automotive SW FMEA expert specializing in Steer-by-Wire (SBW) systems.

Project: ${project_name ?? 'SBW SW FMEA'} (ISO 26262 ASIL-D)
SBW is safety-critical: steering failures can cause loss of vehicle control.

SW Unit: ${sw_unit_name ?? item.sw_unit_id}
Category: ${item.category ?? 'N/A'}
Variable: ${item.variable_name} (${item.variable_type ?? 'unknown'})
Signal Range: ${item.signal_range ?? 'N/A'}
Failure Mode: ${item.failure_mode}
Failure Detail: ${item.failure_detail ?? 'N/A'}
Effect on Module: ${item.effect_module ?? 'N/A'}
Effect on System: ${item.effect_system ?? 'N/A'}
Effect on Safety Goal: ${item.effect_safety_goal ?? 'N/A'}

Rate following AIAG-VDA FMEA (1-10):
- Severity: 10=crash/injury, 7-9=loss of SBW function, 4-6=degraded, 1-3=minor
- Occurrence: 10=frequent, 2-4=well-designed SW, 1=extremely unlikely
- Detection: 1-3=strong runtime monitoring, 4-6=partial, 10=none

Return ONLY valid JSON (no markdown):
{
  "severity": <1-10>,
  "occurrence": <1-10>,
  "detection": <1-10>,
  "effect_system": "<vehicle-level effect in Korean, 1 sentence>",
  "preventive_action": "<design control in Korean>",
  "detection_action": "<diagnostic method in Korean>",
  "reasoning": "<brief reasoning in Korean>"
}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const result = JSON.parse(text)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
