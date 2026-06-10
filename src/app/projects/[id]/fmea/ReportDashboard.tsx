'use client'

import type { FmeaItem, SafetyGoal } from '@/lib/supabase'
import { buildReportSummary } from '@/lib/report'

const ASIL_COLORS: Record<string, string> = {
  D: 'bg-red-100 text-red-700', C: 'bg-orange-100 text-orange-700',
  B: 'bg-yellow-100 text-yellow-700', A: 'bg-blue-100 text-blue-700', QM: 'bg-slate-100 text-slate-600',
}

function sColorClass(s: number) {
  if (s >= 9) return 'text-red-600'
  if (s >= 8) return 'text-orange-500'
  if (s >= 7) return 'text-yellow-600'
  return 'text-slate-700'
}

function RpnBadge({ rpn }: { rpn: number }) {
  if (!rpn) return <span className="text-slate-300">-</span>
  const color = rpn >= 200 ? 'bg-red-100 text-red-700' : rpn >= 100 ? 'bg-orange-100 text-orange-700' : rpn >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>{rpn}</span>
}

function SgBadge({ sg }: { sg: string | null }) {
  if (!sg || sg === 'X' || sg === '-') return <span className="text-slate-300">-</span>
  return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-red-50 text-red-700 border border-red-200">{sg}</span>
}

const S_BAR_COLORS: Record<number, string> = {
  10: 'bg-red-800', 9: 'bg-red-600', 8: 'bg-orange-500', 7: 'bg-yellow-500',
}

const INSIGHT_STYLE: Record<string, { wrap: string; icon: string }> = {
  danger: { wrap: 'bg-red-50 border border-red-200 text-red-800', icon: '🚨' },
  warn: { wrap: 'bg-amber-50 border border-amber-200 text-amber-800', icon: '⚠️' },
  info: { wrap: 'bg-blue-50 border border-blue-200 text-blue-800', icon: '💡' },
}

