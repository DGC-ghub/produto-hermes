# Plano Fase 2 — Hermes Atendente (cérebro IA real, plugável)

> Status: **rascunho para validação do Gabriel**. Nada de código antes do "pode ir".
> Fase 1 (MVP simulado, motor determinístico) = encerrada. Esta fase troca o cérebro.

## 1. Objetivo

Trocar o cérebro determinístico (palavra-chave) por um **atendente de IA real**, mantendo
todo o resto do produto igual. O atendente:

- lê a mensagem do cliente (texto; áudio vira texto antes),
- entende a intenção usando o histórico daquele contato,
- responde de forma natural,
- diz se precisa de humano,
- sugere atualização do lead,
- **nunca** sai do papel de atendente (sem terminal, arquivo, etc).

## 2. Princípio: balcão ≠ cérebro

```
Produto Hermes (balcão)        Hermes Atendente (cérebro)
- recebe a mensagem            - entende e responde
- sabe a empresa e o contato   - só vê o que o balcão passou
- monta o contexto             - devolve JSON estruturado
- chama o cérebro
- VALIDA a resposta
- salva no banco
- mostra no dashboard / envia
```

O balcão é determinístico e confiável. O cérebro é inteligente, mas **vive numa caixa**.

## 3. Arquitetura plugável (o coração da fase)

Uma interface única, com providers trocáveis por env. Nenhuma parte do produto sabe
qual provider está ativo.

```ts
// app/lib/attendant/types.ts
export type AttendantInput = {
  tenant: { slug: string; name: string }
  companyRules: string[]            // guardrails de negócio (não inventar preço, etc)
  knowledge: { title: string; snippet: string }[]  // trechos da base (via retrieval)
  history: { role: 'user' | 'assistant'; content: string }[]  // últimas N mensagens
  lead: {
    name: string | null
    phone: string | null
    neighborhood: string | null
    need: string | null
    urgency: string | null
  } | null
  message: string                   // mensagem nova (texto; já transcrito se veio áudio)
}

export type LeadPatch = Partial<{
  name: string; phone: string; neighborhood: string; need: string; urgency: string
}>

export type AttendantOutput = {
  reply: string
  needsHuman: boolean
  handoffReason: string | null
  leadPatch: LeadPatch | null
  confidence: number                // 0..1
}

export interface AttendantProvider {
  readonly name: string
  generate(input: AttendantInput): Promise<AttendantOutput>
}

// seleção por env: ATTENDANT_PROVIDER = mock | hermes_cli | anthropic_api
export function generateAttendantReply(input: AttendantInput): Promise<AttendantOutput>
```

Providers previstos:

| Provider        | Quando usar              | Auth/custo                         |
|-----------------|--------------------------|------------------------------------|
| `mock`          | testar fluxo/UI sem IA   | nenhum                             |
| `hermes_cli`    | **validação** (só você)  | assinatura logada (barato)         |
| `anthropic_api` | **cliente real**         | API key paga (obrigatório por ToS) |

`.env`: `ATTENDANT_PROVIDER=mock` → depois `hermes_cli` → no futuro `anthropic_api`.
A troca é 1 linha. O resto do produto não muda.

## 4. As 5 camadas de segurança (não-negociáveis)

1. **Mensagem do cliente é DADO, não comando.** Entra delimitada (`"""..."""`),
   nunca concatenada como instrução.
2. **Atendente sem ferramenta perigosa.** No `hermes_cli`, perfil isolado: sem shell,
   sem fs, sem git, sem browser, sem rede livre, sem acesso a `~/.hermes`/`.env`/sistema.
   No `anthropic_api`, a coleira é grátis: nenhuma tool é passada = ele não pode nada.
3. **Saída estruturada (JSON).** O cérebro devolve só o `AttendantOutput`. Texto solto
   é rejeitado.
4. **Validador determinístico** (camada 5 do balcão) confere antes de salvar/enviar.
5. **Tudo logado** (mensagem, resposta, motivo de handoff, lead) para auditoria.

## 5. Validador determinístico

