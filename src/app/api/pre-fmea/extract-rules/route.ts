import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

interface RuleRow {
  content: string
  content_type: string
  quality_score: number
  metadata: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json()
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    // ── 1. merged 항목 SOD diff 분석 ─────────────────────────────────────────
    const mergedItems = await query(
      `SELECT failure_mode, sw_component, human_override
       FROM pre_fmea_items
       WHERE session_id = $1 AND source = 'merged' AND human_override IS NOT NULL`,
      [session_id],
    )

    // failure_mode별 SOD 차이 집계
    const sodByFm: Record<string, { diffs: { s: number; o: number; d: number }[]; components: Set<string> }> = {}

    for (const item of mergedItems) {
      const ho = item.human_override as Record<string, unknown>
      const aiS = Number(ho.ai_severity)   || 0
      const aiO = Number(ho.ai_occurrence) || 0
      const aiD = Number(ho.ai_detection)  || 0
      const huS = Number(ho.human_severity)   || 0
      const huO = Number(ho.human_occurrence) || 0
      const huD = Number(ho.human_detection)  || 0
      if (!aiS || !huS) continue

      const fm = String(item.failure_mode ?? 'UNKNOWN')
      if (!sodByFm[fm]) sodByFm[fm] = { diffs: [], components: new Set() }
      sodByFm[fm].diffs.push({ s: huS - aiS, o: huO - aiO, d: huD - aiD })
      if (item.sw_component) sodByFm[fm].components.add(String(item.sw_component))
    }

    // ── 2. 갭 분석에서 누락 패턴 추출 ────────────────────────────────────────
    const gaps = await query(
      `SELECT gap_type, failure_mode, sw_component, COUNT(*) AS cnt
       FROM pre_fmea_gaps
       WHERE session_id = $1
       GROUP BY gap_type, failure_mode, sw_component
       ORDER BY cnt DESC`,
      [session_id],
    )

    const missingByFm: Record<string, number> = {}
    const missingComponents: Record<string, number> = {}
    for (const g of gaps) {
      if (g.gap_type !== 'missing_item') continue
      const fm = String(g.failure_mode ?? '?')
      const comp = String(g.sw_component ?? '?')
      missingByFm[fm] = (missingByFm[fm] ?? 0) + Number(g.cnt)
      missingComponents[comp] = (missingComponents[comp] ?? 0) + Number(g.cnt)
    }

    const wrongSodCount = gaps.filter(g => g.gap_type === 'wrong_sod').reduce((s, g) => s + Number(g.cnt), 0)
    const totalGapItems  = gaps.reduce((s, g) => s + Number(g.cnt), 0)

    // ── 3. 규칙 생성 ──────────────────────────────────────────────────────────
    const rules: RuleRow[] = []

    // SOD 보정 규칙 — |avg diff| >= 1.2인 failure_mode
    for (const [fm, { diffs, components }] of Object.entries(sodByFm)) {
      if (diffs.length < 2) continue
      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
      const avgS = avg(diffs.map(d => d.s))
      const avgO = avg(diffs.map(d => d.o))
      const avgD = avg(diffs.map(d => d.d))

      const parts: string[] = []
      if (Math.abs(avgS) >= 1.2) parts.push(`Severity ${avgS > 0 ? '+' : ''}${avgS.toFixed(1)} 조정 권장`)
      if (Math.abs(avgO) >= 1.2) parts.push(`Occurrence ${avgO > 0 ? '+' : ''}${avgO.toFixed(1)} 조정 권장`)
      if (Math.abs(avgD) >= 1.2) parts.push(`Detection ${avgD > 0 ? '+' : ''}${avgD.toFixed(1)} 조정 권장`)
      if (!parts.length) continue

      const quality = Math.min(0.95, 0.5 + diffs.length * 0.05)
      rules.push({
        content: `[SOD 보정] ${fm} 고장모드: ${parts.join(', ')} (${diffs.length}건 학습, 관련 컴포넌트: ${[...components].slice(0, 3).join(', ')})`,
        content_type: 'sod_rule',
        quality_score: quality,
        metadata: { failure_mode: fm, avg_s_diff: avgS, avg_o_diff: avgO, avg_d_diff: avgD, sample_count: diffs.length, source_session: session_id },
      })
    }

