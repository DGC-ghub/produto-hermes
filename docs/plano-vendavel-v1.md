# 🛒 Plano — Hermes vendável v1 (SaaS self-service pra PME)

> **Estratégia travada (decisão do dono, 2026-07-09):**
> - **Cliente-alvo:** PME ampla que vive no WhatsApp (clínicas, assistências, salões, escritórios, lojas).
> - **Conexão WhatsApp:** **os dois** — QR (não-oficial/Baileys) como **padrão self-service**, oficial (Meta Cloud API) como **opção** pra quem precisa de robustez (ex.: saúde).
> - **Meta do produto:** um estranho **se cadastra, conecta o WhatsApp em 2 min, e paga — sem o dono rodar nada.**
> - CS MED = estudo de caso / depoimento, **não** dependência do cronograma.

Este doc é a **spec do Bloco 1** (o canal WhatsApp — o desbloqueio nº1) + o escopo dos Blocos 2 e 3.

---

## 0. Por que o canal é o Bloco 1

Hoje só existe o caminho **oficial da Meta**: o cliente precisa de conta Meta Business, verificar número e passar pela aprovação da Meta — **semanas de burocracia por cliente**, o que mata o self-service. O **QR (Baileys)** deixa o cliente escanear um código e estar no ar em 2 minutos. Sem isso, não há venda self-service; por isso é o primeiro e maior bloco.

**Trade-off assumido:** o canal não-oficial pode ser banido pela Meta. Mitigações no §1.6. Pra saúde/empresas maiores, oferecemos o oficial.

---

## 1. Bloco 1 — Canal WhatsApp (abstração + QR/Baileys + oficial)

### 1.1 Estado atual (fatos, com file:line)

| Peça | Como é hoje | Ref |
|---|---|---|
| Inbound | webhook `POST` → rate-limit → `verifyWebhookSignature` (HMAC `x-hub-signature-256`) → `parseInboundMessages` → `persistInbound` → `drainPending` | `app/routes/webhook.whatsapp.tsx:29-58` |
| Formato inbound | `InboundMessage { from, phoneNumberId, messageId, kind:'text'\|'unsupported', text?, mediaType? }` | `app/lib/whatsapp.server.ts:56-101` |
| Outbound | `sendWhatsAppMessage(to, text, phoneNumberId?)` → `POST graph.facebook.com/v21.0/{numberId}/messages`, Bearer, envelope `messaging_product:whatsapp/type:text`; best-effort→boolean | `app/lib/whatsapp.server.ts:214-254` |
| Credencial | `resolveWhatsappCredential(phoneNumberId)` decifra `accessTokenEnc/appSecretEnc` (AAD `tenant:<id>`), fallback env | `app/lib/whatsapp-credential.server.ts:36-57` |
| Fila | `WebhookEvent` DB (pending→processing→done/failed), dedup `messageId @unique`, claim atômico, sweeper 60s `unref()`, `MAX_ATTEMPTS=5`, stale 10min | `app/lib/whatsapp-queue.server.ts:20,134-182,214-223` |
| Runtime | **um** processo Node stateless (`server.js`, systemd `Type=simple`); a fila vive dentro dele; sweeper sobe no load do módulo | `server.js:27-42`, `deploy/hermes.service:20` |
| Cifra (M4.1) | `encryptSecret(plain, context)` / `decryptSecret(stored, context)`, AES-256-GCM, chave via scrypt(`SESSION_SECRET`), AAD = context | `app/lib/crypto.server.ts:27,39` |
| Roteamento | `phoneNumberId` (Meta) é a chave em TUDO: `WhatsappNumber.phoneNumberId @unique → tenantId`, `WebhookEvent.phoneNumberId`, envio | `prisma/schema.prisma:34-49,143-157` |
| Canal genérico | só existe `Conversation.channel String @default("simulator")` | `prisma/schema.prisma:67` |

**Fronteira de acoplamento Meta** (o que a abstração desgruda): (1) `phoneNumberId` como chave — Baileys não tem, usa socket/sessão por número; (2) a URL/envelope/Bearer do envio; (3) o webhook+HMAC do inbound; (4) o modelo de credencial `{accessToken, appSecret}` — Baileys usa **auth-state** (creds+keys) por número, via QR/pareamento.

