/**
 * 사전 FMEA AI 생성 — 로컬 CLI 스크립트
 *
 * 사용법:
 *   node scripts/generate-fmea.mjs                  # 가장 최근 세션 자동 선택
 *   node scripts/generate-fmea.mjs <session_id>     # 특정 세션 지정
 *
 * 전제: 웹 UI에서 설계사양서 업로드 완료 상태
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── .env.local 파싱 ──────────────────────────────────────────────────────────
async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, '.env.local'), 'utf-8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    console.error('⚠  .env.local 파일을 찾을 수 없습니다.')
  }
}

// ── 사용법 출력 ───────────────────────────────────────────────────────────────
function printUsage() {
  console.log(`
사용법:
  node scripts/generate-fmea.mjs [session_id]

옵션:
  session_id  처리할 세션 ID (생략 시 가장 최근 세션 자동 선택)

API 키 지정 (크레딧이 다른 키 사용 시):
  Windows CMD:
    set ANTHROPIC_API_KEY=sk-ant-... && node scripts/generate-fmea.mjs

  PowerShell:
    $env:ANTHROPIC_API_KEY="sk-ant-..." ; node scripts/generate-fmea.mjs
`)
}

// ── DB 연결 ───────────────────────────────────────────────────────────────────
function getPool() {
  const { Pool } = require('pg')
  return new Pool({ connectionString: process.env.DATABASE_URL })
}

// ── 파일 파싱 (DOCX/PDF/TXT) ─────────────────────────────────────────────────
async function extractText(buf, filename) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    const mammoth = require('mammoth')
    const result = await mammoth.extractRawText({ buffer: buf })
    return { type: 'text', content: result.value }
  }
  if (lower.endsWith('.pdf')) {
    return { type: 'pdf', content: buf.toString('base64') }
  }
  return { type: 'text', content: buf.toString('utf-8') }
}

// ── 프롬프트 ─────────────────────────────────────────────────────────────────
const FMEA_PROMPT = `당신은 ISO 26262 인증 전문가이자 SW FMEA 전문가입니다.
위에 제공된 SW 설계사양서를 분석하여 체계적인 사전 FMEA 항목을 생성해주세요.

## 분석 기준

### HAZOP Guide Words (SW 고장 형태)
- MORE: 입력/출력 값이 정상 범위보다 크거나 높은 경우
- LESS: 입력/출력 값이 정상 범위보다 작거나 낮은 경우
- CORRUPT: 데이터가 손상되거나 잘못된 값을 포함하는 경우
- EARLY: 이벤트/신호가 예상보다 빨리 발생하는 경우
- LATE: 이벤트/신호가 예상보다 늦게 발생하는 경우
- STUCK: 값이 변하지 않고 고착되는 경우
- ERRATIC: 값이 불규칙하거나 예측 불가능하게 변동하는 경우

### Severity (심각도, S) 기준 (1~10)
- 10: 안전 관련 사고 (충돌, 부상, 사망)
- 7~9: 시스템 기능 상실 (핵심 기능 불가)
- 4~6: 성능 저하 (부분 기능 손상)
- 1~3: 미미한 영향 (사용자 불편 수준)

### Occurrence (발생도, O) 기준 (1~10)
- 9~10: 빈번히 발생 (≥1회/1000시간)
- 6~8: 가끔 발생
- 3~5: 드물게 발생
- 1~2: 거의 발생 안 함

### Detection (검출도, D) 기준 (1~10)
- 1~2: 확실한 자동 감지 (진단 커버리지 ≥99%)
- 3~4: 높은 감지 가능성
- 5~6: 보통 수준의 감지
- 7~8: 낮은 감지 가능성
- 9~10: 감지 불가 (런타임 진단 없음)

## 출력 형식

반드시 아래 JSON 배열만 출력하세요 (설명이나 마크다운 없이):

[
  {
    "sw_component": "SW 컴포넌트명",
    "function_name": "해당 기능명 (한국어, 명사형)",
    "failure_mode": "MORE|LESS|CORRUPT|EARLY|LATE|STUCK|ERRATIC 중 하나",
    "failure_detail": "구체적인 고장 내용 (한국어, 1~2문장)",
    "effect_local": "모듈 수준 영향 (한국어, 1문장)",
    "effect_system": "시스템/차량 수준 영향 (한국어, 1문장)",
    "potential_cause": "잠재적 원인 (한국어, 1~2문장)",
    "severity": 숫자(1~10),
    "occurrence": 숫자(1~10),
    "detection": 숫자(1~10),
    "preventive_action": "예방 설계 조치 (한국어, 1문장)",
    "detection_action": "검출/진단 방법 (한국어, 1문장)",
    "confidence_score": 0.0~1.0
  }
]

## 요구사항
- 설계사양서의 각 SW 기능/모듈에 대해 모든 적용 가능한 HAZOP guide word를 적용하세요
- 최소 15개 이상의 FMEA 항목을 생성하세요
- ISO 26262 ASIL 요구사항을 고려하세요`

// ── Claude API 호출 (다중 파일 지원) ─────────────────────────────────────────
async function callClaude(textParts, pdfBase64List) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY })

  const pdfBlocks = pdfBase64List.map(data => ({
    type: 'document', source: { type: 'base64', media_type: 'application/pdf', data },
  }))

  let messages
  if (pdfBlocks.length > 0 && textParts.length === 0) {
    messages = [{ role: 'user', content: [...pdfBlocks, { type: 'text', text: FMEA_PROMPT }] }]
  } else if (pdfBlocks.length > 0) {
    messages = [{
      role: 'user',
      content: [...pdfBlocks, { type: 'text', text: `${FMEA_PROMPT}\n\n--- 추가 설계사양서 내용 ---\n${textParts.join('\n\n')}` }],
    }]
  } else {
    messages = [{ role: 'user', content: `${FMEA_PROMPT}\n\n--- 설계사양서 내용 ---\n${textParts.join('\n\n')}` }]
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages,
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ── 데이터 정제 + DB 저장 ────────────────────────────────────────────────────
async function importItems(pool, sessionId, aiItems) {
  const clamp = (v, lo, hi) => { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null }
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const VALID_FM = ['MORE','LESS','CORRUPT','EARLY','LATE','STUCK','ERRATIC']

  const rows = aiItems.map((it, idx) => ({
    session_id: sessionId,
    item_no: String(idx + 1).padStart(3, '0'),
    sw_component: str(it.sw_component),
    function_name: str(it.function_name),
    failure_mode: VALID_FM.includes(String(it.failure_mode)) ? String(it.failure_mode) : null,
    failure_detail: str(it.failure_detail),
    effect_local: str(it.effect_local),
    effect_system: str(it.effect_system),
    potential_cause: str(it.potential_cause),
    severity: clamp(it.severity, 1, 10),
    occurrence: clamp(it.occurrence, 1, 10),
    detection: clamp(it.detection, 1, 10),
    preventive_action: str(it.preventive_action),
    detection_action: str(it.detection_action),
    confidence_score: Math.min(1, Math.max(0, Number(it.confidence_score) || 0)),
  }))

  await saveItems(pool, sessionId, rows)

  console.log('')
  console.log('════════════════════════════════════════')
  console.log(`✅  완료! ${rows.length}개 항목 저장됨`)
  console.log('────────────────────────────────────────')
  const byComponent = {}
  for (const r of rows) {
    const k = r.sw_component ?? '(미분류)'
    byComponent[k] = (byComponent[k] ?? 0) + 1
  }
  for (const [comp, cnt] of Object.entries(byComponent)) {
    console.log(`    ${comp}: ${cnt}개`)
  }
  const avgConf = rows.reduce((s, r) => s + r.confidence_score, 0) / rows.length
  const highConf = rows.filter(r => r.confidence_score >= 0.8).length
  console.log('────────────────────────────────────────')
  console.log(`    평균 확신도: ${(avgConf * 100).toFixed(0)}%`)
  console.log(`    고확신(≥80%): ${highConf}개 / 저확신: ${rows.length - highConf}개`)
  console.log('════════════════════════════════════════')
  console.log('')
  console.log('👉  웹 UI에서 결과 확인: http://localhost:3000/pre-fmea')
}

async function saveItems(pool, sessionId, items) {
  const client = await pool.connect()
  try {
    await client.query("DELETE FROM pre_fmea_items WHERE session_id = $1 AND source = 'ai'", [sessionId])
    await client.query('BEGIN')
    for (const row of items) {
      await client.query(
        `INSERT INTO pre_fmea_items
         (session_id, item_no, sw_component, function_name, failure_mode, failure_detail,
          effect_local, effect_system, potential_cause, severity, occurrence, detection,
          preventive_action, detection_action, confidence_score, source, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ai','pending')`,
        [row.session_id, row.item_no, row.sw_component, row.function_name, row.failure_mode,
         row.failure_detail, row.effect_local, row.effect_system, row.potential_cause,
         row.severity, row.occurrence, row.detection, row.preventive_action,
         row.detection_action, row.confidence_score],
      )
    }
    await client.query('COMMIT')
    await client.query(
      "UPDATE pre_fmea_sessions SET status = 'generated', updated_at = now() WHERE id = $1",
      [sessionId],
    )
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv[2] === '--help' || process.argv[2] === '-h') { printUsage(); return }

  await loadEnv()

  const pool = getPool()
  const uploadDir = process.env.UPLOAD_DIR ?? './data/uploads'

  // --json <file> 모드: claude.ai 결과를 파일에서 읽어 DB에 저장
  if (process.argv[2] === '--json') {
    const jsonFile = process.argv[3]
    const sessionId = process.argv[4]
    if (!jsonFile) { console.error('❌  사용법: node scripts/generate-fmea.mjs --json <result.json> [session_id]'); process.exit(1) }

    let targetSessionId = sessionId
    if (!targetSessionId) {
      const rows = await pool.query('SELECT * FROM pre_fmea_sessions ORDER BY created_at DESC LIMIT 1')
      if (!rows.rows.length) { console.error('❌  세션이 없습니다.'); process.exit(1) }
      targetSessionId = rows.rows[0].id
      console.log(`✔  최근 세션 자동 선택: "${rows.rows[0].name}"`)
    }

    const raw = await readFile(jsonFile, 'utf-8')
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    let aiItems
    try {
      aiItems = JSON.parse(cleaned)
      if (!Array.isArray(aiItems)) throw new Error('배열이 아님')
    } catch {
      console.error('❌  JSON 파싱 실패. claude.ai 결과를 그대로 저장했는지 확인하세요.')
      process.exit(1)
    }

    await importItems(pool, targetSessionId, aiItems)
    await pool.end()
    return
  }

  // --prompt 모드: claude.ai에 붙여넣을 프롬프트 출력
  if (process.argv[2] === '--prompt') {
    const sessionId = process.argv[3]
    let targetSessionId = sessionId
    if (!targetSessionId) {
      const rows = await pool.query('SELECT * FROM pre_fmea_sessions ORDER BY created_at DESC LIMIT 1')
      if (!rows.rows.length) { console.error('❌  세션이 없습니다.'); process.exit(1) }
      targetSessionId = rows.rows[0].id
    }

    const docRes = await pool.query(
      "SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'design_spec' ORDER BY created_at",
      [targetSessionId],
    )
    if (!docRes.rows.length) { console.error('❌  설계사양서가 없습니다. 웹 UI에서 먼저 업로드하세요.'); process.exit(1) }

    const promptUploadDir = process.env.UPLOAD_DIR ?? './data/uploads'
    const textParts = []
    const pdfFileNames = []
    for (const doc of docRes.rows) {
      const filePath = join(ROOT, promptUploadDir, doc.storage_path)
      const buf = await readFile(filePath)
      const fileData = await extractText(buf, doc.filename)
      if (fileData.type === 'pdf') {
        pdfFileNames.push(doc.filename)
      } else {
        textParts.push(`=== ${doc.filename} ===\n${fileData.content}`)
      }
    }

    const outFile = join(ROOT, 'scripts', 'prompt_output.txt')
    let fullPrompt
    if (pdfFileNames.length > 0 && textParts.length === 0) {
      fullPrompt = `[PDF 파일(${pdfFileNames.join(', ')})은 claude.ai에 직접 첨부하세요]\n\n${FMEA_PROMPT}`
    } else if (pdfFileNames.length > 0) {
      fullPrompt = `[PDF 파일(${pdfFileNames.join(', ')})은 claude.ai에 직접 첨부하세요]\n\n${FMEA_PROMPT}\n\n--- 추가 설계사양서 내용 ---\n${textParts.join('\n\n')}`
    } else {
      fullPrompt = `${FMEA_PROMPT}\n\n--- 설계사양서 내용 ---\n${textParts.join('\n\n')}`
    }

    await (await import('node:fs/promises')).writeFile(outFile, fullPrompt, 'utf-8')
    console.log('')
    console.log('════════════════════════════════════════════════════')
    console.log(`✅  프롬프트 파일 생성 완료! (설계사양서 ${docRes.rows.length}개)`)
    console.log(`    📄  ${outFile}`)
    console.log('════════════════════════════════════════════════════')
    console.log('')
    if (pdfFileNames.length > 0) {
      console.log(`⚠  PDF 파일(${pdfFileNames.join(', ')})은 claude.ai에 직접 첨부하세요`)
      console.log('')
    }
    console.log('다음 단계:')
    console.log('  1. 위 파일 내용 전체를 복사 (Ctrl+A → Ctrl+C)')
    console.log('  2. claude.ai 새 대화에 붙여넣기 (Ctrl+V) → 전송')
    console.log('  3. 응답된 JSON을 scripts\\result.json 으로 저장')
    console.log('  4. CMD에서 실행:')
    console.log('     node scripts\\generate-fmea.mjs --json scripts\\result.json')
    console.log('')
    await pool.end()
    return
  }

  // API 자동 모드
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌  ANTHROPIC_API_KEY가 설정되지 않았습니다.')
    printUsage(); process.exit(1)
  }

  // session_id 결정
  let sessionId = process.argv[2]
  if (!sessionId) {
    const rows = await pool.query('SELECT * FROM pre_fmea_sessions ORDER BY created_at DESC LIMIT 1')
    if (!rows.rows.length) { console.error('❌  세션이 없습니다. 웹 UI에서 세션을 먼저 만드세요.'); process.exit(1) }
    sessionId = rows.rows[0].id
    console.log(`✔  최근 세션 자동 선택: "${rows.rows[0].name}" (${sessionId})`)
  }

  // 세션 조회
  const sessRes = await pool.query('SELECT * FROM pre_fmea_sessions WHERE id = $1', [sessionId])
  if (!sessRes.rows.length) { console.error('❌  세션을 찾을 수 없습니다:', sessionId); process.exit(1) }
  console.log(`📋  세션: ${sessRes.rows[0].name}`)

  // design_spec 문서 조회
  const docRes = await pool.query(
    "SELECT * FROM pre_fmea_documents WHERE session_id = $1 AND doc_type = 'design_spec'",
    [sessionId],
  )
  if (!docRes.rows.length) { console.error('❌  설계사양서가 없습니다. 웹 UI에서 업로드 후 다시 실행하세요.'); process.exit(1) }

  console.log(`📄  파일: ${docRes.rows.map(d => d.filename).join(', ')}`)

  // 파일 읽기 + 분류
  console.log('📖  파일 파싱 중...')
  const textParts = []
  const pdfBase64List = []
  for (const doc of docRes.rows) {
    const filePath = join(ROOT, uploadDir, doc.storage_path)
    let buf
    try {
      buf = await readFile(filePath)
    } catch {
      console.error('❌  파일을 읽을 수 없습니다:', filePath); process.exit(1)
    }
    const fileData = await extractText(buf, doc.filename)
    if (fileData.type === 'pdf') {
      pdfBase64List.push(fileData.content)
      console.log(`    [PDF] ${doc.filename}: ${(buf.length / 1024).toFixed(1)} KB`)
    } else {
      textParts.push(`=== ${doc.filename} ===\n${fileData.content}`)
      console.log(`    [텍스트] ${doc.filename}: ${fileData.content.length.toLocaleString()} 자`)
    }
  }

  // Claude API 호출
  console.log('🤖  Claude AI 분석 중... (30~90초 소요)')
  const startTime = Date.now()
  let rawText
  try {
    rawText = await callClaude(textParts, pdfBase64List)
  } catch (e) {
    console.error('❌  Claude API 오류:', e.message)
    process.exit(1)
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`    완료 (${elapsed}초)`)

  // JSON 파싱
  let aiItems
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    aiItems = JSON.parse(cleaned)
    if (!Array.isArray(aiItems)) throw new Error('배열이 아님')
  } catch {
    console.error('❌  AI 응답 파싱 실패. 원문 (앞 500자):')
    console.error(rawText.slice(0, 500))
    process.exit(1)
  }

  // 데이터 정제 + DB 저장
  console.log(`💾  DB에 저장 중... (${aiItems.length}개 항목)`)
  await importItems(pool, sessionId, aiItems)
  await pool.end()
}

main().catch(e => { console.error('❌ ', e); process.exit(1) })
