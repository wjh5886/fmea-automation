'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FmeaItem, SafetyGoal, Project, SwUnit } from '@/lib/supabase'
import ReportDashboard from '@/app/projects/[id]/fmea/ReportDashboard'

type ProjectData = {
  project: Project
  items: FmeaItem[]
  sgs: SafetyGoal[]
}

type ProjectSummary = {
  project: Project
  total: number
  filled: number
  highRisk: number
  sgViolations: number
  avgRpn: number
  maxRpn: number
}

const isSgViolation = (sg: string | null | undefined): sg is string =>
  !!sg && !['X', '-', ''].includes(sg.trim())

export default function IntegratedReportPage() {
  const [data, setData] = useState<ProjectData[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState('__all__')

  useEffect(() => {
    async function load() {
      const projects: Project[] = await (await fetch('/api/projects')).json()
      const results: ProjectData[] = []
      for (const project of projects) {
        const [items, sgs] = await Promise.all([
          fetch(`/api/projects/${project.id}/items`).then(r => (r.ok ? r.json() : [])),
          fetch(`/api/projects/${project.id}/goals`).then(r => (r.ok ? r.json() : [])),
        ])
        results.push({ project, items, sgs })
      }
      setData(results)
      setLoading(false)
    }
    load()
  }, [])

  const summaries = useMemo<ProjectSummary[]>(() => data.map(({ project, items }) => {
    const filled = items.filter(i => i.severity && i.occurrence && i.detection)
    const rpns = filled.map(i => i.rpn ?? 0)
    return {
      project,
      total: items.length,
      filled: filled.length,
      highRisk: rpns.filter(r => r >= 100).length,
      sgViolations: items.filter(i => isSgViolation(i.effect_safety_goal)).length,
      avgRpn: rpns.length ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0,
      maxRpn: rpns.length ? Math.max(...rpns) : 0,
    }
  }), [data])

  const totals = useMemo(() => ({
    total: summaries.reduce((a, s) => a + s.total, 0),
    filled: summaries.reduce((a, s) => a + s.filled, 0),
    highRisk: summaries.reduce((a, s) => a + s.highRisk, 0),
    sgViolations: summaries.reduce((a, s) => a + s.sgViolations, 0),
    maxRpn: summaries.reduce((a, s) => Math.max(a, s.maxRpn), 0),
  }), [summaries])

  const { combinedItems, combinedSgs } = useMemo(() => {
    if (selected !== '__all__') {
      const found = data.find(d => d.project.id === selected)
      return { combinedItems: found?.items ?? [], combinedSgs: found?.sgs ?? [] }
    }
    const items: FmeaItem[] = []
    const sgs: SafetyGoal[] = []
    for (const { project, items: pItems, sgs: pSgs } of data) {
      for (const i of pItems) {
        items.push({
          ...i,
          sw_units: { ...(i.sw_units as SwUnit), name: `${project.name} · ${i.sw_units?.name ?? '미분류'}` } as SwUnit,
        })
      }
      sgs.push(...pSgs)
    }
    const seen = new Set<string>()
    const dedupedSgs = sgs.filter(sg => {
      if (seen.has(sg.sg_id)) return false
      seen.add(sg.sg_id)
      return true
    })
    return { combinedItems: items, combinedSgs: dedupedSgs }
  }, [data, selected])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm">홈</Link>
          <span className="text-slate-300">/</span>
          <Link href="/dashboard" className="text-slate-400 hover:text-slate-600 text-sm">RPN 대시보드</Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-2xl font-bold text-slate-900">통합 분석 리포트</h1>
        </div>
        <Link href="/dashboard" className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
          ← RPN 대시보드
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">프로젝트가 없습니다.</div>
      ) : (
        <>
          {/* 전체 합산 카드 */}
          <div className="grid grid-cols-5 gap-3 mb-8">
            <div className="rounded-xl p-4 border-l-4 border-indigo-500 bg-indigo-50 text-indigo-600">
              <div className="text-xs text-slate-500 mb-1">프로젝트 수</div>
              <div className="text-2xl font-extrabold">{data.length}</div>
            </div>
            <div className="rounded-xl p-4 border-l-4 border-slate-400 bg-slate-50 text-slate-700">
              <div className="text-xs text-slate-500 mb-1">전체 항목</div>
              <div className="text-2xl font-extrabold">{totals.total.toLocaleString()}</div>
            </div>
            <div className="rounded-xl p-4 border-l-4 border-emerald-500 bg-emerald-50 text-emerald-600">
              <div className="text-xs text-slate-500 mb-1">S/O/D 입력 완료</div>
              <div className="text-2xl font-extrabold">
                {totals.total ? Math.round((totals.filled / totals.total) * 100) : 0}%
              </div>
            </div>
            <div className="rounded-xl p-4 border-l-4 border-red-500 bg-red-50 text-red-600">
              <div className="text-xs text-slate-500 mb-1">SG 위반</div>
              <div className="text-2xl font-extrabold">{totals.sgViolations.toLocaleString()}</div>
            </div>
            <div className="rounded-xl p-4 border-l-4 border-cyan-500 bg-cyan-50 text-cyan-600">
              <div className="text-xs text-slate-500 mb-1">최대 RPN</div>
              <div className="text-2xl font-extrabold">{totals.maxRpn}</div>
            </div>
          </div>

          {/* 프로젝트별 현황 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8 shadow-sm">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800 text-sm">프로젝트별 현황</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">프로젝트</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">전체</th>
                  <th className="px-4 py-3 font-medium text-slate-600">진행률</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">평균 RPN</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">최대 RPN</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 text-red-500">SG 위반</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 text-red-500">고위험</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summaries.map(s => {
                  const pct = s.total ? Math.round((s.filled / s.total) * 100) : 0
                  return (
                    <tr key={s.project.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{s.project.name}</div>
                        {s.project.vehicle_model && (
                          <div className="text-xs text-slate-400">{s.project.vehicle_model}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{s.total}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{s.avgRpn || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={s.maxRpn >= 200 ? 'text-red-600 font-semibold' : s.maxRpn >= 100 ? 'text-orange-500' : 'text-slate-600'}>
                          {s.maxRpn || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.sgViolations > 0
                          ? <span className="text-red-600 font-semibold">{s.sgViolations}</span>
                          : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.highRisk > 0
                          ? <span className="text-red-600 font-semibold">{s.highRisk}</span>
                          : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/projects/${s.project.id}/fmea?view=report`} className="text-indigo-600 hover:underline text-xs whitespace-nowrap">
                          리포트 →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 상세 분석 */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5 gap-3">
              <h2 className="font-semibold text-slate-800">상세 분석</h2>
              <select
                value={selected}
                onChange={e => setSelected(e.target.value)}
                className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="__all__">전체 프로젝트 (통합)</option>
                {data.map(({ project }) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <ReportDashboard items={combinedItems} sgs={combinedSgs} />
          </div>
        </>
      )}
    </div>
  )
}
