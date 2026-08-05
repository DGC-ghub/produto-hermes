// Backfill do setup de IA para os tenants que já existiam (spec §8.1).
//
// DRY-RUN POR PADRÃO: sem `--aplicar` nada é escrito, só o plano é impresso. É de propósito —
// este comando decide quais números de WhatsApp continuam no ar quando o gate ligar, e a
// conferência tenant a tenant tem de acontecer ANTES de qualquer escrita.
//
// Uso:
//   npm run setup:backfill                  # imprime o plano (não escreve nada)
//   npm run setup:backfill -- --aplicar     # aplica
//
// `--sim` FOI REMOVIDO e agora aborta com erro (nunca aplica). Aqui ele significava "sim,
// aplique"; nos comandos da fila (`setup:processar`) significa "simular". Mesmo prefixo,
// efeitos opostos: quem aprendesse o sentido da fila escreveria em produção achando que
// estava simulando. O flag de aplicação é sempre explícito — `--aplicar`.
//
// O banco usado é o do DATABASE_URL — impresso no cabeçalho, porque no Pi o dev.db é o
// banco do serviço em produção.

// Import de TIPO é apagado na compilação: não carrega módulo nem lê DATABASE_URL antes
// do loadEnvFile abaixo. Os imports de VALOR continuam dinâmicos, depois dele.
import type { TenantSnapshot } from '../app/lib/setup/backfill'

try {
  process.loadEnvFile()
} catch {
  // sem .env — segue com o ambiente do shell
}

const argv = process.argv.slice(2)

// `--sim` aborta em vez de virar dry-run silencioso: silêncio viraria "rodei e não fez nada",
// e o operador repetiria às cegas até achar o flag que escreve. O erro diz qual é.
if (argv.includes('--sim')) {
  console.error(
    '\n`--sim` não existe mais no setup:backfill.\n' +
      '  Aqui ele significava "sim, aplique"; em setup:processar significa "simular".\n' +
      '  Para APLICAR (escreve no banco):  npm run setup:backfill -- --aplicar\n' +
      '  Para só ver o plano (dry-run):    npm run setup:backfill\n' +
      '\nNada foi lido nem escrito.\n',
  )
  process.exit(1)
}

const aplicar = argv.includes('--aplicar')

// Imports dinâmicos DEPOIS do loadEnvFile: o client do banco lê DATABASE_URL no import.
const { db } = await import('../app/db.server')
const { DEMO_TENANT_SLUGS } = await import('../app/lib/tenants.server')
const { planTenantBackfill, summarizeBackfill } = await import('../app/lib/setup/backfill')
const { resolveTenantConfig } = await import('../app/lib/attendant/tenant-config-db.server')
const { serializeTenantConfig, safeDefaultConfig } = await import(
  '../app/lib/attendant/tenant-config'
)
const { listKnowledgeDocs } = await import('../app/lib/knowledge-db.server')

const dbPath = (process.env.DATABASE_URL ?? '(não definido)').replace('file:', '')
console.log(`\nBanco:  ${dbPath}`)
console.log(`Modo:   ${aplicar ? '⚠️  APLICAR (--aplicar)' : 'dry-run (nada será escrito)'}\n`)

const tenants = await db.tenant.findMany({ orderBy: { createdAt: 'asc' } })
if (tenants.length === 0) {
  console.log('Nenhum tenant no banco. Nada a fazer.')
  await db.$disconnect()
  process.exit(0)
}

// ── Levantamento ────────────────────────────────────────────────────────────
type Linha = {
  snapshot: TenantSnapshot
  tenantId: string
  jaTemSetup: boolean
}

const linhas: Linha[] = []
for (const tenant of tenants) {
  const [docs, canais, numeros, setupExistente] = await Promise.all([
    listKnowledgeDocs(tenant.slug),
    db.channelSession.count({ where: { tenantId: tenant.id, status: 'conectado' } }),
    db.whatsappNumber.count({ where: { tenantId: tenant.id, NOT: { accessTokenEnc: null } } }),
    db.aiSetup.findUnique({ where: { tenantId: tenant.id }, select: { id: true } }),
  ])
  linhas.push({
    tenantId: tenant.id,
    jaTemSetup: setupExistente !== null,
    snapshot: {
      slug: tenant.slug,
      isDemo: DEMO_TENANT_SLUGS.includes(tenant.slug),
      knowledgeDocCount: docs.length,
      connectedChannelCount: canais,
      ownTokenNumberCount: numeros,
    },
  })
}

