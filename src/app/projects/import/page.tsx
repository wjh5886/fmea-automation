'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const BACKEND = '/backend'

const STEPS = [
  { label: 'ARXML 파싱', range: [0, 40] },
  { label: '신호 범위 (DBC)', range: [40, 58] },
  { label: 'S/O/D 교차 참조', range: [58, 75] },
  { label: 'AI S/O/D 생성', range: [75, 100] },
]

function StepIndicator({ progress }: { progress: number }) {
  return (
    <div className="flex gap-2 mb-4">
      {STEPS.map((s, i) => {
        const [lo, hi] = s.range
        const done = progress >= hi
        const active = progress >= lo && progress < hi
        return (
          <div key={i} className="flex-1">
            <div className={`h-1.5 rounded-full mb-1 transition-colors ${
              done ? 'bg-emerald-500' : active ? 'bg-blue-500' : 'bg-slate-200'
            }`} />
            <div className={`text-xs text-center ${
              done ? 'text-emerald-600' : active ? 'text-blue-600 font-medium' : 'text-slate-400'
            }`}>{s.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function ImportPage() {
  const router = useRouter()
  const [projectName, setProjectName] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [arxmlFile, setArxmlFile] = useState<File | null>(null)
  const [dbcFiles, setDbcFiles] = useState<File[]>([])
  const [arxmlDrag, setArxmlDrag] = useState(false)
  const [dbcDrag, setDbcDrag] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<{ status: string; progress: number; logs: string[]; project_id?: string; error?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPoll = useCallback((id: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND}/jobs/${id}`)
        const data = await res.json()
        setJob(data)
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollRef.current!)
          pollRef.current = null
        }
      } catch {
        // network retry
      }
    }, 3000)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!arxmlFile) return
    setSubmitting(true)

    const fd = new FormData()
    fd.append('project_name', projectName)
    fd.append('vehicle_model', vehicleModel)
    fd.append('arxml_zip', arxmlFile)
    dbcFiles.forEach(f => fd.append('dbc_files', f))

    try {
      const res = await fetch(`${BACKEND}/jobs`, { method: 'POST', body: fd })
      const { job_id } = await res.json()
      setJobId(job_id)
      setJob({ status: 'running', progress: 0, logs: [] })
      startPoll(job_id)
    } catch (err) {
      alert(`서버 연결 실패\n백엔드(포트 8000)가 실행 중인지 확인해 주세요.`)
    } finally {
      setSubmitting(false)
    }
  }

  const onArxmlDrop = (e: React.DragEvent) => {
    e.preventDefault(); setArxmlDrag(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.zip')) setArxmlFile(file)
  }
  const onDbcDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDbcDrag(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.dbc'))
    setDbcFiles(prev => [...prev, ...files])
  }

  if (job) {
    const done = job.status === 'done'
    const error = job.status === 'error'
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">FMEA 자동 생성</h1>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <StepIndicator progress={job.progress} />

          <div className="flex items-center justify-between mb-4">
            <span className={`text-sm font-medium ${done ? 'text-emerald-600' : error ? 'text-red-600' : 'text-blue-600'}`}>
              {done ? '완료!' : error ? '오류 발생' : `처리 중… ${job.progress}%`}
            </span>
            <div className="w-40 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${
                done ? 'bg-emerald-500' : error ? 'bg-red-400' : 'bg-blue-500'
              }`} style={{ width: `${job.progress}%` }} />
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs text-slate-600 space-y-0.5">
            {job.logs.map((l, i) => (
              <div key={i} className={l.startsWith('오류') ? 'text-red-600' : ''}>{l}</div>
            ))}
            {!done && !error && <div className="text-slate-400 animate-pulse">▌</div>}
          </div>

          {done && job.project_id && (
            <div className="mt-4 flex gap-3">
              <Link
                href={`/projects/${job.project_id}/fmea`}
                className="flex-1 text-center bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 transition-colors"
              >
                FMEA 보기 →
              </Link>
              <Link href="/projects" className="px-4 py-2.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                목록으로
              </Link>
            </div>
          )}
          {error && (
            <div className="mt-4 space-y-2">
              <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{job.error}</div>
              <button onClick={() => { setJob(null); setJobId(null) }}
                className="w-full border border-slate-300 rounded-lg py-2 text-sm hover:bg-slate-50">
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/projects" className="text-slate-400 hover:text-slate-600 text-sm">← 프로젝트</Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-2xl font-bold text-slate-900">ARXML 자동 가져오기</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
        <strong>자동 처리 단계:</strong> ARXML 파싱 → DBC 신호 범위 → 기존 프로젝트 S/O/D 복사 → Claude AI 생성
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">프로젝트명 *</label>
            <input
              required value={projectName}
              onChange={e => setProjectName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="예: SX3_ICE_2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">차종</label>
            <input
              value={vehicleModel}
              onChange={e => setVehicleModel(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="예: SX3 ICE"
            />
          </div>
        </div>

        {/* ARXML zip 업로드 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            ARXML 프로젝트 <span className="text-red-500">*</span>
            <span className="text-slate-400 font-normal ml-1">(폴더 전체를 .zip으로 압축)</span>
          </label>
          <div
            onDragOver={e => { e.preventDefault(); setArxmlDrag(true) }}
            onDragLeave={() => setArxmlDrag(false)}
            onDrop={onArxmlDrop}
            onClick={() => document.getElementById('arxmlInput')?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              arxmlDrag ? 'border-blue-400 bg-blue-50' :
              arxmlFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            <input id="arxmlInput" type="file" accept=".zip" className="hidden"
              onChange={e => e.target.files?.[0] && setArxmlFile(e.target.files[0])} />
            {arxmlFile ? (
              <div className="text-emerald-700">
                <div className="font-medium">{arxmlFile.name}</div>
                <div className="text-sm text-emerald-600 mt-1">{(arxmlFile.size / 1024 / 1024).toFixed(1)} MB — 선택됨</div>
              </div>
            ) : (
              <div className="text-slate-500">
                <div className="font-medium">zip 파일을 드래그하거나 클릭</div>
                <div className="text-sm mt-1 text-slate-400">HKMC_SX3_SBW_.../ 폴더를 압축한 파일</div>
              </div>
            )}
          </div>
        </div>

        {/* DBC 파일 업로드 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            CAN DB 파일 (DBC)
            <span className="text-slate-400 font-normal ml-1">(선택, 여러 개 가능)</span>
          </label>
          <div
            onDragOver={e => { e.preventDefault(); setDbcDrag(true) }}
            onDragLeave={() => setDbcDrag(false)}
            onDrop={onDbcDrop}
            onClick={() => document.getElementById('dbcInput')?.click()}
            className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
              dbcDrag ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            <input id="dbcInput" type="file" accept=".dbc" multiple className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || [])
                setDbcFiles(prev => [...prev, ...files])
              }} />
            {dbcFiles.length > 0 ? (
              <div className="text-left space-y-1">
                {dbcFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{f.name}</span>
                    <button type="button" onClick={e => { e.stopPropagation(); setDbcFiles(prev => prev.filter((_, j) => j !== i)) }}
                      className="text-slate-400 hover:text-red-500 ml-2">✕</button>
                  </div>
                ))}
                <div className="text-xs text-slate-400 mt-1 pt-1 border-t border-slate-200">
                  + 추가 파일 드래그 또는 클릭
                </div>
              </div>
            ) : (
              <div className="text-slate-400 text-sm py-1">
                .dbc 파일을 드래그하거나 클릭
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={() => router.back()}
            className="flex-1 border border-slate-300 rounded-lg py-2.5 text-sm hover:bg-slate-50">
            취소
          </button>
          <button type="submit" disabled={!arxmlFile || !projectName || submitting}
            className="flex-1 bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {submitting ? '시작 중...' : '자동 생성 시작'}
          </button>
        </div>
      </form>
    </div>
  )
}
