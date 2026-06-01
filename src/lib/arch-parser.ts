/**
 * Architecture document (SWE2 .docx) parser + DBC signal matcher.
 * Extracts ICD variables from AUTOSAR port interfaces.
 */

export interface ArchInterface {
  component: string
  portName: string
  portType: string
  source: string
  destination: string
  direction: string
  elements: Array<{ name: string; dataType: string; valueRange: string }>
  argName: string
  periodMs: number | null
}

export interface DbcSignalRich {
  msgName: string; msgId: number; sender: string
  sigName: string; length: number; signed: boolean
  factor: number; offset: number; min: number; max: number
  unit: string; receivers: string[]; comment: string | null
  periodMs: number | null
}

// ── DBC rich parser (returns map for matching) ────────────────────────────────
export function parseDbcRich(text: string): Map<string, DbcSignalRich> {
  const MSG_RE = /^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/
  const SIG_RE = /^\s+SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([^,]+),([^)]+)\)\s+\[([^|]+)\|([^\]]+)\]\s+"([^"]*)"\s+(.*)/
  const CMT_RE = /^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)"\s*;/

  type MsgEntry = { id: number; name: string; sender: string; periodMs: number | null; signals: Omit<DbcSignalRich, 'msgName' | 'msgId' | 'sender' | 'periodMs'>[] }
  const messages = new Map<number, MsgEntry>()
  const comments = new Map<string, string>()
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

  const result = new Map<string, DbcSignalRich>()
  for (const msg of messages.values()) {
    for (const sig of msg.signals) {
      const comment = comments.get(`${msg.id}_${sig.sigName}`) ?? null
      result.set(sig.sigName, { msgName: msg.name, msgId: msg.id, sender: msg.sender, periodMs: msg.periodMs, ...sig, comment })
    }
  }
  return result
}

// ── Architecture document parser ──────────────────────────────────────────────
export function parseArchInterfaces(text: string): ArchInterface[] {
  const interfaces: ArchInterface[] = []
  const blocks = text.split(/<MKSID-\d+>/)
  let currentComponent = ''

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi].trim()
    if (!block) continue

    const compMatch = block.match(/^((?:CstAp|BswIF|CtAp|CtCdd|Cst|Bsw)\w+)\[SwC\d+\]\s*\/\s*ASIL/)
    if (compMatch) { currentComponent = compMatch[1]; continue }

    if (!currentComponent) continue
    if (!block.includes('Port Interface Type') && !block.includes('Linkage')) continue
    if (!block.includes('Source') || !block.includes('Destination')) continue

    const lines = block.split('\n').map(l => l.trim()).filter(l => l && l !== '-')

    const getAfter = (label: string): string => {
      const idx = lines.findIndex(l => l === label)
      if (idx < 0) return ''
      for (let i = idx + 1; i < Math.min(idx + 4, lines.length); i++) {
        const v = lines[i]
        if (v && !v.startsWith('Classification') && !v.startsWith('Attributes')) return v
      }
      return ''
    }

    const portType    = getAfter('Port Interface Type')
    const source      = getAfter('Source')
    const destination = getAfter('Destination')
    const argNameRaw  = getAfter('Argument Name')
    const portName    = getAfter('Port Interface Proto Type Name') || getAfter('Port Interface Name')

    if (!source || !destination) continue
    if (!portType || portType === 'AUTOSARLayer') continue

    const direction = (portType === 'Sender' || portType === 'Server') ? 'Output' : 'Input'
    const ownerComp = direction === 'Input' ? destination : source
    if (ownerComp !== currentComponent && currentComponent !== destination && currentComponent !== source) continue

    const elements: ArchInterface['elements'] = []
    const elIdx = lines.findIndex(l => l === 'Element List')
    if (elIdx >= 0) {
      const STOP = new Set(['Parameter Name', 'Parameter Direction', 'Code layer', 'Argument Type', 'Argument Name', 'Value Range (Effective Range)', 'Linkage'])
      for (let i = elIdx + 1; i < lines.length; i++) {
        if (STOP.has(lines[i])) break
        const em = lines[i].match(/^(\w+)\s*\((\w+)\)$/)
        if (em) elements.push({ name: em[1], dataType: em[2], valueRange: '' })
      }

      const vrIdx = lines.findIndex(l => l === 'Value Range (Effective Range)')
      if (vrIdx >= 0) {
        let currentEl = ''
        const rangeLines: string[] = []
        for (let i = vrIdx + 1; i < lines.length; i++) {
          if (lines[i] === 'Linkage') break
          const elRefMatch = lines[i].match(/^(\w+):$/)
          if (elRefMatch) {
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
        if (currentEl && rangeLines.length) {
          const el = elements.find(e => e.name === currentEl)
          if (el) el.valueRange = rangeLines.join('; ').slice(0, 100)
        }
      }
    }

    if (elements.length === 0) {
      let sigName = argNameRaw
      let dataType = 'uint8'

      const argMatch = argNameRaw.match(/[IO]_\w+?_(\w+)$/)
      if (argMatch) sigName = argMatch[1]
      else if (argNameRaw.includes('_')) sigName = argNameRaw.split('_').pop() ?? argNameRaw

      const ptIdx = lines.findIndex(l => l === 'Parameter Type')
      if (ptIdx >= 0) {
        const ptVal = lines[ptIdx + 1] ?? ''
        const dtMatch = ptVal.match(/\b(uint8|uint16|uint32|sint8|sint16|sint32|bool|float32|float64)\b/i)
        if (dtMatch) dataType = dtMatch[1].toLowerCase()
        else if (/O_u1_/.test(ptVal)) dataType = 'uint8'
        else if (/O_u2_/.test(ptVal)) dataType = 'uint16'
      }

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

      if (sigName) elements.push({ name: sigName, dataType, valueRange })
    }

    if (elements.length === 0) continue

    let periodMs: number | null = null
    const periodMatch = (portName + ' ' + argNameRaw).match(/(\d+)ms/i)
    if (periodMatch) periodMs = +periodMatch[1]

    interfaces.push({ component: ownerComp, portName, portType, source, destination, direction, elements, argName: argNameRaw, periodMs })
  }

  return interfaces
}

