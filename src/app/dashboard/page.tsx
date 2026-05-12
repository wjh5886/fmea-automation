'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type Project } from '@/lib/supabase'

type ProjectStat = {
  project: Project
  total: number
  filled: number
  highRisk: number
  avgRpn: number
  maxRpn: number
}

export default function DashboardPage() {
  const [stats, setStats] = useState<ProjectStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: projects } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
      if (!projects?.length) { setLoading(false); return }

      const results: ProjectStat[] = []
      for (const project of projects) {
        const { data: items } = await supabase
          .from('fmea_items')
          .select('severity,occurrence,detection,rpn')
          .eq('project_id', project.id)

        if (!items) continue
        const filled = items.filter(i => i.severity && i.occurrence && i.detection)
        const rpns = filled.map(i => (i.rpn ?? i.severity * i.occurrence * i.detection) as number)
        results.push({
          project,
          total: items.length,
          filled: filled.length,
          highRisk: rpns.filter(r => r >= 100).length,
          avgRpn: rpns.length ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0,
          maxRpn: rpns.length ? Math.max(...rpns) : 0,
        })
      }
      setStats(results)
      setLoading(false)
    }
    load()
  }, [])

  const totalItems = stats.reduce((s, p) => s + p.total, 0)
  const totalFilled = stats.reduce((s, p) => s + p.filled, 0)
  const totalHigh = stats.reduce((s, p) => s + p.highRisk, 0)

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm">홈</Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-2xl font-bold text-slate-900">RPN 대시보드</h1>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : (
        <>
          {/* 전체 요약 */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="text-sm text-slate-500 mb-1">전체 항목</div>
              <div className="text-3xl font-bold text-slate-900">{totalItems.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">{stats.length}개 프로젝트</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="text-sm text-slate-500 mb-1">S/O/D 입력 완료</div>
              <div className="text-3xl font-bold text-slate-900">{totalFilled.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">
                {totalItems ? Math.round(totalFilled / totalItems * 100) : 0}% 완료
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="text-sm text-slate-500 mb-1">고위험 항목 (RPN ≥ 100)</div>
              <div className="text-3xl font-bold text-red-600">{totalHigh.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">
                {totalFilled ? Math.round(totalHigh / totalFilled * 100) : 0}% 비율
              </div>
            </div>
          </div>

          {/* 프로젝트별 현황 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">프로젝트</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">전체</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">입력 완료</th>
                  <th className="px-4 py-3 font-medium text-slate-600">진행률</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">평균 RPN</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">최대 RPN</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 text-red-500">고위험</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.map(({ project, total, filled, highRisk, avgRpn, maxRpn }) => {
                  const pct = total ? Math.round(filled / total * 100) : 0
                  return (
                    <tr key={project.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{project.name}</div>
                        {project.vehicle_model && (
                          <div className="text-xs text-slate-400">{project.vehicle_model}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{total}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{filled}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{avgRpn || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={maxRpn >= 200 ? 'text-red-600 font-semibold' : maxRpn >= 100 ? 'text-orange-500' : 'text-slate-600'}>
                          {maxRpn || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {highRisk > 0 ? (
                          <span className="text-red-600 font-semibold">{highRisk}</span>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/projects/${project.id}/fmea`} className="text-blue-600 hover:underline text-xs">
                          보기
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
