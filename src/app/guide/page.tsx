'use client'

import { useState } from 'react'
import Image from 'next/image'

type Entry = { score: number; level: string; en: string; ko: string }

const SEVERITY: Entry[] = [
  { score: 10, level: 'Very High', en: 'Potential failure mode affects safe vehicle operation without warning', ko: '경고 없이 안전 운행에 영향을 주거나 정부 규정 미준수' },
  { score: 9,  level: '',          en: 'Potential failure mode affects safe vehicle operation with warning', ko: '경고와 함께 안전 운행에 영향을 주거나 정부 규정 미준수' },
  { score: 8,  level: 'High',      en: 'Total Loss of primary function (vehicle inoperable, does not affect safe vehicle operation)', ko: '주요 기능 완전 상실 (운행 불가, 안전 운행에는 영향 없음)' },
  { score: 7,  level: '',          en: 'Degradation of primary function (vehicle operable, but at reduced level of performance)', ko: '주요 기능 저하 (운행 가능하나 성능이 저하됨)' },
  { score: 6,  level: 'Moderate',  en: 'Loss of secondary function (vehicle operable, but comfort/convenience functions inoperable)', ko: '2차 기능 상실 (운행 가능, 편의 기능 작동 불가)\n- Default Position 가능 시 S=6 / 불가 시 S=9 (정부 규정 위반)' },
  { score: 5,  level: '',          en: 'Degradation of secondary function (vehicle operable, but comfort/convenience functions at reduced level)', ko: '2차 기능 저하 (운행 가능, 편의 기능 성능 저하)' },
  { score: 4,  level: '',          en: 'Appearance or Audible Noise, vehicle operable, item does not conform. Defect noticed by >75% of customers', ko: '외관/소음 이상, 운행 가능, 75% 이상 고객이 결함 인지' },
  { score: 3,  level: 'Low',       en: 'Appearance or Audible Noise, vehicle operable, item does not conform. Defect noticed by ~50% of customers', ko: '외관/소음 이상, 운행 가능, 약 50%의 고객이 결함 인지' },
  { score: 2,  level: '',          en: 'Appearance or Audible Noise, vehicle operable, item does not conform. Defect noticed by <25% of customers', ko: '외관/소음 이상, 운행 가능, 25% 미만 고객이 결함 인지' },
  { score: 1,  level: 'Very Low',  en: 'No Effect', ko: '영향 없음' },
]

const OCCURRENCE: Entry[] = [
  { score: 10, level: '', en: 'New technology or new design with no history', ko: '신기술/신규 설계로 이력 없음 (새로운 component 사용)' },
  { score: 9,  level: '', en: 'New technology or new/changed requirements — Failure is inevitable', ko: '신기술/변경 요구사항 — 고장 발생 불가피' },
  { score: 8,  level: '', en: 'New technology or new/changed requirements — Failure is likely', ko: '신기술/변경 요구사항 — 고장 발생 가능성 높음' },
  { score: 7,  level: '', en: 'New technology or new/changed requirements — Failure is uncertain', ko: '신기술/변경 요구사항 — 고장 발생 여부 불확실' },
  { score: 6,  level: '', en: 'Similar technology & requirements but frequent failures during simulation and testing', ko: '유사 기술/요구사항, 시험 중 빈번한 고장' },
  { score: 5,  level: '', en: 'Similar technology & requirements but occasional failures during simulation and testing', ko: '유사 기술/요구사항, 시험 중 간헐적 고장' },
  { score: 4,  level: '', en: 'Similar technology & requirements but isolated failures during simulation and testing', ko: '유사 기술/요구사항, 시험 중 개별적 고장' },
  { score: 3,  level: '', en: 'Almost identical technology & requirements — isolated failures during simulation and testing', ko: '거의 동일 기술/요구사항, 시험 중 개별적 고장' },
  { score: 2,  level: '', en: 'Almost identical technology & requirements — no failures during simulation and testing', ko: '거의 동일 기술/요구사항, 시험 중 고장 발생 이력 없음' },
  { score: 1,  level: '', en: 'Failure is eliminated through preventative control', ko: '예방 조치로 인해 고장 원인이 제거됨' },
]

