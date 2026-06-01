// Action Priority 계산 — AIAG-VDA FMEA 2019 기준 (SL SW FMEA Guideline v4.2 준용)
// AP: VH (Very High) > H (High) > M (Medium) > L (Low)
// VH: Counter Measure 필수

export type ActionPriority = 'VH' | 'H' | 'M' | 'L'

export function calculateAP(s: number, o: number, d: number): ActionPriority {
  if (s >= 9) {
    if (o >= 6) return 'VH'
    if (o >= 4) return d >= 4 ? 'VH' : 'H'
    if (o >= 2) return 'H'          // S≥9, O=2-3 → H regardless of D
    return 'L'
  }
  if (s >= 7) {
    if (o >= 6) return 'VH'
    if (o >= 4) return d >= 7 ? 'VH' : 'H'
    if (o >= 3) return d >= 4 ? 'H' : 'M'
    if (o >= 2) return d >= 7 ? 'H' : 'M'
    return 'L'
  }
  if (s >= 5) {
    if (o >= 6) return d >= 7 ? 'H' : 'M'
    if (o >= 4) return d >= 7 ? 'H' : 'M'
    if (o >= 3) return d >= 4 ? 'M' : 'L'
    return 'L'
  }
  return 'L'
}

export function calculateAPSafe(
  s: unknown, o: unknown, d: unknown,
): ActionPriority | null {
  const sv = Number(s); const ov = Number(o); const dv = Number(d)
  if (!isFinite(sv) || !isFinite(ov) || !isFinite(dv)) return null
  if (sv < 1 || sv > 10 || ov < 1 || ov > 10 || dv < 1 || dv > 10) return null
  return calculateAP(sv, ov, dv)
}