// ── Plano ───────────────────────────────────────────────────────────────────
const planos = linhas.map((linha) => ({ ...linha, plan: planTenantBackfill(linha.snapshot) }))
const resumo = summarizeBackfill(planos.map((p) => p.plan))

const col = (texto: string, largura: number) => texto.padEnd(largura)
console.log(
  col('TENANT', 26) +
    col('DOCS', 6) +
    col('CANAL', 7) +
    col('DESTINO', 9) +
    col('GF', 4) +
    'MOTIVO',
)
console.log('─'.repeat(110))
for (const { snapshot, plan, jaTemSetup } of planos) {
  const canal = snapshot.connectedChannelCount + snapshot.ownTokenNumberCount
  console.log(
    col(snapshot.slug + (jaTemSetup ? ' *' : ''), 26) +
      col(String(snapshot.knowledgeDocCount), 6) +
      col(canal > 0 ? `sim(${canal})` : 'não', 7) +
      col(plan.state, 9) +
      col(plan.grandfathered ? 'sim' : '—', 4) +
      plan.reason,
  )
}

console.log(
  `\n${resumo.total} tenants → ${resumo.active} active, ${resumo.draft} draft, ` +
    `${resumo.grandfathered} grandfathered, ${resumo.needsAssistedReview} exigem revisão assistida`,
)

const jaExistentes = planos.filter((p) => p.jaTemSetup)
if (jaExistentes.length > 0) {
  console.log(`\n* ${jaExistentes.length} tenant(s) já têm AiSetup — serão PULADOS (idempotente).`)
}
const atencao = planos.filter((p) => p.plan.needsAssistedReview)
if (atencao.length > 0) {
  console.log('\n⚠️  Atendendo sem base de conhecimento (exceção temporária, revisar):')
  for (const { snapshot } of atencao) {
    console.log(`   - ${snapshot.slug}`)
  }
}

if (!aplicar) {
  console.log(
    '\nDry-run: nada foi escrito. Confira tenant a tenant e rode com --aplicar para aplicar.',
  )
  await db.$disconnect()
  process.exit(0)
}

// ── Aplicação ───────────────────────────────────────────────────────────────
console.log('\nAplicando...\n')
let criados = 0
let pulados = 0

for (const { tenantId, snapshot, plan, jaTemSetup } of planos) {
  if (jaTemSetup) {
    console.log(`  ${snapshot.slug}: já tem AiSetup — pulado`)
    pulados += 1
    continue
  }

  // A versão sintetizada guarda o estado ATUAL como se fosse a publicada: é o que faz
  // `publishedVersionId` nunca ser nulo num tenant `active` (INV-1) e dá ao rollback um
  // ponto de retorno. `answersJson` fica vazio — o tenant nunca respondeu o questionário.
  const config = (await resolveTenantConfig(snapshot.slug)) ?? safeDefaultConfig(snapshot.slug)
  const docs = await listKnowledgeDocs(snapshot.slug)
  const agora = new Date()

  await db.$transaction(
    async (tx) => {
      const setup = await tx.aiSetup.create({
        data: {
          tenantId,
          grandfathered: plan.grandfathered,
          grandfatheredAt: plan.grandfathered ? agora : null,
          activatedAt: plan.activated ? agora : null,
        },
      })

      const version = await tx.aiSetupVersion.create({
        data: {
          setupId: setup.id,
          tenantId,
          state: plan.state,
          origin: 'onboarding',
          generation: 0,
          basePublishedVersionId: null, // nunca houve versão anterior
          answersJson: JSON.stringify({}),
          ...(plan.state === 'active'
            ? {
                candidateConfigJson: serializeTenantConfig(config),
                candidateKnowledgeJson: JSON.stringify(
                  docs.map((d) => ({ title: d.title, content: d.content, position: d.position })),
                ),
                publishedAt: agora,
              }
            : {}),
        },
      })

      if (plan.state === 'active') {
        await tx.aiSetup.update({
          where: { id: setup.id },
          data: { publishedVersionId: version.id },
        })
      }

      await tx.aiSetupEvent.create({
        data: {
          tenantId,
          versionId: version.id,
          kind: plan.grandfathered ? 'grandfathered' : 'published',
          actor: 'system',
          detail: JSON.stringify({ backfill: true, reason: plan.reason, state: plan.state }),
        },
      })
    },
    { maxWait: 20_000, timeout: 20_000 },
  )

  console.log(`  ${snapshot.slug}: ${plan.state}${plan.grandfathered ? ' + grandfathered' : ''}`)
  criados += 1
}

console.log(`\n${criados} criado(s), ${pulados} pulado(s).`)
await db.$disconnect()