    // 누락 고장모드 패턴 — 3건 이상 누락된 failure_mode
    for (const [fm, cnt] of Object.entries(missingByFm).sort((a, b) => b[1] - a[1])) {
      if (cnt < 3) continue
      const quality = Math.min(0.9, 0.4 + cnt * 0.03)
      rules.push({
        content: `[누락 패턴] ${fm} 고장모드를 ${cnt}건 누락 — 해당 고장모드 항목을 빠짐없이 생성할 것`,
        content_type: 'missing_pattern',
        quality_score: quality,
        metadata: { failure_mode: fm, missing_count: cnt, source_session: session_id },
      })
    }

    // 자주 누락된 컴포넌트 — 5건 이상
    for (const [comp, cnt] of Object.entries(missingComponents).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      if (cnt < 5) continue
      const quality = Math.min(0.85, 0.4 + cnt * 0.02)
      rules.push({
        content: `[누락 컴포넌트] '${comp}' 컴포넌트의 항목이 ${cnt}건 누락 — 해당 컴포넌트 고장 항목 집중 검토 필요`,
        content_type: 'missing_pattern',
        quality_score: quality,
        metadata: { sw_component: comp, missing_count: cnt, source_session: session_id },
      })
    }

    // 전체 품질 힌트
    if (totalGapItems > 0) {
      const missingRate = Math.round((Object.values(missingByFm).reduce((a, b) => a + b, 0) / totalGapItems) * 100)
      if (missingRate > 20) {
        rules.push({
          content: `[품질 힌트] 이 프로젝트에서 AI 누락률 ${missingRate}% — HAZOP 가이드워드 전체(9개)를 빠짐없이 적용할 것`,
          content_type: 'quality_hint',
          quality_score: 0.7,
          metadata: { missing_rate: missingRate, wrong_sod_count: wrongSodCount, source_session: session_id },
        })
      }
      if (wrongSodCount > 5) {
        rules.push({
          content: `[품질 힌트] SOD 수치 차이 ${wrongSodCount}건 발견 — 심각도(Severity) 판단 시 시스템 수준 영향도(SG 위반 여부) 우선 고려할 것`,
          content_type: 'quality_hint',
          quality_score: 0.65,
          metadata: { wrong_sod_count: wrongSodCount, source_session: session_id },
        })
      }
    }

    if (!rules.length) {
      return NextResponse.json({ message: '추출할 수 있는 규칙이 없습니다 (데이터 부족)', rulesAdded: 0 })
    }

    // ── 4. DB 저장 (중복 content 스킵) ───────────────────────────────────────
    const existing = await query<{ content: string }>(
      'SELECT content FROM pre_fmea_knowledge',
      [],
    )
    const existingSet = new Set(existing.map(r => r.content))

    let added = 0
    for (const rule of rules) {
      if (existingSet.has(rule.content)) continue
      await execute(
        `INSERT INTO pre_fmea_knowledge (content, content_type, quality_score, metadata, usage_count)
         VALUES ($1, $2, $3, $4, 0)`,
        [rule.content, rule.content_type, rule.quality_score, JSON.stringify(rule.metadata)],
      )
      added++
    }

    // 세션 status 업데이트
    await execute(
      "UPDATE pre_fmea_sessions SET updated_at = now() WHERE id = $1",
      [session_id],
    )

    return NextResponse.json({
      rulesAdded: added,
      rulesSkipped: rules.length - added,
      rules: rules.map(r => ({ content: r.content, content_type: r.content_type, quality_score: r.quality_score })),
    })
  } catch (e) {
    console.error('[extract-rules]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
