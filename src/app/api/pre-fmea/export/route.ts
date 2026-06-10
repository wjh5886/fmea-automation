import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import ExcelJS from 'exceljs'

// ── 색상 팔레트 ──────────────────────────────────────────────────────────────
const CLR = {
  titleBg:   '1E3A5F',  // 진한 네이비
  titleFg:   'FFFFFF',
  hdr2Bg:    '2E75B6',  // 파란 헤더
  hdr2Fg:    'FFFFFF',
  hdr2Sod:   '375623',  // SOD 열 녹색 헤더
  hdr2After: '7B3F00',  // After 열 갈색 헤더
  hdr2Meta:  '404040',  // Source/Status 회색 헤더
  rowAlt:    'F2F7FF',  // 짝수 행 연파란 배경
  rowPend:   'FFF8E1',  // pending 행 연노란
  sodCell:   'E8F5E9',  // SOD 값 셀 연녹색
  rpnLow:    'C8E6C9',  // RPN < 50 녹색
  rpnMid:    'FFF9C4',  // RPN 50~99 노란
  rpnHigh:   'FFCCBC',  // RPN 100~199 오렌지
  rpnCrit:   'FFCDD2',  // RPN ≥ 200 빨강
  border:    'BDD7EE',  // 테두리 연파란
}

function hex(argb: string): ExcelJS.Color { return { argb: 'FF' + argb } as ExcelJS.Color }
function fill(argb: string): ExcelJS.Fill { return { type: 'pattern', pattern: 'solid', fgColor: hex(argb) } }

function border(color = CLR.border): Partial<ExcelJS.Borders> {
  const s: ExcelJS.BorderStyle = 'thin'
  const c = hex(color)
  return { top:{style:s,color:c}, left:{style:s,color:c}, right:{style:s,color:c}, bottom:{style:s,color:c} }
}

function rpnColor(rpn: number | null): string | null {
  if (!rpn) return null
  if (rpn >= 200) return CLR.rpnCrit
  if (rpn >= 100) return CLR.rpnHigh
  if (rpn >= 50)  return CLR.rpnMid
  return CLR.rpnLow
}

// ── 열 정의: [header, key, width, wrapText] ─────────────────────────────────
const COLS: { hdr: string; width: number; align?: ExcelJS.Alignment['horizontal'] }[] = [
  { hdr: 'No',                            width:  5, align: 'center' },
  { hdr: 'SW Unit Name',                  width: 22 },
  { hdr: 'Interface\nCategory',           width: 11, align: 'center' },
  { hdr: 'Interface(Variable)\nName',     width: 24 },
  { hdr: 'Variable\nType',               width: 11 },
  { hdr: 'Failure Mode\n(HAZOP)',         width: 11, align: 'center' },
  { hdr: 'Detail of the Failure Mode',   width: 40 },
  { hdr: 'Effect on Module',             width: 34 },
  { hdr: 'Effect on System',             width: 34 },
  { hdr: 'Effect on SG',                 width: 10 },
  { hdr: 'S',                            width:  4, align: 'center' },
  { hdr: 'Preventive Action',            width: 32 },
  { hdr: 'O',                            width:  4, align: 'center' },
  { hdr: 'Detection Action\n(Safety Mechanism)', width: 32 },
  { hdr: 'Test Method',                  width: 16 },
  { hdr: 'D',                            width:  4, align: 'center' },
  { hdr: 'RPN',                          width:  7, align: 'center' },
  { hdr: 'CM\nRequired',                 width:  9, align: 'center' },
  { hdr: 'Countermeasure',               width: 28 },
  { hdr: 'S\n(after)',                   width:  7, align: 'center' },
  { hdr: 'O\n(after)',                   width:  7, align: 'center' },
  { hdr: 'D\n(after)',                   width:  7, align: 'center' },
  { hdr: 'RPN\n(after)',                 width:  9, align: 'center' },
  { hdr: 'Target Date',                  width: 12 },
  { hdr: 'Responsibility',               width: 14 },
  { hdr: 'Source /\nConfidence',         width: 15, align: 'center' },
  { hdr: 'Review Status',                width: 13, align: 'center' },
]

