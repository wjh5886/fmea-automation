import pg from 'pg'
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/fmea_db' })
async function main() {
  const r = await pool.query(`
    SELECT failure_mode, failure_detail, detection_action, occurrence, action_priority
    FROM pre_fmea_items
    WHERE session_id='263a3e7c-460a-4a2f-998d-99f079137c3f'
      AND function_name='CtAp_MotorControl / SecondRetry'
  `)
  const row = r.rows[0]
  process.stdout.write('failure_mode: ' + row.failure_mode + '\n')
  process.stdout.write('failure_detail: ' + JSON.stringify(row.failure_detail) + '\n')
  process.stdout.write('detection_action: ' + JSON.stringify(row.detection_action) + '\n')
  process.stdout.write('O=' + row.occurrence + ' AP=' + row.action_priority + '\n')
  await pool.end()
}
main().catch(e => { process.stderr.write(String(e)); process.exit(1) })
