'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'

const BACKEND = '/api'

type Category = 'Safety' | 'Control' | 'Monitor' | 'Communication'

interface FunctionItem {
  id: string
  name: string
  description: string
  category: Category
}

interface JobState {
  status: 'running' | 'done' | 'error'
  progress: number
  logs: string[]
  project_id: string | null
  error?: string
}

const CAT_COLORS: Record<Category, string> = {
  Safety:        'bg-red-100 text-red-700',
  Control:       'bg-blue-100 text-blue-700',
  Monitor:       'bg-amber-100 text-amber-700',
  Communication: 'bg-purple-100 text-purple-700',
}

export default function ConceptFmeaPage() {
  const [projectName, setProjectName] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [specFile, setSpecFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [functions, setFunctions] = useState<FunctionItem[]>([])
  const [newFunc, setNewFunc] = useState({ name: '', description: '', category: 'Control' as Category })
  const [job, setJob] = useState<JobState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setSpecFile(f)
  }, [])

  function addFunction() {
    if (!newFunc.name.trim()) return
    setFunctions(prev => [...prev, { ...newFunc, id: crypto.randomUUID() }])
    setNewFunc({ name: '', description: '', category: 'Control' })
  }

  function removeFunction(id: string) {
    setFunctions(prev => prev.filter(f => f.id !== id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectName.trim()) return
    setSubmitting(true)
    setJob({ status: 'running', progress: 10, logs: ['문서 파싱 및 기능 추출 중...'], project_id: null })

    const fd = new FormData()
    fd.append('project_name', projectName)
    fd.append('vehicle_model', vehicleModel)
    if (specFile) fd.append('spec_file', specFile)
    fd.append('functions_json', JSON.stringify(
      functions.map(({ name, description, category }) => ({ name, description, category }))
    ))

    try {
      const r = await fetch(`${BACKEND}/concept`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? '생성 실패')
      setJob({
        status: 'done', progress: 100,
        logs: [`기능 ${data.functions}개 추출, FMEA 항목 ${data.items}개 생성 완료`],
        project_id: data.project_id,
      })
    } catch (err) {
      setJob({ status: 'error', progress: 0, logs: [], project_id: null, error: String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const stepDone = (pct: number) => job && (job.status === 'done' || (job.progress ?? 0) >= pct)

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/projects" className="text-slate-400 hover:text-slate-600 text-sm">← 프로젝트</Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-xl font-bold text-slate-900">개념 FMEA 생성</h1>
      </div>

      {/* 진행 단계 */}
      <div className="flex items-center gap-2 mb-8 text-xs">
        {[
          { pct: 20,  label: '문서 파싱' },
          { pct: 50,  label: '항목 생성' },
          { pct: 75,  label: '교차 참조' },
          { pct: 100, label: '완료' },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && <div className={`h-px w-8 ${stepDone(s.pct) ? 'bg-green-400' : 'bg-slate-200'}`} />}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium transition-colors
              ${stepDone(s.pct) ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
              <span>{stepDone(s.pct) ? '✓' : (i + 1)}</span>
              <span>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {!job && (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 기본 정보 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-slate-800 text-sm">프로젝트 정보</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">프로젝트명 *</label>
                <input value={projectName} onChange={e => setProjectName(e.target.value)}
                  placeholder="SX3_Concept_FMEA"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">차종</label>
                <input value={vehicleModel} onChange={e => setVehicleModel(e.target.value)}
                  placeholder="SX3"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          {/* 문서 업로드 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="font-semibold text-slate-800 text-sm">제어기능사양서 (선택)</h2>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}>
              <input ref={fileRef} type="file"
                accept=".pdf,.xlsx,.xls,.docx,.txt,.csv"
                className="hidden"
                onChange={e => setSpecFile(e.target.files?.[0] ?? null)} />
              {specFile ? (
                <div className="text-sm font-medium text-slate-700">{specFile.name}</div>
              ) : (
                <>
                  <div className="text-slate-400 text-sm mb-1">PDF / Excel / Word / TXT 드래그 또는 클릭</div>
                  <div className="text-slate-300 text-xs">문서에서 기능 목록을 자동 추출합니다</div>
                </>
              )}
            </div>
          </div>

          {/* 수동 기능 추가 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-slate-800 text-sm">기능 직접 추가 (선택)</h2>

            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <label className="block text-xs text-slate-500 mb-1">기능명</label>
                <input value={newFunc.name} onChange={e => setNewFunc(p => ({ ...p, name: e.target.value }))}
                  placeholder="기어변속 제어"
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addFunction())}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-slate-500 mb-1">설명</label>
                <input value={newFunc.description} onChange={e => setNewFunc(p => ({ ...p, description: e.target.value }))}
                  placeholder="SBW 레버 포지션 기반 변속 명령 생성"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">카테고리</label>
                <select value={newFunc.category} onChange={e => setNewFunc(p => ({ ...p, category: e.target.value as Category }))}
                  className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
                  {(['Safety','Control','Monitor','Communication'] as Category[]).map(c =>
                    <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-1">
                <button type="button" onClick={addFunction}
                  className="w-full bg-slate-900 text-white rounded-lg py-2 text-sm hover:bg-slate-700">+</button>
              </div>
            </div>

            {functions.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {functions.map(f => (
                  <div key={f.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${CAT_COLORS[f.category]}`}>{f.category}</span>
                    <span className="font-medium text-slate-700">{f.name}</span>
                    {f.description && <span className="text-slate-400 text-xs flex-1 truncate">{f.description}</span>}
                    <button type="button" onClick={() => removeFunction(f.id)}
                      className="text-slate-300 hover:text-red-400 ml-auto">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!specFile && functions.length === 0 && (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              문서 업로드 또는 기능 직접 추가 중 하나는 필요합니다.
            </div>
          )}

          <button type="submit" disabled={submitting || (!specFile && functions.length === 0) || !projectName}
            className="w-full bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors">
            {submitting ? '제출 중...' : '개념 FMEA 생성 시작'}
          </button>
        </form>
      )}

      {/* 진행 상황 */}
      {job && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              {job.status === 'done' ? '완료' : job.status === 'error' ? '오류' : '처리 중...'}
            </span>
            <span className="text-sm text-slate-500">{job.progress}%</span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all duration-500
              ${job.status === 'error' ? 'bg-red-400' : job.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${job.progress}%` }} />
          </div>

          <div className="bg-slate-900 rounded-lg p-4 h-52 overflow-y-auto font-mono text-xs text-green-400 space-y-0.5">
            {job.logs.map((l, i) => <div key={i}>{l}</div>)}
            {job.status === 'running' && <div className="animate-pulse">▋</div>}
          </div>

          {job.status === 'error' && (
            <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              {job.error}
            </div>
          )}

          {job.status === 'done' && job.project_id && (
            <div className="flex gap-3">
              <Link href={`/projects/${job.project_id}/fmea`}
                className="flex-1 bg-slate-900 text-white text-center py-2.5 rounded-xl text-sm font-medium hover:bg-slate-700">
                개념 FMEA 보기 →
              </Link>
              <button onClick={() => { setJob(null); setSpecFile(null); setFunctions([]) }}
                className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                새로 만들기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
