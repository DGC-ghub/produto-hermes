// Resolver, com segurança, QUAL configuração o simulador do dono vai usar (spec §7.4).
//
// Esta é a peça que a §7.4 chama de "resolução segura da candidata", e a regra que a
// governa é uma só: **quem chama passa apenas o `setupVersionId`**. O tenant vem da sessão
// autenticada, nunca do pedido. Aceitar `tenantId` do cliente seria oferecer, numa tela de
// teste, a configuração de outra empresa — e um id de versão é adivinhável o suficiente
// para valer a tentativa.
//
// Não executa nada. Não toca no motor, não grava, não publica. Só responde "posso testar
// esta versão, e com qual material?".

import { db } from '../../db.server'
import { parseTenantConfig, type TenantConfig } from '../attendant/tenant-config'
import type { KnowledgeDocument } from '../knowledge.server'
import { montarConfigFinal, type ProblemaDeArtefato, validarArtefatos } from './artefatos'
import { conhecimentoDaCandidata } from './preview'

/**
 * A fonte resolvida: config e conhecimento JUNTOS, de propósito.
 *
 * Separá-los deixaria aberto o erro que anula a etapa inteira: chamar o motor com a config
 * da candidata e a base que já está no ar. O dono testaria uma coisa e aprovaria outra.
 * Vindo num objeto só, quem executa recebe os dois ou nenhum.
 *
 * ⚠️ `config.knowledge.sourceDir` existe porque o tipo exige, mas NÃO deve ser lido no
 * preview: a base da candidata está em `conhecimento`. Ler o `sourceDir` traria a base
 * publicada — exatamente o que este objeto existe para impedir.
 */
export type FonteDoPreview = {
  versionId: string
  generation: number
  config: TenantConfig
  conhecimento: KnowledgeDocument[]
}

export type ResultadoDaFonte =
  | { tipo: 'ok'; fonte: FonteDoPreview }
  | { tipo: 'tenant_desconhecido' }
  /**
   * Versão inexistente **ou de outra empresa** — a mesma resposta para os dois casos, de
   * propósito. Responder "existe, mas não é sua" confirmaria a existência de um id alheio.
   */
  | { tipo: 'versao_desconhecida' }
  /** Existe e é sua, mas não é candidata testável. `ready_to_test` é o único estado. */
  | { tipo: 'nao_e_candidata'; estado: string }
  /** A versão não é mais a pendente do setup: linha incoerente, não se testa. */
  | { tipo: 'ponteiro_incoerente' }
  /** Ciclo virou: o que o cliente tem na tela é de antes da correção (§3.5, §4.8). */
  | { tipo: 'geracao_divergente'; atual: number }
  | { tipo: 'artefatos_invalidos'; problemas: ProblemaDeArtefato[] }

/** O único estado em que uma candidata pode ser testada pelo dono (§7.6, `owner_preview`). */
const ESTADO_TESTAVEL = 'ready_to_test'

/**
 * Resolve a fonte do preview a partir do id da versão.
 *
 * Confere, nesta ordem: tenant existe → versão existe E é deste tenant → é a pendente do
 * setup → está em `ready_to_test` → a geração é a que o cliente pensa → os artefatos ainda
 * são válidos. Só então monta a config final e traduz o conhecimento.
 *
 * A revalidação usa as MESMAS funções do processador e do claim de revisão
 * (`montarConfigFinal`, `validarArtefatos`). Reimplementar "válido" aqui criaria uma
 * terceira interpretação, e a que decide o que o dono aprova não pode ser a mais frouxa.
 *
 * ESTA FUNÇÃO NÃO RESOLVE A CONFIG PUBLICADA. A §7.2 diz que `owner_preview` pode usar a
 * publicada quando o tenant já está ativo — esse caminho é o que o motor já faz hoje
 * (`resolveTenantConfig`), e quem escolhe entre os dois é o gate, na etapa 8. Misturar as
 * duas responsabilidades aqui faria esta função decidir política de gate.
 */
export async function resolverFonteDoPreview(input: {
  tenantSlug: string
  setupVersionId: string
  /**
   * A geração que quem chama ACHA que está testando.
   *
   * O valor útil vem do cliente (do `contactId` do simulador, §10.3), não de uma leitura
   * fresca da mesma linha: comparar a linha consigo mesma nunca falha. É assim que uma aba
   * aberta antes de um ciclo de correção é barrada em vez de marcar validação na geração
   * errada.
   */
  generation: number
}): Promise<ResultadoDaFonte> {
  const tenant = await db.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true, slug: true },
  })
  if (!tenant) {
    return { tipo: 'tenant_desconhecido' }
  }

  // UMA consulta traz a versão e o ponteiro do setup: duas consultas separadas poderiam
  // atravessar uma publicação concorrente e ver metades de estados diferentes.
  const versao = await db.aiSetupVersion.findFirst({
    where: { id: input.setupVersionId, tenantId: tenant.id },
    select: {
      id: true,
      state: true,
      generation: true,
      candidateConfigJson: true,
      candidateKnowledgeJson: true,
      summaryJson: true,
      gapsJson: true,
      risksJson: true,
      validationJson: true,
      setup: { select: { reviewVersionId: true } },
    },
  })
  // `tenantId` está no `where`: uma versão de outra empresa não é encontrada, e o resultado
  // é indistinguível de id inexistente.
  if (!versao) {
    return { tipo: 'versao_desconhecida' }
  }
  if (versao.setup.reviewVersionId !== versao.id) {
    return { tipo: 'ponteiro_incoerente' }
  }
  if (versao.state !== ESTADO_TESTAVEL) {
    return { tipo: 'nao_e_candidata', estado: versao.state }
  }
  if (versao.generation !== input.generation) {
    return { tipo: 'geracao_divergente', atual: versao.generation }
  }

  const problemas = validarArtefatos(tenant.slug, versao)
  if (problemas.length > 0) {
    return { tipo: 'artefatos_invalidos', problemas }
  }

  // Daqui não lança: `validarArtefatos` acabou de atravessar este mesmo par de funções.
  const config = parseTenantConfig(
    tenant.slug,
    montarConfigFinal(tenant.slug, JSON.parse(versao.candidateConfigJson as string)),
  )
  const conhecimento = conhecimentoDaCandidata(
    tenant.slug,
    JSON.parse(versao.candidateKnowledgeJson as string),
  )

  return {
    tipo: 'ok',
    fonte: { versionId: versao.id, generation: versao.generation, config, conhecimento },
  }
}
