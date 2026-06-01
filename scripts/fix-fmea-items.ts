import pg from 'pg'
import { calculateAP } from '../src/lib/ap-calculator.js'

const SESSION_ID = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/fmea_db' })

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ① TurnDialErrorDetection — detection_action 추가
    const r1 = await client.query(`
      UPDATE pre_fmea_items
      SET detection_action = '변속 명령 후 완료까지 최대 허용 시간 타임아웃 DTC; RetryWarning 카운터 임계 초과 감시'
      WHERE session_id=$1 AND source='ai'
        AND sw_component='CstAp_MotorControlMgt'
        AND function_name='CtAp_MotorControl / TurnDialErrorDetection'
    `, [SESSION_ID])
    console.log(`① TurnDialErrorDetection detection_action 추가: ${r1.rowCount}행`)

    // ② SecondRetry — failure_detail 추가 + failure_mode MORE→LESS + AP 재계산
    //    S=8, O=3, D=4 → LESS로 변경해도 S/O/D는 동일 → AP 재계산
    const newAP2 = calculateAP(8, 3, 4)
    const r2 = await client.query(`
      UPDATE pre_fmea_items
      SET failure_detail = '2차 재시도(SecondRetry) 후에도 위치 미달성 시 Warning 카운터가 임계값 초과하여 모터 영구 정지 명령 발동',
          failure_mode   = 'LESS',
          action_priority = $2
      WHERE session_id=$1 AND source='ai'
        AND sw_component='CstAp_MotorControlMgt'
        AND function_name='CtAp_MotorControl / SecondRetry'
    `, [SESSION_ID, newAP2])
    console.log(`② SecondRetry failure_detail 추가 + LESS 변경 (AP=${newAP2}): ${r2.rowCount}행`)

    // ③ SysStaChk CORRUPT — O=1→2, AP 재계산
    const newAP3 = calculateAP(9, 2, 4)
    const r3 = await client.query(`
      UPDATE pre_fmea_items
      SET occurrence = 2,
          action_priority = $2
      WHERE session_id=$1 AND source='ai'
        AND sw_component='CstAp_PwrMGT'
        AND function_name='CtAp_SysStaChk / SysPwrSta'
        AND failure_mode = 'CORRUPT'
    `, [SESSION_ID, newAP3])
    console.log(`③ SysStaChk CORRUPT O=1→2 (AP: L→${newAP3}): ${r3.rowCount}행`)

    // ④ CstAP_VehicleReset_Mgt → CstAp_VehicleReset_Mgt (대소문자 통일)
    const r4 = await client.query(`
      UPDATE pre_fmea_items
      SET sw_component = 'CstAp_VehicleReset_Mgt'
      WHERE session_id=$1 AND source='ai'
        AND sw_component='CstAP_VehicleReset_Mgt'
    `, [SESSION_ID])
    console.log(`④ VehicleReset_Mgt 컴포넌트명 대소문자 통일: ${r4.rowCount}행`)

    await client.query('COMMIT')
    console.log('\n✅ 전체 수정 완료')

    // 검증
    const check = await pool.query(`
      SELECT sw_component, function_name, failure_mode, failure_detail,
             occurrence, action_priority, detection_action
      FROM pre_fmea_items
      WHERE session_id=$1 AND source='ai'
        AND (
          (sw_component='CstAp_MotorControlMgt' AND function_name IN (
            'CtAp_MotorControl / TurnDialErrorDetection',
            'CtAp_MotorControl / SecondRetry'
          ))
          OR (sw_component='CstAp_PwrMGT' AND function_name='CtAp_SysStaChk / SysPwrSta' AND failure_mode='CORRUPT')
          OR sw_component='CstAp_VehicleReset_Mgt'
        )
      ORDER BY sw_component, function_name
    `, [SESSION_ID])

    console.log('\n[수정 결과 검증]')
    for (const r of check.rows) {
      console.log(`\n  [${r.sw_component}] ${r.function_name} | ${r.failure_mode} | O=${r.occurrence} AP=${r.action_priority}`)
      console.log(`  상세: ${r.failure_detail ?? '(없음)'}`)
      console.log(`  감지: ${r.detection_action ?? '(없음)'}`)
    }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌', e)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
