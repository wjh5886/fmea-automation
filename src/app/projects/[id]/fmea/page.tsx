'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, type FmeaItem, type SwUnit, type Project, type SafetyGoal, type SafetyMechanism } from '@/lib/supabase'

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
  const [filterUnit, setFilterUnit] = useState('')
  const [filterMode, setFilterMode] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzingAll, setAnalyzingAll] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: proj }, { data: unitData }, { data: sgData }, { data: smData }, { data: itemData }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('sw_units').select('*').eq('project_id', id).order('name'),
      supabase.from('safety_goals').select('*').eq('project_id', id).order('sg_id'),
      supabase.from('safety_mechanisms').select('*').eq('project_id', id).order('sm_id'),
      supabase.from('fmea_items').select('*,sw_units(name)').eq('project_id', id).order('item_no').order('failure_mode'),
    ])
    setProject(proj)
    setUnits(unitData ?? [])
    setSgs(sgData ?? [])
    setSms(smData ?? [])
    setItems(itemData ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const updateItem = async (itemId: string, patch: Partial<FmeaItem>) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...patch } : i))
    await supabase.from('fmea_items').update(patch).eq('id', itemId)
  }

  const analyzeItem = async (item: FmeaItem) => {
    setAnalyzingId(item.id)
    try {
      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      })
      const result = await res.json()
      if (result.severity) {
        await updateItem(item.id, {
          severity: result.severity,
          occurrence: result.occurrence,
          detection: result.detection,
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
    setAnalyzingAll(true)
    const unfilled = filtered.filter(i => !i.severity || !i.occurrence || !i.detection)
    for (const item of unfilled) {
      await analyzeItem(item)
    }
    setAnalyzingAll(false)
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

  const filtered = items.filter(i => {
    if (filterUnit && i.sw_unit_id !== filterUnit) return false
    if (filterMode && i.failure_mode !== filterMode) return false
    if (filterStatus === 'unfilled' && i.severity && i.occurrence && i.detection) return false
    if (filterStatus === 'high' && (i.rpn ?? 0) < 100) return false
    if (filterStatus === 'approved' && i.status !== 'approved') return false
    return true
  })

  const fillRate = items.length > 0
    ? Math.round((items.filter(i => i.severity && i.occurrence && i.detection).length / items.length) * 100)
    : 0

  return (
    <div className="px-4 py-6">
      {showImport && <JsonImportModal projectId={id} onClose={() => setShowImport(false)} onDone={load} />}

      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <Link href="/projects" className="hover:text-slate-600">프로젝트</Link>
        <span>/</span>
        <Link href={`/projects/${id}`} className="hover:text-slate-600">{project?.name}</Link>
        <span>/</span>
        <span className="text-slate-700">FMEA</span>
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">{filtered.length}/{items.length}개</span>
          <span className="text-slate-300">|</span>
          <span>입력률 <span className="font-bold text-blue-600">{fillRate}%</span></span>
          <span className="text-slate-300">|</span>
          <span>미입력 <span className="font-bold text-red-500">{items.filter(i => !i.severity).length}개</span></span>
        </div>
        <div className="flex-1" />

        <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-sm">
          <option value="">전체 SW Unit</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-sm">
          <option value="">전체 모드</option>
          {FAILURE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-sm">
          <option value="">전체</option>
          <option value="unfilled">미입력만</option>
          <option value="high">고위험(≥100)</option>
          <option value="approved">승인됨</option>
        </select>

        <button onClick={analyzeAll} disabled={analyzingAll} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
          {analyzingAll ? '분석 중...' : '🤖 AI 전체분석'}
        </button>
        <button onClick={exportCsv} className="border border-slate-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50">📥 CSV</button>
        <button onClick={() => setShowImport(true)} className="border border-slate-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50">📋 JSON 가져오기</button>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-3">항목이 없습니다.</p>
          <button onClick={() => setShowImport(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
            📋 JSON으로 데이터 가져오기
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="text-xs" style={{ tableLayout: 'auto', whiteSpace: 'nowrap' }}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {/* 기본 식별 */}
                <th className="px-2 py-2 text-left font-medium text-slate-600 border-r border-slate-200">No</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">SW Unit Name</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Interface Category</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Interface(Variable) name</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Interface(Variable) type</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Range</th>
                {/* 고장 분석 */}
                <th className="px-2 py-2 text-left font-medium text-slate-600 border-l border-slate-200">Failure mode</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Detail of the failure mode</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Effect on Module</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Potential Cause</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Effect on System</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Effect on SG</th>
                {/* S/O/D */}
                <th className="px-2 py-2 text-center font-medium text-slate-600 border-l border-slate-200">S</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Preventive Action</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">O</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Safety Mechanism</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '7rem' }}>Test Method</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Detection Action</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">D</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">RPN</th>
                {/* 대책 */}
                <th className="px-2 py-2 text-center font-medium text-slate-600 border-l border-slate-200">CM?</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600" style={{ minWidth: '9rem' }}>Countermeasure</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">S'</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">O'</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">D'</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">RPN'</th>
                {/* 관리 */}
                <th className="px-2 py-2 text-left font-medium text-slate-600 border-l border-slate-200">Target Date</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Responsibility</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Reference result</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Finish Date</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600 border-l border-slate-200">상태</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">AI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(item => {
                const swName = (item as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '-'
                const T = ({ v, cls }: { v: string | null | undefined, cls?: string }) => (
                  <td className={`px-2 py-1.5 text-slate-600 max-w-[12rem] truncate ${cls ?? ''}`} style={{ whiteSpace: 'normal' }} title={v ?? ''}>{v ?? '-'}</td>
                )
                return (
                  <tr key={item.id} className={`hover:bg-slate-50 ${!item.severity ? 'bg-red-50/30' : ''}`}>
                    <td className="px-2 py-1.5 text-slate-500 font-mono border-r border-slate-100">{item.item_no}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-700 max-w-[8rem] truncate" title={swName}>{swName}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-1 py-0.5 rounded ${item.category === 'External' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                        {item.category === 'External' ? 'External' : item.category === 'Internal' ? 'Internal' : '-'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-700 max-w-[10rem] truncate" title={item.variable_name}>{item.variable_name}</td>
                    <td className="px-2 py-1.5 text-slate-500">{item.variable_type ?? '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500 max-w-[10rem] truncate" title={item.signal_range ?? ''}>{item.signal_range ?? '-'}</td>
                    <td className="px-2 py-1.5 border-l border-slate-100">
                      <span className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded font-mono">{item.failure_mode ?? '-'}</span>
                    </td>
                    <T v={item.failure_detail} />
                    <T v={item.effect_module} />
                    <T v={item.potential_cause} />
                    <T v={item.effect_system} />
                    <T v={item.effect_safety_goal} />
                    <td className="px-2 py-1.5 text-center border-l border-slate-100"><NumInput value={item.severity} onChange={v => updateItem(item.id, { severity: v })} /></td>
                    <td className="px-2 py-1.5" style={{ whiteSpace: 'normal' }}>
                      <textarea value={item.preventive_action ?? ''} onChange={e => updateItem(item.id, { preventive_action: e.target.value })} rows={1}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-1.5 text-center"><NumInput value={item.occurrence} onChange={v => updateItem(item.id, { occurrence: v })} /></td>
                    <T v={item.safety_mechanism_text} />
                    <T v={item.test_method} />
                    <td className="px-2 py-1.5" style={{ whiteSpace: 'normal' }}>
                      <textarea value={item.detection_action ?? ''} onChange={e => updateItem(item.id, { detection_action: e.target.value })} rows={1}
                        className="w-full min-w-[8rem] border border-slate-200 rounded px-1.5 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-1.5 text-center"><NumInput value={item.detection} onChange={v => updateItem(item.id, { detection: v })} /></td>
                    <td className="px-2 py-1.5 text-center"><RpnBadge rpn={item.rpn} /></td>
                    <td className="px-2 py-1.5 text-center border-l border-slate-100">
                      <span className={`px-1 py-0.5 rounded text-xs font-medium ${item.cm_required === true ? 'bg-orange-100 text-orange-700' : item.cm_required === false ? 'bg-slate-100 text-slate-500' : 'text-slate-300'}`}>
                        {item.cm_required === true ? 'Y' : item.cm_required === false ? 'N' : '-'}
                      </span>
                    </td>
                    <T v={item.countermeasure} />
                    <td className="px-2 py-1.5 text-center text-slate-500">{item.severity_after ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500">{item.occurrence_after ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500">{item.detection_after ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center"><RpnBadge rpn={item.rpn_after} /></td>
                    <td className="px-2 py-1.5 text-slate-500 border-l border-slate-100">{item.target_date ?? '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500">{item.responsibility ?? '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500 max-w-[8rem] truncate" title={item.reference_result ?? ''}>{item.reference_result ?? '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500">{item.finish_date ?? '-'}</td>
                    <td className="px-2 py-1.5 text-center border-l border-slate-100">
                      <select value={item.status} onChange={e => updateItem(item.id, { status: e.target.value as FmeaItem['status'] })} className="border border-slate-200 rounded px-1 py-0.5 text-xs">
                        <option value="draft">draft</option>
                        <option value="in_review">검토중</option>
                        <option value="approved">승인</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => analyzeItem(item)} disabled={analyzingId === item.id || analyzingAll}
                        className="bg-blue-50 text-blue-600 border border-blue-200 rounded px-2 py-1 text-xs hover:bg-blue-100 disabled:opacity-40">
                        {analyzingId === item.id ? '...' : '🤖'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
