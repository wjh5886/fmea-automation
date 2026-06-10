'use client'

import { Fragment, useState } from 'react'
import type { Project } from '@/lib/supabase'

export type CrossItem = {
  severity: number | null
  rpn: number | null
  failure_mode: string | null
  effect_safety_goal: string | null
}

export type SgInfo = { sg_id: string; name: string; asil: string | null }

export type ProjectCrossData = {
  project: Project
  items: CrossItem[]
  sgs: SgInfo[]
}

const FM_ORDER = ['MORE', 'LESS', 'CORRUPT', 'STUCK', 'EARLY', 'LATE', 'ERRATIC']
const FOLDER_ORDER = ['SBW', 'WPC', 'PLBM']

const ASIL_COLORS: Record<string, string> = {
  D: 'bg-red-100 text-red-700', C: 'bg-orange-100 text-orange-700',
  B: 'bg-yellow-100 text-yellow-700', A: 'bg-blue-100 text-blue-700', QM: 'bg-slate-100 text-slate-600',
}

// "SG1" → "SG01", "SG1 / SG2 / SG3" → ["SG01","SG02","SG03"] 처럼 표기 차이/복수값을 정규화
function splitSgIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[/,]/)
    .map(s => s.trim())
    .filter(s => s && !['X', '-'].includes(s.toUpperCase()))
    .map(s => {
      const m = s.toUpperCase().match(/^SG0*(\d+)$/)
      return m ? `SG${m[1].padStart(2, '0')}` : s.toUpperCase()
    })
}

function heatColor(count: number, maxS: number) {
  if (count === 0) return 'bg-slate-50 text-slate-300'
  if (maxS >= 9) return 'bg-red-600 text-white'
  if (maxS >= 8) return 'bg-red-400 text-white'
  if (maxS >= 7) return 'bg-orange-300 text-orange-900'
  if (maxS >= 5) return 'bg-amber-200 text-amber-900'
  return 'bg-yellow-100 text-yellow-700'
}

const LEGEND = [
  { label: 'S9-10', cls: 'bg-red-600' },
  { label: 'S8', cls: 'bg-red-400' },
  { label: 'S7', cls: 'bg-orange-300' },
  { label: 'S5-6', cls: 'bg-amber-200' },
  { label: 'S1-4', cls: 'bg-yellow-100' },
  { label: '위반 없음', cls: 'bg-slate-50 border border-slate-200' },
]

