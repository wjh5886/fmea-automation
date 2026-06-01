/**
 * Extract ICD variables from architecture docs (SWE2) + match DBC signals.
 * Inserts results into pre_fmea_icd_variables for ICD-mode FMEA generation.
 *
 * Mapping logic:
 *   Architecture interface (Source=BswIF_CAN, Dest=CstAp_CANMGT)
 *     → Structure element names = DBC signal names → match & merge DBC metadata
 *   Architecture interface (Source=BswIF_IoHwAb, Dest=CstAp_xxx)
 *     → HW/sensor inputs (ADC readings, digital signals)
 *   Architecture interface (Source=CstAp_xxx, Dest=CstAp_yyy)
 *     → Inter-component signals
 */
import mammoth from 'mammoth'
import fs from 'fs'
import path from 'path'
import pg from 'pg'

const SESSION_ID = process.argv[2] ?? '263a3e7c-460a-4a2f-998d-99f079137c3f'
const BASE       = `data/uploads/${SESSION_ID}`
const DB_URL     = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/fmea_db'
const pool       = new pg.Pool({ connectionString: DB_URL })

// ── DBC PARSER ────────────────────────────────────────────────────────────────
interface DbcSignal {
  msgName: string; msgId: number; sender: string
  sigName: string; length: number; signed: boolean
  factor: number; offset: number; min: number; max: number
  unit: string; receivers: string[]; comment: string | null
  periodMs: number | null  // inferred from message name pattern
}

function parseDbcSignals(text: string): Map<string, DbcSignal> {
  const MSG_RE = /^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/
  const SIG_RE = /^\s+SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([^,]+),([^)]+)\)\s+\[([^|]+)\|([^\]]+)\]\s+"([^"]*)"\s+(.*)/
  const CMT_RE = /^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)"\s*;/

  const messages = new Map<number, { id: number; name: string; sender: string; periodMs: number | null; signals: Omit<DbcSignal, 'msgName'|'msgId'|'sender'|'periodMs'>[] }>()
  const comments = new Map<string, string>()
  type MsgEntry = { id: number; name: string; sender: string; periodMs: number | null; signals: Omit<DbcSignal, 'msgName'|'msgId'|'sender'|'periodMs'>[] }
  let cur: MsgEntry | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const mm = line.match(MSG_RE)
    if (mm) {
      const name = mm[2]
      const periodMatch = name.match(/(\d+)ms$/i)
      cur = { id: +mm[1], name, sender: mm[4], periodMs: periodMatch ? +periodMatch[1] : null, signals: [] }
      messages.set(cur.id, cur)
      continue
    }
    const sm = rawLine.match(SIG_RE)
    if (sm && cur) {
      cur.signals.push({
        sigName: sm[1], length: +sm[3], signed: sm[5] === '-',
        factor: parseFloat(sm[6]), offset: parseFloat(sm[7]),
        min: parseFloat(sm[8]), max: parseFloat(sm[9]),
        unit: sm[10], receivers: sm[11].split(',').map(s => s.trim()).filter(Boolean), comment: null,
      })
      continue
    }
    if (line === '') cur = null
    const cm = line.match(CMT_RE)
    if (cm) comments.set(`${cm[1]}_${cm[2]}`, cm[3].replace(/\\"/g, '"'))
  }

  const result = new Map<string, DbcSignal>()
  for (const msg of messages.values()) {
    for (const sig of msg.signals) {
      const comment = comments.get(`${msg.id}_${sig.sigName}`) ?? null
      result.set(sig.sigName, { msgName: msg.name, msgId: msg.id, sender: msg.sender, periodMs: msg.periodMs, ...sig, comment })
    }
  }
  return result
}

function dbcDataType(sig: DbcSignal): string {
  if (sig.length === 1)  return 'bool'
  if (sig.length <= 8)   return sig.signed ? 'sint8'  : 'uint8'
  if (sig.length <= 16)  return sig.signed ? 'sint16' : 'uint16'
  if (sig.length <= 32)  return sig.signed ? 'sint32' : 'uint32'
  return 'uint64'
}