const DETECTION: Entry[] = [
  { score: 10, level: 'Very Low',  en: 'No current design control; Cannot detect or is not analyzed', ko: '설계 Control이 적용되어 있지 않아 검출 불가 또는 분석 없음' },
  { score: 9,  level: '',          en: 'Design analysis/detection controls have a weak detection capability (Virtual Analysis not correlated to actual conditions)', ko: '설계 분석/Control의 검출 능력이 미약함. CAE/FEA 등 분석이 실제 운전 조건과 연관되지 않음' },
  { score: 8,  level: 'Low',       en: 'Test during Product Verification/Validation\n→ HW 시작품 시험 with 신뢰성 test, SW Function Test\n→ System Integration Test with 신뢰성 test', ko: '제품 검증/유효화 단계에서 시험 (낮은 검출 커버리지)' },
  { score: 7,  level: '',          en: 'Test during Product Verification/Validation (until failure occurs, system interaction testing)\n→ HW 부품 시험 with 신뢰성 test, SW Integration Test\n→ System Integration Test', ko: '제품 검증/유효화 단계에서 시험 (낮은 검출 커버리지)' },
  { score: 6,  level: 'Medium',    en: 'Test during Product Verification/Validation (Function check after durability test)\n→ HW 부품 TEST, SW Unit TEST\n→ System Integration Test', ko: '일부 결함을 검출 가능 (중간 커버리지)' },
  { score: 5,  level: '',          en: 'Test during Design Verification/Validation (acceptance criteria for performance, function checks)\n→ HW 시작품 시험 with 신뢰성 test, SW Function Test\nSM DC=Low + 추가 Self-test DC=Low → Medium', ko: '일부 결함을 검출 가능 (중간 커버리지)' },
  { score: 4,  level: '',          en: 'Test during Design Verification/Validation (until leaks, yields, cracks)\n→ HW 부품 시험 with 신뢰성 test, SW Integration Test\nSM DC=Medium + 추가 S.M DC=Low → Medium', ko: '일부 결함을 검출 가능 (중간 커버리지)' },
  { score: 3,  level: 'High',      en: 'Test during Design Verification/Validation (data trends, before/after values)\n→ HW 부품 TEST, SW Unit TEST\nSM DC=Medium + 추가 Self-test DC=Medium → High', ko: '대부분의 결함에 대해 검출 가능 (높은 커버리지)' },
  { score: 2,  level: '',          en: 'Design analysis/detection controls have a strong detection capability (Virtual Analysis highly correlated with actual conditions)\n→ Simulation\nSM DC=High + 추가 S.M DC=High → High', ko: '대부분의 결함에 대해 검출 가능 (높은 커버리지)' },
  { score: 1,  level: 'Very High', en: 'Failure cause/mode cannot occur — fully prevented through design solutions\nSM DC=High + Self-test DC=High → Very High', ko: '모든 결함에 대해 완전히 검출 가능 (Full 커버리지)' },
]

const SCORE_COLORS: Record<number, string> = {
  10: 'bg-red-600 text-white',
  9:  'bg-red-500 text-white',
  8:  'bg-orange-500 text-white',
  7:  'bg-orange-400 text-white',
  6:  'bg-yellow-500 text-white',
  5:  'bg-yellow-400 text-slate-800',
  4:  'bg-lime-400 text-slate-800',
  3:  'bg-green-400 text-slate-800',
  2:  'bg-green-500 text-white',
  1:  'bg-green-600 text-white',
}

