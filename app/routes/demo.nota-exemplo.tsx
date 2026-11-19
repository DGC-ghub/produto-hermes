import type { Route } from './+types/demo.nota-exemplo'

// Arquivos de EXEMPLO da demo sem chave. Sem valor fiscal. Nada de dado real.
function pdfMinimo(texto: string): string {
  const conteudo = `BT /F1 14 Tf 50 750 Td (${texto}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offs: number[] = []
  objs.forEach((o, i) => {
    offs.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offs) {
    out += `${String(o).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const tipo = url.searchParams.get('tipo')
  if (tipo === 'xml') {
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><nfse><aviso>NOTA DE TESTE - SEM VALOR FISCAL</aviso></nfse>',
      { headers: { 'Content-Type': 'application/xml' } },
    )
  }
  return new Response(pdfMinimo('NOTA DE TESTE - HOMOLOGACAO - SEM VALOR FISCAL'), {
    headers: { 'Content-Type': 'application/pdf' },
  })
}
