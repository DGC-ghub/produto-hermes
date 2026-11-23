import type { TenantConfig } from './tenant-config'

// Aviso fixo de que quem responde é uma assistente virtual. O contrato do piloto promete esse
// aviso na 1ª mensagem; ele fica no balcão (código), não no prompt: o modelo esquece, o código não.
export function avisoAssistente(nomeEmpresa: string): string {
  return `Olá! Sou a assistente virtual da ${nomeEmpresa}.`
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Garante o aviso na 1ª mensagem da conversa (histórico vazio) de quem liga `avisoAssistente`.
 * Se a resposta já se apresenta como assistente virtual, não repete. Função pura.
 */
export function comAvisoDeAssistente(
  reply: string,
  opcoes: {
    config: Pick<TenantConfig, 'avisoAssistente' | 'businessProfile'>
    primeiraMensagem: boolean
  },
): string {
  if (!opcoes.config.avisoAssistente || !opcoes.primeiraMensagem) return reply
  if (semAcento(reply).includes('assistente virtual')) return reply
  return `${avisoAssistente(opcoes.config.businessProfile.name)} ${reply}`
}
