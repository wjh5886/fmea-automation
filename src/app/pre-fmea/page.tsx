'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { PreFmeaSession, PreFmeaDocument, PreFmeaItem } from '@/lib/supabase'

type IcdComponentSummary = { name: string; count: number }
type IcdParseResult = { count: number; components: IcdComponentSummary[]; filename: string }

// ─── Upload slot state ────────────────────────────────────────────────────────
type UploadSlot = {
  docRecord: PreFmeaDocument | null
  uploading: boolean
  error: string | null
}

// ─── Review status label ─────────────────────────────────────────────────────
const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending:  '검토 중',
  accepted: '확정',
  rejected: '반려',
  modified: '수정됨',
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

// ─── AP badge ─────────────────────────────────────────────────────────────────
const AP_STYLE: Record<string, string> = {
  VH: 'bg-red-600 text-white font-bold',
  H:  'bg-orange-500 text-white font-bold',
  M:  'bg-yellow-400 text-slate-800 font-bold',
  L:  'bg-green-100 text-green-800 font-medium',
}
function ApBadge({ ap }: { ap: string | null }) {
  if (!ap) return <span className="text-slate-300 text-xs">-</span>
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${AP_STYLE[ap] ?? 'bg-slate-100 text-slate-500'}`}>
      {ap}
    </span>
  )
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
        ${done ? 'border-emerald-400 bg-emerald-50/20' : slot.error ? 'border-red-400 bg-red-50/20' : slot.uploading ? 'border-blue-400 bg-blue-50/20' : 'border-slate-300 bg-white'}
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
  const [view, setView] = useState<'items' | 'sessions' | 'detail'>('items')
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const [templateSlot, setTemplateSlot] = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })
  const [archDocs, setArchDocs]         = useState<PreFmeaDocument[]>([])
  const [archUploading, setArchUploading] = useState(false)
  const [archError, setArchError]         = useState<string | null>(null)
  const archInputRef = useRef<HTMLInputElement>(null)
  const [dbcSlot, setDbcSlot]           = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })
  const [specDocs, setSpecDocs] = useState<PreFmeaDocument[]>([])
  const [specUploading, setSpecUploading] = useState(false)
  const [specError, setSpecError] = useState<string | null>(null)
  const [humanSlot, setHumanSlot] = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })
  const specInputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<PreFmeaItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)

  const [showNewModal, setShowNewModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newItemName, setNewItemName] = useState('SBW')
  const [creating, setCreating] = useState(false)

  const [icdSlot, setIcdSlot] = useState<UploadSlot>({ docRecord: null, uploading: false, error: null })
  const [icdParseResult, setIcdParseResult] = useState<IcdParseResult | null>(null)
  const [icdParsing, setIcdParsing] = useState(false)
  const [icdExtracting, setIcdExtracting] = useState<'dbc' | 'spec' | null>(null)
  const [icdBuilding, setIcdBuilding] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [comparing, setComparing]   = useState(false)
  const [enhancing, setEnhancing]   = useState(false)
  const [exporting, setExporting]   = useState(false)
  const [recalcingAp, setRecalcingAp] = useState(false)
  const [showAllMonitoring, setShowAllMonitoring] = useState(false)
  const [editableConclusion, setEditableConclusion] = useState('')

  // ── Report ──
  type ReportMeta = { vehicle: string; item: string; customer: string; department: string; author: string; version: string }
  interface SgStat { sg: string; totalSPF: number; spfWithoutSM: number; totalLF: number; lfWithoutSM: number }
  interface MatrixCell { s: number; oIdx: number; dIdx: number; count: number }
  interface ReportData {
    analysisInfo: { vehicle: string; item: string; customer: string; department: string; author: string; version: string; generatedAt: string; totalItems: number }
    safetyGoalAnalysis: SgStat[]
    sodMatrix: { sBins: number[]; oBins: string[]; dBins: string[]; initial: MatrixCell[]; recommended: MatrixCell[] }
    apSummary: Record<string, { initial: number; recommended: number }>
    additionalActionItems: { fmeaId: string; swUnit: string; failureMode: string; sgViolation: boolean; sg: string; spfLf: string; initialS: number; initialO: number; initialD: number; initialAP: string; recS: number; recO: number; recD: number; recAP: string }[]
    actionMonitoring: { openCount: number; closedCount: number; items: { fmeaId: string; swUnit: string; failureMode: string; sgViolation: boolean; sg: string; action: string; status: string; initialS: number; initialO: number; initialD: number; recS: number; recO: number; recD: number; recAP: string }[] }
    conclusion: string
  }
  const [reportMeta, setReportMeta] = useState<ReportMeta>({ vehicle: '', item: '', customer: '', department: '', author: '', version: '' })
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  type GapItem = {
    gap_type: string; field_name?: string | null
    sw_component: string | null; failure_mode: string | null
    ai_value: string | null; human_value: string | null; lesson: string
  }
  type GapResult = {
    humanCount: number; aiCount: number; matchedCount: number
    missingItems: number; sodDiffs: number; missingActions: number
    totalGaps: number; gaps: GapItem[]
  }
  const [gapResult, setGapResult] = useState<GapResult | null>(null)

  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)

  // ── Sessions ──
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    const res = await fetch('/api/pre-fmea/sessions')
    const data = await res.json()
    setSessions(data ?? [])
    setLoadingSessions(false)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // step 전환 또는 세션 변경 시 항상 최신 데이터 반영
  useEffect(() => {
    if (!activeSession) return
    loadSessionData(activeSession.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeSession?.id])

  // step 3 진입 시 리포트 자동 로드
  useEffect(() => {
    if (!activeSession || step !== 3) return
    fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // reportData 변경 시 conclusion 동기화
  useEffect(() => {
    if (reportData) setEditableConclusion(reportData.conclusion)
  }, [reportData])

  // ── Toast ──
  const showToast = (msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), type === 'error' ? 8000 : 4500)
  }

  // ── Create session ──
  const createSession = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch('/api/pre-fmea/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), item_name: newItemName.trim() || 'SBW' }),
    })
    if (!res.ok) {
      const json = await res.json()
      showToast(`세션 생성 실패: ${json.error}`, 'error')
      setCreating(false)
      return
    }
    const data = await res.json()
    setSessions(prev => [data, ...prev])
    enterSession(data)
    setShowNewModal(false)
    setNewName('')
    setNewItemName(selectedItem ?? 'SBW')
    setCreating(false)
  }

  // ── Item category navigation ──
  const enterItem = (itemName: string) => {
    setSelectedItem(itemName)
    setView('sessions')
  }

  const backToItems = () => {
    setSelectedItem(null)
    setView('items')
  }

  const backToSessions = () => {
    setActiveSession(null)
    setView('sessions')
    setStep(1)
    setTemplateSlot({ docRecord: null, uploading: false, error: null })
    setArchDocs([])
    setArchError(null)
    setDbcSlot({ docRecord: null, uploading: false, error: null })
    setIcdSlot({ docRecord: null, uploading: false, error: null })
    setIcdParseResult(null)
    setIcdExtracting(null)
    setSpecDocs([])
    setSpecError(null)
    setHumanSlot({ docRecord: null, uploading: false, error: null })
    setItems([])
    setGapResult(null)
  }

  // ── Enter session ──
  const enterSession = (session: PreFmeaSession) => {
    setActiveSession(session)
    setView('detail')
    setStep(1)
    setTemplateSlot({ docRecord: null, uploading: false, error: null })
    setArchDocs([])
    setArchError(null)
    setDbcSlot({ docRecord: null, uploading: false, error: null })
    setIcdSlot({ docRecord: null, uploading: false, error: null })
    setIcdParseResult(null)
    setIcdExtracting(null)
    setSpecDocs([])
    setSpecError(null)
    setHumanSlot({ docRecord: null, uploading: false, error: null })
    setItems([])
    loadSessionData(session.id)
  }

  // ── Load session data ──
  const loadSessionData = async (sessionId: string) => {
    setLoadingItems(true)
    const res = await fetch(`/api/pre-fmea/sessions/${sessionId}`)
    const { docs, items: its, gapSummary } = await res.json()
    const allDocs = docs as PreFmeaDocument[]
    const templateDoc = allDocs?.find(d => d.doc_type === 'fmea_template') ?? null
    const humanDoc    = allDocs?.find(d => d.doc_type === 'human_fmea')    ?? null
    const dbcDoc      = allDocs?.find(d => d.doc_type === 'dbc_file')      ?? null
    const icdDoc      = allDocs?.find(d => d.doc_type === 'icd_file')      ?? null
    setTemplateSlot({ docRecord: templateDoc, uploading: false, error: null })
    setArchDocs(allDocs?.filter(d => d.doc_type === 'architecture') ?? [])
    setArchError(null)
    setDbcSlot({ docRecord: dbcDoc, uploading: false, error: null })
    setIcdSlot({ docRecord: icdDoc, uploading: false, error: null })
    setSpecDocs(allDocs?.filter(d => d.doc_type === 'design_spec') ?? [])
    setSpecError(null)
    setHumanSlot({ docRecord: humanDoc, uploading: false, error: null })
    setItems(its ?? [])
    // Restore gap analysis result from DB if available
    if (gapSummary) setGapResult(gapSummary)
    // Restore ICD parse result if ICD doc exists
    if (icdDoc) {
      fetch(`/api/pre-fmea/icd-parse?session_id=${sessionId}`)
        .then(r => r.json())
        .then(data => {
          if (data.count > 0) {
            const groups: Record<string, unknown[]> = data.groups ?? {}
            const components = Object.entries(groups).map(([name, vars]) => ({ name, count: (vars as unknown[]).length }))
            setIcdParseResult({ count: data.count, components, filename: icdDoc.filename })
          }
        })
        .catch(() => {})
    }
    setLoadingItems(false)
  }

  // ── 파일 → base64 변환 ──
  const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('파일 읽기 실패'))
    reader.readAsDataURL(file)
  })

  // ── 단일 슬롯 업로드 (template / human_fmea) ──
  const uploadFile = async (
    file: File,
    docType: 'fmea_template' | 'human_fmea' | 'architecture' | 'dbc_file' | 'icd_file',
    setSlot: React.Dispatch<React.SetStateAction<UploadSlot>>,
  ) => {
    if (!activeSession) return
    setSlot(prev => ({ ...prev, uploading: true, error: null }))
    try {
      const base64 = await toBase64(file)
      const res = await fetch('/api/pre-fmea/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id, doc_type: docType,
          filename: file.name, mime_type: file.type || null, size: file.size, data_base64: base64 }),
      })
      const json = await res.json()
      if (!res.ok) { setSlot(prev => ({ ...prev, uploading: false, error: json.error ?? '업로드 실패' })); showToast(`업로드 실패: ${json.error}`, 'error'); return }
      setSlot({ docRecord: json, uploading: false, error: null })
      showToast(`✅ ${file.name} 업로드 완료`)
    } catch (e) {
      setSlot(prev => ({ ...prev, uploading: false, error: String(e) }))
      showToast(`업로드 오류: ${String(e)}`, 'error')
    }
  }

  // ── 설계사양서 추가 업로드 (다중 파일) ──
  const uploadSpecFile = async (file: File) => {
    if (!activeSession) return
    setSpecUploading(true)
    setSpecError(null)
    try {
      const base64 = await toBase64(file)
      const res = await fetch('/api/pre-fmea/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id, doc_type: 'design_spec',
          filename: file.name, mime_type: file.type || null, size: file.size, data_base64: base64 }),
      })
      const json = await res.json()
      if (!res.ok) { setSpecError(json.error ?? '업로드 실패'); showToast(`업로드 실패: ${json.error}`, 'error'); return }
      setSpecDocs(prev => [...prev, json as PreFmeaDocument])
      showToast(`✅ ${file.name} 업로드 완료`)
    } catch (e) {
      setSpecError(String(e))
      showToast(`업로드 오류: ${String(e)}`, 'error')
    } finally {
      setSpecUploading(false)
    }
  }

  // ── 설계사양서 개별 삭제 ──
  const deleteSpecDoc = async (docId: string) => {
    await fetch('/api/pre-fmea/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_id: docId }),
    })
    setSpecDocs(prev => prev.filter(d => d.id !== docId))
    showToast('파일이 삭제되었습니다.')
  }

  // ── ICD 파싱 (업로드된 ICD 파일) ──
  const parseIcd = async () => {
    if (!activeSession || !icdSlot.docRecord || icdParsing) return
    setIcdParsing(true)
    try {
      const res = await fetch('/api/pre-fmea/icd-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(`ICD 파싱 실패: ${json.error}`, 'error'); return }
      setIcdParseResult(json)
      showToast(`✅ ICD 파싱 완료 — 변수 ${json.count}개, 컴포넌트 ${json.components?.length ?? 0}개`)
    } catch (e) {
      showToast(`ICD 파싱 오류: ${String(e)}`, 'error')
    } finally {
      setIcdParsing(false)
    }
  }

  // ── ICD 추출 (DBC 또는 설계사양서 기반) ──
  const extractIcd = async (source: 'dbc' | 'spec') => {
    if (!activeSession || icdExtracting) return
    setIcdExtracting(source)
    const label = source === 'dbc' ? 'DBC 시그널' : '설계사양서'
    showToast(`${label}에서 변수를 추출 중입니다...`)
    try {
      const res = await fetch('/api/pre-fmea/icd-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id, source }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(`추출 실패: ${json.error}`, 'error'); return }
      setIcdParseResult({ count: json.count, components: json.components, filename: json.filename ?? label })
      const src = source === 'dbc' ? `DBC(${json.filename ?? ''})` : '설계사양서'
      showToast(`✅ ${src}에서 변수 ${json.count}개 추출 완료`)
    } catch (e) {
      showToast(`추출 오류: ${String(e)}`, 'error')
    } finally {
      setIcdExtracting(null)
    }
  }

  // ── ICD 자동 생성 (DBC + 아키텍처 매칭) ──
  const buildIcd = async () => {
    if (!activeSession || icdBuilding || icdExtracting || icdParsing) return
    setIcdBuilding(true)
    showToast(`아키텍처+DBC${specDocs.length > 0 ? '+사양서' : ''} 자동 매칭으로 인터페이스 변수 생성 중...`)
    try {
      const res = await fetch('/api/pre-fmea/icd-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(`인터페이스 자동 추출 실패: ${json.error}`, 'error'); return }
      setIcdParseResult({
        count: json.count,
        components: json.components,
        filename: `아키텍처+DBC 자동매칭 (${json.count}개)`,
      })
      const matchInfo = [
        json.dbcFile ? `DBC 매칭 ${json.dbcMatchCount}개` : null,
        json.specEnrichCount > 0 ? `사양서 보강 ${json.specEnrichCount}개` : null,
      ].filter(Boolean).join(' · ')
      showToast(`✅ 인터페이스 자동 추출 완료 — ${json.count}개 변수${matchInfo ? ` (${matchInfo})` : ''}`)
    } catch (e) {
      showToast(`인터페이스 자동 추출 오류: ${String(e)}`, 'error')
    } finally {
      setIcdBuilding(false)
    }
  }

  // ── Generate FMEA items ──
  const generate = async (mode: 'component' | 'icd' = 'component') => {
    if (!activeSession || !canGenerate || generating) return
    setGenerating(true)
    const modeLabel = mode === 'icd' ? '인터페이스 변수 기반' : '컴포넌트 기반'
    showToast(`AI가 ${modeLabel} FMEA 항목을 생성 중입니다... (30~120초 소요)`)
    try {
      const res = await fetch('/api/pre-fmea/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id, mode }),
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
      const srcInfo = json.mode === 'icd'
        ? ` | 인터페이스 변수 ${json.icdVariableCount}개 × HAZOP → ${json.count}개`
        : json.sources
          ? ` | 아키텍처${json.sources.architecture > 0 ? '✅' : '—'} DBC${json.sources.dbc_file > 0 ? '✅' : '—'}`
          : ''
      showToast(`✅ [${json.itemName ?? activeSession.item_name}] ${json.count}개 항목 생성 완료${srcInfo}`)
    } catch (e) {
      showToast(`오류: ${String(e)}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  // ── Compare (Gap 분석) ──
  const compare = async () => {
    if (!activeSession || comparing) return
    setComparing(true)
    try {
      const res = await fetch('/api/pre-fmea/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(`비교 실패: ${json.error}`, 'error'); return }
      setGapResult(json)
      const updated: PreFmeaSession = { ...activeSession, status: 'reviewed' }
      setActiveSession(updated)
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
      await loadSessionData(activeSession.id)
      showToast(`✅ Gap 분석 완료! 누락 ${json.missingItems}개, S/O/D 오차 ${json.sodDiffs}건 감지`)
    } catch (e) {
      showToast(`오류: ${String(e)}`, 'error')
    } finally {
      setComparing(false)
    }
  }

  // ── Enhance (고도화) ──
  const enhance = async () => {
    if (!activeSession || enhancing) return
    setEnhancing(true)
    try {
      const res = await fetch('/api/pre-fmea/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(`고도화 실패: ${json.error}`, 'error'); return }
      const updated: PreFmeaSession = { ...activeSession, status: 'upgraded', doc_version: activeSession.doc_version + 1 }
      setActiveSession(updated)
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
      await loadSessionData(activeSession.id)
      showToast(`✅ 고도화 완료! 총 ${json.mergedCount}개 병합 (확정 ${json.acceptedCount}개, 검토필요 ${json.pendingCount}개)`)
    } catch (e) {
      showToast(`오류: ${String(e)}`, 'error')
    } finally {
      setEnhancing(false)
    }
  }

  // ── AP 재계산 ──
  const recalcAp = async () => {
    if (!activeSession || recalcingAp) return
    setRecalcingAp(true)
    try {
      const res = await fetch('/api/pre-fmea/recalc-ap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(`AP 재계산 실패: ${json.error}`, 'error'); return }
      await loadSessionData(activeSession.id)
      const dist = json.distribution as Record<string, number>
      const summary = ['VH','H','M','L'].filter(k => dist[k]).map(k => `${k}:${dist[k]}`).join(' ')
      showToast(`✅ AP 재계산 완료 — ${json.updated}개 갱신 (${summary})`)
    } catch (e) {
      showToast(`오류: ${String(e)}`, 'error')
    } finally {
      setRecalcingAp(false)
    }
  }

  // ── Report ──
  const fetchReport = async () => {
    if (!activeSession || loadingReport) return
    setLoadingReport(true)
    try {
      const params = new URLSearchParams({
        session_id: activeSession.id,
        vehicle:    reportMeta.vehicle    || '-',
        item:       reportMeta.item       || activeSession.item_name || '-',
        customer:   reportMeta.customer   || '-',
        department: reportMeta.department || '-',
        author:     reportMeta.author     || '-',
        version:    reportMeta.version    || `v${activeSession.doc_version}`,
      })
      const res = await fetch(`/api/pre-fmea/report?${params}`)
      const json = await res.json()
      if (!res.ok) { showToast(`리포트 생성 실패: ${json.error}`, 'error'); return }
      setReportData(json as ReportData)
      showToast('✅ FMEA 결과 리포트 생성 완료')
    } catch (e) {
      showToast(`리포트 오류: ${String(e)}`, 'error')
    } finally {
      setLoadingReport(false)
    }
  }

  // ── Export Excel ──
  const exportExcel = async () => {
    if (!activeSession || exporting) return
    setExporting(true)
    try {
      const res = await fetch(`/api/pre-fmea/export?session_id=${activeSession.id}`)
      if (!res.ok) {
        const json = await res.json()
        showToast(`내보내기 실패: ${json.error}`, 'error')
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename\*=UTF-8''(.+)/)
      const filename = match ? decodeURIComponent(match[1]) : `PreFMEA_export.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      showToast('✅ Excel 파일 내보내기 완료')
    } catch (e) {
      showToast(`오류: ${String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  // ── Delete session ──
  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!confirm('이 세션을 삭제하시겠습니까? 모든 항목과 문서가 함께 삭제됩니다.')) return
    await fetch(`/api/pre-fmea/sessions/${sessionId}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    if (activeSession?.id === sessionId) {
      backToSessions()
    }
    showToast('세션이 삭제되었습니다.')
  }

  // ── 시스템 아키텍처 추가 업로드 ──
  const uploadArchFile = async (file: File) => {
    if (!activeSession) return
    setArchUploading(true)
    setArchError(null)
    try {
      const base64 = await toBase64(file)
      const res = await fetch('/api/pre-fmea/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id, doc_type: 'architecture',
          filename: file.name, mime_type: file.type || null, size: file.size, data_base64: base64 }),
      })
      const json = await res.json()
      if (!res.ok) { setArchError(json.error ?? '업로드 실패'); showToast(`업로드 실패: ${json.error}`, 'error'); return }
      setArchDocs(prev => [...prev, json as PreFmeaDocument])
      showToast(`✅ ${file.name} 업로드 완료`)
    } catch (e) {
      setArchError(String(e))
      showToast(`업로드 오류: ${String(e)}`, 'error')
    } finally {
      setArchUploading(false)
    }
  }

  const deleteArchDoc = async (docId: string) => {
    await fetch('/api/pre-fmea/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_id: docId }),
    })
    setArchDocs(prev => prev.filter(d => d.id !== docId))
    showToast('파일이 삭제되었습니다.')
  }

  const canGenerate = !!templateSlot.docRecord && specDocs.length > 0

  // item_name 별로 세션 그룹화
  const itemGroups = useMemo(() => {
    const g: Record<string, PreFmeaSession[]> = {}
    for (const s of sessions) {
      const key = s.item_name ?? 'SBW'
      if (!g[key]) g[key] = []
      g[key].push(s)
    }
    return g
  }, [sessions])

  const filteredSessions = selectedItem
    ? sessions.filter(s => (s.item_name ?? 'SBW') === selectedItem)
    : sessions

  // When merged items exist (post-enhance), show only merged; otherwise show AI items
  const hasMerged = items.some(i => i.source === 'merged')
  const displayItems = items.filter(i => i.source === 'ai' || i.source === 'icd')
  const filledCount = displayItems.filter(i => i.severity && i.occurrence && i.detection).length
  const highConfCount = displayItems.filter(i => (i.confidence_score ?? 0) >= 0.8).length

  // ── 공통 모달 ──────────────────────────────────────────────────────────────
  const NewSessionModal = showNewModal ? (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="font-bold text-slate-800 text-lg mb-1">새 세션 만들기</h2>
        <p className="text-xs text-slate-400 mb-4">하나의 세션 = 하나의 사전 FMEA 문서 작업 단위</p>

        <label className="text-sm text-slate-600 font-medium block mb-1.5">아이템 (Item)</label>
        {selectedItem ? (
          <div className="w-full border border-slate-100 bg-slate-50 rounded-lg px-3 py-2.5 text-sm text-slate-500 mb-1 font-mono">
            {selectedItem}
          </div>
        ) : (
          <input
            autoFocus
            type="text"
            value={newItemName}
            onChange={e => setNewItemName(e.target.value)}
            placeholder="예: SBW, PLBM, EPS"
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-1"
          />
        )}
        <p className="text-xs text-slate-400 mb-4">AI가 해당 도메인 특성에 집중하여 FMEA를 생성합니다</p>

        <label className="text-sm text-slate-600 font-medium block mb-1.5">세션명</label>
        <input
          autoFocus={!!selectedItem}
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createSession() }}
          placeholder={`예: JG1_${newItemName}_사전FMEA_v1`}
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-1"
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
  ) : null

  // ── 공통 세션 카드 ──────────────────────────────────────────────────────────
  const SessionCard = ({ s }: { s: PreFmeaSession }) => (
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
              <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">v{s.doc_version}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
            <span>{new Date(s.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            {s.item_count != null && Number(s.item_count) > 0 && (
              <>
                <span className="text-slate-200">|</span>
                <span className="text-slate-500 font-medium">{Number(s.item_count).toLocaleString()}개 생성됨</span>
              </>
            )}
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
  )

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER: Item categories
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'items') {
    const ITEM_ICONS: Record<string, string> = { SBW: '🔄', PLBM: '🔒', EPS: '🔁' }
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Toast toast={toast} onClose={() => setToast(null)} />

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">사전 FMEA_LEB</h1>
            <p className="text-sm text-slate-500 mt-1">아이템별 SW FMEA 프로젝트 관리</p>
          </div>
          <button
            onClick={() => { setNewItemName(''); setShowNewModal(true) }}
            className="bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm hover:bg-slate-700 transition-colors font-medium"
          >
            + 새 세션 만들기
          </button>
        </div>

        {loadingSessions ? (
          <div className="text-center py-16 text-slate-400">불러오는 중...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">📂</div>
            <p className="text-slate-500 text-lg mb-2">아직 세션이 없습니다.</p>
            <p className="text-slate-400 text-sm mb-8">아이템(SBW, PLBM 등)을 선택하고<br />SW 설계사양서를 업로드하면 AI가 FMEA를 자동으로 작성합니다.</p>
            <button
              onClick={() => { setNewItemName('SBW'); setShowNewModal(true) }}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              첫 번째 세션 만들기 →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(itemGroups).map(([itemName, itemSessions]) => {
              const statusCount = itemSessions.reduce<Record<string, number>>((acc, s) => {
                acc[s.status] = (acc[s.status] ?? 0) + 1; return acc
              }, {})
              const icon = ITEM_ICONS[itemName] ?? '⚙️'
              return (
                <div
                  key={itemName}
                  onClick={() => enterItem(itemName)}
                  className="bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-lg hover:border-blue-300 transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center text-3xl group-hover:bg-blue-100 transition-colors">
                      {icon}
                    </div>
                    <span className="text-slate-300 group-hover:text-blue-400 transition-colors text-xl mt-1">→</span>
                  </div>
                  <div className="font-bold text-slate-900 text-xl font-mono mb-1">{itemName}</div>
                  <div className="text-sm text-slate-500 mb-3">세션 {itemSessions.length}개</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(statusCount).map(([status, cnt]) => (
                      <span key={status} className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {STATUS_LABEL[status] ?? status} {cnt}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {NewSessionModal}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER: Session list (inside an item)
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'sessions') {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Toast toast={toast} onClose={() => setToast(null)} />

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
          <button onClick={backToItems} className="hover:text-slate-600 transition-colors">사전 FMEA_LEB</button>
          <span>/</span>
          <span className="text-slate-900 font-bold font-mono">{selectedItem}</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-mono">{selectedItem}</h1>
            <p className="text-sm text-slate-500 mt-0.5">세션 {filteredSessions.length}개</p>
          </div>
          <button
            onClick={() => { setNewItemName(selectedItem ?? 'SBW'); setShowNewModal(true) }}
            className="bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm hover:bg-slate-700 transition-colors font-medium"
          >
            + 새 세션 만들기
          </button>
        </div>

        {loadingSessions ? (
          <div className="text-center py-16 text-slate-400">불러오는 중...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center py-20 bg-white border border-dashed border-slate-200 rounded-xl">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-slate-500 text-sm font-medium">{selectedItem} 아이템에 세션이 없습니다.</p>
            <button
              onClick={() => { setNewItemName(selectedItem ?? 'SBW'); setShowNewModal(true) }}
              className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              첫 번째 세션 만들기 →
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredSessions.map(s => <SessionCard key={s.id} s={s} />)}
          </div>
        )}
        {NewSessionModal}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER: Session detail
  // ══════════════════════════════════════════════════════════════════════════
  if (!activeSession) return null
  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-5">
        <button onClick={backToItems} className="hover:text-slate-600 transition-colors">사전 FMEA_LEB</button>
        <span>/</span>
        <button onClick={backToSessions} className="hover:text-slate-600 transition-colors font-mono font-medium">
          {activeSession.item_name ?? 'SBW'}
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
          [3, '3단계', 'FMEA 결과 리포트'],
        ] as [number, string, string][]).map(([n, label, sub]) => {
          const locked = (n === 2 && activeSession.status === 'draft') ||
                         (n === 3 && items.length === 0)
          return (
            <button
              key={n}
              onClick={() => !locked && setStep(n as 1 | 2 | 3)}
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
        <div className="space-y-3">

          {/* ── ① INPUT ── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center shrink-0">1</span>
              <span className="font-semibold text-slate-800 text-sm">INPUT</span>
              <span className="text-xs text-slate-400">— 분석에 사용할 파일을 업로드하세요</span>
              <div className="flex-1 h-px bg-slate-100 ml-1" />
            </div>
          <div className="grid grid-cols-2 gap-4">
            {/* 1. FMEA 양식 */}
            <UploadCard
              title="FMEA 양식 (Template)"
              description=".xlsx / .xls — 빈 양식 파일"
              accept=".xlsx,.xls"
              slot={templateSlot}
              onFile={f => uploadFile(f, 'fmea_template', setTemplateSlot)}
            />

            {/* 2. DBC 파일 */}
            <UploadCard
              title="DBC 파일 (선택)"
              description=".dbc / .txt — CAN 시그널 정의"
              accept=".dbc,.txt,.csv"
              slot={dbcSlot}
              onFile={f => uploadFile(f, 'dbc_file', setDbcSlot)}
            />

            {/* 3. 시스템 아키텍처 — 다중 파일 */}
            <div className={`border-2 border-dashed rounded-xl p-4 transition-all
              ${archDocs.length > 0 ? 'border-emerald-400 bg-emerald-50/20' : archError ? 'border-red-400 bg-red-50/20' : 'border-slate-300 bg-white'}`}
            >
              <input
                ref={archInputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                className="hidden"
                disabled={archUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; uploadArchFile(f) } }}
              />
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold text-slate-700 text-sm">시스템 아키텍처 (선택)</div>
                  <div className="text-xs text-slate-400">.pdf / .docx — 여러 파일 가능</div>
                </div>
                <button
                  onClick={() => archInputRef.current?.click()}
                  disabled={archUploading}
                  className="shrink-0 ml-2 text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {archUploading
                    ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> 업로드 중</>
                    : '+ 파일 추가'}
                </button>
              </div>
              {archDocs.length === 0 ? (
                <div
                  onClick={() => archInputRef.current?.click()}
                  className="text-center py-5 text-slate-400 text-xs cursor-pointer hover:text-slate-600 border border-dashed border-slate-200 rounded-lg"
                >
                  클릭하여 파일 선택
                </div>
              ) : (
                <div className="space-y-1.5">
                  {archDocs.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 bg-white border border-emerald-200 rounded-lg px-3 py-1.5">
                      <span className="text-emerald-500 text-xs">✅</span>
                      <span className="text-xs text-slate-700 flex-1 truncate" title={doc.filename}>{doc.filename}</span>
                      <button
                        onClick={() => deleteArchDoc(doc.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors text-sm leading-none"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              {archError && <div className="text-xs text-red-600 mt-2">{archError}</div>}
            </div>

            {/* 4. SW 설계사양서 — 다중 파일 */}
            <div className={`border-2 border-dashed rounded-xl p-4 transition-all
              ${specDocs.length > 0 ? 'border-emerald-400 bg-emerald-50/20' : specError ? 'border-red-400 bg-red-50/20' : 'border-slate-300 bg-white'}`}
            >
              <input
                ref={specInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                className="hidden"
                disabled={specUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; uploadSpecFile(f) } }}
              />
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold text-slate-700 text-sm">SW 설계사양서</div>
                  <div className="text-xs text-slate-400">.pdf / .docx / .txt — 모듈별 여러 파일 가능</div>
                </div>
                <button
                  onClick={() => specInputRef.current?.click()}
                  disabled={specUploading}
                  className="shrink-0 ml-2 text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {specUploading
                    ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> 업로드 중</>
                    : '+ 파일 추가'}
                </button>
              </div>
              {specDocs.length === 0 ? (
                <div
                  onClick={() => specInputRef.current?.click()}
                  className="text-center py-5 text-slate-400 text-xs cursor-pointer hover:text-slate-600 border border-dashed border-slate-200 rounded-lg"
                >
                  클릭하여 파일 선택
                </div>
              ) : (
                <div className="space-y-1.5">
                  {specDocs.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 bg-white border border-emerald-200 rounded-lg px-3 py-1.5">
                      <span className="text-emerald-500 text-xs">✅</span>
                      <span className="text-xs text-slate-700 flex-1 truncate" title={doc.filename}>{doc.filename}</span>
                      <button
                        onClick={() => deleteSpecDoc(doc.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors text-sm leading-none"
                        title="삭제"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              {specError && <div className="text-xs text-red-600 mt-2">{specError}</div>}
            </div>
          </div>{/* grid end */}
          </div>{/* INPUT section end */}

          {/* 흐름 화살표 */}
          <div className="flex justify-center py-1 text-slate-300 text-lg select-none">↓</div>

          {/* ── ② GENERATE ── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-5">
              <span className="w-6 h-6 bg-violet-600 text-white text-xs font-bold rounded-full flex items-center justify-center shrink-0">2</span>
              <span className="font-semibold text-slate-800 text-sm">GENERATE</span>
              <span className="text-xs text-slate-400">— 인터페이스 추출 후 FMEA 자동 작성</span>
              <div className="flex-1 h-px bg-slate-100 ml-1" />
            </div>

            {/* 인터페이스 추출 */}
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Step 1 — 인터페이스 변수 추출</p>
            <div className={`border-2 rounded-xl p-4 mb-5 transition-colors
              ${icdParseResult ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
              <p className="text-xs text-slate-500 mb-3">
                업로드된 파일(아키텍처·DBC·설계사양서)을 자동 매칭하여 FMEA 분석 대상 변수를 추출합니다.
              </p>
              <div className="flex flex-col gap-2 mb-3">
                <button
                  onClick={buildIcd}
                  disabled={archDocs.length === 0 || icdBuilding || !!icdExtracting || icdParsing}
                  className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2
                    ${archDocs.length > 0 && !icdBuilding && !icdExtracting && !icdParsing
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                  {icdBuilding
                    ? <><span className="w-3 h-3 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />자동 생성 중...</>
                    : archDocs.length > 0
                      ? `🏗 아키텍처+DBC 자동 매칭 (권장)${dbcSlot.docRecord ? ' ✅' : ''}`
                      : '🏗 아키텍처+DBC 자동 매칭 (아키텍처 없음)'}
                </button>
                <button
                  onClick={() => extractIcd('dbc')}
                  disabled={!dbcSlot.docRecord || !!icdExtracting || icdBuilding || icdParsing}
                  className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2
                    ${dbcSlot.docRecord && !icdExtracting && !icdBuilding && !icdParsing
                      ? 'bg-slate-600 text-white hover:bg-slate-700'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                  {icdExtracting === 'dbc'
                    ? <><span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />추출 중...</>
                    : <>{dbcSlot.docRecord ? '📡 DBC만 추출' : '📡 DBC만 추출 (DBC 없음)'}</>}
                </button>
                <button
                  onClick={() => extractIcd('spec')}
                  disabled={specDocs.length === 0 || !!icdExtracting || icdBuilding || icdParsing}
                  className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2
                    ${specDocs.length > 0 && !icdExtracting && !icdBuilding && !icdParsing
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                  {icdExtracting === 'spec'
                    ? <><span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />AI 추출 중...</>
                    : <>{specDocs.length > 0 ? '🤖 사양서에서 AI 추출' : '🤖 사양서에서 AI 추출 (사양서 없음)'}</>}
                </button>
              </div>
              {icdParseResult && (
                <div className="pt-3 border-t border-indigo-100">
                  <div className="text-xs text-slate-500 mb-1.5">
                    추출된 컴포넌트 ({icdParseResult.components.length}개)
                    <span className="ml-2 text-indigo-600 font-medium">— 변수 {icdParseResult.count}개 준비됨 ✓</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {icdParseResult.components.map(c => (
                      <span key={c.name} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5 font-mono text-slate-700">
                        {c.name} <span className="text-slate-400">{c.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* FMEA 작성 */}
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Step 2 — FMEA 자동 작성</p>
            <div className="border-2 rounded-xl p-4 transition-colors
              border-slate-200 bg-slate-50/30">
              {/* 전제조건 체크리스트 */}
              <div className="flex flex-wrap gap-2 mb-4">
                {([
                  { label: 'FMEA 양식', ok: !!templateSlot.docRecord },
                  { label: 'SW 설계사양서', ok: specDocs.length > 0 },
                  { label: '인터페이스 변수 추출', ok: !!icdParseResult },
                ] as { label: string; ok: boolean }[]).map(({ label, ok }) => (
                  <div key={label} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium
                    ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-400'}`}>
                    <span>{ok ? '✅' : '○'}</span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <button
                  onClick={() => generate('icd')}
                  disabled={!canGenerate || !icdParseResult || generating}
                  className={`px-7 py-3 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2
                    ${canGenerate && icdParseResult && !generating
                      ? 'bg-violet-600 text-white hover:bg-violet-700 shadow-sm'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                >
                  {generating
                    ? <><span className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />FMEA 작성 중... (30~120초)</>
                    : icdParseResult
                      ? displayItems.length > 0
                        ? `🔄 재실행 — 기존 ${displayItems.length.toLocaleString()}개 대체 (변수 ${icdParseResult.count}개 × HAZOP 9가이드워드)`
                        : `▶ FMEA 자동 작성 시작 (변수 ${icdParseResult.count}개 × HAZOP 9가이드워드)`
                      : '▶ FMEA 자동 작성 시작 (Step 1 완료 후 활성화)'}
                </button>
                {items.length > 0 && !generating && (
                  <span className="text-xs text-slate-500">
                    현재 <strong className="text-slate-800">{displayItems.length}</strong>개 항목 생성됨 — ③ OUTPUT에서 확인
                  </span>
                )}
              </div>
              {!templateSlot.docRecord && (
                <p className="text-xs text-orange-500 mt-3">⚠ FMEA 양식 파일을 먼저 업로드해주세요. (① INPUT)</p>
              )}
              {templateSlot.docRecord && specDocs.length === 0 && (
                <p className="text-xs text-orange-500 mt-3">⚠ SW 설계사양서를 업로드해주세요. (① INPUT)</p>
              )}
              {canGenerate && !icdParseResult && (
                <p className="text-xs text-orange-500 mt-3">⚠ Step 1에서 인터페이스 변수를 먼저 추출해주세요.</p>
              )}
            </div>
          </div>

          {/* 흐름 화살표 */}
          <div className="flex justify-center py-1 text-slate-300 text-lg select-none">↓</div>

          {/* ── ③ OUTPUT ── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 bg-emerald-600 text-white text-xs font-bold rounded-full flex items-center justify-center shrink-0">3</span>
              <span className="font-semibold text-slate-800 text-sm">OUTPUT</span>
              <span className="text-xs text-slate-400">— 생성된 FMEA 항목</span>
              <div className="flex-1 h-px bg-slate-100 ml-1" />
            </div>

          {/* Stats bar — shown when items exist */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 mb-4">
              <span className="text-slate-600">
                총 <strong className="text-slate-900">{displayItems.length}</strong>개
                {hasMerged && <span className="ml-1 text-xs text-emerald-600 font-medium">(병합)</span>}
              </span>
              <span className="text-slate-300">|</span>
              {/* AP 분포 */}
              {(['VH','H','M','L'] as const).map(ap => {
                const cnt = displayItems.filter(i => i.action_priority === ap).length
                if (!cnt) return null
                return (
                  <span key={ap} className="flex items-center gap-1 text-xs">
                    <ApBadge ap={ap} /><span className="text-slate-500">{cnt}</span>
                  </span>
                )
              })}
              <span className="text-slate-300">|</span>
              <span className="text-slate-600">
                고확신 ≥80% <strong className="text-emerald-600">{highConfCount}</strong>개
              </span>
              <div className="flex-1" />
              <button
                onClick={exportExcel}
                disabled={exporting}
                className="border border-slate-300 text-slate-600 text-xs px-3 py-1.5 rounded hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {exporting
                  ? <><span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />내보내는 중...</>
                  : '↓ Excel 내보내기'}
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
                  {[40,140,140,80,160,160,160,140,44,44,44,60,50,160,160,60,90].map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    {['No','SW 컴포넌트','기능명','고장 형태','상세 내용','모듈 영향','시스템 영향','잠재 원인','S','O','D','RPN','AP','예방 조치','검출 조치','확신도','상태'].map((h, i) => (
                      <th key={i} className="px-2 py-2 text-left font-medium text-slate-600 whitespace-nowrap overflow-hidden text-ellipsis">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayItems.map((item, idx) => (
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
                      <td className="px-2 py-2 text-center"><ApBadge ap={item.action_priority ?? null} /></td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.preventive_action ?? ''}>{item.preventive_action ?? '-'}</td>
                      <td className="px-2 py-2 text-slate-600 truncate" title={item.detection_action ?? ''}>{item.detection_action ?? '-'}</td>
                      <td className="px-2 py-2 text-center"><ConfBadge score={item.confidence_score} /></td>
                      <td className="px-2 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap
                          ${item.review_status === 'accepted'  ? 'bg-emerald-100 text-emerald-700' :
                            item.review_status === 'rejected'  ? 'bg-red-100 text-red-700' :
                            item.review_status === 'modified'  ? 'bg-blue-100 text-blue-700' :
                                                                  'bg-slate-100 text-slate-500'}`}>
                          {REVIEW_STATUS_LABEL[item.review_status] ?? item.review_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>{/* OUTPUT section end */}
        </div>
      )}

      {/* ── Step 3: FMEA 결과 리포트 ── */}
      {step === 3 && (
        <div className="space-y-6">
          {/* 프로젝트 메타 입력 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="font-semibold text-slate-800 mb-1">분석 정보 입력</h2>
            <p className="text-xs text-slate-400 mb-4">리포트에 포함될 프로젝트 기본 정보를 입력하세요.</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {([
                ['vehicle',    '차량 모델',   ''],
                ['item',       '분석 아이템', ''],
                ['customer',   '고객사',      ''],
                ['department', '담당 부서',   ''],
                ['author',     '작성자',      ''],
                ['version',    '문서 버전',   ''],
              ] as [keyof ReportMeta, string, string][]).map(([key, label, placeholder]) => (
                <div key={key}>
                  <label className="text-xs text-slate-500 font-medium block mb-1">{label}</label>
                  <input
                    type="text"
                    value={reportMeta[key]}
                    onChange={e => setReportMeta(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={fetchReport}
              disabled={loadingReport}
              className="bg-slate-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {loadingReport
                ? <><span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />리포트 생성 중...</>
                : reportData
                  ? '🔄 메타 정보 반영하여 재생성'
                  : '📊 FMEA 결과 리포트 생성'}
            </button>
          </div>

          {reportData && (() => {
            const rd = reportData
            return (
              <>
                {/* ① Analysis Information */}
                <div className="bg-slate-900 text-white rounded-xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h2 className="font-bold text-lg">FMEA Result Sheet</h2>
                      <p className="text-slate-400 text-xs mt-0.5">Software FMEA 종합 결과 리포트</p>
                    </div>
                    <span className="text-slate-400 text-xs">{new Date(rd.analysisInfo.generatedAt).toLocaleString('ko-KR')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-x-8 gap-y-2 text-sm">
                    {([
                      ['Vehicle', rd.analysisInfo.vehicle],
                      ['Item', rd.analysisInfo.item],
                      ['Customer', rd.analysisInfo.customer],
                      ['Department', rd.analysisInfo.department],
                      ['Author', rd.analysisInfo.author],
                      ['Version', rd.analysisInfo.version],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-slate-400 w-24 shrink-0">{k}</span>
                        <span className="font-medium">{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-400">
                    총 분석 항목 <strong className="text-white text-sm">{rd.analysisInfo.totalItems.toLocaleString()}</strong>개
                  </div>
                </div>

                {/* ② Safety Goal Analysis */}
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h2 className="font-semibold text-slate-800 mb-3">② Safety Goal 위반 항목 분석</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        {['Safety Goal', 'Total SPF', 'SPF (SM 미할당)', 'Total LF', 'LF (SM 미할당)'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-medium text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rd.safetyGoalAnalysis.map(sg => (
                        <tr key={sg.sg} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-mono font-medium text-slate-800">{sg.sg}</td>
                          <td className="px-3 py-2.5 text-center font-bold text-slate-700">{sg.totalSPF}</td>
                          <td className="px-3 py-2.5 text-center">
                            {sg.spfWithoutSM > 0
                              ? <span className="text-red-600 font-bold">{sg.spfWithoutSM}</span>
                              : <span className="text-emerald-600 font-medium">0 ✓</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-slate-700">{sg.totalLF}</td>
                          <td className="px-3 py-2.5 text-center">
                            {sg.lfWithoutSM > 0
                              ? <span className="text-red-600 font-bold">{sg.lfWithoutSM}</span>
                              : <span className="text-emerald-600 font-medium">0 ✓</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ③ SOD Matrix */}
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h2 className="font-semibold text-slate-800 mb-1">③ SOD 분포 매트릭스</h2>
                  <p className="text-xs text-slate-400 mb-4">S × D 분포 (O 구간 합산) — 개선 전 / 개선 후 비교</p>
                  <div className="grid grid-cols-2 gap-6">
                    {(['initial', 'recommended'] as const).map(mode => {
                      const cells = rd.sodMatrix[mode]
                      const sdMap: Record<string, number> = {}
                      cells.forEach(c => { const k = `${c.s}_${c.dIdx}`; sdMap[k] = (sdMap[k] ?? 0) + c.count })
                      const maxCount = Math.max(...Object.values(sdMap), 1)
                      return (
                        <div key={mode}>
                          <p className="text-xs font-medium text-slate-600 mb-2">
                            {mode === 'initial' ? '⬛ 개선 전 (Initial SOD)' : '🟦 개선 후 (Recommended Action SOD)'}
                          </p>
                          <table className="text-xs border-collapse">
                            <thead>
                              <tr>
                                <th className="p-1 text-slate-400 text-center w-8">S↓ D→</th>
                                {rd.sodMatrix.dBins.map(d => (
                                  <th key={d} className="p-1 text-center text-slate-500 w-14">{d}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {[...rd.sodMatrix.sBins].reverse().map(s => (
                                <tr key={s}>
                                  <td className="p-1 font-bold text-center text-slate-600">{s}</td>
                                  {rd.sodMatrix.dBins.map((_, dIdx) => {
                                    const cnt = sdMap[`${s}_${dIdx}`] ?? 0
                                    const ratio = cnt / maxCount
                                    const bg = cnt === 0 ? 'bg-slate-50 text-slate-300'
                                      : ratio > 0.6 ? 'bg-blue-700 text-white'
                                      : ratio > 0.3 ? 'bg-blue-400 text-white'
                                      : ratio > 0.1 ? 'bg-blue-200 text-blue-800'
                                      : 'bg-blue-100 text-blue-700'
                                    return (
                                      <td key={dIdx} className={`p-1 text-center rounded font-medium w-14 ${bg}`}>
                                        {cnt || '·'}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* ④ AP 등급 요약 */}
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h2 className="font-semibold text-slate-800 mb-3">④ AP 등급 요약</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        {['AP 등급', '개선 전 (Current Design)', '개선 후 (Recommended Action)', '증감'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-medium text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(['VH', 'H', 'M', 'L'] as const).map(ap => {
                        const v = rd.apSummary[ap] ?? { initial: 0, recommended: 0 }
                        const diff = v.recommended - v.initial
                        return (
                          <tr key={ap} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2.5"><ApTag ap={ap} /></td>
                            <td className="px-3 py-2.5 font-bold text-slate-700">{v.initial.toLocaleString()}</td>
                            <td className="px-3 py-2.5 font-bold text-slate-700">{v.recommended.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-sm font-medium">
                              {diff === 0
                                ? <span className="text-slate-400">—</span>
                                : diff < 0
                                  ? <span className="text-emerald-600">▼ {Math.abs(diff).toLocaleString()}</span>
                                  : <span className="text-orange-500">▲ {diff.toLocaleString()}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ⑤ Additional Action Items */}
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-slate-800">⑤ 추가 조치 활동 리스트</h2>
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">총 {rd.additionalActionItems.length}개</span>
                  </div>
                  <div className="overflow-auto rounded-lg border border-slate-200" style={{ maxHeight: 280 }}>
                    <table className="text-xs w-full">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                          {['FMEA ID', 'SW Unit', 'Failure Mode', 'SG', 'SPF/LF', 'Initial S/O/D', 'Initial AP', 'Rec S/O/D', 'Rec AP'].map(h => (
                            <th key={h} className="px-2 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rd.additionalActionItems.map((it, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-mono text-slate-500">{it.fmeaId}</td>
                            <td className="px-2 py-1.5 font-mono text-slate-700 max-w-[140px] truncate" title={it.swUnit}>{it.swUnit}</td>
                            <td className="px-2 py-1.5"><span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">{it.failureMode}</span></td>
                            <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{it.sg !== '-' ? it.sg : '—'}</td>
                            <td className="px-2 py-1.5">
                              {it.spfLf === 'SPF'
                                ? <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">SPF</span>
                                : it.spfLf === 'LF'
                                  ? <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">LF</span>
                                  : '—'}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-slate-600">{it.initialS}/{it.initialO}/{it.initialD}</td>
                            <td className="px-2 py-1.5"><ApTag ap={it.initialAP} /></td>
                            <td className="px-2 py-1.5 font-mono text-slate-600">{it.recS}/{it.recO}/{it.recD}</td>
                            <td className="px-2 py-1.5"><ApTag ap={it.recAP} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ⑥ Action Monitoring */}
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h2 className="font-semibold text-slate-800 mb-3">⑥ 주요 AP 개선 조치 모니터링</h2>
                  {/* Open/Closed 요약 */}
                  <div className="flex items-center gap-6 mb-4 p-4 bg-slate-50 rounded-lg">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-500">{rd.actionMonitoring.openCount}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Open</div>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Open {rd.actionMonitoring.openCount}</span>
                        <span>Closed {rd.actionMonitoring.closedCount}</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                        {rd.actionMonitoring.openCount + rd.actionMonitoring.closedCount > 0 && (
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{ width: `${rd.actionMonitoring.closedCount / (rd.actionMonitoring.openCount + rd.actionMonitoring.closedCount) * 100}%` }}
                          />
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 text-right">
                        완료율 {rd.actionMonitoring.openCount + rd.actionMonitoring.closedCount > 0
                          ? Math.round(rd.actionMonitoring.closedCount / (rd.actionMonitoring.openCount + rd.actionMonitoring.closedCount) * 100)
                          : 0}%
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-emerald-600">{rd.actionMonitoring.closedCount}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Closed</div>
                    </div>
                  </div>
                  <div className="overflow-auto rounded-lg border border-slate-200" style={{ maxHeight: 260 }}>
                    <table className="text-xs w-full">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                          {['FMEA ID', 'SW Unit', 'FM', 'SG 위반', '개선 조치', 'Status', 'Init S/O/D', 'Rec S/O/D', 'AP*'].map(h => (
                            <th key={h} className="px-2 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rd.actionMonitoring.items.slice(0, showAllMonitoring ? undefined : 50).map((it, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-mono text-slate-500">{it.fmeaId}</td>
                            <td className="px-2 py-1.5 font-mono text-slate-700 max-w-[120px] truncate" title={it.swUnit}>{it.swUnit}</td>
                            <td className="px-2 py-1.5"><span className="bg-slate-100 px-1 py-0.5 rounded font-mono">{it.failureMode}</span></td>
                            <td className="px-2 py-1.5 text-center">{it.sgViolation ? '✓' : '—'}</td>
                            <td className="px-2 py-1.5 max-w-[200px] truncate text-slate-600" title={it.action}>{it.action}</td>
                            <td className="px-2 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${it.status === 'Open' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {it.status}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 font-mono text-slate-600">{it.initialS}/{it.initialO}/{it.initialD}</td>
                            <td className="px-2 py-1.5 font-mono text-slate-600">{it.recS}/{it.recO}/{it.recD}</td>
                            <td className="px-2 py-1.5"><ApTag ap={it.recAP} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rd.actionMonitoring.items.length > 50 && (
                      <div className="text-center py-2.5 border-t border-slate-100">
                        {showAllMonitoring ? (
                          <button
                            onClick={() => setShowAllMonitoring(false)}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                          >
                            접기 (전체 {rd.actionMonitoring.items.length}개 표시 중)
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowAllMonitoring(true)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
                          >
                            전체 보기 ({rd.actionMonitoring.items.length}개) →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ⑦ Conclusion */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-slate-800">⑦ Conclusion</h2>
                    <span className="text-xs text-slate-400">직접 수정 가능</span>
                  </div>
                  <textarea
                    value={editableConclusion}
                    onChange={e => setEditableConclusion(e.target.value)}
                    rows={6}
                    className="w-full text-sm text-slate-700 leading-relaxed bg-white border border-blue-200 rounded-lg px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </>
            )
          })()}
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
              {/* VH 항목 집중 검토 */}
              {displayItems.some(i => i.action_priority === 'VH') && (() => {
                const vhItems = displayItems.filter(i => i.action_priority === 'VH')
                return (
                  <div className="bg-white border border-red-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                        <h2 className="font-semibold text-slate-800 text-sm">VH 항목 집중 검토</h2>
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">{vhItems.length}개</span>
                      </div>
                      <span className="text-xs text-slate-400">Counter Measure 상세는 3단계 리포트에서 확인</span>
                    </div>
                    <div className="overflow-auto rounded-lg border border-red-100" style={{ maxHeight: 320 }}>
                      <table className="text-xs w-full">
                        <thead className="bg-red-50 border-b border-red-100 sticky top-0">
                          <tr>
                            {['No','SW 컴포넌트','고장 형태','S','O','D','RPN','예방 조치','검출 조치','상태'].map(h => (
                              <th key={h} className="px-2 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-50">
                          {vhItems.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-red-50/50 transition-colors">
                              <td className="px-2 py-2 text-slate-400 font-mono">{idx + 1}</td>
                              <td className="px-2 py-2 font-mono text-slate-700 max-w-[140px] truncate" title={item.sw_component ?? ''}>{item.sw_component ?? '-'}</td>
                              <td className="px-2 py-2">
                                <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">{item.failure_mode ?? '-'}</span>
                              </td>
                              <td className="px-2 py-2 text-center font-bold text-red-700">{item.severity ?? '-'}</td>
                              <td className="px-2 py-2 text-center font-bold text-orange-600">{item.occurrence ?? '-'}</td>
                              <td className="px-2 py-2 text-center font-bold text-slate-600">{item.detection ?? '-'}</td>
                              <td className="px-2 py-2 text-center"><RpnBadge rpn={item.rpn} /></td>
                              <td className="px-2 py-2 text-slate-600 max-w-[180px] truncate" title={item.preventive_action ?? ''}>{item.preventive_action ?? <span className="text-slate-300">-</span>}</td>
                              <td className="px-2 py-2 text-slate-600 max-w-[180px] truncate" title={item.detection_action ?? ''}>{item.detection_action ?? <span className="text-slate-300">-</span>}</td>
                              <td className="px-2 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap
                                  ${item.review_status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                                    item.review_status === 'modified' ? 'bg-blue-100 text-blue-700' :
                                    item.review_status === 'rejected' ? 'bg-red-100 text-red-700' :
                                    'bg-slate-100 text-slate-500'}`}>
                                  {REVIEW_STATUS_LABEL[item.review_status] ?? item.review_status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Gap 분석 */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-slate-800">Gap 분석 리포트</h2>
                    <p className="text-xs text-slate-400 mt-0.5">AI 자동 생성본과 전문가 검토본의 SOD 차이·누락 조치 검출</p>
                  </div>
                  <button
                    onClick={compare}
                    disabled={!humanSlot.docRecord || comparing}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2
                      ${humanSlot.docRecord && !comparing
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                  >
                    {comparing
                      ? <><span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />분석 중...</>
                      : '🔍 Gap 분석 실행'}
                  </button>
                </div>

                {/* Human FMEA 업로드 (선택사항) */}
                <div className="flex items-start gap-4 mb-5 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-slate-700">전문가 검토본 업로드</span>
                      <span className="text-xs bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-medium">선택사항</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      전문가가 작성·검토한 FMEA 파일(.xlsx)을 업로드하면 AI 자동 생성본({displayItems.length.toLocaleString()}개)과 대조하여
                      SOD 오차·누락 항목을 자동으로 검출합니다.
                    </p>
                  </div>
                  <div className="shrink-0 w-52">
                    <UploadCard
                      title="전문가 검토 완료본"
                      description=".xlsx / .xls"
                      accept=".xlsx,.xls"
                      slot={humanSlot}
                      onFile={f => uploadFile(f, 'human_fmea', setHumanSlot as React.Dispatch<React.SetStateAction<UploadSlot>>)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: '누락 항목 (AI 미생성)', icon: '❌', color: 'text-red-600',    val: gapResult?.missingItems  ?? '-' },
                    { label: 'S/O/D 오차 (≥2 이상)', icon: '⚠️',  color: 'text-orange-500', val: gapResult?.sodDiffs      ?? '-' },
                    { label: '조치 정보 부족',         icon: '📝', color: 'text-yellow-600', val: gapResult?.missingActions ?? '-' },
                  ].map(({ label, icon, color, val }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-4 text-center">
                      <div className="text-2xl mb-1">{icon}</div>
                      <div className={`text-2xl font-bold ${color}`}>{val}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>

                {gapResult ? (
                  <div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mb-3 flex-wrap">
                      <span>전문가 항목 <strong className="text-slate-700">{gapResult.humanCount}</strong>개</span>
                      <span className="text-slate-300">|</span>
                      <span>AI 항목 <strong className="text-slate-700">{gapResult.aiCount}</strong>개</span>
                      <span className="text-slate-300">|</span>
                      <span>매칭 <strong className="text-emerald-600">{gapResult.matchedCount}</strong>개</span>
                      <span className="text-slate-300">|</span>
                      <span>총 Gap <strong className="text-red-600">{gapResult.totalGaps}</strong>건</span>
                    </div>
                    {gapResult.gaps.length > 0 && (
                      <div className="overflow-auto rounded-lg border border-slate-200" style={{ maxHeight: 280 }}>
                        <table className="text-xs w-full">
                          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                            <tr>
                              {['유형','SW 컴포넌트','고장 형태','AI 값','전문가 값','내용'].map(h => (
                                <th key={h} className="px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {gapResult.gaps.map((g, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-3 py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap
                                    ${g.gap_type === 'missing_item' ? 'bg-red-100 text-red-700' :
                                      g.gap_type === 'wrong_sod'    ? 'bg-orange-100 text-orange-700' :
                                                                       'bg-yellow-100 text-yellow-700'}`}>
                                    {g.gap_type === 'missing_item' ? '누락' : g.gap_type === 'wrong_sod' ? `SOD_${g.field_name}` : '조치부족'}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-slate-600 max-w-[140px] truncate" title={g.sw_component ?? ''}>{g.sw_component ?? '-'}</td>
                                <td className="px-3 py-1.5"><span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">{g.failure_mode ?? '-'}</span></td>
                                <td className="px-3 py-1.5 text-slate-500">{g.ai_value ?? '-'}</td>
                                <td className="px-3 py-1.5 text-slate-700 font-medium">{g.human_value?.slice(0, 40) ?? '-'}</td>
                                <td className="px-3 py-1.5 text-slate-500 max-w-[200px] truncate" title={g.lesson}>{g.lesson}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-slate-400 border border-dashed border-slate-200 rounded-lg">
                    <p className="text-sm">{humanSlot.docRecord ? '위 버튼을 눌러 Gap 분석을 실행하세요.' : '전문가 작성 FMEA를 업로드한 후 분석을 실행하세요.'}</p>
                  </div>
                )}
              </div>

              {/* 고도화 */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-700 text-sm">고도화 (AI + 전문가 병합)</h2>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                      Gap 분석 결과를 바탕으로 전문가 검토본의 SOD 값을 우선 적용하고 누락 항목을 보완합니다.
                      전문가 검증을 통과하지 못한 항목은 신뢰도가 낮아집니다.
                    </p>
                  </div>
                  <button
                    onClick={enhance}
                    disabled={!gapResult && activeSession.status !== 'reviewed' && activeSession.status !== 'upgraded' || enhancing}
                    className={`shrink-0 ml-4 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2
                      ${(gapResult || activeSession.status === 'reviewed' || activeSession.status === 'upgraded') && !enhancing
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                  >
                    {enhancing
                      ? <><span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />고도화 중...</>
                      : '⚡ 고도화 실행'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {[
                    {
                      label: 'AP=VH 항목',
                      icon: '🔴',
                      val: displayItems.filter(i => i.action_priority === 'VH').length || '-',
                      sub: '즉시 조치 필요',
                      color: 'text-red-600',
                    },
                    {
                      label: '검토 확정',
                      icon: '✅',
                      val: items.filter(i => i.review_status === 'accepted' || i.review_status === 'modified').length || '-',
                      sub: 'accepted + modified',
                      color: 'text-emerald-600',
                    },
                    {
                      label: '검토 대기',
                      icon: '⏳',
                      val: items.filter(i => i.review_status === 'pending').length || '-',
                      sub: 'pending',
                      color: 'text-slate-500',
                    },
                  ].map(({ label, val, icon, sub, color }) => (
                    <div key={label} className="bg-white rounded-lg p-3 text-center border border-slate-200">
                      <div className="text-lg mb-0.5">{icon}</div>
                      <div className={`text-base font-bold ${color}`}>{val}</div>
                      <div className="text-xs text-slate-600 font-medium mt-0.5">{label}</div>
                      <div className="text-xs text-slate-400">{sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AP 재계산 */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-800 text-sm">AP 재계산</h2>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                      현재 S·O·D 값을 기준으로 AIAG-VDA 룩업 테이블에 따라 모든 항목의 AP를 다시 계산합니다.
                      Counter Measure 검토 후 S*/O*/D* After 값이 변경된 경우 실행하세요.
                    </p>
                  </div>
                  <button
                    onClick={recalcAp}
                    disabled={recalcingAp || items.length === 0}
                    className={`shrink-0 ml-4 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2
                      ${!recalcingAp && items.length > 0
                        ? 'bg-slate-800 text-white hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                  >
                    {recalcingAp
                      ? <><span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />재계산 중...</>
                      : '🔄 AP 재계산'}
                  </button>
                </div>
                {/* AP 분포 현황 */}
                {items.length > 0 && (
                  <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-100">
                    <span className="text-xs text-slate-400 self-center">현재 AP 분포</span>
                    {(['VH','H','M','L'] as const).map(ap => {
                      const cnt = displayItems.filter(i => i.action_priority === ap).length
                      if (!cnt) return null
                      return (
                        <div key={ap} className="flex items-center gap-1.5">
                          <ApBadge ap={ap} />
                          <span className="text-xs font-medium text-slate-600">{cnt.toLocaleString()}개</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Report helpers ───────────────────────────────────────────────────────────
const AP_REPORT_STYLE: Record<string, string> = {
  VH: 'bg-red-600 text-white', H: 'bg-orange-500 text-white',
  M: 'bg-yellow-400 text-slate-800', L: 'bg-green-100 text-green-800',
}
function ApTag({ ap }: { ap: string }) {
  return <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${AP_REPORT_STYLE[ap] ?? 'bg-slate-100 text-slate-500'}`}>{ap}</span>
}

// ─── Toast component ──────────────────────────────────────────────────────────
function Toast({ toast, onClose }: { toast: { msg: string; type: 'info' | 'error' } | null; onClose: () => void }) {
  if (!toast) return null
  return (
    <div
      onClick={onClose}
      className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm shadow-xl max-w-sm cursor-pointer flex items-start gap-3
        ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-800 text-white'}`}
    >
      <span className="flex-1">{toast.msg}</span>
      <span className="shrink-0 opacity-60 text-xs mt-0.5">✕</span>
    </div>
  )
}
