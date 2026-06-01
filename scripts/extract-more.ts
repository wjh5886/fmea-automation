import mammoth from 'mammoth'
import fs from 'fs'
import path from 'path'

const SESSION = '263a3e7c-460a-4a2f-998d-99f079137c3f'
const BASE = `data/uploads/${SESSION}`

async function extractComp(allText: string, compName: string, chars = 800): Promise<string> {
  const idx = allText.indexOf(compName + '[')
  if (idx < 0) return '(미발견)'
  return allText.slice(idx, idx + chars).replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

async function main() {
  const specDir = path.join(BASE, 'design_spec')
  let allText = ''
  for (const f of fs.readdirSync(specDir)) {
    const buf = fs.readFileSync(path.join(specDir, f))
    const r = await mammoth.extractRawText({ buffer: buf as any })
    allText += r.value
  }

  const targets = [
    'CstAp_MoodControlMgt',
    'CstAp_DIDMgt',
    'CstAp_DtcMgt',
    'BswIF_ECUModeCntl',
    'BswIF_IoHwAb',
    'BswIF_NvM',
    'BswIF_Sbc',
    'BswIF_WdgM',
    'BswIF_SafetyLib',
    'BswIF_Dcm_19_RDTCI',
    'BswIF_Dcm_22_2E_RWDID',
    'BswIF_Dcm_27_SA',
    'CstAP_VehicleReset_Mgt',
    'BswIF_Dcm_28_CC',
    'BswIF_Dcm_31_RC',
  ]

  for (const comp of targets) {
    const snippet = await extractComp(allText, comp, 1000)
    console.log(`\n${'='.repeat(50)}`)
    console.log(`[${comp}]`)
    console.log(snippet.slice(0, 900))
  }
}
main().catch(console.error)
