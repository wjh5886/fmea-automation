import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { item } = await req.json()

  const prompt = `You are an automotive SW FMEA expert. Analyze the following FMEA item and provide ratings.

SW Unit: ${item.sw_unit_id ?? 'Unknown'}
Variable: ${item.variable_name}
Type: ${item.variable_type ?? 'Unknown'}
Failure Mode: ${item.failure_mode}
Failure Detail: ${item.failure_detail ?? 'N/A'}
Effect on Module: ${item.effect_module ?? 'N/A'}
Effect on System: ${item.effect_system ?? 'N/A'}
Effect on Safety Goal: ${item.effect_safety_goal ?? 'N/A'}

Provide ratings (1-10 scale) and actions following AIAG-VDA FMEA methodology:
- Severity (S): Impact on system/user (10=hazardous, 1=no effect)
- Occurrence (O): Likelihood of failure cause (10=very high, 1=remote)
- Detection (D): Ability to detect before delivery (10=no detection, 1=certain detection)

Return ONLY valid JSON (no markdown, no explanation):
{
  "severity": <number 1-10>,
  "occurrence": <number 1-10>,
  "detection": <number 1-10>,
  "preventive_action": "<specific preventive action in Korean>",
  "detection_action": "<specific detection/verification action in Korean>",
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