function dbcRange(sig: DbcSignal): string {
  const lo = sig.min * sig.factor + sig.offset
  const hi = sig.max * sig.factor + sig.offset
  if (lo === 0 && hi === 0) return '-'
  const unit = sig.unit || ''
  return `${lo}~${hi}${unit ? ' ' + unit : ''}`
}

// ── ARCHITECTURE PARSER ───────────────────────────────────────────────────────
export interface ArchInterface {
  component: string      // Destination SW component
  portName: string       // Port prototype name
  portType: string       // Client | Receiver | Sender | Server
  source: string         // Source SW component
  destination: string    // Destination SW component
  direction: string      // Input | Output
  elements: Array<{
    name: string         // Signal / element name
    dataType: string     // uint8 | uint16 | bool | enum | ...
    valueRange: string   // e.g. "0u~255u" or enum values
  }>
  argName: string        // Internal argument variable name
  periodMs: number | null  // CAN message period (if from BswIF_CAN)
}

function parseArchInterfaces(text: string): ArchInterface[] {
  const interfaces: ArchInterface[] = []

  // Split into MKSID blocks
  const blocks = text.split(/<MKSID-\d+>/)

  let currentComponent = ''

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi].trim()
    if (!block) continue

    // Detect component section header
    const compMatch = block.match(/^((?:CstAp|BswIF|CtAp|CtCdd|Cst|Bsw)\w+)\[SwC\d+\]\s*\/\s*ASIL/)
    if (compMatch) {
      currentComponent = compMatch[1]
      continue
    }

    // Skip non-interface blocks
    if (!currentComponent) continue

    // Interface blocks contain "Port Interface Type" or "Linkage"
    if (!block.includes('Port Interface Type') && !block.includes('Linkage')) continue
    if (!block.includes('Source') || !block.includes('Destination')) continue

    // ── Field extraction ──────────────────────────────────────────────────────
    const lines = block.split('\n').map(l => l.trim()).filter(l => l && l !== '-')

    const getAfter = (label: string): string => {
      const idx = lines.findIndex(l => l === label)
      if (idx < 0) return ''
      // next non-empty line(s)
      for (let i = idx + 1; i < Math.min(idx + 4, lines.length); i++) {
        const v = lines[i]
        if (v && !v.startsWith('Classification') && !v.startsWith('Attributes')) return v
      }
      return ''
    }

    const portType    = getAfter('Port Interface Type')   // Client|Receiver|Sender|Server
    const source      = getAfter('Source')
    const destination = getAfter('Destination')
    const argNameRaw  = getAfter('Argument Name')
    const portName    = getAfter('Port Interface Proto Type Name') || getAfter('Port Interface Name')

    if (!source || !destination) continue
    if (!portType || portType === 'AUTOSARLayer') continue

    // Direction
    const direction = (portType === 'Sender' || portType === 'Server') ? 'Output' : 'Input'

    // The component that "owns" this interface is the Destination for Input, Source for Output
    const ownerComp = direction === 'Input' ? destination : source
    if (ownerComp !== currentComponent && currentComponent !== destination && currentComponent !== source) continue

    // ── Element extraction ────────────────────────────────────────────────────
    const elements: ArchInterface['elements'] = []

    // Find Element List section
    const elIdx = lines.findIndex(l => l === 'Element List')
    if (elIdx >= 0) {
      // Elements are after "Element List" until next major label
      const STOP = new Set(['Parameter Name', 'Parameter Direction', 'Code layer', 'Argument Type', 'Argument Name', 'Value Range (Effective Range)', 'Linkage'])
      for (let i = elIdx + 1; i < lines.length; i++) {
        if (STOP.has(lines[i])) break
        // Match "SignalName (dataType)" or "SignalName(dataType)"
        const em = lines[i].match(/^(\w+)\s*\((\w+)\)$/)
        if (em) {
          elements.push({ name: em[1], dataType: em[2], valueRange: '' })
        }
      }

      // Parse Value Range section for each element
      const vrIdx = lines.findIndex(l => l === 'Value Range (Effective Range)')
      if (vrIdx >= 0) {
        let currentEl = ''
        const rangeLines: string[] = []
        for (let i = vrIdx + 1; i < lines.length; i++) {
          if (lines[i] === 'Linkage') break
          const elRefMatch = lines[i].match(/^(\w+):$/)
          if (elRefMatch) {
            // Save previous
            if (currentEl && rangeLines.length) {
              const el = elements.find(e => e.name === currentEl)
              if (el) el.valueRange = rangeLines.join('; ').slice(0, 100)
              rangeLines.length = 0
            }
            currentEl = elRefMatch[1]
          } else if (currentEl && lines[i]) {
            rangeLines.push(lines[i])
          }
        }
        // Last element
        if (currentEl && rangeLines.length) {
          const el = elements.find(e => e.name === currentEl)
          if (el) el.valueRange = rangeLines.join('; ').slice(0, 100)
        }
      }
    }

    // If no element list → single signal, extract from Parameter Type or Argument Name
    if (elements.length === 0) {
      // Try to infer signal name from argument name: e.g. CtApXxx_I_u1_DrvRdySig → DrvRdySig
      let sigName = argNameRaw
      let dataType = 'uint8'

      const argMatch = argNameRaw.match(/[IO]_\w+?_(\w+)$/)
      if (argMatch) sigName = argMatch[1]
      else if (argNameRaw.includes('_')) sigName = argNameRaw.split('_').pop() ?? argNameRaw

      // Get data type from Parameter Type line
      const ptIdx = lines.findIndex(l => l === 'Parameter Type')
      if (ptIdx >= 0) {
        const ptVal = lines[ptIdx + 1] ?? ''
        const dtMatch = ptVal.match(/\b(uint8|uint16|uint32|sint8|sint16|sint32|bool|float32|float64)\b/i)
        if (dtMatch) dataType = dtMatch[1].toLowerCase()
        else if (/O_u1_/.test(ptVal)) dataType = 'uint8'
        else if (/O_u2_/.test(ptVal)) dataType = 'uint16'
      }

      // Get value range from simple value range section
      const vrIdx = lines.findIndex(l => l === 'Value Range (Effective Range)')
      let valueRange = ''
      if (vrIdx >= 0) {
        const rangeVals: string[] = []
        for (let i = vrIdx + 1; i < Math.min(vrIdx + 8, lines.length); i++) {
          if (lines[i] === 'Linkage' || lines[i] === 'Source') break
          if (lines[i]) rangeVals.push(lines[i])
        }
        valueRange = rangeVals.join('; ').slice(0, 100)
      }

      if (sigName) {
        elements.push({ name: sigName, dataType, valueRange })
      }
    }

    if (elements.length === 0) continue

    // Extract CAN period from port name (e.g. GetCLUMsg → CLU_01_20ms)
    let periodMs: number | null = null
    const periodMatch = (portName + ' ' + argNameRaw).match(/(\d+)ms/i)
    if (periodMatch) periodMs = +periodMatch[1]

    interfaces.push({
      component: ownerComp,
      portName,
      portType,
      source,
      destination,
      direction,
      elements,
      argName: argNameRaw,
      periodMs,
    })
  }

  return interfaces
}

