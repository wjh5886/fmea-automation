export type OSelections = {
  newComp: number
  intfChange: number
  fieldIssue: number
  hasChange: number
}

export const DEFAULT_O_SELECTIONS: OSelections = {
  newComp: 2,
  intfChange: 2,
  fieldIssue: 0,
  hasChange: 1,
}

export const NEW_COMP_OPTIONS = [
  { value: 0, label: '기존과 동일' },
  { value: 1, label: '일부 변경' },
  { value: 2, label: '신규' },
]

export const INTF_CHANGE_OPTIONS = [
  { value: 0, label: '없음' },
  { value: 1, label: '낮음' },
  { value: 2, label: '높음' },
]

export const FIELD_ISSUE_OPTIONS = [
  { value: 0, label: '없음' },
  { value: 1, label: '낮음' },
  { value: 2, label: '높음' },
]

export const HAS_CHANGE_OPTIONS = [
  { value: 0, label: '없음' },
  { value: 1, label: '있음' },
]

export function calcOccurrence(sel: OSelections): number {
  const score = sel.newComp * 3 + sel.intfChange * 2 + sel.fieldIssue * 2 + sel.hasChange
  if (score === 0) return 1
  if (score <= 2) return 2
  if (score <= 4) return 3
  if (score <= 5) return 4
  if (score <= 6) return 5
  if (score <= 7) return 6
  if (score <= 8) return 7
  if (score <= 9) return 8
  return (sel.newComp === 2 && sel.fieldIssue === 2) ? 10 : 9
}

export function oColorClass(o: number): string {
  if (o <= 3) return 'bg-emerald-100 text-emerald-700'
  if (o <= 6) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}
