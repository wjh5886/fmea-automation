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
  folder: string | null
  deleted_at: string | null
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

export type PreFmeaSession = {
  id: string
  name: string
  item_name: string
  status: 'draft' | 'generated' | 'reviewed' | 'upgraded'
  doc_version: number
  item_count?: number
  created_at: string
  updated_at: string
}

export type PreFmeaIcdVariable = {
  id: string
  session_id: string
  sw_component: string | null
  variable_name: string
  variable_type: string | null
  direction: string | null
  data_type: string | null
  signal_range: string | null
  unit: string | null
  description: string | null
  sort_order: number
  created_at: string
}

export type PreFmeaDocument = {
  id: string
  session_id: string
  doc_type: 'fmea_template' | 'design_spec' | 'human_fmea' | 'architecture' | 'dbc_file' | 'icd_file' | 'system_fmea'
  filename: string
  storage_path: string | null
  parsed_text: string | null
  metadata: { size?: number; mime_type?: string } | null
  created_at: string
}

export type PreFmeaItem = {
  id: string
  session_id: string
  item_no: string | null
  sw_component: string | null
  function_name: string | null
  failure_mode: string | null
  failure_detail: string | null
  effect_local: string | null
  effect_system: string | null
  potential_cause: string | null
  severity: number | null
  occurrence: number | null
  detection: number | null
  rpn: number | null
  preventive_action: string | null
  detection_action: string | null
  confidence_score: number | null
  source: 'ai' | 'icd' | 'human' | 'merged'
  review_status: 'pending' | 'accepted' | 'rejected' | 'modified'
  action_priority: 'VH' | 'H' | 'M' | 'L' | null
  human_override: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type PreFmeaGap = {
  id: string
  session_id: string
  gap_type: 'missing_item' | 'wrong_sod' | 'missing_cause' | 'wrong_effect' | 'missing_action'
  field_name: string | null
  ai_value: string | null
  human_value: string | null
  sw_component: string | null
  failure_mode: string | null
  severity: number | null
  lesson: string | null
  applied: boolean
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