// ── ICD RECORD BUILDER ────────────────────────────────────────────────────────
interface IcdVariable {
  session_id: string
  sw_component: string
  variable_name: string
  variable_type: string   // CAN_RX | CAN_TX | HW_INPUT | HW_OUTPUT | SW_INTERNAL
  direction: string       // Input | Output
  data_type: string
  signal_range: string
  unit: string
  description: string
  sort_order: number
}

// Build suffix lookup: "RhstaLvlSta" → [CLU_RhstaLvlSta, ...]
function buildDbcSuffixMap(dbcMap: Map<string, DbcSignal>): Map<string, DbcSignal[]> {
  const sfx = new Map<string, DbcSignal[]>()
  for (const [name, sig] of dbcMap) {
    // Index by full name
    const push = (k: string) => { if (!sfx.has(k)) sfx.set(k, []); sfx.get(k)!.push(sig) }
    push(name)
    // Index by suffix after first underscore prefix (e.g. CLU_Rh... → Rh...)
    const parts = name.split('_')
    if (parts.length >= 2) push(parts.slice(1).join('_'))
    // Index by suffix after second underscore (e.g. MoodLamp_Slv_X → Slv_X)
    if (parts.length >= 3) push(parts.slice(2).join('_'))
    // Index by lowercased
    push(name.toLowerCase())
  }
  return sfx
}