### 1.2 A abstração de canal (o coração)

Introduzir uma interface única que **os dois** adaptadores implementam. O motor (`processIncomingMessage`) **não muda** — continua recebendo `tenantSlug` + texto e devolvendo `reply`.

```ts
// app/lib/channels/types.ts
export type ChannelKind = 'meta' | 'baileys'

// Evento normalizado de entrada — MESMO shape pros dois canais.
export type InboundEvent = {
  tenantSlug: string        // já resolvido (Baileys sabe direto; Meta resolve por phoneNumberId)
  contactId: string         // telefone do cliente (from / jid)
  messageId: string         // wamid (Meta) | key.id (Baileys) — dedup
  kind: 'text' | 'unsupported'
  text?: string
  mediaType?: string
}

export interface MessagingChannel {
  readonly kind: ChannelKind
  // envia texto; best-effort → boolean (contrato de que a fila e o operator-reply dependem)
  sendText(ref: ChannelRef, to: string, text: string): Promise<boolean>
}
// ChannelRef = { kind:'meta', phoneNumberId } | { kind:'baileys', sessionId }
```

- **`metaChannel`** = o código atual (extrair o corpo de `sendWhatsAppMessage` como `metaChannel.sendText`; inbound = webhook→parse).
- **`baileysChannel`** = novo (socket por sessão; inbound = evento do socket).
- **Dispatcher** `sendReply(channelRef, to, text)` escolhe o adapter por `channelRef.kind`. `sendWhatsAppMessage` vira um alias fino pra `metaChannel` (compat com os pilotos) OU é substituído pelo dispatcher onde a conversa souber o canal.

### 1.3 Schema — `ChannelSession` (novo, pro Baileys)

`WhatsappNumber` (Meta) fica intacto. Baileys ganha um model próprio (não tem `phoneNumberId` estável do jeito Meta):

```prisma
model ChannelSession {
  id            String   @id @default(cuid())
  tenantId      String
  kind          String   // 'baileys' (futuro: outros)
  label         String?  // ex.: "WhatsApp da recepção"
  waNumber      String?  // número conectado (preenchido após parear) — exibição/dedup
  status        String   @default("desconectado") // desconectado|pareando|conectado|derrubado
  authStateEnc  String?  // auth-state do Baileys CIFRADO (crypto.server, AAD tenant:<id>)
  lastConnAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  @@index([tenantId])
  @@index([status])
}
```

- **Roteamento inbound Baileys:** o socket **já é** de um tenant → o `InboundEvent.tenantSlug` vem direto da `ChannelSession`, sem resolver por `phoneNumberId`. Isso simplifica.
- **Fila:** generalizar `WebhookEvent` pra carregar a origem: adicionar `channelSessionId String?` (nullable). O drain resolve `tenantSlug` por `phoneNumberId` (Meta) **ou** por `ChannelSession.tenantId` (Baileys). Dedup por `messageId @unique` continua valendo (Baileys dá `key.id`).

### 1.4 O gerenciador de sockets (`baileys.server.ts`)

Baileys segura **um WebSocket por sessão conectada**. Precisa de um gerente in-process (como o sweeper hoje), no **mesmo** `server.js`:

- **No boot:** carrega toda `ChannelSession` `status='conectado'`, decifra `authStateEnc`, reconecta cada socket. (idempotente; guard em `globalThis` contra subida dupla, igual ao sweeper `:214-223`).
- **Novo pareamento:** `startPairing(tenantId, label)` cria/reusa uma `ChannelSession` `status='pareando'`, abre o socket e captura o evento `connection.update → qr`. O QR fica num **mapa em memória** `sessionId → { qr, status }` pra tela ler.
- **Eventos do socket:**
  - `connection.update`: `qr` (novo QR), `open` (→ `conectado`, persiste `authStateEnc` + `waNumber`), `close` (→ reconnect automático se não foi logout; se `loggedOut`, `status='derrubado'` e limpa auth).
  - `creds.update`: re-cifra e persiste o auth-state (via um **auth-state custom**, §1.5).
  - `messages.upsert`: normaliza pro `InboundEvent` (com `tenantSlug` da sessão) → `persistInbound` (mesma fila) → `drainPending`.
