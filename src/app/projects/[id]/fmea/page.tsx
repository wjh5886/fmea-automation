'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { supabase, type FmeaItem, type SwUnit, type Project, type SafetyGoal, type SafetyMechanism } from '@/lib/supabase'
import ReportDashboard from './ReportDashboard'

const FAILURE_MODES = ['MORE', 'LESS', 'CORRUPT', 'EARLY', 'LATE', 'STUCK', 'ERRATIC', 'N/A']

function RpnBadge({ rpn }: { rpn: number | null }) {
  if (!rpn) return <span className="text-slate-300">-</span>
  const color = rpn >= 200 ? 'bg-red-100 text-red-700' : rpn >= 100 ? 'bg-orange-100 text-orange-700' : rpn >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>{rpn}</span>
}

function NumInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number" min={1} max={10}
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="w-14 border border-slate-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  )
}

type RagResult = {
  id: string
  variable_name: string
  failure_mode: string | null
  effect_system: string | null
  preventive_action: string | null
  severity: number | null
  occurrence: number | null
  detection: number | null
  rpn: number | null
  similarity: number
}

function RagPanel({
  item,
  onClose,
  onApply,
}: {
  item: { id: string; variable_name: string; failure_mode: string | null }
  onClose: () => void
  onApply: (itemId: string, patch: { effect_system?: string; preventive_action?: string }) => void
}) {
  const [results, setResults] = useState<RagResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/backend/rag/similar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: item.id,
        failure_mode: item.failure_mode,
        top_k: 5,
      }),
    })
      .then(r => r.json())
      .then(d => { setResults(d.results ?? []); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [item.id])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-sm">유사 항목 검색 (RAG)</h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">
              {item.variable_name.split('(')[0].trim()} [{item.failure_mode ?? 'ANY'}]
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {loading && (
            <div className="text-center py-8 text-slate-400 text-sm">
              <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
              JG1 데이터에서 검색 중...
            </div>
          )}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
              백엔드 서버 미연결 — <code>start_local.bat</code> 실행 후 재시도
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">유사 항목 없음 (임베딩 미생성 가능)</div>
          )}
          {results.map((r, i) => (
            <div key={r.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <span className="text-xs font-mono text-slate-700 font-medium">{r.variable_name.split('(')[0].trim()}</span>
                  <span className="ml-2 bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-xs font-mono">{r.failure_mode}</span>
                  <span className={`ml-2 text-xs font-medium ${r.similarity >= 0.7 ? 'text-emerald-600' : r.similarity >= 0.5 ? 'text-blue-600' : 'text-slate-400'}`}>
                    유사도 {(r.similarity * 100).toFixed(0)}%
                  </span>
                  {r.rpn && <span className="ml-2 text-xs text-slate-400">RPN {r.rpn}</span>}
                </div>
                <button
                  onClick={() => onApply(item.id, {
                    effect_system: r.effect_system ?? undefined,
                    preventive_action: r.preventive_action ?? undefined,
                  })}
                  className="shrink-0 text-xs bg-emerald-600 text-white rounded px-2.5 py-1 hover:bg-emerald-700"
                >
                  적용
                </button>
              </div>
              {r.effect_system && (
                <div className="mb-1.5">
                  <span className="text-xs text-slate-400 block mb-0.5">Effect on System</span>
                  <p className="text-xs text-slate-700 leading-relaxed">{r.effect_system}</p>
                </div>
              )}
              {r.preventive_action && (
                <div>
                  <span className="text-xs text-slate-400 block mb-0.5">Preventive Action</span>
                  <p className="text-xs text-slate-700 leading-relaxed">{r.preventive_action}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 shrink-0">
          <p className="text-xs text-slate-400">JG1 프로젝트의 양질 데이터 기반</p>
        </div>
      </div>
    </div>
  )
}

function JsonImportModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleImport = async () => {
    setImporting(true)
    try {
      const rows = JSON.parse(text)
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, project_id: projectId }),
      })
      const data = await res.json()
      setResult(`완료: ${data.inserted}/${data.total}개 가져옴`)
      setTimeout(() => { onDone(); onClose() }, 1500)
    } catch (e) {
      setResult(`오류: ${e}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">JSON 데이터 가져오기</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <p className="text-sm text-slate-500">
          <code className="bg-slate-100 px-1 rounded">fmea_data.json</code> 파일 내용을 아래에 붙여넣기(Ctrl+V) 하세요.
        </p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          placeholder='[{"No": "1.0", "SW_Unit": "CstAp_PwrMGT", ...}]'
          className="border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {result && (
          <div className={`text-sm px-3 py-2 rounded-lg ${result.startsWith('오류') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {result}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg py-2 text-sm hover:bg-slate-50">취소</button>
          <button onClick={handleImport} disabled={importing || !text.trim()} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
            {importing ? '가져오는 중...' : '가져오기'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FmeaTablePage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [units, setUnits] = useState<SwUnit[]>([])
  const [sgs, setSgs] = useState<SafetyGoal[]>([])
  const [sms, setSms] = useState<SafetyMechanism[]>([])
  const [items, setItems] = useState<FmeaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'table' | 'report'>('table')

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'report') setView('report')
  }, [])
  const [filterUnit, setFilterUnit] = useState('')
  const [filterMode, setFilterMode] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzingAll, setAnalyzingAll] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [ragItem, setRagItem] = useState<{ id: string; variable_name: string; failure_mode: string | null } | null>(null)
  const [colWidths, setColWidths] = useState<Record<number, number>>({})
  const resizeRef = useRef<{ col: number; startX: number; startW: number } | null>(null)

  const startResize = useCallback((col: number, e: React.MouseEvent) => {
    e.preventDefault()
    const th = (e.currentTarget as HTMLElement).closest('th') as HTMLElement
    resizeRef.current = { col, startX: e.clientX, startW: th.offsetWidth }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const { col: c, startX, startW } = resizeRef.current
      setColWidths(prev => ({ ...prev, [c]: Math.max(40, startW + ev.clientX - startX) }))
    }
    const onUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const cw = (col: number, def: number) => colWidths[col] ?? def

  const fetchAllItems = async (projectId: string): Promise<FmeaItem[]> => {
    const res = await fetch(`/api/projects/${projectId}/items`)
    return res.ok ? (await res.json()) as FmeaItem[] : []
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [projRes, allItems] = await Promise.all([
      fetch(`/api/projects/${id}`).then(r => r.json()),
      fetchAllItems(id),
    ])
    setProject(projRes.project)
    setUnits(projRes.units ?? [])
    setSgs(projRes.sgs ?? [])
    setSms(projRes.sms ?? [])
    setItems(allItems)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const updateItem = async (itemId: string, patch: Partial<FmeaItem>) => {
    setItems(prev => prev.map(i => {
      if (i.id !== itemId) return i
      const merged = { ...i, ...patch }
      const s = merged.severity ?? 0
      const o = merged.occurrence ?? 0
      const d = merged.detection ?? 0
      merged.rpn = (s && o && d) ? s * o * d : null
      return merged
    }))
    const item = items.find(i => i.id === itemId)
    const rpn = item ? (() => {
      const merged = { ...item, ...patch }
      const s = merged.severity ?? 0; const o = merged.occurrence ?? 0; const d = merged.detection ?? 0
      return (s && o && d) ? s * o * d : null
    })() : undefined
    await fetch(`/api/projects/${id}/items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, ...patch, ...(rpn !== undefined ? { rpn } : {}) }),
    })
  }

  const analyzeItem = async (item: FmeaItem) => {
    setAnalyzingId(item.id)
    try {
      const swName = (item as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? ''
      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, sw_unit_name: swName, project_name: project?.name }),
      })
      const result = await res.json()
      if (result.severity) {
        await updateItem(item.id, {
          severity: result.severity,
          occurrence: result.occurrence,
          detection: result.detection,
          effect_system: result.effect_system || item.effect_system,
          preventive_action: result.preventive_action,
          detection_action: result.detection_action,
          ai_generated: true,
          status: 'in_review',
        })
      }
    } finally {
      setAnalyzingId(null)
    }
  }

  const analyzeAll = async () => {
    const unfilled = filtered.filter(i => !i.severity || !i.occurrence || !i.detection)
    if (unfilled.length === 0) return
    setAnalyzingAll(true)
    setAnalyzeProgress({ done: 0, total: unfilled.length })

    setAnalyzeError(null)
    const BATCH = 5
    const CONCURRENT = 3
    const batches: FmeaItem[][] = []
    for (let i = 0; i < unfilled.length; i += BATCH) batches.push(unfilled.slice(i, i + BATCH))

    let done = 0
    for (let i = 0; i < batches.length; i += CONCURRENT) {
      const chunk = batches.slice(i, i + CONCURRENT)
      await Promise.all(chunk.map(async (batch) => {
        const payload = batch.map(item => ({
          id: item.id,
          sw_unit_name: (item as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '',
          category: item.category ?? '',
          variable_name: item.variable_name ?? '',
          variable_type: item.variable_type ?? null,
          failure_mode: item.failure_mode ?? '',
          failure_detail: item.failure_detail ?? null,
          effect_module: item.effect_module ?? null,
          signal_range: item.signal_range ?? null,
        }))
        try {
          const res = await fetch('/api/ai-analyze-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: payload, project_name: project?.name }),
          })
          const data = await res.json()
          if (data.results) {
            // Bulk DB update
            await Promise.all(
              (data.results as { id: string; severity: number; occurrence: number; detection: number; effect_system: string; preventive_action: string; detection_action: string }[]).map(r =>
                fetch(`/api/projects/${id}/items`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    item_id: r.id,
                    severity: r.severity,
                    occurrence: r.occurrence,
                    detection: r.detection,
                    ...(r.effect_system ? { effect_system: r.effect_system } : {}),
                    ...(r.preventive_action ? { preventive_action: r.preventive_action } : {}),
                    ...(r.detection_action ? { detection_action: r.detection_action } : {}),
                    ai_generated: true,
                    status: 'in_review',
                  }),
                })
              )
            )
            // Update local state in bulk
            setItems(prev => {
              const map = Object.fromEntries(
                (data.results as { id: string; severity: number; occurrence: number; detection: number; effect_system: string; preventive_action: string; detection_action: string }[]).map(r => [r.id, r])
              )
              return prev.map(it => map[it.id]
                ? { ...it, ...map[it.id], ai_generated: true, status: 'in_review' as FmeaItem['status'] }
                : it)
            })
            done += data.results.length
            setAnalyzeProgress({ done, total: unfilled.length })
          }
        } catch (e) {
          setAnalyzeError(`API 오류: ${e}`)
          done += batch.length
          setAnalyzeProgress({ done, total: unfilled.length })
        }
      }))
    }

    setAnalyzingAll(false)
    setAnalyzeProgress(null)
  }

  const exportCsv = () => {
    const headers = ['No','SW Unit Name','Interface Category','Interface(Variable) name','Interface(Variable) type','Range','Failure mode','Detail of the failure mode','Effect on Module','Potential Cause','Effect on System','Effect on SG','S','Preventive Action','O','Safety Mechanism','Test Method','Detection Action','D','RPN','CM?','Countermeasure','S\'','O\'','D\'','RPN\'','Target Date','Responsibility','Reference result','Finish Date','Status']
    const rows = filtered.map(i => [
      i.item_no, (i as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '', i.category,
      i.variable_name, i.variable_type, i.signal_range,
      i.failure_mode, i.failure_detail, i.effect_module, i.potential_cause, i.effect_system, i.effect_safety_goal,
      i.severity, i.preventive_action, i.occurrence, i.safety_mechanism_text, i.test_method, i.detection_action, i.detection, i.rpn,
      i.cm_required === true ? 'Y' : i.cm_required === false ? 'N' : '',
      i.countermeasure, i.severity_after, i.occurrence_after, i.detection_after, i.rpn_after,
      i.target_date, i.responsibility, i.reference_result, i.finish_date, i.status,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${project?.name ?? 'fmea'}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportXlsx = () => {
    const HEADERS = [
      'No','SW Unit Name','Interface Category','Interface(Variable) name',
      'Interface(Variable) type','Range','Failure mode','Detail of the failure mode',
      'Effect on Module','Potential Cause','Effect on System','Effect on SG',
      'S','Preventive Action','O','Safety Mechanism','Test Method','Detection Action',
      'D','RPN','CM?','Countermeasure',"S'","O'","D'","RPN'",
      'Target Date','Responsibility','Reference result','Finish Date','Status',
    ]
    const COL_WIDTHS = [6,20,14,28,14,22,12,28,24,24,28,12,5,28,5,24,20,28,5,7,5,24,5,5,5,7,12,16,24,12,10]

    const dataRows = filtered.map(i => [
      i.item_no ?? '',
      (i as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '',
      i.category ?? '',
      i.variable_name ?? '',
      i.variable_type ?? '',
      i.signal_range ?? '',
      i.failure_mode ?? '',
      i.failure_detail ?? '',
      i.effect_module ?? '',
      i.potential_cause ?? '',
      i.effect_system ?? '',
      i.effect_safety_goal ?? '',
      i.severity ?? '',
      i.preventive_action ?? '',
      i.occurrence ?? '',
      i.safety_mechanism_text ?? '',
      i.test_method ?? '',
      i.detection_action ?? '',
      i.detection ?? '',
      i.rpn ?? '',
      i.cm_required === true ? 'Y' : i.cm_required === false ? 'N' : '',
      i.countermeasure ?? '',
      i.severity_after ?? '',
      i.occurrence_after ?? '',
      i.detection_after ?? '',
      i.rpn_after ?? '',
      i.target_date ?? '',
      i.responsibility ?? '',
      i.reference_result ?? '',
      i.finish_date ?? '',
      i.status ?? '',
    ])

    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows])

    // 헤더 행 스타일 (굵게 + 배경색)
    const headerFill = { fgColor: { rgb: '1E293B' } }
    const headerFont = { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 }
    HEADERS.forEach((_, ci) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: ci })]
      if (cell) {
        cell.s = { fill: { patternType: 'solid', ...headerFill }, font: headerFont, alignment: { wrapText: true, vertical: 'center' } }
      }
    })

    // S/O/D/RPN 열 숫자 셀 스타일
    const numCols = new Set([12, 14, 18, 19, 22, 23, 24, 25]) // S,O,D,RPN,S',O',D',RPN'
    dataRows.forEach((_, ri) => {
      numCols.forEach(ci => {
        const cell = ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })]
        if (cell && cell.v !== '') {
          cell.t = 'n'
          const rpn = ci === 19 || ci === 25
          const val = Number(cell.v)
          if (!isNaN(val)) {
            const bg = rpn
              ? val >= 200 ? 'FECACA' : val >= 100 ? 'FED7AA' : val >= 50 ? 'FEF08A' : 'DCFCE7'
              : undefined
            cell.s = bg
              ? { fill: { patternType: 'solid', fgColor: { rgb: bg } }, alignment: { horizontal: 'center' } }
              : { alignment: { horizontal: 'center' } }
          }
        }
      })
    })

    // 열 너비
    ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }))
    // 첫 행 고정
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'FMEA')
    XLSX.writeFile(wb, `${project?.name ?? 'fmea'}_FMEA.xlsx`)
  }

  const filtered = items.filter(i => {
    if (filterUnit && i.sw_unit_id !== filterUnit) return false
    if (filterMode && i.failure_mode !== filterMode) return false
    if (filterStatus === 'unfilled' && i.severity && i.occurrence && i.detection) return false
    if (filterStatus === 'high' && (i.rpn ?? 0) < 100) return false
    if (filterStatus === 'veryhigh' && (i.rpn ?? 0) < 200) return false
    if (filterStatus === 'approved' && i.status !== 'approved') return false
    if (filterCategory && i.category !== filterCategory) return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      if (!(i.variable_name ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const fillRate = items.length > 0
    ? Math.round((items.filter(i => i.severity && i.occurrence && i.detection).length / items.length) * 100)
    : 0

  return (
    <div className="px-4 py-6">
      {showImport && <JsonImportModal projectId={id} onClose={() => setShowImport(false)} onDone={load} />}
      {ragItem && (
        <RagPanel
          item={ragItem}
          onClose={() => setRagItem(null)}
          onApply={(itemId, patch) => { updateItem(itemId, patch); setRagItem(null) }}
        />
      )}

      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <Link href="/projects" className="hover:text-slate-600">프로젝트</Link>
        <span>/</span>
        <Link href={`/projects/${id}`} className="hover:text-slate-600">{project?.name}</Link>
        <span>/</span>
        <span className="text-slate-700">FMEA</span>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-slate-200 mb-4">
        {([['table', 'FMEA 테이블'], ['report', '분석 리포트']] as [typeof view, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${view === key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'report' ? (
        loading ? (
          <div className="text-center py-16 text-slate-400">불러오는 중...</div>
        ) : (
          <ReportDashboard items={items} sgs={sgs} />
        )
      ) : (
      <>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* 통계 */}
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">{filtered.length}/{items.length}개</span>
          <span className="text-slate-300">|</span>
          <span>입력률 <span className="font-bold text-blue-600">{fillRate}%</span></span>
          <span className="text-slate-300">|</span>
          <span>미입력 <span className="font-bold text-red-500">{items.filter(i => !i.severity).length}개</span></span>
        </div>
        <div className="flex-1" />

        {/* 변수명 검색 */}
        <input
          type="text"
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
          placeholder="변수명 검색..."
          className="border border-slate-200 rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />

        {/* 카테고리 토글 */}
        <div className="flex rounded border border-slate-200 overflow-hidden text-sm">
          {(['', 'Internal', 'External'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-2 py-1 ${filterCategory === cat ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {cat === '' ? '전체' : cat}
            </button>
          ))}
        </div>

        {/* 미입력만 빠른 버튼 */}
        <button
          onClick={() => setFilterStatus(filterStatus === 'unfilled' ? '' : 'unfilled')}
          className={`px-2 py-1 rounded text-sm border ${filterStatus === 'unfilled' ? 'bg-red-500 text-white border-red-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          미입력만
        </button>

        <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-sm">
          <option value="">전체 SW Unit</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-sm">
          <option value="">전체 모드</option>
          {FAILURE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={filterStatus === 'unfilled' ? '' : filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-slate-200 rounded px-2 py-1 text-sm"
        >
          <option value="">전체</option>
          <option value="high">고위험(≥100)</option>
          <option value="veryhigh">매우고위험(≥200)</option>
          <option value="approved">승인됨</option>
        </select>

        {analyzeError && (
          <span className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-xs truncate" title={analyzeError}>
            {analyzeError}
          </span>
        )}
        <button onClick={analyzeAll} disabled={analyzingAll} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
          {analyzingAll && analyzeProgress ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {analyzeProgress.done}/{analyzeProgress.total}
            </>
          ) : analyzingAll ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              준비 중...
            </>
          ) : (
            <>AI 전체분석 ({filtered.filter(i => !i.severity || !i.occurrence || !i.detection).length}개)</>
          )}
        </button>
        <button onClick={exportXlsx} className="border border-emerald-400 text-emerald-700 px-3 py-1.5 rounded text-sm hover:bg-emerald-50">Excel 내보내기</button>
        <button onClick={exportCsv} className="border border-slate-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50">CSV</button>
        <button onClick={() => setShowImport(true)} className="border border-slate-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50">JSON 가져오기</button>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-3">항목이 없습니다.</p>
          <button onClick={() => setShowImport(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
            JSON으로 데이터 가져오기
          </button>
        </div>
      ) : (
        <>
        <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-white" style={{ maxHeight: 'calc(100vh - 11rem)' }}>
          <table className="text-xs" style={{ tableLayout: 'fixed', width: 'max-content' }}>
            <colgroup>
              {[48,140,90,160,80,180,80,160,160,160,160,80,50,160,50,180,120,160,50,60,50,160,50,50,50,60,100,120,120,100,90,50].map((w,i) => (
                <col key={i} style={{ width: cw(i, w) }} />
              ))}
            </colgroup>
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-20">
              <tr>
                {([
                  [0,'No','border-r border-slate-200'],
                  [1,'SW Unit Name',''],
                  [2,'Interface Category',''],
                  [3,'Interface(Variable) name',''],
                  [4,'Interface(Variable) type',''],
                  [5,'Range',''],
                  [6,'Failure mode','border-l border-slate-200'],
                  [7,'Detail of the failure mode',''],
                  [8,'Effect on Module',''],
                  [9,'Potential Cause',''],
                  [10,'Effect on System',''],
                  [11,'Effect on SG',''],
                  [12,'S','border-l border-slate-200 text-center'],
                  [13,'Preventive Action',''],
                  [14,'O','text-center'],
                  [15,'Safety Mechanism',''],
                  [16,'Test Method',''],
                  [17,'Detection Action',''],
                  [18,'D','text-center'],
                  [19,'RPN','text-center'],
                  [20,'CM?','border-l border-slate-200 text-center'],
                  [21,'Countermeasure',''],
                  [22,"S'",'text-center'],
                  [23,"O'",'text-center'],
                  [24,"D'",'text-center'],
                  [25,"RPN'",'text-center'],
                  [26,'Target Date','border-l border-slate-200'],
                  [27,'Responsibility',''],
                  [28,'Reference result',''],
                  [29,'Finish Date',''],
                  [30,'상태','border-l border-slate-200 text-center'],
                  [31,'AI','text-center'],
                ] as [number, string, string][]).map(([col, label, cls]) => (
                  <th key={col} className={`px-2 py-2 font-medium text-slate-600 text-left overflow-hidden relative select-none group/th ${cls}`}
                    style={{ width: cw(col, 0) }}>
                    <span className="block overflow-hidden text-ellipsis">{label}</span>
                    <div
                      onMouseDown={e => startResize(col, e)}
                      className="absolute right-0 top-0 h-full w-3 cursor-col-resize z-10 flex items-center justify-center"
                    >
                      <div className="w-px h-4 bg-slate-300 group-hover/th:bg-blue-400 group-hover/th:w-0.5 transition-all" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item, idx) => {
                const swName = (item as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '-'
                const T = ({ v, cls }: { v: string | null | undefined, cls?: string }) => (
                  <td className={`px-2 py-1.5 text-slate-600 align-top ${cls ?? ''}`} title={v ?? ''}>
                    <div style={{ maxHeight: '4.5rem', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {v ?? '-'}
                    </div>
                  </td>
                )
                const Mono = ({ v, cls }: { v: string | null | undefined, cls?: string }) => (
                  <td className={`px-2 py-1.5 font-mono text-slate-700 align-top ${cls ?? ''}`} title={v ?? ''}>
                    <div style={{ maxHeight: '4.5rem', overflow: 'hidden', wordBreak: 'break-all' }}>
                      {v ?? '-'}
                    </div>
                  </td>
                )
                return (
                  <tr key={item.id} className={`hover:bg-slate-50 ${!item.severity ? 'bg-red-50/30' : ''}`}>
                    <td className="px-2 py-1.5 text-slate-500 font-mono border-r border-slate-100 whitespace-nowrap">{idx + 1}</td>
                    <Mono v={swName} />
                    <td className="px-2 py-1.5 align-top">
                      <span className={`px-1 py-0.5 rounded ${item.category === 'External' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                        {item.category === 'External' ? 'External' : item.category === 'Internal' ? 'Internal' : '-'}
                      </span>
                    </td>
                    <Mono v={item.variable_name} />
                    <td className="px-2 py-1.5 text-slate-500 align-top whitespace-nowrap overflow-hidden" style={{ textOverflow: 'ellipsis' }}>{item.variable_type ?? '-'}</td>
                    <T v={item.signal_range} />
                    <td className="px-2 py-1.5 border-l border-slate-100 align-top whitespace-nowrap">
                      <span className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded font-mono">{item.failure_mode ?? '-'}</span>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <textarea value={item.failure_detail ?? ''} onChange={e => updateItem(item.id, { failure_detail: e.target.value })} rows={2}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <textarea value={item.effect_module ?? ''} onChange={e => updateItem(item.id, { effect_module: e.target.value })} rows={2}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <T v={item.potential_cause} />
                    <td className="px-2 py-1.5 align-top">
                      <textarea value={item.effect_system ?? ''} onChange={e => updateItem(item.id, { effect_system: e.target.value })} rows={2}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <select
                        value={item.safety_goal_id ?? ''}
                        onChange={e => {
                          const sg = sgs.find(s => s.id === e.target.value)
                          updateItem(item.id, {
                            safety_goal_id: e.target.value || null,
                            effect_safety_goal: sg?.sg_id ?? null,
                          })
                        }}
                        className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                        <option value="">-</option>
                        {sgs.map(sg => (
                          <option key={sg.id} value={sg.id}>
                            {sg.sg_id}{sg.asil ? ` (ASIL-${sg.asil})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-center border-l border-slate-100 align-top"><NumInput value={item.severity} onChange={v => updateItem(item.id, { severity: v })} /></td>
                    <td className="px-2 py-1.5 align-top">
                      <textarea value={item.preventive_action ?? ''} onChange={e => updateItem(item.id, { preventive_action: e.target.value })} rows={2}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-1.5 text-center align-top"><NumInput value={item.occurrence} onChange={v => updateItem(item.id, { occurrence: v })} /></td>
                    <td className="px-2 py-1.5 align-top">
                      <select
                        value={item.safety_mechanism_text ?? ''}
                        onChange={e => {
                          const sm = sms.find(s => s.sm_id === e.target.value)
                          updateItem(item.id, {
                            safety_mechanism_text: e.target.value || null,
                            safety_mechanism_id: sm?.id ?? null,
                          })
                        }}
                        className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                        title={sms.find(s => s.sm_id === item.safety_mechanism_text)?.description ?? ''}
                      >
                        <option value="">-</option>
                        {sms.map(sm => (
                          <option key={sm.id} value={sm.sm_id}>
                            {sm.sm_id} {sm.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <T v={item.test_method} />
                    <td className="px-2 py-1.5 align-top">
                      <textarea value={item.detection_action ?? ''} onChange={e => updateItem(item.id, { detection_action: e.target.value })} rows={2}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-1.5 text-center align-top"><NumInput value={item.detection} onChange={v => updateItem(item.id, { detection: v })} /></td>
                    <td className="px-2 py-1.5 text-center align-top"><RpnBadge rpn={item.rpn} /></td>
                    <td className="px-2 py-1.5 text-center border-l border-slate-100 align-top">
                      <span className={`px-1 py-0.5 rounded text-xs font-medium ${item.cm_required === true ? 'bg-orange-100 text-orange-700' : item.cm_required === false ? 'bg-slate-100 text-slate-500' : 'text-slate-300'}`}>
                        {item.cm_required === true ? 'Y' : item.cm_required === false ? 'N' : '-'}
                      </span>
                    </td>
                    <T v={item.countermeasure} />
                    <td className="px-2 py-1.5 text-center text-slate-500 align-top whitespace-nowrap">{item.severity_after ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500 align-top whitespace-nowrap">{item.occurrence_after ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500 align-top whitespace-nowrap">{item.detection_after ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center align-top"><RpnBadge rpn={item.rpn_after} /></td>
                    <td className="px-2 py-1.5 text-slate-500 border-l border-slate-100 align-top whitespace-nowrap">{item.target_date ?? '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500 align-top whitespace-nowrap">{item.responsibility ?? '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500 align-top" title={item.reference_result ?? ''}>
                      <div style={{ maxHeight: '4.5rem', overflow: 'hidden', wordBreak: 'break-word' }}>{item.reference_result ?? '-'}</div>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500 align-top whitespace-nowrap">{item.finish_date ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center border-l border-slate-100 align-top">
                      <select value={item.status} onChange={e => updateItem(item.id, { status: e.target.value as FmeaItem['status'] })} className="border border-slate-200 rounded px-1 py-0.5 text-xs">
                        <option value="draft">draft</option>
                        <option value="in_review">검토중</option>
                        <option value="approved">승인</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-center align-top">
                      <div className="flex flex-col gap-1 items-center">
                        <button onClick={() => analyzeItem(item)} disabled={analyzingId === item.id || analyzingAll}
                          className="bg-blue-50 text-blue-600 border border-blue-200 rounded px-2 py-1 text-xs hover:bg-blue-100 disabled:opacity-40 w-full">
                          {analyzingId === item.id ? '...' : 'AI'}
                        </button>
                        <button onClick={() => setRagItem({ id: item.id, variable_name: item.variable_name ?? '', failure_mode: item.failure_mode ?? null })}
                          className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-1 text-xs hover:bg-emerald-100 w-full">
                          유사
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
