'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
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

type ApplyState = 'idle' | 'saving' | 'saved'

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
  const [showExample, setShowExample] = useState(false)
  const [search, setSearch] = useState('')

  const componentRows = useMemo(() => {
    return units
      .map(u => {
        const rows = items.filter(i => i.sw_unit_id === u.id)
        const intfCount = new Set(rows.map(r => r.variable_name)).size
        return { id: u.id, name: u.name, itemCount: rows.length, intfCount }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [units, items])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? componentRows.filter(r => r.name.toLowerCase().includes(q)) : componentRows
  }, [componentRows, search])

  const getSel = (id: string): OSelections => selections[id] ?? DEFAULT_O_SELECTIONS

  const applyO = async (unitId: string, o: number) => {
    const targets = items.filter(i => i.sw_unit_id === unitId)
    if (targets.length === 0) return
    setApplyState(prev => ({ ...prev, [unitId]: 'saving' }))
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
    setApplyState(prev => ({ ...prev, [unitId]: 'saved' }))
    onApplied()
  }

  const setSel = (id: string, patch: Partial<OSelections>) => {
    const newSel = { ...getSel(id), ...patch }
    setSelections(prev => ({ ...prev, [id]: newSel }))
    setOverrides(prev => ({ ...prev, [id]: null }))
    applyO(id, calcOccurrence(newSel))
  }

  const setOverride = (id: string, value: number | null) => {
    setOverrides(prev => ({ ...prev, [id]: value }))
  }

  const commitOverride = (id: string) => {
    const ov = overrides[id]
    const o = ov != null ? ov : calcOccurrence(getSel(id))
    applyO(id, o)
  }

  const resetOverride = (id: string) => {
    setOverrides(prev => ({ ...prev, [id]: null }))
    applyO(id, calcOccurrence(getSel(id)))
  }

  const oValue = (id: string): number => {
    const ov = overrides[id]
    if (ov != null) return ov
    return calcOccurrence(getSel(id))
  }

  const Select = ({ value, options, onChange }: { value: number; options: { value: number; label: string }[]; onChange: (v: number) => void }) => (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )

  return (
    <div>
      {showExample && <OccurrenceExampleModal onClose={() => setShowExample(false)} />}
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-sm text-slate-500">O값 평가 ({componentRows.length})</span>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="검색..."
            className="border border-slate-200 rounded px-2 py-1 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => setShowExample(true)}
            className="text-xs text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1 hover:bg-blue-50 whitespace-nowrap"
          >
            📋 작성 예시
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3">평가 항목 변경 시 O값이 자동 계산되어 해당 SW Unit의 모든 FMEA 항목에 즉시 반영됩니다 (현재 프로젝트 한정)</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">SW Unit</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">인터페이스 수</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">신규 SW Unit</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">인터페이스 변경</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">필드 이슈</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">변경 유무</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">O값</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">수동 입력</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">{componentRows.length === 0 ? 'SW Unit이 없습니다.' : '검색 결과가 없습니다.'}</td></tr>
            ) : filteredRows.map(r => {
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
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${oColorClass(o)}`}>{o}</span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">
                        {state === 'saving' ? '저장 중...' : state === 'saved' ? '✓ 반영됨' : ''}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-center">
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number" min={1} max={10}
                        value={overrides[r.id] ?? ''}
                        onChange={e => setOverride(r.id, e.target.value ? Number(e.target.value) : null)}
                        onBlur={() => commitOverride(r.id)}
                        placeholder="-"
                        className="w-12 border border-slate-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      {isManual && (
                        <button
                          onClick={() => resetOverride(r.id)}
                          className="text-slate-400 hover:text-slate-600 text-xs underline"
                        >
                          초기화
                        </button>
                      )}
                    </div>
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

function OccurrenceExampleModal({ onClose }: { onClose: () => void }) {
  const rows: { label: string; meaning: string; score: string }[] = [
    { label: '신규 SW Unit', meaning: '기존 동일 / 일부 변경 / 신규 적용', score: '0 / 1 / 3점' },
    { label: '인터페이스 변경', meaning: '없음 / 낮음 / 높음', score: '0 / 1 / 2점' },
    { label: '베이스 필드 이슈', meaning: '없음 / 낮음 / 높음', score: '0 / 1 / 2점' },
    { label: '변경 유무', meaning: '없음 / 있음', score: '0 / 1점' },
  ]
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-800 text-sm">Occurrence(O) 평가 — 작성 예시</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 overflow-y-auto">
          <p className="text-sm text-slate-500 mb-4">
            각 SW Unit에 대해 신규 여부, 인터페이스 변경 수준, 필드 이슈, 변경 유무를 선택하면 O값이 자동 계산됩니다.
          </p>
          <div className="mb-5 text-center">
            <Image
              src="/img/occurrence_example.png"
              alt="Occurrence(O) Ranking Criteria"
              width={730}
              height={1486}
              className="max-w-full h-auto mx-auto rounded-lg border border-slate-200"
            />
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 font-medium text-slate-600 text-left">선택값</th>
                  <th className="px-3 py-2 font-medium text-slate-600 text-left">의미</th>
                  <th className="px-3 py-2 font-medium text-slate-600 text-left">O값 기여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => (
                  <tr key={r.label}>
                    <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{r.label}</td>
                    <td className="px-3 py-2 text-slate-600">{r.meaning}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-4">
            총점 0→O=1, ≤2→O=2, ≤4→O=3, ≤5→O=4, ≤6→O=5, ≤7→O=6, ≤8→O=7, ≤9→O=8, 그 외→O=9~10
          </p>
        </div>
      </div>
    </div>
  )
}
