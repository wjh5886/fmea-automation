const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const JSON_PATH = path.join(__dirname, 'result_claude.json')

const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'fmea_db', user: 'postgres', password: 'postgres',
})

const VALID_FM = new Set(['MORE','LESS','REVERSE','CORRUPT','NO','AS_WELL_AS','PART_OF','EARLY','LATE'])

function getActionPriority(s, o, d) {
  if (!s || !o || !d) return null
  const rpn = s * o * d
  if (s >= 9 && (o >= 6 || d >= 7)) return 'VH'
  if (s >= 7 && o >= 6 && d >= 7) return 'VH'
  if (s >= 9) return 'H'
  if (s >= 7 && (o >= 6 || d >= 6)) return 'H'
  if (rpn >= 200 || (s >= 5 && o >= 6)) return 'H'
  if (rpn >= 100) return 'M'
  return 'L'
}

async function main() {
  const items = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'))
  console.log(`읽은 항목 수: ${items.length}`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 기존 source='ai' 항목 삭제
    const del = await client.query(
      "DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'",
      [SESSION_ID]
    )
    console.log(`삭제된 기존 ai 항목: ${del.rowCount}`)

    let inserted = 0
    let skipped = 0
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const fm = String(it.failure_mode ?? '').trim().toUpperCase()
      if (!VALID_FM.has(fm)) {
        console.warn(`  SKIP [${i}] ${it.sw_component} - 유효하지 않은 failure_mode: ${it.failure_mode}`)
        skipped++
        continue
      }

      const itemNo = String(i + 1).padStart(3, '0')
      const s = it.severity ?? null
      const o = it.occurrence ?? null
      const d = it.detection ?? null
      const ap = getActionPriority(s, o, d)

      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          action_priority, preventive_action, detection_action, confidence_score, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ai','pending')`,
        [
          SESSION_ID, itemNo,
          it.sw_component ?? null,
          it.function_name ?? null,
          fm,
          it.failure_detail ?? null,
          it.effect_local ?? null,
          it.effect_system ?? null,
          it.potential_cause ?? null,
          s, o, d, ap,
          it.preventive_action ?? null,
          it.detection_action ?? null,
          it.confidence_score ?? 0.85,
        ]
      )
      inserted++
    }

    await client.query('COMMIT')
    console.log(`\n완료: ${inserted}개 삽입, ${skipped}개 스킵`)

    // 확인 쿼리
    const check = await client.query(
      "SELECT sw_component, failure_mode, action_priority FROM pre_fmea_items WHERE session_id=$1 AND source='ai' ORDER BY item_no",
      [SESSION_ID]
    )
    console.log(`\nDB 확인 (총 ${check.rows.length}개):`)
    const byComp = {}
    for (const r of check.rows) {
      if (!byComp[r.sw_component]) byComp[r.sw_component] = []
      byComp[r.sw_component].push(`${r.failure_mode}(${r.action_priority})`)
    }
    for (const [comp, modes] of Object.entries(byComp)) {
      console.log(`  ${comp}: ${modes.join(', ')}`)
    }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('오류:', e.message)
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
