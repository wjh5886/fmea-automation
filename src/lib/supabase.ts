import { createClient } from '@supabase/supabase-js'

// 브라우저에서는 로컬 서버를 통해 프록시 (사내망 방화벽 우회)
const supabaseUrl = typeof window !== 'undefined'
  ? `${window.location.origin}/sb`
  : process.env.NEXT_PUBLIC_SUPABASE_URL!
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

export type SafetyGoal = {
  id: string
  project_id: string
  sg_id: string
  name: string
  description: string | null
  asil: 'QM' | 'A' | 'B' | 'C' | 'D' | null
  created_at: string
}

export type SafetyMechanism = {
  id: string
  project_id: string
  sm_id: string
  name: string
  description: string | null
  type: 'Preventive' | 'Detection' | 'Both' | null
  diagnostic_coverage: 'Low' | 'Medium' | 'High' | 'N/A' | null
  related_sg_id: string | null
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
  signal_range: string | null
  potential_cause: string | null
  test_method: string | null
  safety_mechanism_text: string | null
  severity_after: number | null
  occurrence_after: number | null
  detection_after: number | null
  rpn_after: number | null
  target_date: string | null
  responsibility: string | null
  reference_result: string | null
  finish_date: string | null
  safety_goal_id: string | null
  safety_mechanism_id: string | null
  status: 'draft' | 'in_review' | 'approved'
  ai_generated: boolean
  created_at: string
  updated_at: string
  sw_units?: SwUnit
  safety_goals?: SafetyGoal
  safety_mechanisms?: SafetyMechanism
}