- **Envio:** `baileysChannel.sendText({sessionId}, to, text)` = `sock.sendMessage(jid(to), { text })`; best-effort→boolean.
- **Encerrar:** `disconnect(sessionId)` fecha o socket e marca `desconectado` (mantém auth p/ reconectar) ou `logout` (limpa auth).

### 1.5 Auth-state cifrado (reusa M4.1)

Baileys por padrão grava o auth-state em disco (`useMultiFileAuthState`). Vamos implementar um **auth-state custom** que serializa creds+keys e grava **cifrado no banco** (`ChannelSession.authStateEnc` via `encryptSecret(json, 'tenant:<id>')`). Assim: segredo por-tenant, fora de disco solto, e reconexão sem re-escanear. Decifra fail-safe (se `SESSION_SECRET` mudar, não conecta com lixo — marca `derrubado` e pede novo QR).

### 1.6 Tela `/canais` (self-service)

Padrão das telas internas (`requireOwner`, `<AppShell>` — igual `conectar-whatsapp.tsx:19-26`):
- Lista as `ChannelSession` do tenant (status colorido: pareando/conectado/derrubado).
- **"Conectar por QR"** → `startPairing` → mostra o **QR** (loader faz poll do mapa em memória a cada ~2s, ou SSE) → quando `conectado`, some o QR e mostra ✅.
- Botões **reconectar** / **desconectar**.
- A `/conectar-whatsapp` (oficial, token) vira a aba **"avançado / oficial"**.

### 1.7 Riscos & decisões

| Risco | Mitigação |
|---|---|
| **Ban do número (Baileys)** | avisar o cliente no onboarding; ritmo humano de envio; **oficial** disponível pra quem exige (saúde). Não usar Baileys em base de saúde crítica. |
| **Memória no Pi** — N sockets persistentes | medição real: **~449Mi livres / ~1.9Gi disponíveis** (não os 114MB de uma medição antiga). Baseline = medir o RSS de importar o Baileys com 0 sockets + o delta por-socket no 1º cliente. **Lazy-import do gerente só quando existe ≥1 sessão Baileys.** Escala grande → VPS (já previsto). |
| **Dependência nova (`@whiskeysockets/baileys`)** | é o mecanismo que o dono aprovou (estratégia QR). Registrar no `package.json`; sem ela, o canal Baileys fica desligado (Meta segue funcionando). |
| **Socket morre e ninguém percebe** | `connection.update/close` → reconnect automático + `status` no banco + alarme (`reportDegradation`) quando derruba; a tela mostra o estado. |
| **Processo reinicia** | boot reconecta todas as sessões `conectado` do auth-state cifrado (sem re-escanear). |

---

## 2. Bloco 2 — O que VENDE (landing + demo) — rápido, paralelo

- **Landing que converte** (`home.tsx`): hoje o CTA leva a `/login` (beco). Trocar por: **dor** ("seu WhatsApp perde cliente") → **demo instantâneo** → **preço** → **"conecte seu WhatsApp"**.
- **Demo como herói:** o `/demo/chat` já existe e é o melhor vendedor — promover pra dobradinha "veja funcionando com a cara do seu negócio".
- Prova social (quando houver): CS MED / primeiros clientes.

## 3. Bloco 3 — Cobrar de verdade (80% pronto)

- Conta **Mercado Pago de produção** + **domínio próprio** (MP exige) + ligar o **gate de cobrança** (`BILLING_GATE_ENABLED`, hoje OFF por decisão do dono).
- Depende de ações do dono (conta MP, domínio), não de código.

---

## 4. Plano de ataque (ordem incremental — cada passo é um PR testável)

