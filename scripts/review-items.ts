import pg from 'pg'
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/fmea_db' })

async function main() {
  const res = await pool.query(`
    SELECT sw_component, function_name, failure_mode, failure_detail,
           effect_local, effect_system, potential_cause,
           severity, occurrence, detection, action_priority,
           preventive_action, detection_action
    FROM pre_fmea_items
    WHERE session_id='263a3e7c-460a-4a2f-998d-99f079137c3f' AND source='ai'
    ORDER BY sw_component, failure_mode
  `)
  for (const r of res.rows) {
    console.log(`\n[${r.sw_component}] ${r.function_name} | ${r.failure_mode} | S${r.severity}/O${r.occurrence}/D${r.detection} → ${r.action_priority}`)
    console.log(`  상세: ${r.failure_detail}`)
    console.log(`  로컬효과: ${r.effect_local}`)
    console.log(`  시스템효과: ${r.effect_system}`)
    console.log(`  원인: ${r.potential_cause}`)
    console.log(`  예방: ${r.preventive_action}`)
    console.log(`  감지: ${r.detection_action}`)
  }
  console.log(`\n총 ${res.rows.length}개`)
  await pool.end()
}
main().catch(console.error)
