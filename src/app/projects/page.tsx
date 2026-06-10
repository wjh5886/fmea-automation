'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { supabase, type Project } from '@/lib/supabase'

const FOLDERS = ['SBW', 'WPC', 'PLBM'] as const
type Folder = typeof FOLDERS[number]

function ProjectCard({
  project,
  onMove,
  onDelete,
  onRestore,
  onPermanentDelete,
  isDeleted,
}: {
  project: Project
  onMove?: (id: string, folder: string | null) => void
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
  onPermanentDelete?: (id: string) => void
  isDeleted?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover-shine hover:border-blue-400 hover:shadow-lg hover:shadow-blue-200/60 hover:-translate-y-0.5 flex items-center justify-between group">
      <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
        <div className="font-semibold text-slate-800">{project.name}</div>
        {project.vehicle_model && <div className="text-sm text-slate-500 mt-1">차종: {project.vehicle_model}</div>}
        {project.description && <div className="text-sm text-slate-400 mt-1 truncate">{project.description}</div>}
      </Link>
      <div className="flex items-center gap-3 ml-4 shrink-0">
        <span className="text-slate-400 text-sm">{new Date(project.created_at).toLocaleDateString('ko-KR')}</span>

        {isDeleted ? (
          <div className="flex gap-2">
            <button onClick={() => onRestore?.(project.id)}
              className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 border border-green-200">
              복원
            </button>
            <button onClick={() => { if (confirm(`"${project.name}" 을 영구 삭제하시겠습니까? 복구할 수 없습니다.`)) onPermanentDelete?.(project.id) }}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">
              영구 삭제
            </button>
          </div>
        ) : (
          <div className="relative" ref={menuRef}>
            <button onClick={e => { e.preventDefault(); setMenuOpen(v => !v) }}
              className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-opacity">
              ···
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-10 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-44">
                <div className="px-3 py-1.5 text-xs text-slate-400 font-medium">폴더 이동</div>
                {FOLDERS.map(f => (
                  <button key={f} onClick={() => { onMove?.(project.id, f); setMenuOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2
                      ${project.folder === f ? 'text-blue-600 font-medium' : 'text-slate-700'}`}>
                    <span>📁</span> {f}
                    {project.folder === f && <span className="ml-auto text-blue-400">✓</span>}
                  </button>
                ))}
                <button onClick={() => { onMove?.(project.id, null); setMenuOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2
                    ${!project.folder ? 'text-blue-600 font-medium' : 'text-slate-700'}`}>
                  <span>📄</span> 미분류
                  {!project.folder && <span className="ml-auto text-blue-400">✓</span>}
                </button>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button onClick={() => { onDelete?.(project.id); setMenuOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2">
                    <span>🗑️</span> 삭제
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FolderSection({
  title,
  icon,
  projects,
  onMove,
  onDelete,
  defaultOpen = true,
}: {
  title: string
  icon: string
  projects: Project[]
  onMove: (id: string, folder: string | null) => void
  onDelete: (id: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-4">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-blue-50 group mb-2">
        <span className="text-slate-400 text-xs">{open ? '▾' : '▸'}</span>
        <span className="text-base">{icon}</span>
        <span className="font-semibold text-slate-700 text-sm">{title}</span>
        <span className="text-xs text-slate-400 ml-1">({projects.length})</span>
      </button>
      {open && (
        <div className="grid gap-2 pl-2">
          {projects.length === 0 ? (
            <div className="text-sm text-slate-300 py-3 pl-4">프로젝트 없음</div>
          ) : (
            projects.map(p => (
              <ProjectCard key={p.id} project={p} onMove={onMove} onDelete={onDelete} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showTrash, setShowTrash] = useState(false)

  const load = () => {
    supabase.from('projects').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data ?? []); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const active = projects.filter(p => !p.deleted_at)
  const deleted = projects.filter(p => !!p.deleted_at)

  const byFolder = (folder: string | null) =>
    active.filter(p => p.folder === folder)

  async function handleMove(id: string, folder: string | null) {
    await supabase.from('projects').update({ folder }).eq('id', id)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, folder } : p))
  }

  async function handleDelete(id: string) {
    await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, deleted_at: new Date().toISOString() } : p))
  }

  async function handleRestore(id: string) {
    await supabase.from('projects').update({ deleted_at: null }).eq('id', id)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, deleted_at: null } : p))
  }

  async function handlePermanentDelete(id: string) {
    await supabase.from('fmea_items').delete().eq('project_id', id)
    await supabase.from('sw_units').delete().eq('project_id', id)
    await supabase.from('projects').delete().eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">FMEA 프로젝트</h1>
        <div className="flex gap-2">
          <Link href="/projects/compare" className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-amber-400 transition-colors">
            프로젝트 비교
          </Link>
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
      ) : (
        <>
          <FolderSection title="SBW" icon="📁" projects={byFolder('SBW')} onMove={handleMove} onDelete={handleDelete} />
          <FolderSection title="WPC" icon="📁" projects={byFolder('WPC')} onMove={handleMove} onDelete={handleDelete} />
          <FolderSection title="PLBM" icon="📁" projects={byFolder('PLBM')} onMove={handleMove} onDelete={handleDelete} />
          <FolderSection title="미분류" icon="📄" projects={byFolder(null)} onMove={handleMove} onDelete={handleDelete} defaultOpen={true} />

          {/* 삭제된 프로젝트 */}
          <div className="mt-6 border-t border-slate-100 pt-4">
            <button onClick={() => setShowTrash(v => !v)}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-blue-50 mb-2">
              <span className="text-slate-400 text-xs">{showTrash ? '▾' : '▸'}</span>
              <span className="text-base">🗑️</span>
              <span className="font-semibold text-slate-500 text-sm">삭제된 프로젝트</span>
              <span className="text-xs text-slate-400 ml-1">({deleted.length})</span>
            </button>
            {showTrash && (
              <div className="grid gap-2 pl-2">
                {deleted.length === 0 ? (
                  <div className="text-sm text-slate-300 py-3 pl-4">삭제된 프로젝트 없음</div>
                ) : (
                  deleted.map(p => (
                    <ProjectCard key={p.id} project={p}
                      onRestore={handleRestore}
                      onPermanentDelete={handlePermanentDelete}
                      isDeleted />
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
