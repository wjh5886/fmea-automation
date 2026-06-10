'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

const BACKEND = '/api'

interface Project { id: string; name: string; vehicle_model?: string }

interface CompareRow {
  norm_key: string
  failure_mode: string
  a_variable_name: string | null
  b_variable_name: string | null
  a_id: string | null
  b_id: string | null
  a_severity: number | null
  a_occurrence: number | null
  a_detection: number | null
  a_rpn: number | null
  a_effect: string | null
  a_preventive: string | null
  b_severity: number | null
  b_occurrence: number | null
  b_detection: number | null
  b_rpn: number | null
  diff: 'b_missing' | 'different' | 'same' | 'a_only' | 'b_only' | 'both_missing'
  recommendation: string | null
}

interface Summary {
  total_a: number; total_b: number
  b_missing: number; different: number; same: number
  a_only: number; b_only: number; both_missing: number
}

const DIFF_LABEL: Record<string, { label: string; color: string }> = {
  b_missing:    { label: '복사 추천', color: 'bg-amber-100 text-amber-800' },
  different:    { label: '값 다름',   color: 'bg-blue-100 text-blue-800' },
  same:         { label: '동일',      color: 'bg-green-100 text-green-700' },
  a_only:       { label: 'A만 존재',  color: 'bg-slate-100 text-slate-500' },
  b_only:       { label: 'B만 존재',  color: 'bg-purple-100 text-purple-700' },
  both_missing: { label: '둘 다 없음', color: 'bg-red-100 text-red-700' },
}

function SodBadge({ s, o, d }: { s: number | null; o: number | null; d: number | null }) {
  if (s == null) return <span className="text-slate-300">—</span>
  const rpn = (s ?? 0) * (o ?? 0) * (d ?? 0)
  const color = rpn >= 200 ? 'text-red-600' : rpn >= 100 ? 'text-amber-600' : 'text-slate-600'
  return (
    <span className={`font-mono text-xs ${color}`}>
      {s}/{o}/{d} <span className="text-slate-400">({rpn})</span>
    </span>
  )
}

type Tab = 'all' | 'b_missing' | 'different' | 'same'