// ── DBC suffix lookup map for fuzzy matching ──────────────────────────────────
function buildSuffixMap(dbcMap: Map<string, DbcSignalRich>): Map<string, DbcSignalRich[]> {
  const sfx = new Map<string, DbcSignalRich[]>()
  const push = (k: string, sig: DbcSignalRich) => { if (!sfx.has(k)) sfx.set(k, []); sfx.get(k)!.push(sig) }
  for (const [name, sig] of dbcMap) {
    push(name, sig)
    const parts = name.split('_')
    if (parts.length >= 2) push(parts.slice(1).join('_'), sig)
    if (parts.length >= 3) push(parts.slice(2).join('_'), sig)
    push(name.toLowerCase(), sig)
  }
  return sfx
}

function matchDbc(name: string, dbcMap: Map<string, DbcSignalRich>, sfxMap: Map<string, DbcSignalRich[]>): DbcSignalRich | null {
  if (dbcMap.has(name)) return dbcMap.get(name)!
  const candidates = sfxMap.get(name) ?? sfxMap.get(name.toLowerCase()) ?? []
  if (candidates.length >= 1) return candidates[0]
  for (const [dName, sig] of dbcMap) {
    if (dName.endsWith('_' + name)) return sig
  }
  return null
}

function dbcDataType(sig: DbcSignalRich): string {
  if (sig.length === 1)  return 'bool'
  if (sig.length <= 8)   return sig.signed ? 'sint8'  : 'uint8'
  if (sig.length <= 16)  return sig.signed ? 'sint16' : 'uint16'
  if (sig.length <= 32)  return sig.signed ? 'sint32' : 'uint32'
  return 'uint64'
}

function dbcRange(sig: DbcSignalRich): string {
  const lo = sig.min * sig.factor + sig.offset
  const hi = sig.max * sig.factor + sig.offset
  if (lo === 0 && hi === 0) return '-'
  const unit = sig.unit || ''
  return `${lo}~${hi}${unit ? ' ' + unit : ''}`
}

// ── ICD variable builder from arch interfaces + DBC ───────────────────────────
export interface BuiltIcdVariable {
  sw_component: string
  variable_name: string
  variable_type: string   // CAN_RX | CAN_TX | HW_INPUT | HW_OUTPUT | SW_INTERNAL
  direction: string
  data_type: string
  signal_range: string
  unit: string
  description: string
  sort_order: number
}

export function buildIcdFromArch(
  interfaces: ArchInterface[],
  dbcMap: Map<string, DbcSignalRich>,
): BuiltIcdVariable[] {
  const sfxMap = buildSuffixMap(dbcMap)
  const all: BuiltIcdVariable[] = []
  let sortOrder = 0

  for (const iface of interfaces) {
    for (const el of iface.elements) {
      let variableType: string
      if (iface.source === 'BswIF_CAN' || iface.destination === 'BswIF_CAN') {
        variableType = iface.direction === 'Input' ? 'CAN_RX' : 'CAN_TX'
      } else if (iface.source === 'BswIF_IoHwAb' || iface.destination === 'BswIF_IoHwAb') {
        variableType = iface.direction === 'Input' ? 'HW_INPUT' : 'HW_OUTPUT'
      } else {
        variableType = 'SW_INTERNAL'
      }

      const dbcSig = matchDbc(el.name, dbcMap, sfxMap)
      let dataType    = el.dataType || 'uint8'
      let signalRange = el.valueRange || '-'
      let unit        = ''
      let description = ''
      let periodMs    = iface.periodMs

      if (dbcSig) {
        dataType    = dbcDataType(dbcSig)
        signalRange = dbcRange(dbcSig)
        unit        = dbcSig.unit || ''
        description = [
          dbcSig.comment ?? '',
          `[DBC: ${dbcSig.msgName}, sender=${dbcSig.sender}]`,
          `receivers: ${dbcSig.receivers.join(',')}`,
        ].filter(Boolean).join(' | ')
        if (dbcSig.periodMs && !periodMs) periodMs = dbcSig.periodMs
        if (periodMs) description += ` | Period: ${periodMs}ms`
      } else {
        description = `[Arch: ${iface.portName}] ${iface.source}→${iface.destination}`
        if (periodMs) description += ` | Period: ${periodMs}ms`
      }

      if (el.dataType === 'bool' || el.name.endsWith('Sta') || /^Is[A-Z]/.test(el.name)) {
        if (el.dataType !== 'uint16' && el.dataType !== 'uint32') dataType = 'bool'
      }

      all.push({
        sw_component:  iface.component,
        variable_name: el.name,
        variable_type: variableType,
        direction:     iface.direction,
        data_type:     dataType,
        signal_range:  signalRange,
        unit,
        description,
        sort_order:    sortOrder++,
      })
    }
  }

  // Dedup: same (sw_component + variable_name + direction)
  const seen = new Set<string>()
  return all.filter(v => {
    const key = `${v.sw_component}|${v.variable_name}|${v.direction}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Filter garbage variable names from arch parsing artifacts
const GARBAGE_RE = /^(Value Range|const definition|WriteSlaveAddr|ReadSlaveAddr|\d+u?$|[0-9]|\s*$)/i
export function isValidVariableName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 80) return false
  if (GARBAGE_RE.test(name)) return false
  if (/[^a-zA-Z0-9_]/.test(name)) return false
  return true
}
