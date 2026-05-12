'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function NewProjectPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', vehicle_model: '', description: '' })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { data } = await supabase.from('projects').insert([form]).select().single()
    if (data) router.push(`/projects/${data.id}`)
    else setSaving(false)
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">새 프로젝트</h1>

      <Link href="/projects/import" className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 hover:bg-blue-100 transition-colors group">
        <div>
          <div className="font-semibold text-blue-800 text-sm">ARXML로 자동 가져오기</div>
          <div className="text-xs text-blue-600 mt-0.5">ARXML + DBC 업로드 → S/O/D 자동 생성</div>
        </div>
        <span className="text-blue-400 group-hover:text-blue-600 text-lg">→</span>
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400">또는 수동으로 생성</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">프로젝트명 *</label>
          <input
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="예: JG1_SBW_SW_FMEA"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">차종</label>
          <input
            value={form.vehicle_model}
            onChange={e => setForm(f => ({ ...f, vehicle_model: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="예: JG1, NQ6e"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">설명</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()} className="flex-1 border border-slate-300 rounded-lg py-2 text-sm hover:bg-slate-50">취소</button>
          <button type="submit" disabled={saving} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm hover:bg-slate-700 disabled:opacity-50">
            {saving ? '생성 중...' : '프로젝트 생성'}
          </button>
        </div>
      </form>
    </div>
  )
}
