'use client'

import { useMemo, useState } from 'react'
import type { FmeaItem, SwUnit } from '@/lib/supabase'
import {
  type OSelections,
  DEFAULT_O_SELECTIONS,
  NEW_COMP_OPTIONS,
  INTF_CHANGE_OPTIONS,
  FIELD_ISSUE_OPTIONS,
  HAS_CHANGE_OPTIONS,
  calcOccurrence,
  oColorClass,
} from '@/lib/occurrence'

type ApplyState = 'idle' | 'applying' | 'done'

export default function OccurrencePanel({
  units,
  items,
  projectId,
  onApplied,
}: {
  units: SwUnit[]
  items: FmeaItem[]
  projectId: string
  onApplied: () => void
}) {
  const [selections, setSelections] = useState<Record<string, OSelections>>({})
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [applyState, setApplyState] = useState<Record<string, ApplyState>>({})

  const componentRows = useMemo(() => {
    return units
      .map(u => {
        const rows = items.filter(i => i.sw_unit_id === u.id)
        const intfCount = new Set(rows.map(r => r.variable_name)).size
        return { id: u.id, name: u.name, itemCount: rows.length, intfCount }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [units, items])

  const getSel = (id: string): OSelections => selections[id] ?? DEFAULT_O_SELECTIONS

  const setSel = (id: string, patch: Partial<OSelections>) => {
    setSelections(prev => ({ ...prev, [id]: { ...getSel(id), ...patch } }))
    setOverrides(prev => ({ ...prev, [id]: null }))
  }

  const oValue = (id: string): number => {
    const ov = overrides[id]
    if (ov != null) return ov
    return calcOccurrence(getSel(id))
  }

  const apply = async (unitId: string) => {
    const o = oValue(unitId)
    const targets = items.filter(i => i.sw_unit_id === unitId)
    if (targets.length === 0) return
    setApplyState(prev => ({ ...prev, [unitId]: 'applying' }))
    await Promise.all(targets.map(item => {
      const s = item.severity ?? 0
      const d = item.detection ?? 0
      const rpn = (s && o && d) ? s * o * d : null
      return fetch(`/api/projects/${projectId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, occurrence: o, rpn }),
      })
    }))
    setApplyState(prev => ({ ...prev, [unitId]: 'done' }))
    onApplied()
  }

  const Select = ({ value, options, onChange }: { value: number; options: { value: number; label: string }[]; onChange: (v: number) => void }) => (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 w-full"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )

  return (
    <div>
      <p className="text-sm text-slate-500 mb-3">
        컴포넌트별 변경 이력을 평가하여 Occurrence(O)값을 자동 계산합니다. &ldquo;적용&rdquo;을 누르면 해당 컴포넌트의 모든 FMEA 항목에 O값(및 RPN)이 일괄 반영됩니다.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">컴포넌트</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">인터페이스 수</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">신규 컴포넌트</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">인터페이스 변경</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">필드 이슈</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">변경 유무</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">O값</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">수동 입력</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">적용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {componentRows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">컴포넌트가 없습니다.</td></tr>
            ) : componentRows.map(r => {
              const sel = getSel(r.id)
              const o = oValue(r.id)
              const isManual = overrides[r.id] != null
              const state = applyState[r.id] ?? 'idle'
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 align-top font-mono font-medium text-slate-800 whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2 align-top text-slate-500">{r.intfCount} ({r.itemCount}건)</td>
                  <td className="px-3 py-2 align-top w-32">
                    <Select value={sel.newComp} options={NEW_COMP_OPTIONS} onChange={v => setSel(r.id, { newComp: v })} />
                  </td>
                  <td className="px-3 py-2 align-top w-32">
                    <Select value={sel.intfChange} options={INTF_CHANGE_OPTIONS} onChange={v => setSel(r.id, { intfChange: v })} />
                  </td>
                  <td className="px-3 py-2 align-top w-28">
                    <Select value={sel.fieldIssue} options={FIELD_ISSUE_OPTIONS} onChange={v => setSel(r.id, { fieldIssue: v })} />
                  </td>
                  <td className="px-3 py-2 align-top w-24">
                    <Select value={sel.hasChange} options={HAS_CHANGE_OPTIONS} onChange={v => setSel(r.id, { hasChange: v })} />
                  </td>
                  <td className="px-3 py-2 align-top text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${oColorClass(o)}`}>{o}</span>
                  </td>
                  <td className="px-3 py-2 align-top text-center">
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number" min={1} max={10}
                        value={overrides[r.id] ?? ''}
                        onChange={e => setOverrides(prev => ({ ...prev, [r.id]: e.target.value ? Number(e.target.value) : null }))}
                        placeholder="-"
                        className="w-12 border border-slate-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                      {isManual && (
                        <button
                          onClick={() => setOverrides(prev => ({ ...prev, [r.id]: null }))}
                          className="text-slate-400 hover:text-slate-600 text-xs underline"
                        >
                          초기화
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-center">
                    <button
                      onClick={() => apply(r.id)}
                      disabled={state === 'applying' || r.itemCount === 0}
                      className="bg-indigo-600 text-white px-2.5 py-1 rounded text-xs hover:bg-indigo-500 disabled:opacity-40 whitespace-nowrap"
                    >
                      {state === 'applying' ? '적용 중...' : state === 'done' ? '완료 ✓' : '적용'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