function FolderHeatmap({ label, group }: { label: string; group: ProjectCrossData[] }) {
  const [hiddenSgs, setHiddenSgs] = useState<Set<string>>(new Set())

  // ── Safety Goal 위반 비교 ──
  const sgIds = new Set<string>()
  const sgInfo = new Map<string, SgInfo>()
  for (const { items, sgs } of group) {
    for (const i of items) {
      for (const id of splitSgIds(i.effect_safety_goal)) sgIds.add(id)
    }
    for (const sg of sgs) {
      if (!sgInfo.has(sg.sg_id)) sgInfo.set(sg.sg_id, sg)
    }
  }
  const sgRows = [...sgIds].sort().map(sgId => {
    const cells = group.map(({ items }) => {
      const violations = items.filter(i => splitSgIds(i.effect_safety_goal).includes(sgId))
      return {
        count: violations.length,
        maxS: violations.length ? Math.max(...violations.map(v => v.severity ?? 0)) : 0,
      }
    })
    return { sgId, info: sgInfo.get(sgId), cells, projectsAffected: cells.filter(c => c.count > 0).length }
  }).sort((a, b) => b.projectsAffected - a.projectsAffected || a.sgId.localeCompare(b.sgId))

  const visibleSgRows = sgRows.filter(r => !hiddenSgs.has(r.sgId))

  function toggleSg(sgId: string) {
    setHiddenSgs(prev => {
      const next = new Set(prev)
      if (next.has(sgId)) next.delete(sgId)
      else next.add(sgId)
      return next
    })
  }

  // ── 고장 유형(FM) 비교 ──
  const fmRows = FM_ORDER.map(fm => {
    const cells = group.map(({ items }) => {
      const rows = items.filter(i => (i.failure_mode ?? '').trim().toUpperCase() === fm)
      const rpns = rows.map(r => r.rpn ?? 0)
      return { count: rows.length, avgRpn: rows.length ? Math.round(rpns.reduce((a, b) => a + b, 0) / rows.length) : 0 }
    })
    return { fm, cells, projectsAffected: cells.filter(c => c.count > 0).length }
  }).filter(r => r.projectsAffected > 0)
    .sort((a, b) => b.projectsAffected - a.projectsAffected)

  const topSg = sgRows.find(r => r.projectsAffected >= 2)
  const topFm = fmRows.find(r => r.projectsAffected >= 2)

  return (
    <div>
      <h3 className="text-sm font-bold text-slate-700 mb-3">{label} <span className="font-normal text-slate-400">({group.length}개 차종)</span></h3>

      {(topSg || topFm) && (
        <div className="flex flex-col gap-2 mb-4">
          {topSg && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800">
              🚨 <strong>{topSg.sgId}</strong>{topSg.info?.name ? ` (${topSg.info.name})` : ''} — {topSg.projectsAffected}개 차종에서 공통 위반 (최대 S{Math.max(...topSg.cells.map(c => c.maxS))}). 공통 진단 로직 검토를 권장합니다.
            </div>
          )}
          {topFm && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
              ⚠️ <strong>{topFm.fm}</strong> 고장 유형이 {topFm.projectsAffected}개 차종에서 공통으로 발생 — 플랫폼 공통 SM 표준화를 검토하세요.
            </div>
          )}
        </div>
      )}

      {sgRows.length > 0 && (
        <div className="overflow-x-auto">
          {/* SG 선택 토글 */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-xs text-slate-400 mr-0.5">SG 선택</span>
            {sgRows.map(row => {
              const hidden = hiddenSgs.has(row.sgId)
              return (
                <button
                  key={row.sgId}
                  onClick={() => toggleSg(row.sgId)}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                    hidden
                      ? 'border-slate-200 text-slate-300 bg-white hover:border-slate-300'
                      : 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'
                  }`}
                >
                  {row.sgId}
                </button>
              )
            })}
            {hiddenSgs.size > 0 && (
              <button onClick={() => setHiddenSgs(new Set())} className="text-xs text-slate-400 hover:text-blue-600 ml-1">
                전체 보기
              </button>
            )}
          </div>

          {visibleSgRows.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-300">선택된 SG가 없습니다.</div>
          ) : (
          <div
            className="inline-grid gap-1.5 min-w-full"
            style={{ gridTemplateColumns: `140px repeat(${group.length}, minmax(76px, 1fr))` }}
          >
            <div />
            {group.map(({ project }) => (
              <div key={project.id} className="text-xs font-medium text-slate-600 text-center truncate px-1 self-end pb-1" title={project.name}>
                {project.name}
              </div>
            ))}

            {visibleSgRows.map(row => (
              <Fragment key={row.sgId}>
                <div className="flex items-center gap-1.5 pr-2" title={row.info?.name}>
                  <span className="font-bold text-slate-700 text-sm">{row.sgId}</span>
                  {row.info?.asil && (
                    <span className={`px-1.5 py-0.5 rounded text-[.65rem] font-bold ${ASIL_COLORS[row.info.asil] ?? ASIL_COLORS.QM}`}>
                      {row.info.asil}
                    </span>
                  )}
                </div>
                {row.cells.map((c, i) => (
                  <div
                    key={i}
                    className={`rounded-lg h-14 flex flex-col items-center justify-center transition-colors ${heatColor(c.count, c.maxS)}`}
                  >
                    {c.count > 0 ? (
                      <>
                        <span className="text-base font-bold leading-tight">{c.count}</span>
                        <span className="text-[.65rem] opacity-80 leading-tight">S{c.maxS}</span>
                      </>
                    ) : (
                      <span className="text-xs">-</span>
                    )}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
          )}

          {/* 범례 */}
          <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-400">심각도</span>
            {LEGEND.map(l => (
              <div key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
                <div className={`w-3.5 h-3.5 rounded ${l.cls}`} />
                {l.label}
              </div>
            ))}
            <span className="ml-auto text-xs text-slate-400">셀 = 위반 건수 / 최대 S값</span>
          </div>
        </div>
      )}
    </div>
  )
}

// 차종(프로젝트) 간 공통 위험 패턴 비교 — 같은 제품군(폴더) 내에서만 SG 정의가 동일하므로 폴더별로 그룹핑
export default function CrossModelComparison({ data }: { data: ProjectCrossData[] }) {
  const groups = new Map<string, ProjectCrossData[]>()
  for (const d of data) {
    const key = d.project.folder ?? '미분류'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(d)
  }

  const groupEntries = [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort(([a], [b]) => {
      const ia = FOLDER_ORDER.indexOf(a), ib = FOLDER_ORDER.indexOf(b)
      if (ia === -1 && ib === -1) return a.localeCompare(b)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

  if (groupEntries.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
      <h2 className="font-semibold text-slate-800 mb-1">🔍 차종 간 비교</h2>
      <p className="text-xs text-slate-400 mb-4">같은 제품군(폴더) 내 차종 간 공통 위험 패턴을 확인하세요.</p>

      {groupEntries.map(([folder, group], idx) => (
        <div key={folder} className={idx > 0 ? 'mt-8 pt-6 border-t border-slate-100' : ''}>
          <FolderHeatmap label={folder} group={group} />
        </div>
      ))}
    </div>
  )
}
