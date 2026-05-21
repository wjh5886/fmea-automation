'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, type Project, type SwUnit, type SafetyGoal, type SafetyMechanism } from '@/lib/supabase'

type StatItem = { id: string; severity: number | null; occurrence: number | null; detection: number | null; rpn: number | null }
type Tab = 'overview' | 'sg' | 'sm'

const ASIL_COLORS: Record<string, string> = {
  D: 'bg-red-100 text-red-700', C: 'bg-orange-100 text-orange-700',
  B: 'bg-yellow-100 text-yellow-700', A: 'bg-blue-100 text-blue-700', QM: 'bg-slate-100 text-slate-600',
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [units, setUnits] = useState<SwUnit[]>([])
  const [sgs, setSgs] = useState<SafetyGoal[]>([])
  const [sms, setSms] = useState<SafetyMechanism[]>([])
  const [stats, setStats] = useState({ total: 0, filled: 0, high_rpn: 0 })
  const [tab, setTab] = useState<Tab>('overview')

  // SG form
  const [sgForm, setSgForm] = useState({ sg_id: '', name: '', asil: 'QM', description: '' })
  const [savingSg, setSavingSg] = useState(false)

  // SM form
  const [smForm, setSmForm] = useState({ sm_id: '', name: '', type: 'Preventive', diagnostic_coverage: 'Medium', description: '', related_sg_id: '' })
  const [savingSm, setSavingSm] = useState(false)

  // SW Unit
  const [newUnit, setNewUnit] = useState('')
  const [addingUnit, setAddingUnit] = useState(false)

  const load = useCallback(async () => {
    const [{ data: proj }, { data: unitData }, { data: sgData }, { data: smData },
      { count: total }, { count: filled }, { count: high_rpn }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('sw_units').select('*').eq('project_id', id).order('name'),
      supabase.from('safety_goals').select('*').eq('project_id', id).order('sg_id'),
      supabase.from('safety_mechanisms').select('*').eq('project_id', id).order('sm_id'),
      supabase.from('fmea_items').select('*', { count: 'exact', head: true }).eq('project_id', id),
      supabase.from('fmea_items').select('*', { count: 'exact', head: true }).eq('project_id', id)
        .not('severity', 'is', null).not('occurrence', 'is', null).not('detection', 'is', null),
      supabase.from('fmea_items').select('*', { count: 'exact', head: true }).eq('project_id', id)
        .gte('rpn', 100),
    ])
    setProject(proj)
    setUnits(unitData ?? [])
    setSgs(sgData ?? [])
    setSms(smData ?? [])
    setStats({ total: total ?? 0, filled: filled ?? 0, high_rpn: high_rpn ?? 0 })
  }, [id])

  useEffect(() => { load() }, [load])

  const addUnit = async () => {
    if (!newUnit.trim()) return
    setAddingUnit(true)
    const { data } = await supabase.from('sw_units').insert([{ project_id: id, name: newUnit.trim() }]).select().single()
    if (data) setUnits(u => [...u, data])
    setNewUnit('')
    setAddingUnit(false)
  }

  const addSg = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSg(true)
    const { data } = await supabase.from('safety_goals').insert([{ project_id: id, ...sgForm }]).select().single()
    if (data) { setSgs(s => [...s, data]); setSgForm({ sg_id: '', name: '', asil: 'QM', description: '' }) }
    setSavingSg(false)
  }

  const deleteSg = async (sgId: string) => {
    await supabase.from('safety_goals').delete().eq('id', sgId)
    setSgs(s => s.filter(x => x.id !== sgId))
  }

  const addSm = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSm(true)
    const payload = { project_id: id, ...smForm, related_sg_id: smForm.related_sg_id || null }
    const { data } = await supabase.from('safety_mechanisms').insert([payload]).select().single()
    if (data) { setSms(s => [...s, data]); setSmForm({ sm_id: '', name: '', type: 'Preventive', diagnostic_coverage: 'Medium', description: '', related_sg_id: '' }) }
    setSavingSm(false)
  }

  const deleteSm = async (smId: string) => {
    await supabase.from('safety_mechanisms').delete().eq('id', smId)
    setSms(s => s.filter(x => x.id !== smId))
  }

  const deleteProject = async () => {
    if (!project || !confirm(`"${project.name}" 을 삭제하시겠습니까?\n삭제된 프로젝트 함에서 복원할 수 있습니다.`)) return
    await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    router.push('/projects')
  }

  if (!project) return <div className="text-center py-16 text-slate-400">불러오는 중...</div>

  const fillRate = stats.total > 0 ? Math.round((stats.filled / stats.total) * 100) : 0

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* 브레드크럼 */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <Link href="/projects" className="hover:text-slate-600">프로젝트</Link>
        <span>/</span>
        <span className="text-slate-700">{project.name}</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
          {project.vehicle_model && <p className="text-slate-500 text-sm mt-1">차종: {project.vehicle_model}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={deleteProject}
            className="border border-red-200 text-red-500 px-4 py-2 rounded-lg text-sm hover:bg-red-50 transition-colors">
            🗑️ 삭제
          </button>
          <Link href={`/projects/${id}/fmea`} className="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm hover:bg-slate-700 transition-colors">
            FMEA 테이블 →
          </Link>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: '전체 항목', value: stats.total, color: 'text-slate-800' },
          { label: 'S/O/D 입력률', value: `${fillRate}%`, color: 'text-blue-600' },
          { label: '고위험(RPN≥100)', value: stats.high_rpn, color: 'text-red-500' },
          { label: 'Safety Goal', value: sgs.length, color: 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div className="flex border-b border-slate-200 mb-6">
        {([['overview', 'SW Unit'], ['sg', `Safety Goal (${sgs.length})`], ['sm', `Safety Mechanism (${sms.length})`]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview 탭 - SW Unit */}
      {tab === 'overview' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">SW Unit 목록</h2>
          <div className="flex gap-2 mb-4">
            <input value={newUnit} onChange={e => setNewUnit(e.target.value)} onKeyDown={e => e.key === 'Enter' && addUnit()}
              placeholder="SW Unit 이름 (예: CstAp_PwrMGT)"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            <button onClick={addUnit} disabled={addingUnit} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-50">추가</button>
          </div>
          {units.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">SW Unit을 추가하세요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {units.map(u => <span key={u.id} className="bg-slate-100 text-slate-700 text-sm px-3 py-1 rounded-full font-mono">{u.name}</span>)}
            </div>
          )}
        </div>
      )}

      {/* SG 탭 */}
      {tab === 'sg' && (
        <div className="flex flex-col gap-5">
          {/* SG 추가 폼 */}
          <form onSubmit={addSg} className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Safety Goal 추가</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">SG ID *</label>
                <input required value={sgForm.sg_id} onChange={e => setSgForm(f => ({ ...f, sg_id: e.target.value }))}
                  placeholder="예: SG-001" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">ASIL</label>
                <select value={sgForm.asil} onChange={e => setSgForm(f => ({ ...f, asil: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  {['QM', 'A', 'B', 'C', 'D'].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="text-xs font-medium text-slate-600 mb-1 block">Safety Goal 명 *</label>
              <input required value={sgForm.name} onChange={e => setSgForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: 변속기 오작동으로 인한 의도치 않은 차량 이동 방지"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-600 mb-1 block">설명</label>
              <textarea value={sgForm.description} onChange={e => setSgForm(f => ({ ...f, description: e.target.value }))}
                rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <button type="submit" disabled={savingSg} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-50">
              {savingSg ? '저장 중...' : '+ Safety Goal 추가'}
            </button>
          </form>

          {/* SG 목록 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {sgs.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">Safety Goal을 추가하세요.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600 w-24">SG ID</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600 w-16">ASIL</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Safety Goal</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">설명</th>
                    <th className="px-4 py-2 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sgs.map(sg => (
                    <tr key={sg.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700">{sg.sg_id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${ASIL_COLORS[sg.asil ?? 'QM']}`}>{sg.asil ?? 'QM'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-800">{sg.name}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{sg.description ?? '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => deleteSg(sg.id)} className="text-slate-300 hover:text-red-500 transition-colors">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* SM 탭 */}
      {tab === 'sm' && (
        <div className="flex flex-col gap-5">
          {/* SM 추가 폼 */}
          <form onSubmit={addSm} className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Safety Mechanism 추가</h2>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">SM ID *</label>
                <input required value={smForm.sm_id} onChange={e => setSmForm(f => ({ ...f, sm_id: e.target.value }))}
                  placeholder="예: SM-001"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">종류</label>
                <select value={smForm.type} onChange={e => setSmForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  {['Preventive', 'Detection', 'Both'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Diagnostic Coverage</label>
                <select value={smForm.diagnostic_coverage} onChange={e => setSmForm(f => ({ ...f, diagnostic_coverage: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  {['Low', 'Medium', 'High', 'N/A'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">SM 명 *</label>
                <input required value={smForm.name} onChange={e => setSmForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: E2E 통신 검증"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">관련 Safety Goal</label>
                <select value={smForm.related_sg_id} onChange={e => setSmForm(f => ({ ...f, related_sg_id: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">-</option>
                  {sgs.map(sg => <option key={sg.id} value={sg.id}>{sg.sg_id}: {sg.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-600 mb-1 block">설명</label>
              <textarea value={smForm.description} onChange={e => setSmForm(f => ({ ...f, description: e.target.value }))}
                rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <button type="submit" disabled={savingSm} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-50">
              {savingSm ? '저장 중...' : '+ Safety Mechanism 추가'}
            </button>
          </form>

          {/* SM 목록 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {sms.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">Safety Mechanism을 추가하세요.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600 w-20">SM ID</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600 w-24">종류</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">SM 명</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600 w-24">Coverage</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600 w-24">관련 SG</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">설명</th>
                    <th className="px-4 py-2 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sms.map(sm => {
                    const relatedSg = sgs.find(sg => sg.id === sm.related_sg_id)
                    const coverageColor = sm.diagnostic_coverage === 'High' ? 'bg-green-100 text-green-700' : sm.diagnostic_coverage === 'Medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600'
                    const typeColor = sm.type === 'Preventive' ? 'bg-blue-50 text-blue-700' : sm.type === 'Detection' ? 'bg-purple-50 text-purple-700' : 'bg-teal-50 text-teal-700'
                    return (
                      <tr key={sm.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-semibold text-slate-700">{sm.sm_id}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs ${typeColor}`}>{sm.type}</span></td>
                        <td className="px-4 py-3 text-slate-800">{sm.name}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${coverageColor}`}>{sm.diagnostic_coverage}</span></td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{relatedSg ? relatedSg.sg_id : '-'}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{sm.description ?? '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => deleteSm(sm.id)} className="text-slate-300 hover:text-red-500 transition-colors">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
