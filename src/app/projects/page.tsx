'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type Project } from '@/lib/supabase'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('projects').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data ?? []); setLoading(false) })
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">FMEA 프로젝트</h1>
        <div className="flex gap-2">
          <Link href="/projects/import" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-500 transition-colors">
            ARXML 가져오기
          </Link>
          <Link href="/projects/new" className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition-colors">
            + 새 프로젝트
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-4">프로젝트가 없습니다.</p>
          <Link href="/projects/new" className="text-blue-600 hover:underline">첫 번째 프로젝트 만들기 →</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map(p => (
            <Link key={p.id} href={`/projects/${p.id}`} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-800">{p.name}</div>
                {p.vehicle_model && <div className="text-sm text-slate-500 mt-1">차종: {p.vehicle_model}</div>}
                {p.description && <div className="text-sm text-slate-400 mt-1">{p.description}</div>}
              </div>
              <div className="text-slate-400 text-sm">{new Date(p.created_at).toLocaleDateString('ko-KR')} →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
