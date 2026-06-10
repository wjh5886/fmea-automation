'use client'

import { useMemo, useState } from 'react'
import type { FmeaItem, SafetyGoal, SafetyMechanism, SwUnit } from '@/lib/supabase'

type SubTab = 'component' | 'interface' | 'sg' | 'sm'

const SUB_TABS: [SubTab, string][] = [
  ['component', '컴포넌트'],
  ['interface', '인터페이스'],
  ['sg', 'Safety Goal'],
  ['sm', 'Safety Mechanism'],
]

type ComponentRow = {
  id: string
  name: string
  total: number
  external: number
  internal: number
}

type InterfaceRow = {
  component: string
  variableName: string
  category: string | null
  variableType: string | null
}

export default function ReferenceDataPanel({
  units,
  items,
  sgs,
  sms,
}: {
  units: SwUnit[]
  items: FmeaItem[]
  sgs: SafetyGoal[]
  sms: SafetyMechanism[]
}) {
  const [tab, setTab] = useState<SubTab>('component')
  const [search, setSearch] = useState('')

  const componentRows = useMemo<ComponentRow[]>(() => {
    return units
      .map(u => {
        const rows = items.filter(i => i.sw_unit_id === u.id)
        return {
          id: u.id,
          name: u.name,
          total: rows.length,
          external: rows.filter(r => r.category === 'External').length,
          internal: rows.filter(r => r.category === 'Internal').length,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [units, items])

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

  const counts: Record<SubTab, number> = {
    component: componentRows.length,
    interface: interfaceRows.length,
    sg: sgs.length,
    sm: sms.length,
  }

  const q = search.trim().toLowerCase()

  const filteredComponents = q
    ? componentRows.filter(r => r.name.toLowerCase().includes(q))
    : componentRows

  const filteredInterfaces = q
    ? interfaceRows.filter(r => r.component.toLowerCase().includes(q) || r.variableName.toLowerCase().includes(q))
    : interfaceRows

  const filteredSgs = q
    ? sgs.filter(s => s.sg_id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    : sgs

  const filteredSms = q
    ? sms.filter(s => s.sm_id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    : sms

  const Th = ({ children }: { children: React.ReactNode }) => (
    <th className="px-3 py-2 font-medium text-slate-600 text-left whitespace-nowrap">{children}</th>
  )
  const Td = ({ children, cls }: { children: React.ReactNode; cls?: string }) => (
    <td className={`px-3 py-2 text-slate-600 align-top ${cls ?? ''}`}>{children}</td>
  )

  return (
    <div>
      {/* 서브탭 + 검색 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-lg border border-indigo-100 overflow-hidden text-sm bg-white shadow-sm">
          {SUB_TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 transition-colors ${tab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-indigo-50'}`}
            >
              {label} <span className="opacity-70">({counts[key]})</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="검색..."
          className="border border-slate-200 rounded px-2 py-1 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>

      {/* 컴포넌트 */}
      {tab === 'component' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>컴포넌트명</Th>
                <Th>전체 인터페이스 수</Th>
                <Th>External</Th>
                <Th>Internal</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredComponents.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>
              ) : filteredComponents.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td cls="font-mono text-slate-800 font-medium">{r.name}</Td>
                  <Td>{r.total}</Td>
                  <Td><span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{r.external}</span></Td>
                  <Td><span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{r.internal}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 인터페이스 */}
      {tab === 'interface' && (
        <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <Th>컴포넌트</Th>
                <Th>인터페이스(변수)명</Th>
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
      )}

      {/* Safety Goal */}
      {tab === 'sg' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>SG ID</Th>
                <Th>설명</Th>
                <Th>ASIL</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSgs.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>
              ) : filteredSgs.map(sg => (
                <tr key={sg.id} className="hover:bg-slate-50">
                  <Td cls="font-mono font-medium text-slate-800">{sg.sg_id}</Td>
                  <Td>{sg.name}{sg.description ? <span className="text-slate-400"> — {sg.description}</span> : null}</Td>
                  <Td>
                    {sg.asil ? (
                      <span className={`px-1.5 py-0.5 rounded font-mono ${sg.asil === 'B' ? 'bg-red-50 text-red-700' : sg.asil === 'A' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        ASIL {sg.asil}
                      </span>
                    ) : '-'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Safety Mechanism */}
      {tab === 'sm' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>SM ID</Th>
                <Th>명칭</Th>
                <Th>유형</Th>
                <Th>진단 커버리지</Th>
                <Th>관련 SG</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSms.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>
              ) : filteredSms.map(sm => (
                <tr key={sm.id} className="hover:bg-slate-50">
                  <Td cls="font-mono font-medium text-slate-800">{sm.sm_id}</Td>
                  <Td>{sm.name}</Td>
                  <Td>{sm.type ?? '-'}</Td>
                  <Td>
                    {sm.diagnostic_coverage ? (
                      <span className={`px-1.5 py-0.5 rounded ${sm.diagnostic_coverage === 'High' ? 'bg-emerald-50 text-emerald-700' : sm.diagnostic_coverage === 'Medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {sm.diagnostic_coverage}
                      </span>
                    ) : '-'}
                  </Td>
                  <Td cls="font-mono">{sm.related_sg_id ?? '-'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