// SOD / After / Meta 열 인덱스 (1-based for ExcelJS)
const SOD_COLS  = [11, 13, 16]          // S, O, D
const RPN_COL   = 17
const AFTER_COLS = [20, 21, 22, 23]
const META_COLS  = [26, 27]

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const session_id = url.searchParams.get('session_id')
    if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    const sourceParam = url.searchParams.get('source') // 'merged' | 'ai' | 'all' | null(auto)

    const [sessions, mergedCheck] = await Promise.all([
      query('SELECT * FROM pre_fmea_sessions WHERE id = $1', [session_id]),
      query("SELECT COUNT(*) AS cnt FROM pre_fmea_items WHERE session_id = $1 AND source = 'merged'", [session_id]),
    ])

    let sourceFilter: string
    if (sourceParam === 'merged') {
      sourceFilter = "source = 'merged'"
    } else if (sourceParam === 'all') {
      sourceFilter = "source IN ('ai','icd','merged','human')"
    } else {
      // 기본값: icd/ai 항목이 최종본 (option B)
      sourceFilter = "source IN ('ai','icd')"
    }
    const items = await query(
      `SELECT * FROM pre_fmea_items WHERE session_id = $1 AND ${sourceFilter} ORDER BY item_no NULLS LAST, id`,
      [session_id],
    )

    if (!sessions.length) return NextResponse.json({ error: '세션 없음' }, { status: 404 })
    const session = sessions[0]

    // ── 워크북 생성 ───────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Pre-FMEA System'
    wb.created = new Date()
    const ws = wb.addWorksheet('Pre-FMEA', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }],  // 헤더 3행 고정
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, paperSize: 9 },
    })

    // ── 열 너비 설정 ─────────────────────────────────────────────────────────
    ws.columns = COLS.map(c => ({ width: c.width }))

    // ── Row 1: 제목 행 ────────────────────────────────────────────────────────
    const titleRow = ws.addRow(['Failure Mode and Effects Analysis (Pre-FMEA)', ...Array(COLS.length - 1).fill(null)])
    ws.mergeCells(1, 1, 1, COLS.length)
    titleRow.height = 22
    const titleCell = titleRow.getCell(1)
    titleCell.font  = { name: 'Calibri', size: 13, bold: true, color: hex(CLR.titleFg) }
    titleCell.fill  = fill(CLR.titleBg)
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
    titleCell.border = border('1E3A5F')

    // ── Row 2: 컬럼 헤더 ─────────────────────────────────────────────────────
    const hdrRow = ws.addRow(COLS.map(c => c.hdr))
    hdrRow.height = 38
    hdrRow.eachCell((cell, colNo) => {
      let bgColor = CLR.hdr2Bg
      if (SOD_COLS.includes(colNo) || colNo === RPN_COL) bgColor = CLR.hdr2Sod
      else if (AFTER_COLS.includes(colNo))               bgColor = CLR.hdr2After
      else if (META_COLS.includes(colNo))                bgColor = CLR.hdr2Meta

      cell.font      = { name: 'Calibri', size: 9, bold: true, color: hex(CLR.hdr2Fg) }
      cell.fill      = fill(bgColor)
      cell.alignment = { vertical: 'middle', horizontal: COLS[colNo - 1]?.align ?? 'center', wrapText: true }
      cell.border    = border()
    })

    // ── Row 3: 빈 서브헤더 (구분선 역할) ─────────────────────────────────────
    const subRow = ws.addRow(Array(COLS.length).fill(null))
    subRow.height = 4
    subRow.eachCell(cell => {
      cell.fill   = fill('D6E4F7')
      cell.border = border()
    })

    // ── 데이터 행 ─────────────────────────────────────────────────────────────
    items.forEach((item, idx) => {
      const ov = (item.human_override ?? {}) as Record<string, unknown>
      const hs = Number(ov.human_severity)   || null
      const ho = Number(ov.human_occurrence) || null
      const hd = Number(ov.human_detection)  || null
      const rpnAfter = hs && ho && hd ? hs * ho * hd : null
      const confPct  = item.confidence_score != null ? `${Math.round(Number(item.confidence_score) * 100)}%` : ''
      const isPending = item.review_status === 'pending'
      const isEven    = idx % 2 === 1

      const rowData = [
        idx + 1,
        item.sw_component    ?? null,
        null,
        item.function_name   ?? null,
        null,
        item.failure_mode    ?? null,
        item.failure_detail  ?? null,
        item.effect_local    ?? null,
        item.effect_system   ?? null,
        item.effect_sg       ?? null,
        item.severity        ?? null,
        item.preventive_action ?? null,
        item.occurrence      ?? null,
        item.detection_action ?? null,
        null,
        item.detection       ?? null,
        item.rpn             ?? null,
        null,
        null,
        hs,
        ho,
        hd,
        rpnAfter,
        null,
        null,
        item.source ? `${item.source} / ${confPct}` : null,
        item.review_status   ?? null,
      ]

      const dataRow = ws.addRow(rowData)
      dataRow.height = 15

      dataRow.eachCell({ includeEmpty: true }, (cell, colNo) => {
        const col = COLS[colNo - 1]

        // 기본 배경
        let bg = isPending ? CLR.rowPend : isEven ? CLR.rowAlt : 'FFFFFF'

        // SOD 셀 강조
        if (SOD_COLS.includes(colNo)) bg = CLR.sodCell

        // RPN 색상
        if (colNo === RPN_COL) {
          const rpnColor_ = rpnColor(Number(item.rpn) || null)
          if (rpnColor_) bg = rpnColor_
        }
        if (colNo === 23) { // RPN after
          const rpnColor_ = rpnColor(rpnAfter)
          if (rpnColor_) bg = rpnColor_
        }

        cell.fill      = fill(bg)
        cell.font      = { name: 'Calibri', size: 9 }
        cell.alignment = {
          vertical: 'top',
          horizontal: col?.align ?? 'left',
          wrapText: true,
          shrinkToFit: false,
        }
        cell.border = border()

        // SOD / RPN 숫자 볼드
        if ((SOD_COLS.includes(colNo) || colNo === RPN_COL) && cell.value) {
          cell.font = { name: 'Calibri', size: 9, bold: true }
        }
        // pending 상태 이탤릭
        if (colNo === 27 && isPending) {
          cell.font = { name: 'Calibri', size: 9, italic: true, color: hex('B8860B') }
        }
        // accepted 상태 초록
        if (colNo === 27 && !isPending && item.review_status === 'accepted') {
          cell.font = { name: 'Calibri', size: 9, color: hex('1B5E20') }
        }
      })
    })

    // ── 자동 필터 ─────────────────────────────────────────────────────────────
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLS.length } }

    // ── 버퍼 출력 ─────────────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer()
    const safeName = String(session.name ?? 'export').replace(/[^a-zA-Z0-9가-힣_\-]/g, '_')
    const filename = encodeURIComponent(`PreFMEA_${safeName}_v${session.doc_version}.xlsx`)

    return new NextResponse(Buffer.from(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    })
  } catch (e) {
    console.error('[pre-fmea/export]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