**Bloco 1 (canal):**
1. **Abstração de canal** — `app/lib/channels/types.ts` + `metaChannel` (extrai o envio atual, sem mudar comportamento) + dispatcher; testes provam que o caminho Meta segue idêntico. *(refactor puro, zero regressão)*
2. **Schema** — `ChannelSession` + `WebhookEvent.channelSessionId?` + migration + `prisma generate`.
3. **Auth-state cifrado** — adapter Baileys↔`crypto.server` (funções puras + teste de roundtrip cifra/decifra).
4. **Gerenciador Baileys** — `baileys.server.ts`: pareamento (QR), eventos, reconexão, boot-reconnect. Inbound → `persistInbound`; outbound → `baileysChannel`.
5. **Fila generaliza** — drain resolve tenant por phoneNumberId **ou** channelSessionId; dedup mantém.
6. **Tela `/canais`** — QR + status + reconectar/desconectar; rota no `routes.ts`; `requireOwner`.
7. **Prova ponta a ponta** — parear um número de teste, mandar msg → motor responde pelo socket.

**Bloco 2 (paralelo, rápido):** landing + demo herói.
**Bloco 3 (por último):** MP produção + domínio + gate (ações do dono).

**Definição de pronto do v1:** um estranho faz signup → abre `/canais` → escaneia o QR → manda uma mensagem de teste **de um segundo número/dispositivo** → o Hermes responde. Sem o dono tocar em nada.
> A DoD exige um **2º número/dispositivo de teste** (o próprio número não recebe as próprias msgs como inbound). Em CI, provar com `makeWASocket` **injetável** (socket fake) — ver §5.

---

## 5. Endurecimento — achados da verificação adversarial (2026-07-09, obrigatórios)

Revisão por 4 lentes (Baileys confirmada via context7). Cada item é requisito de construção, ligado ao passo do §4.

### Passo 1 — abstração de canal
- **[CRÍTICA] Generalizar o caminho de RESPOSTA também.** `processEvent` (`whatsapp-queue.server.ts:68,90`) hoje chama `sendWhatsAppMessage(..., event.phoneNumberId)` hardcoded. Trocar por `sendReply(channelRefFromEvent(event), to, text)` — Meta se `phoneNumberId`, Baileys se `channelSessionId`. `sendOperatorReply` idem.
- **[MÉDIA] Janela de 24h (Meta):** `metaChannel.sendText` pode falhar fora da janela de 24h (template fora do escopo v1) — documentar o modo de falha; o Baileys **não** tem essa trava (vantagem proativa).

### Passo 2 — schema
- **[CRÍTICA] `WebhookEvent.phoneNumberId` é `NOT NULL`** (`schema.prisma:146`) e evento Baileys não tem. Tornar **nullable** + exigir no código **exatamente-um-de** `{phoneNumberId, channelSessionId}`.
- **[ALTA] Dedup global quebra entre canais.** `messageId @unique` é global (desenhado pro `wamid`). O `key.id` do Baileys **não** é único global (é por `remoteJid,fromMe,id`). Adicionar coluna `routeKey String` sempre preenchida (`m:<phoneNumberId>` | `b:<sessionId>`) e trocar por **`@@unique([routeKey, messageId])`**. Senão o `persistInbound` engole o P2002 e **descarta silenciosamente** uma msg real.

### Passo 3 — auth-state cifrado
- **[ALTA] BufferJSON obrigatório.** creds/keys têm `Buffer` (chaves Signal). Usar `JSON.stringify(state, BufferJSON.replacer)` antes do `encryptSecret` e `JSON.parse(dec, BufferJSON.reviver)` depois do `decryptSecret` (importar `BufferJSON` de `@whiskeysockets/baileys`). Sem isso: "Bad MAC" → força re-escanear (mata a promessa de reconexão sem QR).
- **[ALTA] Persistir no `keys.set()`, não só no `creds.update`.** O auth-state tem `creds` (creds.update) **e** `keys` (SignalKeyStore, gravado via `keys.set()` durante a sessão, que não dispara creds.update). Store custom onde o `keys.set()` também re-cifra+persiste (debounced); envolver com `makeCacheableSignalKeyStore(store, logger)`.
- **[MÉDIA] AAD por-sessão:** `channel-session:<sessionId>` (não `tenant:<id>` — há várias sessões por tenant).
- **[MÉDIA] Debounce da persistência:** `creds.update` dispara com muita frequência e o SQLite é single-writer → coalescer (máx. 1 gravação/N s por sessão).
- **[MÉDIA] Memoizar a chave scrypt.** `crypto.server.ts:9-19` deriva a chave com `scryptSync` (síncrono, dezenas de ms) a CADA cifra — no event-loop único isso trava com as gravações frequentes do auth-state. Cachear o Buffer de 32B derivado **uma vez** no processo. *(muda `crypto.server.ts`)*

