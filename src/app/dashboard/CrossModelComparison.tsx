'use client'

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

const ASIL_COLORS: Record<string, string> = {
  D: 'bg-red-100 text-red-700', C: 'bg-orange-100 text-orange-700',
  B: 'bg-yellow-100 text-yellow-700', A: 'bg-blue-100 text-blue-700', QM: 'bg-slate-100 text-slate-600',
}

const isSgViolation = (sg: string | null | undefined): sg is string =>
  !!sg && !['X', '-', ''].includes(sg.trim())

function cellColor(maxS: number) {
  if (maxS >= 9) return 'bg-red-100 text-red-700'
  if (maxS >= 8) return 'bg-orange-100 text-orange-700'
  if (maxS > 0) return 'bg-amber-50 text-amber-700'
  return 'bg-slate-50 text-slate-400'
}

// 차종(프로젝트) 간 공통 위험 패턴 비교 — 담당자 검토 후 제거될 수 있는 실험적 섹션
export default function CrossModelComparison({ data }: { data: ProjectCrossData[] }) {
  if (data.length < 2) return null

  // ── Safety Goal 위반 비교 ──
  const sgIds = new Set<string>()
  const sgInfo = new Map<string, SgInfo>()
  for (const { items, sgs } of data) {
    for (const i of items) {
      if (isSgViolation(i.effect_safety_goal)) sgIds.add(i.effect_safety_goal!.trim())
    }
    for (const sg of sgs) {
      if (!sgInfo.has(sg.sg_id)) sgInfo.set(sg.sg_id, sg)
    }
  }
  const sgRows = [...sgIds].sort().map(sgId => {
    const cells = data.map(({ items }) => {
      const violations = items.filter(i => (i.effect_safety_goal ?? '').trim() === sgId)
      return {
        count: violations.length,
        maxS: violations.length ? Math.max(...violations.map(v => v.severity ?? 0)) : 0,
      }
    })
    return { sgId, info: sgInfo.get(sgId), cells, projectsAffected: cells.filter(c => c.count > 0).length }
  }).sort((a, b) => b.projectsAffected - a.projectsAffected || a.sgId.localeCompare(b.sgId))

  // ── 고장 유형(FM) 비교 ──
  const fmRows = FM_ORDER.map(fm => {
    const cells = data.map(({ items }) => {
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
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
      <h2 className="font-semibold text-slate-800 mb-1">🔍 차종 간 비교</h2>
      <p className="text-xs text-slate-400 mb-4">여러 프로젝트(차종)에 공통으로 나타나는 위험 패턴을 확인하세요.</p>

      {(topSg || topFm) && (
        <div className="flex flex-col gap-2 mb-5">
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
        <div className="mb-6 overflow-x-auto">
          <h3 className="text-sm font-bold text-slate-700 mb-2">Safety Goal 위반 비교</h3>
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600">SG</th>
                {data.map(({ project }) => (
                  <th key={project.id} className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">{project.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sgRows.map(row => (
                <tr key={row.sgId}>
                  <td className="px-3 py-2 whitespace-nowrap align-top">
                    <span className="font-bold text-slate-700">{row.sgId}</span>
                    {row.info?.asil && <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[.65rem] font-bold ${ASIL_COLORS[row.info.asil] ?? ASIL_COLORS.QM}`}>{row.info.asil}</span>}
                    {row.info?.name && <div className="text-xs text-slate-400">{row.info.name}</div>}
                  </td>
                  {row.cells.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center align-top">
                      {c.count > 0
                        ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${cellColor(c.maxS)}`}>{c.count}건 (S{c.maxS})</span>
                        : <span className="text-slate-300">-</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
