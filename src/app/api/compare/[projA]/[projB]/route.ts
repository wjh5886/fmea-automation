import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { compareFmeaRows } from '@/lib/fmea-utils'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const FIELDS = 'id,variable_name,failure_mode,severity,occurrence,detection,rpn,effect_system,preventive_action'
const PAGE = 1000

async function fetchAll(projectId: string) {
  const rows: unknown[] = []
  let offset = 0
  while (true) {
    const { data, error } = await sb.from('fmea_items').select(FIELDS)
      .eq('project_id', projectId).range(offset, offset + PAGE - 1)
    if (error || !data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return rows
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projA: string; projB: string }> }
) {
  const { projA, projB } = await params
  const [rowsA, rowsB] = await Promise.all([fetchAll(projA), fetchAll(projB)])
  const result = compareFmeaRows(rowsA as never, rowsB as never)
  return NextResponse.json(result)
}