function RatingTable({ data, showLevel }: { data: Entry[]; showLevel: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-100 border-b-2 border-slate-300">
            <th className="px-4 py-2 text-center w-16 font-semibold text-slate-700">점수</th>
            {showLevel && <th className="px-4 py-2 text-center w-24 font-semibold text-slate-700">레벨</th>}
            <th className="px-4 py-2 text-left font-semibold text-slate-700">평가 기준 (English)</th>
            <th className="px-4 py-2 text-left font-semibold text-slate-700">설명 (한국어)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.score} className="border-b border-slate-200 hover:bg-slate-50">
              <td className="px-4 py-3 text-center">
                <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-bold text-base ${SCORE_COLORS[entry.score]}`}>
                  {entry.score}
                </span>
              </td>
              {showLevel && (
                <td className="px-4 py-3 text-center text-sm font-medium text-slate-600">
                  {entry.level || ''}
                </td>
              )}
              <td className="px-4 py-3 text-slate-700 align-top" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                {entry.en}
              </td>
              <td className="px-4 py-3 text-slate-500 align-top text-xs" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                {entry.ko}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type HazopEntry = { category: string; word: string; label: string; description: string; note: string }

const HAZOP: HazopEntry[] = [
  { category: '값의 이상', word: 'MORE',       label: '증가',     description: '정상 범위내에서 정상값보다 크다.',              note: '' },
  { category: '값의 이상', word: 'LESS',       label: '감소',     description: '정상 범위내에서 정상값보다 작다.',              note: '' },
  { category: '값의 이상', word: 'REVERSE',    label: '역',       description: '진리가 반전, 부호가 반전, 비트 반전',           note: '' },
  { category: '값의 이상', word: 'CORRUPT',    label: '이외/파괴', description: '정상 범위외의 정의되어 있지 않은 값',           note: 'OTHER THAN을 포함' },
  { category: '타이밍의 이상', word: 'NO',         label: '없음',     description: '값이 갱신되지 않음, 값이 출력되지 않음',       note: '' },
  { category: '타이밍의 이상', word: 'AS WELL AS', label: '과다/여분', description: '횟수(갯수)가 많음',                          note: '' },
  { category: '타이밍의 이상', word: 'PART OF',    label: '부족/빠짐', description: '횟수(갯수)가 적음',                          note: '' },
  { category: '타이밍의 이상', word: 'EARLY',      label: '빠름',     description: '타이밍이 빠름',                               note: '' },
  { category: '타이밍의 이상', word: 'LATE',       label: '느림',     description: '타이밍이 느림',                               note: '' },
]

function HazopTable() {
  let lastCategory = ''
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-100 border-b-2 border-slate-300">
            <th className="px-4 py-2 text-center w-32 font-semibold text-slate-700">이상의 분류</th>
            <th className="px-4 py-2 text-center w-36 font-semibold text-slate-700">가이드 워드</th>
            <th className="px-4 py-2 text-left font-semibold text-slate-700">설명</th>
            <th className="px-4 py-2 text-left w-44 font-semibold text-slate-700">비고</th>
          </tr>
        </thead>
        <tbody>
          {HAZOP.map((entry, i) => {
            const showCategory = entry.category !== lastCategory
            lastCategory = entry.category
            const categoryRowspan = HAZOP.filter(e => e.category === entry.category).length
            return (
              <tr key={i} className="border-b border-slate-200 hover:bg-slate-50">
                {showCategory && (
                  <td
                    rowSpan={categoryRowspan}
                    className="px-4 py-3 text-center font-semibold text-slate-700 bg-slate-50 border-r border-slate-200 align-middle"
                  >
                    {entry.category}
                  </td>
                )}
                <td className="px-4 py-3 text-center">
                  <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono font-semibold text-xs">
                    {entry.word}
                  </span>
                  <div className="text-xs text-slate-500 mt-0.5">{entry.label}</div>
                </td>
                <td className="px-4 py-3 text-slate-700">{entry.description}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{entry.note}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const SOD_TABS = [
  { key: 'severity',   label: 'S — Severity',   subtitle: '심각도 (System Level)',    data: SEVERITY,   showLevel: true },
  { key: 'occurrence', label: 'O — Occurrence',  subtitle: '발생도 (Software Level)',  data: OCCURRENCE, showLevel: false },
  { key: 'detection',  label: 'D — Detection',   subtitle: '검출도 (Software Level)',  data: DETECTION,  showLevel: true },
]

export default function GuidePage() {
  const [tab, setTab] = useState('severity')
  const sodTab = SOD_TABS.find(t => t.key === tab)

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">S/O/D 평가 기준표 &amp; HAZOP 가이드</h1>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {SOD_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t transition-colors
              ${tab === t.key
                ? 'bg-white border border-b-white border-slate-200 text-blue-600 -mb-px'
                : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setTab('hazop')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t transition-colors
            ${tab === 'hazop'
              ? 'bg-white border border-b-white border-slate-200 text-blue-600 -mb-px'
              : 'text-slate-500 hover:text-slate-700'}`}
        >
          SW HAZOP 가이드
        </button>
      </div>

      {tab === 'hazop' ? (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-700 mb-1">SW HAZOP 가이드 워드</h2>
            <p className="text-xs text-slate-400">System-HW/SW FMEA Sheet 전개 설명 자료</p>
          </div>

          {/* HAZOP 다이어그램 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">값의 이상 — 데이터 타입별 가이드 워드 범위</p>
            <div className="flex justify-center">
              <Image
                src="/guide/hazop_diagram.png"
                alt="SW HAZOP 가이드 워드 다이어그램 — Bool/카운터/부호값/부호없는 값 범위"
                width={660}
                height={340}
                className="rounded border border-slate-100"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
          </div>

          {/* HAZOP 테이블 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <HazopTable />
          </div>
        </>
      ) : tab === 'detection' ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-700">검출도 (Software Level)</h2>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
              점수가 높을수록 위험 / 1=최소위험, 10=최대위험
            </span>
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[10,9,8,7,6,5,4,3,2,1].map(s => (
              <span key={s} className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${SCORE_COLORS[s]}`}>
                {s}
              </span>
            ))}
            <span className="text-xs text-slate-400 self-center ml-2">← 고위험 &nbsp; 저위험 →</span>
          </div>

          {/* Detection 기준 테이블 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <RatingTable data={DETECTION} showLevel={true} />
          </div>

          {/* System Detection 참고 이미지 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">System Detection — DV / PV 단계별 점수 기준</p>
            <div className="flex justify-center">
              <Image
                src="/guide/detection_system.png"
                alt="System Detection DV PV 점수 기준표"
                width={800}
                height={480}
                className="rounded border border-slate-100"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
          </div>

          {/* Safety Mechanism Reco 매트릭스 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Safety Mechanism — Reco/기준 매트릭스</p>
            <div className="flex flex-wrap gap-6 justify-center">
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-slate-400">SM only</p>
                <Image
                  src="/guide/detection_sm1.png"
                  alt="Safety Mechanism SM only Reco 기준 매트릭스"
                  width={320}
                  height={160}
                  className="rounded border border-slate-100"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-slate-400">SM + 추가 SM 조합</p>
                <Image
                  src="/guide/detection_sm2.png"
                  alt="Safety Mechanism SM 조합 Reco 기준 매트릭스"
                  width={320}
                  height={160}
                  className="rounded border border-slate-100"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* 설명 */}
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-700">{sodTab!.subtitle}</h2>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
              점수가 높을수록 위험 / 1=최소위험, 10=최대위험
            </span>
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[10,9,8,7,6,5,4,3,2,1].map(s => (
              <span key={s} className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${SCORE_COLORS[s]}`}>
                {s}
              </span>
            ))}
            <span className="text-xs text-slate-400 self-center ml-2">← 고위험 &nbsp; 저위험 →</span>
          </div>

          {/* 테이블 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <RatingTable data={sodTab!.data} showLevel={sodTab!.showLevel} />
          </div>
        </>
      )}
    </div>
  )
}
