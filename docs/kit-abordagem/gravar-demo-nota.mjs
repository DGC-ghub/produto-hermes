// Grava o vídeo vertical da Nota automática (DGC-357). Só na gravação: esconde marcas técnicas e textos
// em inglês e troca textos de tela. Dados fictícios, emissor falso (simulador). Nada disto altera a demo pública.
// Uso: PW_DIR=/caminho/com/playwright BASE=http://127.0.0.1:5199 node gravar-demo-nota.mjs <pasta-saida>
import { createRequire } from 'node:module'

const require = createRequire(`${process.env.PW_DIR ?? '.'}/`)
const { chromium, devices } = require('playwright')

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
const OUT = process.argv[2] ?? 'out-nota'
const LEGENDA = 'Demonstração com dados fictícios · nota de teste, sem valor fiscal'

const b = await chromium.launch()
const c = await b.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  recordVideo: { dir: `${OUT}/raw`, size: { width: 390, height: 844 } },
})

await c.addInitScript(
  ({ legenda }) => {
    const css = `
      main > header, main > section:nth-of-type(1), main > section:nth-of-type(2) { display:none!important }
      main { padding: 64px 14px 56px !important; space-y: 0 }
      p.text-xs.opacity-70, div.border-gray-200.bg-white.p-3 { display:none!important }
      #dgc-top{position:fixed;top:0;left:0;right:0;z-index:9999;background:#0f172a;color:#fff;font:600 14px/1.25 system-ui;padding:10px 12px;text-align:center}
      #dgc-top small{display:block;font-weight:400;font-size:10.5px;opacity:.8;margin-top:3px}
      #dgc-fim{flex-direction:column;position:fixed;inset:0;z-index:10000;background:#0f172a;color:#fff;display:none;align-items:center;justify-content:center;text-align:center;padding:32px;font:700 24px/1.3 system-ui}
      #dgc-fim small{display:block;font-weight:400;font-size:13px;opacity:.75;margin-top:18px}
    `
    const montar = () => {
      if (!document.head || !document.body) return
      if (!document.getElementById('dgc-css')) {
        const s = document.createElement('style')
        s.id = 'dgc-css'
        s.textContent = css
        document.head.appendChild(s)
      }
      if (!document.getElementById('dgc-top')) {
        const t = document.createElement('div')
        t.id = 'dgc-top'
        document.body.appendChild(t)
      }
      if (!document.getElementById('dgc-fim')) {
        const f = document.createElement('div')
        f.id = 'dgc-fim'
        document.body.appendChild(f)
      }
      const cap = localStorage.getItem('dgc-cap') ?? ''
      const top = document.getElementById('dgc-top')
      const html = `${cap}<small>${legenda}</small>`
      if (top.innerHTML !== html) top.innerHTML = html
      const fim = localStorage.getItem('dgc-fim')
      const f = document.getElementById('dgc-fim')
      f.style.display = fim ? 'flex' : 'none'
      if (fim && f.innerHTML !== fim) f.innerHTML = fim
      // textos de tela (só na gravação)
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        let v = n.nodeValue
        const o = v
        v = v
          .replace(/00020126FAKE-PIX-DE-TESTE-\d+-\S+/g, '00020126…PIX-COPIA-E-COLA-DE-TESTE')
          .replace(/A prefeitura recusou a nota/g, 'O emissor recusou a nota')
          .replace(/Sem chave: simular pagamento e resposta da prefeitura:/g, 'Simular o pagamento do paciente:')
          .replace(/^\s*PDF: \S+/gm, '📄 nota-de-teste.pdf')
          .replace(/^\s*XML: \S+\n?/gm, '')
          .replace(/\[Aviso para a recepção\]/g, '🔔 Aviso para a recepção:')
        if (v !== o) n.nodeValue = v
      }
      for (const el of document.querySelectorAll('button')) {
        if (el.textContent.trim() === 'Rejeitada sem motivo') el.style.display = 'none'
      }
    }
    setInterval(montar, 150)
    document.addEventListener('DOMContentLoaded', montar)
    new MutationObserver(montar).observe(document, { childList: true, subtree: true })
    montar()
  },
  { legenda: LEGENDA },
)

const p = await c.newPage()
p.setDefaultTimeout(60000)
const t0 = Date.now()
const marca = (nome) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${nome}`)
const cap = (texto) =>
  p.evaluate((t) => localStorage.setItem('dgc-cap', t), texto)
const pausa = (ms) => p.waitForTimeout(ms)
const rolarFim = () => p.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))

async function abrir(id, legenda) {
  await p.goto(`${BASE}/demo/chat?tenant=dgc&conversationId=${id}`)
  await p.evaluate(() => localStorage.removeItem('dgc-fim'))
  await cap(legenda)
}

async function cobrar() {
  await cap('2 · A recepção gera o Pix de teste')
  await p.getByRole('button', { name: /gerar Pix de teste/ }).scrollIntoViewIfNeeded()
  await pausa(2500)
  await p.getByRole('button', { name: /gerar Pix de teste/ }).click()
  await p.waitForSelector('text=Pague pelo Pix')
  await rolarFim()
  await pausa(6000)
}

// ===== Cena A: nota autorizada (≈ 40 s) =====
await p.goto(`${BASE}/demo/chat?tenant=dgc`)
await p.evaluate(() => localStorage.clear())
await abrir('conv-nota-a', '1 · O paciente termina o atendimento')
await pausa(5000)
marca('conversa ok')
await cobrar()
marca('pix ok')
await cap('3 · O paciente paga (simulado) e a nota sai sozinha')
await p.getByRole('button', { name: 'Nota autorizada' }).scrollIntoViewIfNeeded()
await pausa(3500)
await p.getByRole('button', { name: 'Nota autorizada' }).click()
await p.waitForSelector('text=Pagamento confirmado')
await cap('4 · O PDF chega ao paciente no WhatsApp')
await rolarFim()
await pausa(13000)
marca('nota ok')

// ===== Cena B: nota rejeitada (≈ 10 s) =====
await abrir('conv-nota-b', '5 · Outro paciente: a nota é rejeitada')
await pausa(2500)
await p.getByRole('button', { name: /gerar Pix de teste/ }).scrollIntoViewIfNeeded()
await p.getByRole('button', { name: /gerar Pix de teste/ }).click()
await p.waitForSelector('button:has-text("Nota rejeitada")')
await pausa(2500)
await p.getByRole('button', { name: 'Nota rejeitada', exact: true }).click()
await cap('5 · A recepção vê o motivo em português')
await p.waitForSelector('text=Aviso para a recepção')
await p.waitForTimeout(300)
await p.getByText('recusou a nota').last().scrollIntoViewIfNeeded()
await rolarFim()
await p.screenshot({ path: `${OUT}/quadro_rejeitada.png` })
await pausa(8500)
marca('rejeitada ok')

// ===== Fecho =====
await p.evaluate(() => {
  localStorage.setItem(
    'dgc-fim',
    'Nota automática da DGC<br/>o paciente paga, a nota sai e chega no WhatsApp.<small>Demonstração com dados fictícios · nota de teste, sem valor fiscal</small>',
  )
})
await pausa(11000)
marca('fim')
await p.screenshot({ path: `${OUT}/quadro_fecho.png` })
await c.close()
await b.close()