export default function ComparePage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projA, setProjA] = useState('')
  const [projB, setProjB] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<CompareRow[]>([])
  const [tab, setTab] = useState<Tab>('b_missing')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)

  useEffect(() => {
    supabase.from('projects').select('id,name,vehicle_model').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setProjects(data)
        const params = new URLSearchParams(window.location.search)
        const b = params.get('b')
        if (b) setProjB(b)
      })
  }, [])

  async function runCompare() {
    if (!projA || !projB || projA === projB) return
    setLoading(true); setSummary(null); setRows([]); setSelected(new Set()); setApplied(null)
    try {
      const r = await fetch(`${BACKEND}/compare/${projA}/${projB}`)
      const data = await r.json()
      setSummary(data.summary)
      setRows(data.rows)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (tab === 'all') return rows
    return rows.filter(r => r.diff === tab)
  }, [rows, tab])

  function toggleRow(id: string) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function toggleAll() {
    const ids = filtered.filter(r => r.b_id && r.a_id).map(r => r.b_id!)
    if (ids.every(id => selected.has(id))) {
      setSelected(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s })
    } else {
      setSelected(prev => { const s = new Set(prev); ids.forEach(id => s.add(id)); return s })
    }
  }

  async function applySelected() {
    if (selected.size === 0) return
    setApplying(true)
    const patches = rows
      .filter(r => r.b_id && selected.has(r.b_id))
      .map(r => ({
        b_id: r.b_id,
        a_severity: r.a_severity, a_occurrence: r.a_occurrence,
        a_detection: r.a_detection, a_effect_system: r.a_effect,
        a_preventive_action: r.a_preventive,
      }))
    try {
      const r = await fetch(`${BACKEND}/compare/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches }),
      })
      const data = await r.json()
      setApplied(data.applied)
      setSelected(new Set())
      // 반영 후 재조회
      runCompare()
    } finally {
      setApplying(false)
    }
  }

  const projName = (id: string) => projects.find(p => p.id === id)?.name ?? id.slice(0, 8)

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">FMEA 프로젝트 비교</h1>

      {/* 프로젝트 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-500 mb-1">프로젝트 A (참조 소스)</label>
          <select value={projA} onChange={e => setProjA(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">선택...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="text-slate-400 font-bold pb-2">vs</div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-500 mb-1">프로젝트 B (수정 대상)</label>
          <select value={projB} onChange={e => setProjB(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">선택...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={runCompare} disabled={!projA || !projB || projA === projB || loading}
          className="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-40 transition-colors">
          {loading ? '비교 중...' : '비교 실행'}
        </button>
      </div>

      {/* 요약 카드 */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: '복사 추천', value: summary.b_missing, color: 'text-amber-600', tab: 'b_missing' as Tab },
            { label: '값 다름',   value: summary.different,  color: 'text-blue-600',  tab: 'different' as Tab },
            { label: '동일',      value: summary.same,       color: 'text-green-600', tab: 'same' as Tab },
            { label: 'A 항목 수', value: summary.total_a,    color: 'text-slate-600', tab: 'all' as Tab },
          ].map(c => (
            <button key={c.label} onClick={() => setTab(c.tab)}
              className={`bg-white border rounded-xl p-4 text-left hover:shadow-sm transition-shadow ${tab === c.tab ? 'border-slate-400' : 'border-slate-200'}`}>
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-xs text-slate-500 mt-1">{c.label}</div>
            </button>
          ))}
        </div>
      )}

      {applied != null && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700 mb-4">
          {applied}개 항목이 {projName(projB)}에 적용되었습니다.
        </div>
      )}

      {/* 테이블 */}
      {rows.length > 0 && (
        <>
          {/* 탭 */}
          <div className="flex gap-1 mb-3">
            {(['all', 'b_missing', 'different', 'same'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}>
                {t === 'all' ? `전체 (${rows.length})` :
                 t === 'b_missing' ? `복사 추천 (${summary?.b_missing})` :
                 t === 'different' ? `값 다름 (${summary?.different})` :
                 `동일 (${summary?.same})`}
              </button>
            ))}
          </div>

          {/* 액션 바 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-500">{filtered.length}개 항목</span>
            {selected.size > 0 && (
              <button onClick={applySelected} disabled={applying}
                className="bg-amber-500 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-amber-400 disabled:opacity-40 transition-colors">
                {applying ? '적용 중...' : `선택 ${selected.size}개를 ${projName(projB)}에 적용`}
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left w-8">
                    <input type="checkbox" onChange={toggleAll}
                      checked={filtered.filter(r => r.b_id && r.a_id).every(r => selected.has(r.b_id!))}
                      className="rounded" />
                  </th>
                  <th className="px-3 py-2 text-left">신호명 (정규화)</th>
                  <th className="px-3 py-2 text-left">실패모드</th>
                  <th className="px-3 py-2 text-left">A 변수명</th>
                  <th className="px-3 py-2 text-left">A S/O/D (RPN)</th>
                  <th className="px-3 py-2 text-left">B 변수명</th>
                  <th className="px-3 py-2 text-left">B S/O/D (RPN)</th>
                  <th className="px-3 py-2 text-left">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row, i) => {
                  const sel = row.b_id ? selected.has(row.b_id) : false
                  const di = DIFF_LABEL[row.diff]
                  return (
                    <tr key={i} className={`hover:bg-slate-50 ${sel ? 'bg-amber-50' : ''}`}>
                      <td className="px-3 py-2">
                        {row.b_id && row.a_id && (
                          <input type="checkbox" checked={sel}
                            onChange={() => toggleRow(row.b_id!)} className="rounded" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">{row.norm_key}</td>
                      <td className="px-3 py-2">
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-xs">{row.failure_mode}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-32 truncate" title={row.a_variable_name ?? ''}>
                        {row.a_variable_name ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <SodBadge s={row.a_severity} o={row.a_occurrence} d={row.a_detection} />
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-32 truncate" title={row.b_variable_name ?? ''}>
                        {row.b_variable_name ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <SodBadge s={row.b_severity} o={row.b_occurrence} d={row.b_detection} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${di.color}`}>{di.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm">
          두 프로젝트를 선택하고 비교 실행을 눌러주세요.
        </div>
      )}
    </div>
  )
}
