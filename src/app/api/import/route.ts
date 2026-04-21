import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const projectId = formData.get('project_id') as string

  if (!file || !projectId) return NextResponse.json({ error: 'Missing file or project_id' }, { status: 400 })

  const buffer = await file.arrayBuffer()
  let rows: Record<string, unknown>[] = []

  if (file.name.endsWith('.json')) {
    rows = JSON.parse(Buffer.from(buffer).toString('utf-8'))
  } else {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  }

  // SW Units 조회
  const { data: units } = await supabase.from('sw_units').select('*').eq('project_id', projectId)
  const unitMap = new Map((units ?? []).map((u: { name: string; id: string }) => [u.name, u.id]))

  // SW Unit 자동 생성
  const newUnits = [...new Set(rows.map((r: Record<string, unknown>) => String(r.SW_Unit ?? r['SW Unit'] ?? '')).filter(Boolean))]
  for (const name of newUnits) {
    if (!unitMap.has(name)) {
      const { data } = await supabase.from('sw_units').insert([{ project_id: projectId, name }]).select().single()
      if (data) unitMap.set(name, data.id)
    }
  }

  // FMEA 항목 변환
  const items = rows.map((r: Record<string, unknown>) => {
    const swUnitName = String(r.SW_Unit ?? r['SW Unit'] ?? '')
    const failureMode = String(r.Failure_Mode ?? r['Failure Mode'] ?? r.FailureMode ?? '')
    return {
      project_id: projectId,
      sw_unit_id: unitMap.get(swUnitName) ?? null,
      item_no: String(r.No ?? r.item_no ?? ''),
      category: String(r.Category ?? '') as 'External' | 'Internal' | null,
      variable_name: String(r.Variable ?? r.variable_name ?? ''),
      variable_type: String(r.Type ?? r.variable_type ?? ''),
      failure_mode: (['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE', 'STUCK', 'ERRATIC', 'N/A'].includes(failureMode) ? failureMode : null) as string | null,
      failure_detail: String(r.Detail ?? r.failure_detail ?? '') || null,
      effect_module: String(r.Effect_Module ?? r['Effect Module'] ?? '') || null,
      effect_system: String(r.Effect_System ?? r['Effect System'] ?? '') || null,
      effect_safety_goal: String(r.Effect_SG ?? r['Effect SG'] ?? '') || null,
      severity: r.S ? Number(r.S) : null,
      occurrence: r.O ? Number(r.O) : null,
      detection: r.D ? Number(r.D) : null,
      preventive_action: String(r.Preventive ?? r.preventive_action ?? '') || null,
      detection_action: String(r.Detection ?? r.detection_action ?? '') || null,
      cm_required: r.CM_Required != null ? Boolean(r.CM_Required) : null,
      countermeasure: String(r.Countermeasure ?? '') || null,
      status: 'draft' as const,
    }
  }).filter(i => i.variable_name)

  // 배치 삽입
  const batchSize = 100
  let inserted = 0
  for (let i = 0; i < items.length; i += batchSize) {
    const { error } = await supabase.from('fmea_items').insert(items.slice(i, i + batchSize))
    if (!error) inserted += Math.min(batchSize, items.length - i)
  }

  return NextResponse.json({ inserted, total: items.length })
}
