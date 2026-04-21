import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Project = {
  id: string
  name: string
  description: string | null
  vehicle_model: string | null
  created_at: string
  updated_at: string
}

export type SwUnit = {
  id: string
  project_id: string
  name: string
  description: string | null
  created_at: string
}

export type FmeaItem = {
  id: string
  project_id: string
  sw_unit_id: string | null
  item_no: string | null
  category: 'External' | 'Internal' | null
  variable_name: string
  variable_type: string | null
  failure_mode: 'MORE' | 'LESS' | 'CORRUPT' | 'EARLY' | 'LATE' | 'STUCK' | 'ERRATIC' | 'N/A' | null
  failure_detail: string | null
  effect_module: string | null
  effect_system: string | null
  effect_safety_goal: string | null
  severity: number | null
  occurrence: number | null
  detection: number | null
  rpn: number | null
  preventive_action: string | null
  detection_action: string | null
  cm_required: boolean | null
  countermeasure: string | null
  status: 'draft' | 'in_review' | 'approved'
  ai_generated: boolean
  created_at: string
  updated_at: string
  sw_units?: SwUnit
}
