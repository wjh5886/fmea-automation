'use client'

import { useMemo, useState } from 'react'
import type { FmeaItem, SafetyGoal, Project, SwUnit } from '@/lib/supabase'
import ReportDashboard from '@/app/projects/[id]/fmea/ReportDashboard'

type ProjectData = {
  project: Project
  items: FmeaItem[]
  sgs: SafetyGoal[]
}

// 전체 프로젝트 통합 ReportDashboard — 펼쳤을 때만 데이터를 불러오는 자체 완결 섹션.
// 담당자 검토 후 제거될 수 있어 page.tsx에서는 이 컴포넌트 한 줄만 참조한다.
export default function IntegratedReportSection({ projects }: { projects: Project[] }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ProjectData[] | null>(null)
  const [selected, setSelected] = useState('__all__')

  const toggle = async () => {
    if (!expanded && data === null) {
      setLoading(true)
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
    setExpanded(e => !e)
  }

  const { combinedItems, combinedSgs } = useMemo(() => {
    if (!data) return { combinedItems: [] as FmeaItem[], combinedSgs: [] as SafetyGoal[] }
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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8">
      <button onClick={toggle} className="w-full flex items-center justify-between px-6 py-4 text-left">
        <h2 className="font-semibold text-slate-800">📊 통합 상세 분석</h2>
        <span className="text-sm text-slate-400">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {expanded && (
        <div className="px-6 pb-6 border-t border-slate-100 pt-5">
          {loading ? (
            <div className="text-center py-12 text-slate-400">불러오는 중...</div>
          ) : (
            <>
              <div className="flex items-center justify-end mb-5">
                <select
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="__all__">전체 프로젝트 (통합)</option>
                  {(data ?? []).map(({ project }) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
              <ReportDashboard items={combinedItems} sgs={combinedSgs} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
