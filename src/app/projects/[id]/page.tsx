'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, type Project, type SwUnit } from '@/lib/supabase'

type StatItem = { id: string; severity: number | null; occurrence: number | null; detection: number | null; rpn: number | null }

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter(); void router
  const [project, setProject] = useState<Project | null>(null)
  const [units, setUnits] = useState<SwUnit[]>([])
  const [stats, setStats] = useState({ total: 0, filled: 0, high_rpn: 0 })
  const [newUnit, setNewUnit] = useState('')
  const [addingUnit, setAddingUnit] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('*').eq('id', id).single().then(({ data }) => setProject(data))
    supabase.from('sw_units').select('*').eq('project_id', id).order('name').then(({ data }) => setUnits(data ?? []))
    supabase.from('fmea_items').select('id,severity,occurrence,detection,rpn').eq('project_id', id).then(({ data }) => {
      const items = data ?? []
      setStats({
        total: items.length,
        filled: items.filter((i: StatItem) => i.severity && i.occurrence && i.detection).length,
        high_rpn: items.filter((i: StatItem) => (i.rpn ?? 0) >= 100).length,
      })
    })
  }, [id])

  const addSwUnit = async () => {
    if (!newUnit.trim()) return
    setAddingUnit(true)
    const { data } = await supabase.from('sw_units').insert([{ project_id: id, name: newUnit.trim() }]).select().single()
    if (data) setUnits(u => [...u, data])
    setNewUnit('')
    setAddingUnit(false)
  }

  if (!project) return <div className="text-center py-16 text-slate-400">불러오는 중...</div>

  const fillRate = stats.total > 0 ? Math.round((stats.filled / stats.total) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <Link href="/projects" className="hover:text-slate-600">프로젝트</Link>
        <span>/</span>
        <span className="text-slate-700">{project.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
          {project.vehicle_model && <p className="text-slate-500 text-sm mt-1">차종: {project.vehicle_model}</p>}
        </div>
        <Link href={`/projects/${id}/fmea`} className="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm hover:bg-slate-700 transition-colors">
          FMEA 테이블 →
        </Link>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-3xl font-bold text-slate-800">{stats.total}</div>
          <div className="text-sm text-slate-500 mt-1">전체 항목</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{fillRate}%</div>
          <div className="text-sm text-slate-500 mt-1">S/O/D 입력률</div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
            <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${fillRate}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-3xl font-bold text-red-500">{stats.high_rpn}</div>
          <div className="text-sm text-slate-500 mt-1">고위험(RPN≥100)</div>
        </div>
      </div>

      {/* SW Unit 관리 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-800 mb-4">SW Unit 목록</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={newUnit}
            onChange={e => setNewUnit(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSwUnit()}
            placeholder="SW Unit 이름 (예: CstAp_PwrMGT)"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <button onClick={addSwUnit} disabled={addingUnit} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-50">
            추가
          </button>
        </div>
        {units.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">SW Unit을 추가하세요.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {units.map(u => (
              <span key={u.id} className="bg-slate-100 text-slate-700 text-sm px-3 py-1 rounded-full font-mono">{u.name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
