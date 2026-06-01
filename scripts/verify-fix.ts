import pg from 'pg'
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/fmea_db' })
async function main() {
  const r = await pool.query(`
    SELECT sw_component, function_name, failure_mode, failure_detail, detection_action, occurrence, action_priority
    FROM pre_fmea_items
    WHERE session_id='263a3e7c-460a-4a2f-998d-99f079137c3f'
      AND function_name IN (
        'CtAp_MotorControl / SecondRetry',
        'CtAp_MotorControl / TurnDialErrorDetection',
        'CtAp_SysStaChk / SysPwrSta'
      )
    ORDER BY function_name
  `)
  for (const row of r.rows) {
    console.log(`\n[${row.function_name}]`)
    console.log(`  mode: ${row.failure_mode} | O=${row.occurrence} | AP=${row.action_priority}`)
    console.log(`  failure_detail: ${row.failure_detail}`)
    console.log(`  detection_action: ${row.detection_action}`)
  }
  await pool.end()
}
main().catch(console.error)