export default function ReportDashboard({ items, sgs }: { items: FmeaItem[]; sgs: SafetyGoal[] }) {
  const d = buildReportSummary(items, sgs)

  if (!d.total) {
    return <div className="text-center py-16 text-slate-400">FMEA 항목이 없습니다.</div>
  }

  const pct = (n: number) => (d.total ? ` (${Math.round((n / d.total) * 1000) / 10}%)` : '')
  const cards = [
    { label: '전체 항목', value: String(d.total), color: 'border-blue-500 text-blue-600 bg-blue-50' },
    { label: 'SG 위반', value: `${d.sgViolations}${pct(d.sgViolations)}`, color: 'border-red-500 text-red-600 bg-red-50' },
    { label: '고위험 (S≥8)', value: `${d.highS}${pct(d.highS)}`, color: 'border-amber-500 text-amber-600 bg-amber-50' },
    { label: '최대 RPN', value: String(d.maxRpn), color: 'border-cyan-500 text-cyan-600 bg-cyan-50' },
  ]

  const maxCnt = Math.max(...Object.values(d.sDistribution), 1)

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {cards.map(c => (
          <div key={c.label} className={`rounded-xl p-4 border-l-4 ${c.color}`}>
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className="text-2xl font-extrabold">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Severity 분포 */}
      <div>
        <h4 className="text-sm font-bold text-slate-700 mb-2">Severity 분포</h4>
        <div className="flex items-end gap-1 h-20">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(s => {
            const cnt = d.sDistribution[s] ?? 0
            const h = Math.max((cnt / maxCnt) * 72, cnt > 0 ? 4 : 0)
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-0.5 justify-end">
                <span className="text-[.65rem] text-slate-500">{cnt || ''}</span>
                <div className={`w-full rounded-t ${S_BAR_COLORS[s] ?? 'bg-blue-400'} opacity-85`} style={{ height: `${h}px` }} />
              </div>
            )
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(s => (
            <div key={s} className="flex-1 text-center text-[.7rem] text-slate-400">S{s}</div>
          ))}
        </div>
      </div>

      {/* 컴포넌트별 리스크 */}
      <div>
        <h4 className="text-sm font-bold text-slate-700 mb-2">컴포넌트별 리스크</h4>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">컴포넌트</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">항목 수</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">최대 S</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">평균 RPN</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">최대 RPN</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">SG 위반</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.components.map(c => (
                <tr key={c.name} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-700">{c.name}</td>
                  <td className="px-3 py-2 text-center">{c.count}</td>
                  <td className={`px-3 py-2 text-center font-bold ${sColorClass(c.maxS)}`}>{c.maxS}</td>
                  <td className="px-3 py-2 text-center">{c.avgRpn}</td>
                  <td className="px-3 py-2 text-center font-bold">{c.maxRpn}</td>
                  <td className="px-3 py-2 text-center">
                    {c.sgCount > 0
                      ? <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-bold">{c.sgCount}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 고위험 Top 15 */}
      <div>
        <h4 className="text-sm font-bold text-slate-700 mb-2">고위험 항목 Top 15 (RPN 기준)</h4>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">컴포넌트</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">변수명</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Failure Mode</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">SG</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">S</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">O</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">D</th>
                <th className="px-3 py-2 text-center font-medium text-slate-600">RPN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.topRisks.map((r, i) => (
                <tr key={i} className={r.s >= 9 ? 'bg-rose-50' : r.s >= 8 ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.component}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700">{r.variableName}</td>
                  <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600">{r.failureMode ?? '-'}</span></td>
                  <td className="px-3 py-2"><SgBadge sg={r.effectSg} /></td>
                  <td className={`px-3 py-2 text-center font-bold ${sColorClass(r.s)}`}>{r.s || ''}</td>
                  <td className="px-3 py-2 text-center">{r.o || ''}</td>
                  <td className="px-3 py-2 text-center">{r.d || ''}</td>
                  <td className="px-3 py-2 text-center"><RpnBadge rpn={r.rpn} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SG 위반 현황 */}
      <div>
        <h4 className="text-sm font-bold text-slate-700 mb-2">Safety Goal 위반 현황</h4>
        {d.sgBreakdown.length ? (
          <div className="flex flex-wrap gap-2">
            {d.sgBreakdown.map(sg => (
              <div key={sg.sgId} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 min-w-[150px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-extrabold text-red-600">{sg.sgId}</span>
                  {sg.asil && <span className={`px-1.5 py-0.5 rounded text-[.65rem] font-bold ${ASIL_COLORS[sg.asil] ?? ASIL_COLORS.QM}`}>{sg.asil}</span>}
                </div>
                {sg.desc && <div className="text-xs text-slate-500 mt-0.5">{sg.desc}</div>}
                <div className="text-xs text-slate-600 mt-1">위반 {sg.count}개 · 최대 S{sg.maxS}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Safety Goal 위반 항목 없음</p>
        )}
      </div>

      {/* 설계자 인사이트 */}
      {d.insights.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-slate-700 mb-2">💡 설계자 인사이트</h4>
          <div className="flex flex-col gap-2">
            {d.insights.map((ins, i) => {
              const style = INSIGHT_STYLE[ins.type] ?? INSIGHT_STYLE.info
              return (
                <div key={i} className={`rounded-lg px-3 py-2 text-sm ${style.wrap}`}>
                  {style.icon} {ins.text}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* FM 분포 + 코드 구현 가이드 */}
      {d.fmDistribution.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-slate-700 mb-2">고장 유형별 분포 &amp; 코드 구현 가이드</h4>
          <div className="flex flex-col gap-2">
            {d.fmDistribution.map(fm => (
              <details key={fm.key} open className="border border-slate-200 rounded-lg overflow-hidden">
                <summary className="px-3 py-2 cursor-pointer flex items-center justify-between bg-slate-50 select-none">
                  <span>
                    <strong className="text-sm">{fm.label}</strong>
                    <span className="ml-2.5 text-xs text-slate-500">{fm.count}건 · SG위반 {fm.sgCount}건 · 최대 S{fm.maxS} · {fm.pct}%</span>
                  </span>
                  <span className="text-xs text-slate-400">구현 가이드</span>
                </summary>
                <div className="px-4 py-3 bg-white">
                  <div className="text-xs text-slate-600 mb-1.5"><strong>권장 SM:</strong> {fm.sm}</div>
                  <ul className="text-xs text-slate-600 list-disc pl-4 space-y-0.5">
                    {fm.impl.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                  {fm.topVars.length > 0 && (
                    <div className="text-xs text-slate-500 mt-2">
                      <strong>우선 적용 대상 (S≥8):</strong>{' '}
                      {fm.topVars.map((v, i) => (
                        <span key={i} className="bg-slate-100 rounded px-1.5 py-0.5 mr-1">
                          {v.variableName} [{v.component}] S{v.s}/RPN{v.rpn}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* SM 구현 체크리스트 */}
      {d.smChecklist.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-slate-700 mb-1">🔲 Safety Mechanism 구현 체크리스트 (S≥8)</h4>
          <p className="text-xs text-slate-400 mb-2">아래 항목에 대해 코드 구현 후 점검하세요.</p>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">컴포넌트</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">변수명</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Failure Mode</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">SG</th>
                  <th className="px-3 py-2 text-center font-medium text-slate-600">S</th>
                  <th className="px-3 py-2 text-center font-medium text-slate-600">RPN</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">권장 SM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.smChecklist.map((r, i) => (
                  <tr key={i} className={r.s >= 9 ? 'bg-rose-50' : 'bg-amber-50'}>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.component}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{r.variableName}</td>
                    <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600">{r.failureMode ?? '-'}</span></td>
                    <td className="px-3 py-2"><SgBadge sg={r.effectSg} /></td>
                    <td className={`px-3 py-2 text-center font-bold ${sColorClass(r.s)}`}>{r.s}</td>
                    <td className="px-3 py-2 text-center"><RpnBadge rpn={r.rpn} /></td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.sm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