### Passo 4 — gerenciador Baileys
- **[CRÍTICA] Normalização defensiva do `messages.upsert` ANTES do `persistInbound`:**
  - descartar `msg.key.fromMe === true` (o reply do próprio bot volta como upsert → **laço de auto-resposta**);
  - processar só `type === 'notify'` (nunca `'append'` = histórico/backlog no reconnect);
  - descartar `messageTimestamp` anterior ao momento da conexão (gate extra contra backlog);
  - ignorar `protocolMessage`/reaction/receipt/msg sem corpo de texto.
- **[MÉDIA] `contactId` = MSISDN** (dígitos extraídos do jid, casa com o `wa_id` da Meta); guardar o `remoteJid` **original** pra responder (`sock.sendMessage(remoteJid, {text})`, sem reconstruir). Ignorar grupo (`@g.us`) no v1.
- **[ALTA] Reconexão por causa:** ramificar no `DisconnectReason`/`statusCode` (Boom). Reconectar em `connectionClosed`/`connectionLost`/`restartRequired`(515)/`timedOut`; **terminal** (`status='derrubado'` + `reportDegradation`, sem auto-reconnect) em `loggedOut`/`connectionReplaced`(440)/`badSession`. Backoff exponencial + jitter + teto de tentativas. (`restartRequired` logo após o 1º pareamento **não** é erro.)
- **[MÉDIA] Ritmo humano (anti-ban):** `baileysChannel.sendText` manda presence `'composing'`, espera delay randomizado (escalado pelo tamanho da resposta), com teto diário por sessão.
- **[MÉDIA] Classificador de mídia:** definir quais tipos viram cortesia `'unsupported'` (áudio/imagem/doc) vs ignorados (reaction/receipt/protocol), reusando a intenção do `UNSUPPORTED_REPLY_TYPES` atual.
- **[MÉDIA] `makeWASocket` injetável** no gerente → testes unitários contra um socket fake (a DoD real precisa de 2 números).

### Passo 5 — fila
- **[CRÍTICA] `persistInbound`/drain aceitam origem Meta OU Baileys** (via `routeKey`); resolvem tenant por `phoneNumberId` **ou** `channelSessionId`; respondem pelo canal certo (ver Passo 1).
- **[MÉDIA] Drain serial = teto global entre tenants** (1 LLM ~20s por vez). v1: documentar o teto; v1.1: concorrência por sessão/pool pequeno.

### Passo 6 — tela /canais
- **[MÉDIA] Isolamento do QR:** o poll carrega `ChannelSession where { id, tenantId: <tenant do requester> }` (não só `requireOwner`) antes de devolver o QR; 404 se não for do tenant.
- **[BAIXA] QR expira** → botão "gerar de novo"; no boot, reapar sessões `'pareando'` stale → `'desconectado'`.

### Rollout & segurança (blast-radius)
- **[ALTA] `BAILEYS_ENABLED`** (env, **default OFF** no rollout inicial — protege os pilotos Meta). O boot-reconnect **nunca lança**; erro isolado por socket (guard try/catch por sessão).
- **[MÉDIA] Boot-reconnect deliberado (lazy):** o módulo já-no-boot (`whatsapp-queue`) checa `count(ChannelSession status='conectado') > 0` e faz `dynamic import` do gerente só então (casa com a memória).
- **[ALTA] Shutdown gracioso:** `server.js` no `SIGTERM` chama `closeAllSockets()` (`sock.end()` **sem** logout, preserva o auth) antes do `server.close`.

### Dependência
- **`@whiskeysockets/baileys`** (+ `@hapi/boom` pra ler `DisconnectReason`). Sem ela, o canal Baileys fica desligado; Meta segue.