`validateAttendantOutput(raw)` roda no balcão e checa:

- é JSON válido e parseável?
- `reply` é string não-vazia, sem bloco de código/markdown estranho?
- não vaza segredo/caminho/credencial (regex de `sk-`, `/home/`, `.env`, etc)?
- não tem claim proibido (reusa `FORBIDDEN_CLAIMS` atual: garantido/certeza/100%/definitivo)
  nem preço fechado inventado?
- `needsHuman` é boolean? Se `true`, `handoffReason` é não-nulo?
- `leadPatch` só tem chaves permitidas, valores string curtos?
- `confidence` é número 0..1?

**Qualquer falha → força `needsHuman=true`, `handoffReason="validacao_falhou"`, e usa uma
`reply` segura padrão** ("Vou marcar para uma pessoa do time te ajudar com segurança…").
Cliente nunca vê erro cru.

## 6. Régua de custo / Termos de Uso

- `hermes_cli` usa a **assinatura pessoal logada** → ótimo e barato para você validar,
  mas é **uso individual**. Não pode ser o motor de um produto comercial com clientes
  de fora (risco de violar os termos e suspender a conta).
- Antes do **primeiro cliente real**, virar `anthropic_api` (key paga; Haiku ≈ centavos
  por conversa, custo repassável). Isso já está previsto na arquitetura — é só o env.

## 7. Faseamento (uma fatia por vez, valida antes da próxima)

- **2.1 — Contrato + tipos + testes.** Cria a interface e os tipos. Sem IA. Testes do
  validador e dos tipos. *(começa aqui)*
- **2.2 — Provider `mock`.** Resposta fake determinística. Pluga a interface e dá pra ver
  o fluxo inteiro andar sem credencial nenhuma.
- **2.3 — Provider `hermes_cli`.** Chama o CLI com perfil atendente isolado, com timeout,
  parse de JSON e fallback pra handoff se falhar/estourar tempo.
- **2.4 — Plugar no `/demo/chat`.** Substitui `composeAssistantResponse` por
  `generateAttendantReply`. Você testa digitando, sem WhatsApp.
- **2.5 — Áudio local.** `faster-whisper` (já instalado no hermes) transcreve →
  mesma interface. Áudio e texto convergem no mesmo caminho.
- **2.6 — Provider `anthropic_api`.** Para piloto/produção, antes de cliente real.

(WhatsApp real = fase seguinte, separada, depois do backlog de segurança.)

## 8. O que NÃO fazer agora

- Não plugar WhatsApp real direto.
- Não dar terminal/fs/git ao atendente.
- Não usar o hermes operador (o seu, da Pi) nem `hermes --continue` da sessão principal.
- Não misturar memória pessoal do Gabriel com a do cliente.
- Não passar `.env`/config/secrets para dentro do prompt.
- Não deixar o cliente definir `tenant`/`contactId` (isso vem do canal, não da mensagem).
- Não montar multi-agente (qualificador/auditor/etc) agora — **um agente só**.

## 9. Como testar sem WhatsApp

1. `/demo/chat`: digita como cliente → vê o atendente responder e o lead no dashboard.
2. Áudio manual: aponta um arquivo de áudio → whisper → texto → mesmo fluxo.
3. Teu WhatsApp como piloto controlado (fase seguinte).
4. WhatsApp oficial/piloto (só depois de segurança).

## 10. Decisões abertas (preciso da tua opinião)

1. **Histórico:** passar as últimas N mensagens (ex.: 12) ou um resumo + últimas N?
   Proposta: começar com últimas ~12 mensagens cruas; resumo só quando a conversa ficar longa.
2. **Base de conhecimento:** mandar a base inteira no prompt (simples, gasta mais token)
   ou reusar o `retrieval` atual e mandar só os trechos relevantes (mais barato/escalável)?
   Proposta: reusar o `retrieval` que já existe.
3. **Persona/tom:** um tom único pra todos, ou cada empresa (tenant) define o seu?
   Proposta: um tom base agora; override por tenant numa fase futura.
```
