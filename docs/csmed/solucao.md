# Solução Proposta — Sistema de Faturamento CSMed

> Etapa 2 · rascunho (2026-07-03). Ainda em discussão; provável sistema sob medida. Ver `fluxo.svg`.

## Ideia central
Automatizar o "meio" que hoje é manual: os dados **entram** → o sistema **aplica as regras dos contratos e concilia** → **saem** os relatórios prontos.

## 4 partes
1. **Cadastro de contratos e regras** (o cérebro) — por cliente: modelo (plantão/hora/procedimento), valores (ex.: plantão 12h = R$ 3.414,17; porte 8C = R$ 818), regra de período (1–31 ou 26–26), valor do coordenador.
2. **Entradas** — escala: importa o Excel do escalaApp (futuro: integração direta). Procedimentos: tela de cadastro (ver coleta).
3. **Motor de conciliação** (o coração) — conta plantões/horas por médico, aplica as regras e junta tudo num lugar só.
4. **Saídas** — gera automático: **mapa de horas**, **relatório gerencial / fatura do cliente** e **repasse dos médicos (70%)**. Com **conferência humana** antes de faturar.

## Coleta do procedimento — 3 opções (decisão em aberto)
Restrição fixa: o médico já preenche o sistema do hospital e **não vai preencher 2 sistemas**; a CSMed **não tem acesso** ao sistema do hospital.

1. **Foto + IA lê a tela** (base recomendada) — o médico continua mandando o print; uma IA de visão extrai os campos → lançamento "pendente" → humano confere. Não muda o hábito do médico e mata a digitação. **Funciona sempre.**
2. **Formulário rápido / bot de WhatsApp** — dado limpo direto, mas depende de adoção do médico ("preencher 2x"). Opcional.
3. **Export/acesso do hospital** — elimina a coleta onde o hospital cooperar. É **comercial/relacionamento**, não técnico. Varia por hospital.

Estratégia: **opção 1 como base + opção 3 como upgrade** onde der; as 3 podem coexistir. Campos mínimos (iguais pra todas): médico, paciente/ref, data, código, vias, porte.

## Fora de escopo (v1) / limites
- A **coleta** do procedimento depende de dado do hospital → o sistema tira a dor do **cálculo/conciliação**, não da coleta (enquanto não houver acesso ao hospital).
- **Não substitui o escalaApp** (ele já faz a escala); a dor é a conciliação.

## Roadmap sugerido (por fase)
- **Fase 1 — Diagnóstico pago:** mapear volumes, contratos, formatos de export e acessos → base pra cotar com precisão.
- **Fase 2 — MVP: módulo plantão** (90% dos contratos): import da escala → mapa de horas + relatório gerencial + repasse.
- **Fase 3 — Procedimento:** coleta via IA + conferência.
- **Fase 4 — Hora, coordenador e particularidades** (período 26–26 etc.) e integrações.
