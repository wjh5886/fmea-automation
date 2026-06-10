'use client'

import { useMemo, useState } from 'react'
import type { FmeaItem, SwUnit } from '@/lib/supabase'

type InterfaceRow = {
  component: string
  variableName: string
  category: string | null
  variableType: string | null
}

export default function ReferenceDataPanel({
  items,
}: {
  items: FmeaItem[]
}) {
  const [search, setSearch] = useState('')

  const interfaceRows = useMemo<InterfaceRow[]>(() => {
    const seen = new Set<string>()
    const rows: InterfaceRow[] = []
    for (const i of items) {
      const component = (i as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '미분류'
      const variableName = i.variable_name ?? ''
      const key = `${component}::${variableName}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        component,
        variableName,
        category: i.category,
        variableType: i.variable_type,
      })
    }
    return rows.sort((a, b) => a.component.localeCompare(b.component) || a.variableName.localeCompare(b.variableName))
  }, [items])

  const q = search.trim().toLowerCase()

  const filteredInterfaces = q
    ? interfaceRows.filter(r => r.component.toLowerCase().includes(q) || r.variableName.toLowerCase().includes(q))
    : interfaceRows

  const Th = ({ children }: { children: React.ReactNode }) => (
    <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">{children}</th>
  )
  const Td = ({ children, cls }: { children: React.ReactNode; cls?: string }) => (
    <td className={`px-3 py-2 text-slate-600 align-top ${cls ?? ''}`}>{children}</td>
  )

  return (
    <div>
      {/* 검색 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-slate-500">Interface ({interfaceRows.length})</span>
        <div className="flex-1" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="검색..."
          className="border border-slate-200 rounded px-2 py-1 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>

      {/* Interface */}
      <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
            <tr>
              <Th>컴포넌트</Th>
              <Th>Interface(변수)명</Th>
              <Th>구분</Th>
              <Th>타입</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInterfaces.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>
            ) : filteredInterfaces.map((r, idx) => (
              <tr key={idx} className="hover:bg-slate-50">
                <Td cls="font-mono">{r.component}</Td>
                <Td cls="font-mono text-slate-800">{r.variableName}</Td>
                <Td>
                  {r.category ? (
                    <span className={`px-1.5 py-0.5 rounded ${r.category === 'External' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                      {r.category}
                    </span>
                  ) : '-'}
                </Td>
                <Td>{r.variableType ?? '-'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
