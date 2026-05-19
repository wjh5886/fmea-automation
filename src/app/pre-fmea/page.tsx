'use client'

import { useEffect, useState, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { supabase, type PreFmeaSession, type PreFmeaDocument, type PreFmeaItem } from '@/lib/supabase'

// ─── Upload slot state ────────────────────────────────────────────────────────
type UploadSlot = {
  docRecord: PreFmeaDocument | null
  uploading: boolean
  error: string | null
}

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600',
  generated: 'bg-blue-100 text-blue-700',
  reviewed:  'bg-yellow-100 text-yellow-700',
  upgraded:  'bg-emerald-100 text-emerald-700',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', generated: '생성완료', reviewed: '검토완료', upgraded: '고도화완료',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-300 text-xs">-</span>
  const pct = Math.round(score * 100)
  const cls = score >= 0.8 ? 'text-emerald-700 font-medium' : score >= 0.6 ? 'text-yellow-600 font-medium' : 'text-red-500 font-medium'
  return <span className={`text-xs ${cls}`}>{pct}%</span>
}

// ─── RPN badge ────────────────────────────────────────────────────────────────
function RpnBadge({ rpn }: { rpn: number | null }) {
  if (!rpn) return <span className="text-slate-300 text-xs">-</span>
  const color = rpn >= 200 ? 'bg-red-100 text-red-700' : rpn >= 100 ? 'bg-orange-100 text-orange-700' : rpn >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
  return <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${color}`}>{rpn}</span>
}

// ─── Upload card ──────────────────────────────────────────────────────────────
function UploadCard({
  title, description, accept, slot, onFile, disabled,
}: {
  title: string
  description: string
  accept: string
  slot: UploadSlot
  onFile: (f: File) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const done = !!slot.docRecord && !slot.uploading

  return (
    <div
      onClick={() => !disabled && !slot.uploading && inputRef.current?.click()}
      className={`relative border-2 border-dashed rounded-xl p-6 transition-all select-none
        ${disabled ? 'opacity-40 cursor-not-allowed' : slot.uploading ? 'cursor-wait' : 'cursor-pointer hover:border-blue-400 hover:bg-blue-50/30'}
        ${done ? 'border-emerald-400 bg-emerald-50/20' : slot.error ? 'border-red-400 bg-red-50/20' : 'border-slate-300 bg-white'}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled || slot.uploading}
        onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; onFile(f) } }}
      />
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="text-3xl">
          {slot.uploading ? '⏳' : done ? '✅' : slot.error ? '❌' : '📄'}
        </div>
        <div className="font-semibold text-slate-700 text-sm">{title}</div>
        <div className="text-xs text-slate-400">{description}</div>

        {slot.uploading && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600 mt-1">
            <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
            업로드 중...
          </div>
        )}
        {done && (
          <div className="text-xs text-emerald-700 font-medium max-w-full truncate px-2">
            {slot.docRecord!.filename}
          </div>
        )}
        {slot.error && (
          <div className="text-xs text-red-600 mt-1 px-2">{slot.error}</div>
        )}
        {!done && !slot.uploading && !slot.error && (
          <div className="text-xs text-slate-400 mt-1">클릭하여 파일 선택</div>
        )}
        {done && (
          <button
            onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
            className="text-xs text-slate-400 hover:text-slate-600 underline mt-0.5"
          >
            파일 교체
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PreFmeaPage() {
  const [sessions, setSessions] = useState<PreFmeaSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [activeSession, setActiveSession] = useState<PreFmeaSession | null>(null)
  const [step, setStep] = useState<1 | 2>(1)

  const [templateSlot, setTemplateSlot] = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })
  const [specSlot, setSpecSlot] = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })
  const [humanSlot, setHumanSlot] = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })

  const [items, setItems] = useState<PreFmeaItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)

  const [showNewModal, setShowNewModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const [generating, setGenerating] = useState(false)

  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)

  // ── Sessions ──
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    const { data } = await supabase
      .from('pre_fmea_sessions')
      .select('*')
      .order('created_at', { ascending: false })
    setSessions(data ?? [])
    setLoadingSessions(false)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // ── Toast ──
  const showToast = (msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Create session ──
  const createSession = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('pre_fmea_sessions')
      .insert({ name: newName.trim() })
      .select()
      .single()
    if (error) { showToast(`세션 생성 실패: ${error.message}`, 'error') }
    if (data) {
      setSessions(prev => [data, ...prev])
      enterSession(data)
      setShowNewModal(false)
      setNewName('')
    }
    setCreating(false)
  }

  // ── Enter session ──
  const enterSession = (session: PreFmeaSession) => {
    setActiveSession(session)
    setStep(1)
    setTemplateSlot({ docRecord: null, uploading: false, error: null })
    setSpecSlot({ docRecord: null, uploading: false, error: null })
    setHumanSlot({ docRecord: null, uploading: false, error: null })
    setItems([])
    loadSessionData(session.id)
  }

  // ── Load session data ──
  const loadSessionData = async (sessionId: string) => {
    setLoadingItems(true)
    const [{ data: docs }, { data: its }] = await Promise.all([
      supabase.from('pre_fmea_documents').select('*').eq('session_id', sessionId).order('created_at'),
      supabase.from('pre_fmea_items').select('*').eq('session_id', sessionId).order('item_no').order('failure_mode').order('id'),
    ])
    const templateDoc = docs?.find(d => d.doc_type === 'fmea_template') ?? null
    const specDoc     = docs?.find(d => d.doc_type === 'design_spec')   ?? null
    const humanDoc    = docs?.find(d => d.doc_type === 'human_fmea')    ?? null
    setTemplateSlot({ docRecord: templateDoc, uploading: false, error: null })
    setSpecSlot({     docRecord: specDoc,     uploading: false, error: null })
    setHumanSlot({    docRecord: humanDoc,    uploading: false, error: null })
    setItems(its ?? [])
    setLoadingItems(false)
  }

  // ── Upload file via server API (bypasses corporate firewall) ──
  const uploadFile = async (
    file: File,
    docType: 'fmea_template' | 'design_spec' | 'human_fmea',
    setSlot: Dispatch<SetStateAction<UploadSlot>>,
  ) => {
    if (!activeSession) return
    setSlot(prev => ({ ...prev, uploading: true, error: null }))

    const form = new FormData()
    form.append('file', file)
    form.append('session_id', activeSession.id)
    form.append('doc_type', docType)

    try {
      const res = await fetch('/api/pre-fmea/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) {
        setSlot(prev => ({ ...prev, uploading: false, error: json.error ?? '업로드 실패' }))
        showToast(`업로드 실패: ${json.error}`, 'error')
        return
      }
      setSlot({ docRecord: json, uploading: false, error: null })
      showToast(`✅ ${file.name} 업로드 완료`)
    } catch (e) {
      setSlot(prev => ({ ...prev, uploading: false, error: String(e) }))
      showToast(`업로드 오류: ${String(e)}`, 'error')
    }
  }

  // ── Generate FMEA items ──
  const generate = async () => {
    if (!activeSession || !canGenerate || generating) return
    setGenerating(true)
    showToast('AI가 사전 FMEA 항목을 생성 중입니다... (30~90초 소요)')
    try {
      const res = await fetch('/api/pre-fmea/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(`생성 실패: ${json.error ?? res.statusText}`, 'error')
        return
      }
      const updated: PreFmeaSession = { ...activeSession, status: 'generated' }
      setActiveSession(updated)
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
      await loadSessionData(activeSession.id)
      showToast(`✅ ${json.count}개 항목 생성 완료!`)
    } catch (e) {
      showToast(`오류: ${String(e)}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  // ── Delete session ──
  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!confirm('이 세션을 삭제하시겠습니까? 모든 항목과 문서가 함께 삭제됩니다.')) return
    await supabase.from('pre_fmea_sessions').delete().eq('id', sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    if (activeSession?.id === sessionId) {
      setActiveSession(null)
      setItems([])
    }
    showToast('세션이 삭제되었습니다.')
  }

  const canGenerate = !!templateSlot.docRecord && !!specSlot.docRecord
  const filledCount = items.filter(i => i.severity && i.occurrence && i.detection).length
  const highConfCount = items.filter(i => (i.confidence_score ?? 0) >= 0.8).length

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER: Session list (no active session)
  // ══════════════════════════════════════════════════════════════════════════
  if (!activeSession) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Toast toast={toast} />

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">사전 FMEA_LEB</h1>
            <p className="text-sm text-slate-500 mt-1">SW 설계사양서 기반 사전 FMEA 문서 자동 생성 및 지속 고도화</p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm hover:bg-slate-700 transition-colors font-medium"
          >
            + 새 세션 만들기
          </button>
        </div>

        {loadingSessions ? (
          <div className="text-center py-16 text-slate-400">불러오는 중...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-slate-500 text-lg mb-2">아직 세션이 없습니다.</p>
            <p className="text-slate-400 text-sm mb-8">
              새 세션을 만들고 SW 설계사양서를 업로드하면<br />AI가 사전 FMEA 문서를 자동으로 작성합니다.
            </p>
            <button
              onClick={() => setShowNewModal(true)}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              첫 번째 세션 만들기 →
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => enterSession(s)}
                className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-xl shrink-0">📋</div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{s.name}</span>
                      <StatusBadge status={s.status} />
                      {s.doc_version > 1 && (
                        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                          v{s.doc_version}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(s.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-300 group-hover:text-slate-500 transition-colors text-lg">→</span>
                  <button
                    onClick={e => deleteSession(e, s.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded border border-red-200 hover:border-red-400 transition-all"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New session modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="font-bold text-slate-800 text-lg mb-1">새 세션 만들기</h2>
              <p className="text-xs text-slate-400 mb-5">하나의 세션 = 하나의 사전 FMEA 문서 작업 단위</p>
              <label className="text-sm text-slate-600 font-medium block mb-1.5">세션명</label>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createSession() }}
                placeholder="예: SX3_EPS_사전FMEA_v1"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-1.5"
              />
              <p className="text-xs text-slate-400 mb-5">차종명_시스템명_버전 형태를 권장합니다</p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowNewModal(false); setNewName('') }}
                  className="flex-1 border border-slate-300 rounded-lg py-2.5 text-sm hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={createSession}
                  disabled={creating || !newName.trim()}
                  className="flex-1 bg-slate-900 text-white rounded-lg py-2.5 text-sm hover:bg-slate-700 disabled:opacity-40 transition-colors font-medium"
                >
                  {creating ? '생성 중...' : '세션 만들기'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER: Session detail
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      <Toast toast={toast} />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-5">
        <button
          onClick={() => setActiveSession(null)}
          className="hover:text-slate-600 transition-colors"
        >
          사전 FMEA_LEB
        </button>
        <span>/</span>
        <span className="text-slate-700 font-medium">{activeSession.name}</span>
        <StatusBadge status={activeSession.status} />
        {activeSession.doc_version > 1 && (
          <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
            v{activeSession.doc_version}
          </span>
        )}
      </div>

      {/* Step tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {([
          [1, '1단계', '문서 업로드 & 생성'],
          [2, '2단계', '피드백 & 고도화'],
        ] as [number, string, string][]).map(([n, label, sub]) => {
          const locked = n === 2 && activeSession.status === 'draft'
          return (
            <button
              key={n}
              onClick={() => !locked && setStep(n as 1 | 2)}
              disabled={locked}
              className={`px-5 py-2.5 text-sm rounded-t transition-colors
                ${step === n
                  ? 'bg-white border border-b-white border-slate-200 text-blue-600 -mb-px font-semibold'
                  : locked
                    ? 'text-slate-300 cursor-not-allowed'
                    : 'text-slate-500 hover:text-slate-700 font-medium'
                }`}
            >
              {label}
              <span className={`ml-1.5 text-xs font-normal ${step === n ? 'text-blue-400' : 'text-slate-400'}`}>
                {sub}
              </span>
              {locked && <span className="ml-1 text-xs">🔒</span>}
            </button>
          )
        })}
      </div>

      {/* ── Step 1: 문서 업로드 & 생성 ── */}
      {step === 1 && (
        <div>
          {/* Upload cards */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <UploadCard
              title="FMEA 양식 (Template)"
              description=".xlsx / .xls — 빈 양식 파일"
              accept=".xlsx,.xls"
              slot={templateSlot}
              onFile={f => uploadFile(f, 'fmea_template', setTemplateSlot)}
            />
            <UploadCard
              title="SW 설계사양서"
              description=".pdf / .docx / .txt — 기능 명세 문서"
              accept=".pdf,.docx,.doc,.txt"
              slot={specSlot}
              onFile={f => uploadFile(f, 'design_spec', setSpecSlot)}
            />
          </div>

          {/* Generate button + hint */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={generate}
              disabled={!canGenerate || generating}
              className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2
                ${canGenerate && !generating
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
            >
              {generating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
                  생성 중...
                </>
              ) : '▶ AI 사전 FMEA 생성'}
            </button>
            <span className="text-xs text-slate-400">
              {generating
                ? 'Claude AI가 설계사양서를 분석하고 있습니다. 잠시 기다려주세요.'
                : !templateSlot.docRecord && !specSlot.docRecord
                  ? '① FMEA 양식과 ② 설계사양서를 업로드하면 활성화됩니다'
                  : !templateSlot.docRecord
                    ? '① FMEA 양식을 업로드하세요'
                    : !specSlot.docRecord
                      ? '② SW 설계사양서를 업로드하세요'
                      : '준비 완료 — 버튼을 클릭하면 AI가 FMEA 항목을 자동 생성합니다'}
            </span>
          </div>

          {/* Stats bar — shown when items exist */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm bg-white border border-slate-200 rounded-xl px-5 py-3 mb-4">
              <span className="text-slate-600">
                총 <strong className="text-slate-900">{items.length}</strong>개 항목
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-600">
                S/O/D 입력 <strong className="text-blue-600">{filledCount}</strong>개
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-600">
                고확신 ≥80% <strong className="text-emerald-600">{highConfCount}</strong>개
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-600">
                저확신 <strong className="text-red-500">{items.length - highConfCount}</strong>개
              </span>
              <div className="flex-1" />
              <button className="border border-slate-300 text-slate-600 text-xs px-3 py-1.5 rounded hover:bg-slate-50 transition-colors">
                Excel 내보내기
              </button>
            </div>
          )}

          {/* Items table */}
          {loadingItems ? (
            <div className="text-center py-14 text-slate-400 text-sm">불러오는 중...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-20 bg-white border border-dashed border-slate-200 rounded-xl">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-slate-500 text-sm font-medium">아직 생성된 FMEA 항목이 없습니다.</p>
              <p className="text-slate-400 text-xs mt-1.5">
                {canGenerate
                  ? '위의 "AI 사전 FMEA 생성" 버튼으로 항목을 생성하세요.'
                  : '설계사양서를 업로드하면 AI가 FMEA 항목을 자동으로 작성합니다.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-white" style={{ maxHeight: 'calc(100vh - 18rem)' }}>
              <table className="text-xs" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
                <colgroup>
                  {[40,140,140,80,160,160,160,140,44,44,44,60,160,160,60,90].map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    {['No','SW 컴포넌트','기능명','고장 형태','상세 내용','모듈 영향','시스템 영향','잠재 원인','S','O','D','RPN','예방 조치','검출 조치','확신도','상태'].map((h, i) => (
                      <th key={i} className="px-2 py-2 text-left font-medium text-slate-600 whitespace-nowrap overflow-hidden text-ellipsis">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50 transition-colors
                        ${(item.confidence_score ?? 1) < 0.6 ? 'bg-orange-50/40' : ''}
                      `}
                    >
                      <td className="px-2 py-2 text-slate-500 font-mono">{idx + 1}</td>
                      <td className="px-2 py-2 font-mono text-slate-700 truncate" title={item.sw_component ?? ''}>{item.sw_component ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.function_name ?? ''}>{item.function_name ?? '-'}</td>
                      <td className="px-2 py-2">
                        {item.failure_mode
                          ? <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">{item.failure_mode}</span>
                          : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.failure_detail ?? ''}>{item.failure_detail ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.effect_local ?? ''}>{item.effect_local ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.effect_system ?? ''}>{item.effect_system ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.potential_cause ?? ''}>{item.potential_cause ?? '-'}</td>
                      <td className="px-2 py-2 text-center font-medium text-slate-700">{item.severity ?? '-'}</td>
                      <td className="px-2 py-2 text-center font-medium text-slate-700">{item.occurrence ?? '-'}</td>
                      <td className="px-2 py-2 text-center font-medium text-slate-700">{item.detection ?? '-'}</td>
                      <td className="px-2 py-2 text-center"><RpnBadge rpn={item.rpn} /></td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.preventive_action ?? ''}>{item.preventive_action ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.detection_action ?? ''}>{item.detection_action ?? '-'}</td>
                      <td className="px-2 py-2 text-center"><ConfBadge score={item.confidence_score} /></td>
                      <td className="px-2 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap
                          ${item.review_status === 'accepted'  ? 'bg-emerald-100 text-emerald-700' :
                            item.review_status === 'rejected'  ? 'bg-red-100 text-red-700' :
                            item.review_status === 'modified'  ? 'bg-blue-100 text-blue-700' :
                                                                  'bg-slate-100 text-slate-500'}`}>
                          {item.review_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: 피드백 & 고도화 ── */}
      {step === 2 && (
        <div>
          {activeSession.status === 'draft' ? (
            <div className="text-center py-24 text-slate-400">
              <div className="text-4xl mb-3">🔒</div>
              <p className="text-sm">1단계에서 FMEA 항목을 먼저 생성해야 합니다.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Human FMEA upload */}
              <div>
                <h2 className="font-semibold text-slate-800 mb-1">실제 작성 FMEA 업로드</h2>
                <p className="text-xs text-slate-400 mb-3">
                  현업 전문가가 검토·완성한 최종 FMEA 문서를 업로드하면 AI 생성본과 자동 비교 분석합니다.
                </p>
                <div className="max-w-xs">
                  <UploadCard
                    title="실제 FMEA 문서 (검토 완료본)"
                    description=".xlsx / .xls — 전문가 작성 최종본"
                    accept=".xlsx,.xls"
                    slot={humanSlot}
                    onFile={f => uploadFile(f, 'human_fmea', setHumanSlot)}
                  />
                </div>
              </div>

              {/* Gap analysis */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-slate-800">Gap 분석 리포트</h2>
                    <p className="text-xs text-slate-400 mt-0.5">AI 생성본 vs 전문가 작성본 자동 비교 분석</p>
                  </div>
                  <button
                    onClick={() => showToast('🚧 Gap 분석 파이프라인 구현 중입니다 (P2 예정)')}
                    disabled={!humanSlot.docRecord}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                      ${humanSlot.docRecord
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}
                  >
                    🔍 Gap 분석 실행
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: '누락 항목', icon: '❌', color: 'text-red-600', val: '-' },
                    { label: 'S/O/D 오차', icon: '⚠️', color: 'text-orange-500', val: '-' },
                    { label: '원인/조치 누락', icon: '📝', color: 'text-yellow-600', val: '-' },
                  ].map(({ label, icon, color, val }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-4 text-center">
                      <div className="text-2xl mb-1">{icon}</div>
                      <div className={`text-2xl font-bold ${color}`}>{val}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="text-center py-6 text-slate-400 border border-dashed border-slate-200 rounded-lg">
                  <p className="text-sm">Gap 분석을 실행하면 결과가 여기에 표시됩니다.</p>
                </div>
              </div>

              {/* Knowledge base update */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-700 text-sm">지식베이스 업데이트</h2>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                      Gap 분석 결과를 AI 지식베이스에 반영하면, 다음 세션 생성 시 동일한 실수를 방지하고
                      품질이 자동으로 향상됩니다.
                    </p>
                  </div>
                  <button
                    onClick={() => showToast('🚧 지식베이스 업데이트 기능 구현 중입니다 (P2 예정)')}
                    className="shrink-0 text-xs border border-slate-300 text-slate-500 px-3 py-1.5 rounded hover:bg-white transition-colors ml-4"
                  >
                    ✅ 지식베이스에 반영
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {[
                    { label: '저장된 예시', val: '0건', icon: '💾' },
                    { label: '학습된 규칙', val: '0건', icon: '📚' },
                    { label: '프롬프트 버전', val: 'v1', icon: '🔧' },
                  ].map(({ label, val, icon }) => (
                    <div key={label} className="bg-white rounded-lg p-3 text-center border border-slate-200">
                      <div className="text-lg mb-0.5">{icon}</div>
                      <div className="text-base font-bold text-slate-700">{val}</div>
                      <div className="text-xs text-slate-400">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Toast component ──────────────────────────────────────────────────────────
function Toast({ toast }: { toast: { msg: string; type: 'info' | 'error' } | null }) {
  if (!toast) return null
  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-sm shadow-lg max-w-sm
      ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-800 text-white'}`}>
      {toast.msg}
    </div>
  )
}
