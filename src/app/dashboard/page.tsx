'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type Project } from '@/lib/supabase'
import CrossModelComparison, { type ProjectCrossData } from './CrossModelComparison'

type ProjectStat = {
  project: Project
  total: number
  filled: number
  highRisk: number
  avgRpn: number
  maxRpn: number
}

type FmStat = {
  mode: string
  count: number
  avgRpn: number
  highRisk: number
}

const FM_ORDER = ['MORE', 'LESS', 'CORRUPT', 'STUCK', 'EARLY', 'LATE', 'ERRATIC', 'N/A']

const FM_COLOR: Record<string, string> = {
  MORE:    'bg-orange-400',
  LESS:    'bg-yellow-400',
  CORRUPT: 'bg-red-500',
  STUCK:   'bg-red-400',
  EARLY:   'bg-blue-400',
  LATE:    'bg-blue-300',
  ERRATIC: 'bg-purple-400',
  'N/A':   'bg-slate-300',
}

function buildFmStats(fmMap: Record<string, { count: number; rpnSum: number; highRisk: number }>): FmStat[] {
  return FM_ORDER
    .filter(m => fmMap[m])
    .map(m => ({
      mode: m,
      count: fmMap[m].count,
      avgRpn: fmMap[m].count ? Math.round(fmMap[m].rpnSum / fmMap[m].count) : 0,
      highRisk: fmMap[m].highRisk,
    }))
}

export default function DashboardPage() {
  const [stats, setStats] = useState<ProjectStat[]>([])
  const [fmAll, setFmAll] = useState<FmStat[]>([])
  const [fmByProject, setFmByProject] = useState<Record<string, FmStat[]>>({})
  const [crossData, setCrossData] = useState<ProjectCrossData[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('__all__')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: projects } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
      if (!projects?.length) { setLoading(false); return }

      const results: ProjectStat[] = []
      const allFmMap: Record<string, { count: number; rpnSum: number; highRisk: number }> = {}
      const byProject: Record<string, FmStat[]> = {}
      const cross: ProjectCrossData[] = []

      for (const project of projects) {
        const [{ data: items }, { data: sgs }] = await Promise.all([
          supabase
            .from('fmea_items')
            .select('severity,occurrence,detection,rpn,failure_mode,effect_safety_goal')
            .eq('project_id', project.id),
          supabase
            .from('safety_goals')
            .select('sg_id,name,asil')
            .eq('project_id', project.id),
        ])

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
        cross.push({ project, items, sgs: sgs ?? [] })

        const projFmMap: Record<string, { count: number; rpnSum: number; highRisk: number }> = {}
        for (const item of items) {
          const mode = item.failure_mode ?? 'N/A'
          for (const map of [allFmMap, projFmMap]) {
            if (!map[mode]) map[mode] = { count: 0, rpnSum: 0, highRisk: 0 }
            map[mode].count++
            if (item.rpn) { map[mode].rpnSum += item.rpn; if (item.rpn >= 100) map[mode].highRisk++ }
          }
        }
        byProject[project.id] = buildFmStats(projFmMap)
      }

      setStats(results)
      setFmAll(buildFmStats(allFmMap))
      setFmByProject(byProject)
      setCrossData(cross)
      setLoading(false)
    }
    load()
  }, [])

  const totalItems = stats.reduce((s, p) => s + p.total, 0)
  const totalFilled = stats.reduce((s, p) => s + p.filled, 0)
  const totalHigh = stats.reduce((s, p) => s + p.highRisk, 0)

  const displayFm = selectedProject === '__all__' ? fmAll : (fmByProject[selectedProject] ?? [])
  const maxFmCount = Math.max(...displayFm.map(f => f.count), 1)

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
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
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
                  <th className="text-right px-4 py-3 font-medium text-slate-600">FMEA 결과</th>
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

          {/* Failure Mode 분포 */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-slate-800">Failure Mode 분포</h2>
              <select
                value={selectedProject}
                onChange={e => setSelectedProject(e.target.value)}
                className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="__all__">전체 프로젝트</option>
                {stats.map(({ project }) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              {displayFm.map(({ mode, count, avgRpn, highRisk }) => (
                <div key={mode} className="flex items-center gap-3">
                  <div className="w-16 text-xs font-mono font-medium text-slate-700 text-right shrink-0">{mode}</div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${FM_COLOR[mode] ?? 'bg-slate-400'} transition-all duration-500`}
                        style={{ width: `${(count / maxFmCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 text-xs text-slate-600 text-right shrink-0">{count.toLocaleString()}개</span>
                  </div>
                  <div className="w-24 flex gap-2 text-xs shrink-0">
                    <span className="text-slate-400">avg</span>
                    <span className={`font-medium ${avgRpn >= 200 ? 'text-red-600' : avgRpn >= 100 ? 'text-orange-500' : 'text-slate-600'}`}>
                      {avgRpn || '-'}
                    </span>
                    {highRisk > 0 && (
                      <span className="text-red-400 ml-auto">⚠ {highRisk}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100">
              {FM_ORDER.filter(m => displayFm.find(f => f.mode === m)).map(m => (
                <div key={m} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <div className={`w-3 h-3 rounded-full ${FM_COLOR[m] ?? 'bg-slate-300'}`} />
                  {m}
                </div>
              ))}
              <div className="ml-auto text-xs text-slate-400">⚠ = 고위험(≥100) 수</div>
            </div>
          </div>

          {/* 차종 간 비교 */}
          <CrossModelComparison data={crossData} />
        </>
      )}
    </div>
  )
}
