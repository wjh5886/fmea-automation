import type { IcdVariable } from './icd-parser'

type DbcMessage = {
  id: number
  name: string
  sender: string
  signals: DbcSignal[]
}

type DbcSignal = {
  name: string
  startBit: number
  length: number
  byteOrder: '0' | '1'   // 0=big-endian, 1=little-endian
  signed: boolean
  factor: number
  offset: number
  min: number
  max: number
  unit: string
  receivers: string[]
  comment: string | null
}

// BO_ 100 GearController: 8 ECU
const MSG_RE  = /^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/
// SG_ SBW_TargetGear : 0|8@1+ (1,0) [0|7] "rpm" TCU,BCM
const SIG_RE  = /^\s+SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([^,]+),([^)]+)\)\s+\[([^|]+)\|([^\]]+)\]\s+"([^"]*)"\s+(.*)/
// CM_ SG_ 100 SBW_TargetGear "description text";
const CMT_RE  = /^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)"\s*;/

export function parseDbcBuffer(buf: Buffer): IcdVariable[] {
  const text = buf.toString('utf-8')
  const lines = text.split(/\r?\n/)

  const messages = new Map<number, DbcMessage>()
  const comments = new Map<string, string>() // `${msgId}_${sigName}` -> comment

  let currentMsg: DbcMessage | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Message block
    const msgMatch = line.match(MSG_RE)
    if (msgMatch) {
      currentMsg = {
        id: parseInt(msgMatch[1]),
        name: msgMatch[2],
        sender: msgMatch[4],
        signals: [],
      }
      messages.set(currentMsg.id, currentMsg)
      continue
    }

    // Match rawLine (not trimmed) so leading spaces are preserved for SIG_RE
    const sigMatch = rawLine.match(SIG_RE)
    if (sigMatch && currentMsg) {
      currentMsg.signals.push({
        name:      sigMatch[1],
        startBit:  parseInt(sigMatch[2]),
        length:    parseInt(sigMatch[3]),
        byteOrder: sigMatch[4] as '0' | '1',
        signed:    sigMatch[5] === '-',
        factor:    parseFloat(sigMatch[6]),
        offset:    parseFloat(sigMatch[7]),
        min:       parseFloat(sigMatch[8]),
        max:       parseFloat(sigMatch[9]),
        unit:      sigMatch[10],
        receivers: sigMatch[11].split(',').map(s => s.trim()).filter(Boolean),
        comment:   null,
      })
      continue
    }

    // End of message block on empty line
    if (line === '') currentMsg = null

    // Signal comment
    const cmtMatch = line.match(CMT_RE)
    if (cmtMatch) {
      const key = `${cmtMatch[1]}_${cmtMatch[2]}`
      comments.set(key, cmtMatch[3].replace(/\\"/g, '"'))
    }
  }

  // Build IcdVariable list
  const result: IcdVariable[] = []
  let sortOrder = 0

  for (const msg of messages.values()) {
    for (const sig of msg.signals) {
      const key = `${msg.id}_${sig.name}`
      const comment = comments.get(key) ?? null

      const bitLen = sig.length
      let dataType: string
      if (bitLen === 1)       dataType = 'bool'
      else if (bitLen <= 8)   dataType = sig.signed ? 'sint8'  : 'uint8'
      else if (bitLen <= 16)  dataType = sig.signed ? 'sint16' : 'uint16'
      else if (bitLen <= 32)  dataType = sig.signed ? 'sint32' : 'uint32'
      else                    dataType = 'uint64'

      // Compute physical range
      const physMin = sig.min * sig.factor + sig.offset
      const physMax = sig.max * sig.factor + sig.offset
      const rangeStr = (physMin !== 0 || physMax !== 0)
        ? `${physMin}~${physMax}`
        : `0~${Math.pow(2, bitLen) - 1}`

      // Direction: sender = this ECU → Output; receiver → Input
      const direction = msg.sender !== 'Vector__XXX' ? `Send (${msg.sender})` : 'Recv'

      result.push({
        sw_component:  msg.name,          // message name as component
        variable_name: sig.name,
        variable_type: direction.startsWith('Send') ? 'Output' : 'Input',
        direction,
        data_type:     dataType,
        signal_range:  rangeStr,
        unit:          sig.unit || null,
        description:   comment,
        sort_order:    sortOrder++,
      })
    }
  }

  return result
}
