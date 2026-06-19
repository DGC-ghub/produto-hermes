# Roadmap — SaaS de Atendimento WhatsApp por IA

> Ordem de **construção** (≠ ordem de prioridade): a base precisa existir antes da IA.

## Fase 0 — Base (encanamento)
Conectar no WhatsApp (API oficial da Meta) + receber/enviar mensagem. Sem isso, nada funciona.

## Fase 1 — Núcleo: Hermes (IA)  ⭐ prioridade nº1
IA atendendo via base de conhecimento (RAG): tirar dúvidas + vender. Passagem pra humano mínima e configurável.

## Fase 2 — CRM
Cadastro de cliente, histórico de conversa, etiquetas, funil.

## Fase 3 — Caixa de entrada da equipe
Painel pros atendentes humanos.

## Fase 4 — Campanhas / disparos
Mensagens em massa (avisos, lembretes, promoções).

## Infra (evolução)
- **MVP / uso interno:** pode rodar na **Pi** (Raspberry) pra testar.
- **Produção vendida:** **nuvem** (VPS) — a Pi em casa não aguenta produto pago (uptime, internet, segurança, escala).

## Riscos a resolver
- **WhatsApp API oficial:** custo por conversa + aprovação na Meta. Atalho não-oficial = **ban** (não serve pra vender).
- **"Humanizado" depende da base de conhecimento** ser boa — lixo entra, lixo sai.
- **LGPD:** dados de conversa dos clientes precisam de cuidado legal.