let _sfxMap: Map<string, DbcSignal[]> | null = null
function matchDbc(name: string, dbcMap: Map<string, DbcSignal>, sfxMap: Map<string, DbcSignal[]>): DbcSignal | null {
  // 1. Exact match
  if (dbcMap.has(name)) return dbcMap.get(name)!
  // 2. Suffix match (DBC has prefix like CLU_, MoodLamp_, SMK_)
  const candidates = sfxMap.get(name) ?? sfxMap.get(name.toLowerCase()) ?? []
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) return candidates[0] // take first (closest)
  // 3. DBC signal that ends with the arch element name
  for (const [dName, sig] of dbcMap) {
    if (dName.endsWith('_' + name)) return sig
  }
  return null
}

function buildIcdVariables(
  iface: ArchInterface,
  dbcMap: Map<string, DbcSignal>,
  sfxMap: Map<string, DbcSignal[]>,
  sortBase: number,
): IcdVariable[] {
  const vars: IcdVariable[] = []

  for (let i = 0; i < iface.elements.length; i++) {
    const el = iface.elements[i]

    // Skip internal timeout/counter signals that are purely diagnostic
    if (/Timeout$|_To$|AlvCnt|_Crc\d*$|^CRC_/i.test(el.name)) {
      // Still include E2E signals but tag them differently
    }

    // Determine variable type
    let variableType: string
    if (iface.source === 'BswIF_CAN' || iface.destination === 'BswIF_CAN') {
      variableType = iface.direction === 'Input' ? 'CAN_RX' : 'CAN_TX'
    } else if (iface.source === 'BswIF_IoHwAb' || iface.destination === 'BswIF_IoHwAb') {
      variableType = iface.direction === 'Input' ? 'HW_INPUT' : 'HW_OUTPUT'
    } else {
      variableType = 'SW_INTERNAL'
    }

    // Try DBC match for CAN signals (exact + suffix + ends-with)
    const dbcSig = matchDbc(el.name, dbcMap, sfxMap)
    let dataType   = el.dataType || 'uint8'
    let signalRange = el.valueRange || '-'
    let unit = ''
    let description = ''
    let periodMs = iface.periodMs

    if (dbcSig) {
      // Override with DBC metadata (more accurate)
      dataType    = dbcDataType(dbcSig)
      signalRange = dbcRange(dbcSig)
      unit        = dbcSig.unit || ''
      description = [
        dbcSig.comment ?? '',
        `[DBC: ${dbcSig.msgName}, sender=${dbcSig.sender}]`,
        `receivers: ${dbcSig.receivers.join(',')}`,
      ].filter(Boolean).join(' | ')
      if (dbcSig.periodMs && !periodMs) periodMs = dbcSig.periodMs

      // For CAN polling signals: add EARLY/LATE hazop note
      if (periodMs) {
        description += ` | Period: ${periodMs}ms (polling)`
      }
    } else {
      // No DBC match → use architecture data
      description = `[Arch: ${iface.portName}] ${iface.source}→${iface.destination}`
      if (periodMs) description += ` | Period: ${periodMs}ms`
    }

    // For bool detection
    if (el.dataType === 'bool' || el.name.endsWith('Sta') || /^Is[A-Z]/.test(el.name)) {
      if (el.dataType !== 'uint16' && el.dataType !== 'uint32') dataType = 'bool'
    }

    vars.push({
      session_id: SESSION_ID,
      sw_component: iface.component,
      variable_name: el.name,
      variable_type: variableType,
      direction: iface.direction,
      data_type: dataType,
      signal_range: signalRange,
      unit,
      description,
      sort_order: sortBase + i,
    })
  }

  return vars
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ ICD 변수 추출 시작`)
  console.log(`  세션: ${SESSION_ID}`)

  // 1. Load DBC
  const dbcDir = path.join(BASE, 'dbc_file')
  const dbcFiles = fs.existsSync(dbcDir) ? fs.readdirSync(dbcDir) : []
  if (!dbcFiles.length) { console.error('❌ DBC 파일 없음'); process.exit(1) }
  const dbcText = fs.readFileSync(path.join(dbcDir, dbcFiles[0]), 'utf-8')
  const dbcMap  = parseDbcSignals(dbcText)
  const sfxMap  = buildDbcSuffixMap(dbcMap)
  console.log(`✅ DBC 신호 파싱: ${dbcMap.size}개`)

  // 2. Load + parse all architecture files
  const archDir = path.join(BASE, 'architecture')
  const archFiles = fs.existsSync(archDir) ? fs.readdirSync(archDir) : []
  if (!archFiles.length) { console.error('❌ 아키텍처 파일 없음'); process.exit(1) }

  let allInterfaces: ArchInterface[] = []
  for (const f of archFiles) {
    const buf = fs.readFileSync(path.join(archDir, f))
    const result = await mammoth.extractRawText({ buffer: buf as any })
    const ifaces = parseArchInterfaces(result.value)
    console.log(`  ${f}: ${ifaces.length}개 인터페이스 추출`)
    allInterfaces = allInterfaces.concat(ifaces)
  }
  console.log(`✅ 총 인터페이스 추출: ${allInterfaces.length}개`)

  // 3. Build ICD variables
  const allVars: IcdVariable[] = []
  let sortOrder = 0
  for (const iface of allInterfaces) {
    const vars = buildIcdVariables(iface, dbcMap, sfxMap, sortOrder)
    allVars.push(...vars)
    sortOrder += vars.length
  }

  // 4. Dedup: same (sw_component + variable_name + direction)
  const seen = new Set<string>()
  const dedupVars = allVars.filter(v => {
    const key = `${v.sw_component}|${v.variable_name}|${v.direction}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`✅ ICD 변수 생성: ${allVars.length}개 → 중복 제거 후 ${dedupVars.length}개`)

  // 5. Stats
  const byType: Record<string, number> = {}
  const byComp: Record<string, number> = {}
  let dbcMatchCount = 0
  for (const v of dedupVars) {
    byType[v.variable_type] = (byType[v.variable_type] ?? 0) + 1
    byComp[v.sw_component]  = (byComp[v.sw_component]  ?? 0) + 1
    if (v.description.includes('[DBC:')) dbcMatchCount++
  }
  console.log(`\n[타입별 분포]`)
  for (const [t, c] of Object.entries(byType).sort()) console.log(`  ${t.padEnd(15)}: ${c}개`)
  console.log(`\n  DBC 매칭 성공: ${dbcMatchCount}개 / ${dedupVars.filter(v => v.variable_type.startsWith('CAN')).length}개 CAN 신호`)

  console.log(`\n[컴포넌트별 ICD 변수 수 (상위 20개)]`)
  const sortedComps = Object.entries(byComp).sort((a, b) => b[1] - a[1]).slice(0, 20)
  for (const [comp, cnt] of sortedComps) console.log(`  ${comp.padEnd(35)}: ${cnt}개`)

  // 6. Insert to DB
  const client = await pool.connect()
  try {
    // Delete existing ICD vars for this session
    await client.query('DELETE FROM pre_fmea_icd_variables WHERE session_id = $1', [SESSION_ID])
    console.log(`\n  기존 ICD 변수 삭제 완료`)

    await client.query('BEGIN')
    let inserted = 0
    for (const v of dedupVars) {
      await client.query(
        `INSERT INTO pre_fmea_icd_variables
         (session_id, sw_component, variable_name, variable_type, direction,
          data_type, signal_range, unit, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [v.session_id, v.sw_component, v.variable_name, v.variable_type, v.direction,
         v.data_type, v.signal_range, v.unit, v.description, v.sort_order],
      )
      inserted++
    }
    await client.query('COMMIT')
    console.log(`✅ DB 삽입 완료: ${inserted}개 ICD 변수`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }

  // 7. Show sample
  console.log('\n[샘플 ICD 변수 — CAN_RX 첫 10개]')
  const canSamples = dedupVars.filter(v => v.variable_type === 'CAN_RX').slice(0, 10)
  for (const v of canSamples) {
    console.log(`  [${v.sw_component}] ${v.variable_name} (${v.data_type}) ${v.signal_range}`)
    if (v.description) console.log(`    → ${v.description.slice(0, 80)}`)
  }
}

main().catch(e => { console.error('❌', e); process.exit(1) })
