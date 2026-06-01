'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, type SafetyGoal, type SafetyMechanism } from '@/lib/supabase'

type SourceProject = { id: string; name: string }


export default function NewProjectPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', vehicle_model: '', description: '' })
  const [saving, setSaving] = useState(false)

  // Safety Goal / Mechanism 복사 설정
  const [sourceProjects, setSourceProjects] = useState<SourceProject[]>([])
  const [sourceId, setSourceId] = useState('')
  const [sgs, setSgs] = useState<SafetyGoal[]>([])
  const [sms, setSms] = useState<SafetyMechanism[]>([])
  const [selSg, setSelSg] = useState<Set<string>>(new Set())
  const [selSm, setSelSm] = useState<Set<string>>(new Set())
  const [loadingSrc, setLoadingSrc] = useState(false)

  // SG/SM이 있는 프로젝트 목록
  useEffect(() => {
    supabase
      .from('safety_goals')
      .select('project_id, projects(id, name)')
      .limit(200)
      .then(({ data }) => {
        if (!data) return
        const seen = new Map<string, string>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.forEach((r: any) => {
          const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
          if (proj && !seen.has(r.project_id))
            seen.set(r.project_id, proj.name)
        })
        setSourceProjects(
          Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
        )
      })
  }, [])

  // 소스 프로젝트 선택 시 SG/SM 로드
  useEffect(() => {
    if (!sourceId) { setSgs([]); setSms([]); setSelSg(new Set()); setSelSm(new Set()); return }
    setLoadingSrc(true)
    Promise.all([
      supabase.from('safety_goals').select('*').eq('project_id', sourceId).order('sg_id'),
      supabase.from('safety_mechanisms').select('*').eq('project_id', sourceId).order('sm_id'),
    ]).then(([{ data: sgData }, { data: smData }]) => {
      const sgList = sgData ?? []
      const smList = smData ?? []
      setSgs(sgList)
      setSms(smList)
      setSelSg(new Set(sgList.map((s: SafetyGoal) => s.id)))
      setSelSm(new Set(smList.map((s: SafetyMechanism) => s.id)))
      setLoadingSrc(false)
    })
  }, [sourceId])

  const toggleSg = (id: string) =>
    setSelSg(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleSm = (id: string) =>
    setSelSm(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleAllSg = () =>
    setSelSg(selSg.size === sgs.length ? new Set() : new Set(sgs.map(s => s.id)))
  const toggleAllSm = () =>
    setSelSm(selSm.size === sms.length ? new Set() : new Set(sms.map(s => s.id)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const { data: proj } = await supabase.from('projects').insert([form]).select().single()
    if (!proj) { setSaving(false); return }

    // 선택된 SG/SM 복사
    const sgToCopy = sgs.filter(s => selSg.has(s.id)).map(({ id: _id, project_id: _pid, created_at: _ca, ...rest }) => ({ ...rest, project_id: proj.id }))
    const smToCopy = sms.filter(s => selSm.has(s.id)).map(({ id: _id, project_id: _pid, created_at: _ca, ...rest }) => ({ ...rest, project_id: proj.id }))

    await Promise.all([
      sgToCopy.length > 0 ? supabase.from('safety_goals').insert(sgToCopy) : Promise.resolve(),
      smToCopy.length > 0 ? supabase.from('safety_mechanisms').insert(smToCopy) : Promise.resolve(),
    ])

    router.push(`/projects/${proj.id}`)
  }

  const ASIL_COLOR: Record<string, string> = {
    A: 'bg-yellow-100 text-yellow-700',
    B: 'bg-orange-100 text-orange-700',
    C: 'bg-red-100 text-red-700',
    D: 'bg-red-200 text-red-800',
    QM: 'bg-slate-100 text-slate-500',
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">새 프로젝트</h1>

      <Link href="/projects/import" className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 hover:bg-blue-100 transition-colors group">
        <div>
          <div className="font-semibold text-blue-800 text-sm">ARXML로 자동 가져오기</div>
          <div className="text-xs text-blue-600 mt-0.5">ARXML + DBC 업로드 → S/O/D 자동 생성</div>
        </div>
        <span className="text-blue-400 group-hover:text-blue-600 text-lg">→</span>
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400">또는 수동으로 생성</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 기본 정보 */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">프로젝트명 *</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="예: JG1_SBW_SW_FMEA"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">차종</label>
            <input
              value={form.vehicle_model}
              onChange={e => setForm(f => ({ ...f, vehicle_model: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="예: JG1, NQ6e, SX3"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">설명</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"
            />
          </div>
        </div>

        {/* Safety Goal / Mechanism 복사 */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-4">
          <div>
            <div className="text-sm font-medium text-slate-700 mb-1">Safety Goal · Mechanism 초기화</div>
            <div className="text-xs text-slate-400 mb-2">기존 프로젝트에서 복사할 항목을 선택하세요.</div>
            <select
              value={sourceId}
              onChange={e => setSourceId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            >
              <option value="">복사 안 함</option>
              {sourceProjects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {loadingSrc && (
            <div className="text-xs text-slate-400 text-center py-2">불러오는 중...</div>
          )}

          {!loadingSrc && sgs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Safety Goal ({selSg.size}/{sgs.length})</span>
                <button type="button" onClick={toggleAllSg} className="text-xs text-blue-600 hover:underline">
                  {selSg.size === sgs.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {sgs.map(sg => (
                  <label key={sg.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selSg.has(sg.id)}
                      onChange={() => toggleSg(sg.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-400"
                    />
                    <span className="font-mono text-xs text-slate-700">{sg.sg_id}</span>
                    {sg.asil && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ASIL_COLOR[sg.asil] ?? 'bg-slate-100 text-slate-500'}`}>
                        ASIL {sg.asil}
                      </span>
                    )}
                    <span className="text-xs text-slate-500 truncate">{sg.description}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!loadingSrc && sms.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Safety Mechanism ({selSm.size}/{sms.length})</span>
                <button type="button" onClick={toggleAllSm} className="text-xs text-blue-600 hover:underline">
                  {selSm.size === sms.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                {sms.map(sm => (
                  <label key={sm.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selSm.has(sm.id)}
                      onChange={() => toggleSm(sm.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-400 shrink-0"
                    />
                    <span className="font-mono text-xs text-slate-700 shrink-0">{sm.sm_id}</span>
                    <span className="text-xs text-slate-500 truncate">{sm.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()} className="flex-1 border border-slate-300 rounded-lg py-2 text-sm hover:bg-slate-50">취소</button>
          <button type="submit" disabled={saving} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm hover:bg-slate-700 disabled:opacity-50">
            {saving ? '생성 중...' : '프로젝트 생성'}
          </button>
        </div>
      </form>
    </div>
  )
}
