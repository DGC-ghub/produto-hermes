// "Este banco é descartável?" — a pergunta que decide se o gerador de mentira pode rodar.
//
// Ela olha o FILESYSTEM, não a string. Comparar prefixo de caminho parece bastar e não
// basta: `/tmp/teste.db` pode ser um symlink para o `dev.db` do repositório, que no Pi é o
// banco do serviço em produção. Quem escreve é o inode, não o texto que a pessoa digitou.
//
// A regra é uma allowlist estreita e a resposta padrão é NÃO. O custo de errar não é
// simétrico: negar a mais custa um `export`; negar a menos grava configuração de mentira
// na empresa de alguém.
import { realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * O caminho do arquivo por trás de uma `DATABASE_URL` de SQLite.
 *
 * `null` quando não é `file:` — e aí não dá para afirmar nada sobre descartabilidade.
 */
export function caminhoDoBanco(url: string | undefined): string | null {
  if (!url?.startsWith('file:')) {
    return null
  }
  const bruto = url.slice('file:'.length)
  return bruto.length > 0 ? path.resolve(bruto) : null
}

/**
 * O que pode ser IMPRESSO sobre o banco em uso.
 *
 * Uma `DATABASE_URL` que não é SQLite carrega usuário e senha no próprio texto. Ela não
 * vai para a tela nem para o log: o operador precisa saber que não é SQLite, não precisa
 * ver a credencial.
 *
 * Para SQLite mostra o caminho absoluto — e o caminho REAL junto, quando são diferentes.
 * Se alguém apontou para um symlink, quem manda é o destino, e é ele que precisa aparecer.
 */
export function descreverBanco(url: string | undefined): string {
  if (url === undefined) {
    return 'file:./dev.db (default do db.server — nenhuma DATABASE_URL definida)'
  }
  const caminho = caminhoDoBanco(url)
  if (caminho === null) {
    return '(banco não-SQLite — endereço omitido porque a URL carrega credencial)'
  }
  try {
    const real = realpathSync(caminho)
    return real === caminho ? caminho : `${caminho} → ${real}`
  } catch {
    return `${caminho} (ainda não existe)`
  }
}

/** Por que um banco NÃO é descartável. Vira mensagem para quem está no terminal. */
export type MotivoNaoDescartavel =
  | 'nao_e_sqlite'
  | 'nao_existe'
  | 'nao_e_arquivo_regular'
  | 'fora_do_tmp'
  | 'tem_hardlink'

export type VeredictoDoBanco =
  | { descartavel: true; caminhoReal: string }
  | { descartavel: false; motivo: MotivoNaoDescartavel }

/**
 * O banco é seguramente descartável?
 *
 * Exige que o arquivo JÁ EXISTA — o procedimento manda rodar `prisma db push` antes, e
 * exigir a existência é o que permite resolver symlink e conferir o inode. Sem arquivo não
 * há o que provar, e sem prova a resposta é não.
 *
 * `nlink > 1` recusa hardlink: um hardlink não é symlink e o `realpath` não o desfaz, mas
 * escrever nele escreve no arquivo de produção do mesmo jeito.
 */
export function avaliarBanco(
  url: string | undefined,
  /**
   * A raiz do que se considera descartável. Injetável só para teste: a regra do separador
   * ("/tmpfoo não está dentro de /tmp") precisa de um diretório irmão da raiz, e criar
   * `/tmpfoo` de verdade exige root.
   */
  raizDescartavel?: string,
): VeredictoDoBanco {
  const caminho = caminhoDoBanco(url)
  if (caminho === null) {
    return { descartavel: false, motivo: 'nao_e_sqlite' }
  }

  let real: string
  try {
    real = realpathSync(caminho)
  } catch {
    return { descartavel: false, motivo: 'nao_existe' }
  }

  let info: ReturnType<typeof statSync>
  try {
    info = statSync(real)
  } catch {
    return { descartavel: false, motivo: 'nao_existe' }
  }
  if (!info.isFile()) {
    return { descartavel: false, motivo: 'nao_e_arquivo_regular' }
  }

  // O `/tmp` REAL: em alguns sistemas ele próprio é um link (`/tmp → /private/tmp`).
  // Comparar contra o texto "/tmp" deixaria passar (ou barraria) pelo motivo errado.
  const tmpReal = raizDescartavel ?? realpathSync(tmpdir())
  if (real !== tmpReal && !real.startsWith(`${tmpReal}${path.sep}`)) {
    return { descartavel: false, motivo: 'fora_do_tmp' }
  }
  if (info.nlink > 1) {
    return { descartavel: false, motivo: 'tem_hardlink' }
  }

  return { descartavel: true, caminhoReal: real }
}

/** O texto que explica a recusa para quem está no terminal. */
export function explicarRecusa(motivo: MotivoNaoDescartavel): string {
  switch (motivo) {
    case 'nao_e_sqlite':
      return 'não é um banco SQLite (`file:`)'
    case 'nao_existe':
      return 'o arquivo não existe — rode o `prisma db push` primeiro, é ele que prova onde o banco fica'
    case 'nao_e_arquivo_regular':
      return 'o caminho não é um arquivo regular'
    case 'fora_do_tmp':
      return 'o arquivo REAL não está dentro do diretório temporário do sistema'
    case 'tem_hardlink':
      return 'o arquivo tem mais de um nome no disco (hardlink) — escrever nele escreve no outro também'
  }
}
