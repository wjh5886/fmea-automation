'use client'

import { useMemo, useState } from 'react'
import type { FmeaItem, SwUnit } from '@/lib/supabase'

type InterfaceRow = {
  key: string
  component: string
  variableName: string
  category: string | null
  variableType: string | null
  itemIds: string[]
}

const CATEGORY_OPTIONS = ['', 'External', 'Internal']

export default function ReferenceDataPanel({
  items,
  projectId,
  onUpdated,
}: {
  items: FmeaItem[]
  projectId: string
  onUpdated: () => void
}) {
  const [search, setSearch] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const interfaceRows = useMemo<InterfaceRow[]>(() => {
    const map = new Map<string, InterfaceRow>()
    for (const i of items) {
      const component = (i as FmeaItem & { sw_units?: SwUnit }).sw_units?.name ?? '미분류'
      const variableName = i.variable_name ?? ''
      const key = `${component}::${variableName}`
      const existing = map.get(key)
      if (existing) {
        existing.itemIds.push(i.id)
        continue
      }
      map.set(key, {
        key,
        component,
        variableName,
        category: i.category,
        variableType: i.variable_type,
        itemIds: [i.id],
      })
    }
    return Array.from(map.values()).sort((a, b) => a.component.localeCompare(b.component) || a.variableName.localeCompare(b.variableName))
  }, [items])

  const q = search.trim().toLowerCase()

  const filteredInterfaces = q
    ? interfaceRows.filter(r => r.component.toLowerCase().includes(q) || r.variableName.toLowerCase().includes(q))
    : interfaceRows

  const updateRow = async (row: InterfaceRow, patch: Partial<Pick<InterfaceRow, 'category' | 'variableType' | 'variableName'>>) => {
    setSavingKey(row.key)
    const body: Record<string, unknown> = {}
    if ('category' in patch) body.category = patch.category || null
    if ('variableType' in patch) body.variable_type = patch.variableType || null
    if ('variableName' in patch) body.variable_name = patch.variableName || null
    await Promise.all(row.itemIds.map(itemId =>
      fetch(`/api/projects/${projectId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, ...body }),
      })
    ))
    setSavingKey(null)
    onUpdated()
  }

  const Th = ({ children }: { children: React.ReactNode }) => (
    <th className="px-4 py-2 font-medium text-slate-600 text-left whitespace-nowrap">{children}</th>
  )
  const Td = ({ children, cls }: { children: React.ReactNode; cls?: string }) => (
    <td className={`px-4 py-3 text-slate-600 align-top ${cls ?? ''}`}>{children}</td>
  )

  return (
    <div>
      {/* Interface */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-800">Interface ({interfaceRows.length})</h2>
            <p className="text-xs text-slate-400 mt-0.5">수정한 값은 같은 SW Unit·변수명을 가진 모든 FMEA 항목(현재 프로젝트 내)에 함께 반영됩니다.</p>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="검색..."
            className="border border-slate-200 rounded px-2 py-1 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        {filteredInterfaces.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-8">{interfaceRows.length === 0 ? '데이터가 없습니다.' : '검색 결과가 없습니다.'}</p>
        ) : (
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 20rem)' }}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  <Th>SW Unit</Th>
                  <Th>Interface(변수)명</Th>
                  <Th>구분</Th>
                  <Th>타입</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInterfaces.map(r => (
                  <tr key={r.key} className="hover:bg-slate-50">
                    <Td cls="font-mono font-semibold text-slate-700 whitespace-nowrap">{r.component}</Td>
                    <Td>
                      <input
                        type="text"
                        defaultValue={r.variableName}
                        onBlur={e => {
                          if (e.target.value !== r.variableName) updateRow(r, { variableName: e.target.value })
                        }}
                        disabled={savingKey === r.key}
                        className="border border-slate-200 rounded px-1.5 py-1 text-sm font-mono text-slate-800 w-40 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                      />
                    </Td>
                    <Td>
                      <select
                        value={r.category ?? ''}
                        onChange={e => updateRow(r, { category: e.target.value })}
                        disabled={savingKey === r.key}
                        className="border border-slate-200 rounded px-1.5 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                      >
                        {CATEGORY_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt || '-'}</option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <input
                        type="text"
                        defaultValue={r.variableType ?? ''}
                        onBlur={e => {
                          if (e.target.value !== (r.variableType ?? '')) updateRow(r, { variableType: e.target.value })
                        }}
                        disabled={savingKey === r.key}
                        placeholder="-"
                        className="border border-slate-200 rounded px-1.5 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
