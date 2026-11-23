import { dataBR } from "./calendario.ts";
import { classificar, pedidoDeParar, type Categoria } from "./classificador.ts";
import type { ClinicaRow } from "./db.ts";
import { aleatorio, bloqueado, clinicaCfg, conversaDe, enviarKit, enviarTexto, enviarUnico, marcar, podeEscrever } from "./enviador.ts";
import { jidPermitido, ehNumeroDeComando } from "./seguro.ts";
import { canonico, mascarar } from "./telefone.ts";
import type { ClinicaConfig, Ctx, Entrada, SaidaVista } from "./types.ts";

const MIN = 60_000;
/** O /liberar só vale até 30 min depois do /podeir. */
export const VALIDADE_PODEIR_MS = 30 * MIN;
const AJUDA = "Comandos: /podeir (prévia da 1ª leva) · /liberar · /cancelar · /pausar · /retomar · /funil · /status · /leva2 sim ou /leva2 nao.";

export type EventoConexao = { estado: "aberta" } | { estado: "fechada"; permanente: boolean; motivo?: string };

const ROTULO_MIDIA: Record<string, string> = {
	audio: "[áudio]",
	ligacao: "[ligação perdida]",
	imagem: "[imagem]",
	documento: "[documento]",
	outro: "[mensagem sem texto]",
};

export class Robo {
	readonly ctx: Ctx;

	constructor(ctx: Ctx) {
		this.ctx = ctx;
	}

	// ---------- utilidades ----------

	private cfgPorTelefone(jid: string): ClinicaConfig | undefined {
		if (!jidPermitido(this.ctx.campanha, jid)) return undefined;
		const n = canonico(jid);
		return this.ctx.campanha.clinicas.find((c) => c.telefone && canonico(c.telefone) === n);
	}

	private nome(id: string) {
		return clinicaCfg(this.ctx, id).nome;
	}

	/** Aviso ao Gabriel pelo WhatsApp (e pela reserva, se crítico ou se o WhatsApp falhar). Nunca é envio à clínica. */
	private avisar(texto: string, critico = false) {
		return this.ctx.avisos.enviar(texto, { critico });
	}

	private rascunho(categoria: string): string | null {
		const base = this.ctx.campanha.textos.rascunhos[categoria] ?? null;
		if (!base) return null;
		const [d1 = "amanhã", d2 = "depois"] = this.ctx.cal.proximosDiasUteis(this.ctx.agora(), 2);
		return base.replaceAll("{dia1}", d1).replaceAll("{dia2}", d2);
	}

	// ---------- mensagens que chegam da clínica (webhook do agent bot) ----------

	async aoReceber(e: Entrada): Promise<void> {
		const { ctx } = this;
		if (e.grupo) return;
		// A conversa do número de comando nunca é clínica: sem etiqueta, kit, rascunho, nota, atribuição ou funil.
		if (ehNumeroDeComando(ctx.numerosComando, e.jid)) return this.aoComando(e.texto);
		const cfg = this.cfgPorTelefone(e.jid);
		if (!cfg) {
			// Fora da campanha: o robô não responde e tira a conversa de `pending`, sem atribuir.
			ctx.log("conversa de contato fora da campanha: passada a open, sem resposta");
			await this.cw(() => ctx.cw.status(e.conversaId, "open"));
			return;
		}
		const row = ctx.store.clinica(cfg.id);
		if (row.conversa_id !== e.conversaId) ctx.store.atualizarClinica(cfg.id, { conversa_id: e.conversaId });
		if (row.respondeu_em === null) ctx.store.atualizarClinica(cfg.id, { respondeu_em: ctx.agora() });
		const etq = e.etiquetas ?? [];
		const mensagem = e.texto ?? ROTULO_MIDIA[e.tipo] ?? "[mensagem sem texto]";
		// Cada etiqueta de parada vale só nesta conversa; o robô não escreve nada.
		if (etq.includes("com-gabriel") || etq.includes("robo-pausado") || etq.includes("nao-quer")) {
			ctx.store.cancelarSaidasDaClinica(cfg.id);
			await this.cw(() => ctx.cw.status(e.conversaId, "open"));
			return;
		}
		await marcar(ctx, cfg.id, ["respondeu"]);
		if (row.status === "parou") {
			await this.escalar(cfg, "outro", `${mensagem}\n(Esta clínica pediu para parar. O robô não responde.)`, false);
			return;
		}
		// Fora de `aguardando`, um pedido de parar não dispara resposta automática: o Gabriel decide.
		if (row.status !== "aguardando" && pedidoDeParar(e.texto)) {
			await this.suspeitaDeParar(cfg, mensagem);
			return;
		}
		const r = classificar(e.texto, row.status === "aguardando");
		if (r.classe === "sim") {
			ctx.store.atualizarClinica(cfg.id, { status: "kit_agendado" });
			this.agendarResposta(cfg.id, "kit", null);
			await this.avisar(`${cfg.nome}: respondeu "${mensagem}". O kit sai em alguns minutos.`);
		} else if (r.classe === "nao") {
			ctx.store.atualizarClinica(cfg.id, { status: "parou" });
			ctx.store.cancelarSaidasDaClinica(cfg.id);
			this.agendarResposta(cfg.id, "pare", cfg.pare);
			await this.avisar(`${cfg.nome}: pediu para parar ("${mensagem}"). Vou agradecer e não escrevo mais.`);
		} else if (r.classe === "robo" && !ctx.store.temEnvio(`${cfg.id}:robo`)) {
			ctx.store.agendarSaida({
				chave: `${cfg.id}:robo`,
				clinica_id: cfg.id,
				tipo: "robo",
				texto: ctx.campanha.textos.robo,
				executar_apos: ctx.agora(),
				imediata: 1,
			});
			await this.executarSaidas();
			await this.escalar(cfg, "robo", mensagem, false);
			await this.avisar(`${cfg.nome} perguntou se é robô: "${mensagem}". Respondi com a frase de honestidade e passei a conversa para você, no Chatwoot.`);
		} else {
			await this.escalar(cfg, r.categoria, mensagem, true);
		}
	}

	/** "Pare" depois do "sim" (ou do kit): cancela o que está na fila, não escreve nada à clínica e passa ao Gabriel. */
	private async suspeitaDeParar(cfg: ClinicaConfig, mensagem: string) {
		const { ctx } = this;
		ctx.store.cancelarSaidasDaClinica(cfg.id);
		ctx.store.atualizarClinica(cfg.id, { status: "manual" });
		await this.escalar(cfg, "outro", mensagem, true, "Atenção: parece pedido para parar, confira. O robô não respondeu e cancelou o que estava na fila.");
		await this.avisar(`${cfg.nome}: parece pedido para parar ("${mensagem}"). Não respondi e cancelei a fila. Confira no Chatwoot.`);
	}

	/** Um humano (Gabriel ou Danilo) escreveu na conversa: encerra o lembrete das 4h. */
	async aoSaida(s: SaidaVista): Promise<void> {
		if (!s.humano || s.privada) return;
		const { ctx } = this;
		const linha = ctx.store.clinicas().find((c) => c.conversa_id === s.conversaId);
		if (!linha) return;
		const p = ctx.store.pendenciaDaConversa(linha.id);
		if (!p) return;
		// O espelho da mensagem que o próprio robô acabou de mandar não conta.
		if (ctx.agora() - p.criada_em < 60_000 && p.categoria === "robo") return;
		ctx.store.atualizarPendencia(p.id, { status: "enviada" });
	}

	/** Chamada ao Chatwoot que não deve derrubar o fluxo: registra e segue. */
	private async cw(acao: () => Promise<void>): Promise<boolean> {
		try {
			await acao();
			return true;
		} catch (e) {
			this.ctx.log(`chatwoot: ${(e as Error).message}`);
			return false;
		}
	}

	private agendarResposta(id: string, tipo: "kit" | "pare", texto: string | null) {
		const { ctx } = this;
		const espera = aleatorio(ctx, ctx.ritmo.esperaRespostaMinMs, ctx.ritmo.esperaRespostaMaxMs);
		let quando = ctx.agora() + espera;
		if (!ctx.cal.janelaResposta(quando)) quando = ctx.cal.aberturaResposta(quando);
		ctx.store.agendarSaida({
			chave: `${id}:${tipo}`,
			clinica_id: id,
			tipo,
			texto,
			executar_apos: quando,
			imediata: 0,
		});
	}

	/**
	 * Passa ao humano, sem escrever à clínica: nota privada com o rascunho,
	 * etiqueta `com-gabriel` (quando `parar`), atribuição ao Gabriel e status `open`.
	 */
	private async escalar(cfg: ClinicaConfig, categoria: Categoria | "robo", mensagem: string, marcarGabriel: boolean, aviso?: string) {
		const { ctx } = this;
		const row = ctx.store.clinica(cfg.id);
		const conversa = row.conversa_id ?? (await conversaDe(ctx, cfg.id));
		const rascunho = aviso ? null : this.rascunho(categoria);
		if (marcarGabriel || categoria === "robo") {
			ctx.store.criarPendencia({ clinica_id: cfg.id, categoria, mensagem, rascunho, agora: ctx.agora() });
		}
		if (conversa === null) {
			await this.avisar(`${cfg.nome} (${categoria}): não achei a conversa no Chatwoot. A clínica disse: ${mensagem}`);
			return;
		}
		const nota = [
			aviso ?? `Passei para você: ${categoria}.`,
			"",
			`A clínica disse: ${mensagem}`,
			"",
			rascunho ? `Rascunho (edite e envie por aqui):\n${rascunho}` : "Sem rascunho para este caso.",
		].join("\n");
		await this.cw(() => ctx.cw.notaPrivada(conversa, nota));
		if (marcarGabriel || categoria === "robo") await this.cw(() => ctx.cw.adicionarEtiquetas(conversa, ["com-gabriel"]));
		await this.cw(() => ctx.cw.atribuirGabriel(conversa));
		await this.cw(() => ctx.cw.status(conversa, "open"));
	}

	// ---------- agendador (roda a cada minuto, lê tudo do SQLite) ----------

	async tick(): Promise<void> {
		const { ctx } = this;
		try {
			await this.verificarConexao();
			await this.executarSaidas();
			await this.sincronizarEtiquetas();
			await this.enviarFrios();
			await this.lembrarPendencias();
			await this.resumoDasOito();
			await this.avisarQueda();
		} catch (e) {
			ctx.log(`erro no agendador: ${(e as Error).message}`);
		}
	}

	async executarSaidas(): Promise<void> {
		const { ctx } = this;
		if (bloqueado(ctx) || !ctx.wa.conectado()) return;
		for (const s of ctx.store.saidasVencidas(ctx.agora())) {
			if (!s.imediata && !ctx.cal.janelaResposta(ctx.agora())) continue;
			try {
				// Etiqueta de parada na conversa: o robô desiste desta saída (o "pare" sai mesmo com `nao-quer`; a frase do robô, com `com-gabriel`).
				const ignorar = s.tipo === "pare" ? ["nao-quer"] : s.tipo === "robo" ? ["com-gabriel"] : [];
				const pode = await podeEscrever(ctx, s.clinica_id, ignorar);
				if (pode === "parado") ctx.store.concluirSaida(s.id);
				if (pode !== "ok") continue;
				if (s.tipo === "kit") {
					// A conversa mudou desde o "sim" (pare, Gabriel assumiu): o kit não sai.
					if (ctx.store.clinica(s.clinica_id).status !== "kit_agendado") {
						ctx.store.concluirSaida(s.id);
						continue;
					}
					if (await enviarKit(ctx, s.clinica_id)) {
						// Só vira kit_enviado se nada mudou durante o envio (nunca troca `parou`).
						if (ctx.store.clinica(s.clinica_id).status !== "kit_agendado") {
							ctx.store.concluirSaida(s.id);
							continue;
						}
						ctx.store.atualizarClinica(s.clinica_id, { status: "kit_enviado" });
						ctx.store.concluirSaida(s.id);
						await marcar(ctx, s.clinica_id, ["kit-enviado"]);
						await this.avisar(`${this.nome(s.clinica_id)}: kit enviado (texto, vídeo e PDF).`);
					}
				} else {
					const texto = s.texto ?? "";
					const ok = await enviarUnico(ctx, s.chave, s.clinica_id, s.tipo, () => enviarTexto(ctx, s.clinica_id, texto));
					if (ok || ctx.store.temEnvio(s.chave)) {
						ctx.store.concluirSaida(s.id);
						if (s.tipo === "pare") {
							const conversa = await conversaDe(ctx, s.clinica_id);
							await marcar(ctx, s.clinica_id, ["nao-quer"]);
							if (conversa !== null) await this.cw(() => ctx.cw.status(conversa, "resolved"));
						}
					}
				}
			} catch (e) {
				ctx.log(`saída ${s.chave} falhou: ${(e as Error).message}`);
			}
		}
	}

	/** Consulta a Evolution a cada ciclo (1 min): queda curta, queda longa ou bloqueio. */
	private async verificarConexao(): Promise<void> {
		try {
			await this.aoConexao(await this.ctx.wa.estado());
		} catch (e) {
			this.ctx.log(`não consegui ler o estado da Evolution: ${(e as Error).message}`);
			await this.aoConexao({ estado: "fechada", permanente: false });
		}
	}

	/** Reaplica as etiquetas do funil que ainda não entraram (a conversa pode nascer depois do envio). */
	private async sincronizarEtiquetas(): Promise<void> {
		const { ctx } = this;
		for (const r of ctx.store.clinicas()) {
			const quer: [string, boolean][] = [
				["1a-msg", ctx.store.temEnvio(`${r.id}:primeira`)],
				["kit-enviado", r.status === "kit_enviado"],
			];
			for (const [etq, deve] of quer) {
				const chave = `etq:${r.id}:${etq}`;
				if (!deve || ctx.store.estado(chave) === "1") continue;
				if (await marcar(ctx, r.id, [etq])) ctx.store.definirEstado(chave, "1");
			}
		}
	}

	private async enviarFrios(): Promise<void> {
		const { ctx } = this;
		const agora = ctx.agora();
		if (bloqueado(ctx) || !ctx.wa.conectado() || !ctx.cal.janelaPrimeira(agora)) return;
		if (agora < Number(ctx.store.estado("proximo_frio") ?? 0)) return;
		this.repararEnvios();
		const linhas = new Map(ctx.store.clinicas().map((r) => [r.id, r]));
		const ordenadas = [...ctx.campanha.clinicas].sort((a, b) => a.leva - b.leva || a.ordem - b.ordem);

		// 1) lembretes (D7 antes do D3, para nunca mandar os dois seguidos)
		for (const c of ordenadas) {
			const r = linhas.get(c.id) as ClinicaRow;
			if (r.status !== "aguardando" || r.respondeu_em !== null || r.primeira_em === null) continue;
			const d7 = ctx.cal.somarDiasUteis(r.primeira_em, 7);
			const d3 = ctx.cal.somarDiasUteis(r.primeira_em, 3);
			if (agora >= d7 && !ctx.store.temEnvio(`${c.id}:d7`)) {
				if ((await podeEscrever(ctx, c.id)) !== "ok") continue;
				if (await enviarUnico(ctx, `${c.id}:d7`, c.id, "d7", () => enviarTexto(ctx, c.id, c.ultimoD7))) {
					ctx.store.atualizarClinica(c.id, { status: "encerrado", encerrada_em: agora });
					this.marcarFrio();
				}
				return;
			}
			if (agora >= d3 && agora < d7 && !ctx.store.temEnvio(`${c.id}:d3`)) {
				if ((await podeEscrever(ctx, c.id)) !== "ok") continue;
				if (await enviarUnico(ctx, `${c.id}:d3`, c.id, "d3", () => enviarTexto(ctx, c.id, c.lembreteD3))) this.marcarFrio();
				return;
			}
		}

		// 2) primeira mensagem
		if (ctx.store.primeirasDoDia(ctx.cal.diaId(agora)) >= ctx.ritmo.maxPrimeirasPorDia) return;
		const proxima = await this.proximaPrimeira(ordenadas, linhas);
		if (!proxima) return;
		if ((await podeEscrever(ctx, proxima.id)) !== "ok") return;
		const ok = await enviarUnico(ctx, `${proxima.id}:primeira`, proxima.id, "primeira", () =>
			enviarTexto(ctx, proxima.id, proxima.primeira),
		);
		if (ok) {
			ctx.store.atualizarClinica(proxima.id, { status: "aguardando", primeira_em: agora });
			this.marcarFrio();
		}
	}

	/** Se o processo caiu entre o envio e a gravação do status, o envio gravado vale: não repete. */
	private repararEnvios() {
		const { ctx } = this;
		for (const r of ctx.store.clinicas()) {
			const em = ctx.store.envioEm(`${r.id}:primeira`);
			if (r.status === "fila" && em !== null) ctx.store.atualizarClinica(r.id, { status: "aguardando", primeira_em: em });
			if (r.status === "aguardando" && ctx.store.temEnvio(`${r.id}:d7`)) ctx.store.atualizarClinica(r.id, { status: "encerrado" });
		}
	}

	private marcarFrio() {
		const { ctx } = this;
		const espera = aleatorio(ctx, ctx.ritmo.intervaloMinMs, ctx.ritmo.intervaloMaxMs);
		ctx.store.definirEstado("proximo_frio", String(ctx.agora() + espera));
	}

	private async proximaPrimeira(ordenadas: ClinicaConfig[], linhas: Map<string, ClinicaRow>): Promise<ClinicaConfig | undefined> {
		const { ctx } = this;
		const naFila = (leva: number) => ordenadas.filter((c) => c.leva === leva && linhas.get(c.id)?.status === "fila");
		const l1 = naFila(1);
		if (l1.length > 0) return l1[0];
		const l2 = naFila(2);
		if (l2.length === 0) return undefined;
		// 2ª leva: 3 dias úteis depois do último envio da 1ª, e só se ninguém da 1ª respondeu
		const daLeva1 = ordenadas.filter((c) => c.leva === 1).map((c) => linhas.get(c.id) as ClinicaRow);
		if (daLeva1.some((r) => r.respondeu_em !== null)) return undefined;
		const envios = daLeva1.map((r) => r.primeira_em).filter((x): x is number => x !== null);
		if (envios.length === 0) return undefined;
		if (ctx.agora() < ctx.cal.somarDiasUteis(Math.max(...envios), 3)) return undefined;
		const estado = ctx.store.estado("leva2");
		if (estado === "liberada") return l2[0];
		if (estado === null) {
			ctx.store.definirEstado("leva2", "perguntada");
			await this.avisar("A 1ª leva não teve resposta. Começar a 2ª leva (CCO, OdontoSin, Angela, Vintage e Stoá)? Responda /leva2 sim ou /leva2 nao.");
		}
		return undefined;
	}

	private async lembrarPendencias() {
		const { ctx } = this;
		const agora = ctx.agora();
		for (const p of ctx.store.pendenciasAbertas()) {
			if (await this.clinicaPediuParar(p.clinica_id)) continue;
			if (ctx.cal.minutosComerciais(p.ultimo_aviso_em, agora) >= ctx.ritmo.lembretePendenciaMin) {
				ctx.store.atualizarPendencia(p.id, { ultimo_aviso_em: agora });
				await this.avisar(
					`Lembrete: ${this.nome(p.clinica_id)} (${p.categoria}) espera a sua resposta no Chatwoot há mais de 4 horas comerciais. Não enviei nada.`,
				);
			}
		}
	}

	/** `parou` ou etiqueta `nao-quer`: nenhum lembrete de pendência para essa clínica. */
	private async clinicaPediuParar(id: string): Promise<boolean> {
		const { ctx } = this;
		if (ctx.store.clinica(id).status === "parou") return true;
		try {
			const conversa = await conversaDe(ctx, id);
			return conversa !== null && (await ctx.cw.etiquetas(conversa)).includes("nao-quer");
		} catch (e) {
			ctx.log(`não consegui ler as etiquetas de ${id}: ${(e as Error).message}`);
			return false;
		}
	}

	private async resumoDasOito() {
		const { ctx } = this;
		const agora = ctx.agora();
		const dia = ctx.cal.diaId(agora);
		if (!ctx.cal.horaDoResumo(agora) || ctx.store.estado("resumo_dia") === dia) return;
		ctx.store.definirEstado("resumo_dia", dia);
		const pend = ctx.store.pendenciasAbertas();
		const saiHoje = this.saiHoje();
		const partes = [
			`Resumo de hoje (${dataBR(agora)})`,
			"",
			this.funil(),
			"",
			pend.length
				? `Conversas com você:\n${pend.map((p) => `#${p.id} ${this.nome(p.clinica_id)} (${p.categoria})`).join("\n")}`
				: "Conversas com você: nenhuma.",
			"",
			saiHoje.length ? `Sai hoje:\n${saiHoje.join("\n")}` : "Sai hoje: nada.",
		];
		await this.avisar(partes.join("\n"));
	}

	private async avisarQueda() {
		const { ctx } = this;
		const desde = ctx.store.estado("caiu_em");
		if (desde === null || ctx.store.estado("queda_avisada") === "1") return;
		if (ctx.agora() - Number(desde) >= ctx.ritmo.quedaAvisoMs) {
			ctx.store.definirEstado("queda_avisada", "1");
			await this.avisar("O WhatsApp está fora do ar há mais de 10 minutos. Estou tentando reconectar sozinho.", true);
		}
	}

	// ---------- conexão do WhatsApp ----------

	async aoConexao(ev: EventoConexao): Promise<void> {
		const { ctx } = this;
		if (ev.estado === "aberta") {
			const avisou = ctx.store.estado("queda_avisada") === "1";
			ctx.store.definirEstado("caiu_em", null);
			ctx.store.definirEstado("queda_avisada", null);
			if (avisou) await this.avisar("O WhatsApp voltou.");
			return;
		}
		if (ev.permanente) {
			ctx.store.definirEstado("ban", "1");
			ctx.store.definirEstado("pausado", "1");
			await this.avisar(
				"Número desconectado ou bloqueado. Parei tudo. Não troque de chip sem decisão dos sócios.",
				true,
			);
			return;
		}
		if (ctx.store.estado("caiu_em") === null) ctx.store.definirEstado("caiu_em", String(ctx.agora()));
	}

	// ---------- comandos do Gabriel (WhatsApp, pelo webhook do Chatwoot) ----------

	/** Mensagem vinda de um número de comando. Só `/comando` age; o resto recebe a lista. */
	private async aoComando(texto: string | null): Promise<void> {
		const m = texto ? /^\/(\w+)(?:\s+(.*))?$/s.exec(texto.trim()) : null;
		if (!m) return this.avisar(AJUDA);
		return this.comando((m[1] as string).toLowerCase(), m[2]?.trim().toLowerCase());
	}

	private async comando(nome: string, arg?: string) {
		const { ctx } = this;
		switch (nome) {
			case "podeir":
				return this.podeir();
			case "liberar":
				return this.liberar();
			case "cancelar":
				ctx.store.definirEstado("podeir_em", null);
				return this.avisar("Cancelado. Nada foi liberado.");
			case "pausar":
				ctx.store.definirEstado("pausado", "1");
				return this.avisar("Pausado. Nada sai, nem o que estava na fila. /retomar para voltar.");
			case "retomar":
				if (ctx.store.estado("ban") === "1") {
					if (arg !== "forcar") {
						return this.avisar("O número foi bloqueado ou desconectado. Só retome depois de decisão dos sócios, com /retomar forcar.");
					}
					ctx.store.definirEstado("ban", null);
				}
				ctx.store.definirEstado("pausado", null);
				return this.avisar("Retomado.");
			case "funil":
				return this.avisar(this.funil());
			case "status":
				return this.avisar(this.status());
			case "leva2":
				return this.leva2(arg);
			default:
				return this.avisar(`Comando desconhecido. ${AJUDA}`);
		}
	}

	private async podeir() {
		const { ctx } = this;
		if (ctx.store.estado("ban") === "1") return this.avisar("O número está bloqueado. Veja /status.");
		if (ctx.store.estado("liberado") === "1") return this.avisar("Já está liberado. Use /status para ver a fila.");
		const linhas = new Map(ctx.store.clinicas().map((r) => [r.id, r]));
		const leva = ctx.campanha.clinicas.filter((c) => c.leva === 1).sort((a, b) => a.ordem - b.ordem);
		const blocos = leva.map((c) =>
			linhas.get(c.id)?.status === "sem_telefone" || !c.telefone
				? `${c.ordem}. ${c.nome}: SEM TELEFONE, não será enviada.`
				: `${c.ordem}. ${c.nome} (${mascarar(c.telefone)})\n${c.primeira}`,
		);
		ctx.store.definirEstado("podeir_em", String(ctx.agora()));
		await this.avisar(
			`Prévia da 1ª leva. Nada sai sem o seu /liberar.\nAté ${ctx.ritmo.maxPrimeirasPorDia} por dia, em dia útil, das 9h às 17h, com 20 a 60 min entre elas.\n\n${blocos.join("\n\n")}\n\nPara liberar, mande /liberar (vale por 30 minutos). Para desistir, /cancelar.`,
		);
	}

	private async liberar() {
		const { ctx } = this;
		if (ctx.store.estado("ban") === "1") return this.avisar("O número está bloqueado. Não liberei.");
		const em = Number(ctx.store.estado("podeir_em") ?? 0);
		if (!em) return this.avisar("Antes do /liberar, mande /podeir para ver a prévia.");
		ctx.store.definirEstado("podeir_em", null);
		if (ctx.agora() - em > VALIDADE_PODEIR_MS) return this.avisar("O /podeir passou de 30 minutos. Nada foi liberado. Mande /podeir de novo.");
		ctx.store.definirEstado("liberado", "1");
		return this.avisar("Liberado. A 1ª mensagem sai na próxima janela (dia útil, 9h às 17h).");
	}

	private async leva2(arg?: string) {
		const { ctx } = this;
		if (arg !== "sim" && arg !== "nao") return this.avisar("Use /leva2 sim ou /leva2 nao.");
		if (ctx.store.estado("leva2") !== "perguntada") return this.avisar("Não há pergunta da 2ª leva aberta.");
		if (arg === "sim") {
			ctx.store.definirEstado("leva2", "liberada");
			return this.avisar("2ª leva liberada. Começa na próxima janela.");
		}
		ctx.store.definirEstado("leva2", "recusada");
		return this.avisar("Ok, a 2ª leva não começa.");
	}

	// ---------- textos dos avisos ----------

	private proximoPasso(c: ClinicaConfig, r: ClinicaRow): { texto: string; quando: number | null } {
		const { ctx } = this;
		switch (r.status) {
			case "fila":
				return { texto: `1ª mensagem (${c.leva}ª leva)`, quando: null };
			case "sem_telefone":
				return { texto: "sem telefone: não envia", quando: null };
			case "aguardando": {
				if (r.respondeu_em !== null || r.primeira_em === null) return { texto: "você responde", quando: null };
				const d3 = ctx.cal.somarDiasUteis(r.primeira_em, 3);
				const d7 = ctx.cal.somarDiasUteis(r.primeira_em, 7);
				if (!ctx.store.temEnvio(`${c.id}:d3`) && ctx.agora() < d7) return { texto: "lembrete do 3º dia", quando: d3 };
				return { texto: "último lembrete", quando: d7 };
			}
			case "kit_agendado":
				return { texto: "kit na fila", quando: null };
			case "kit_enviado":
				return { texto: "aguarda resposta", quando: null };
			case "manual":
				return { texto: "com você", quando: null };
			default:
				return { texto: "nada (encerrada)", quando: null };
		}
	}

	funil(): string {
		const { ctx } = this;
		const linhas = new Map(ctx.store.clinicas().map((r) => [r.id, r]));
		const out = [...ctx.campanha.clinicas]
			.sort((a, b) => a.leva - b.leva || a.ordem - b.ordem)
			.map((c) => {
				const r = linhas.get(c.id) as ClinicaRow;
				const p = this.proximoPasso(c, r);
				const primeira = r.primeira_em ? dataBR(r.primeira_em) : "-";
				const quando = p.quando ? ` em ${dataBR(p.quando)}` : "";
				return `${c.nome}: ${r.status} | 1ª msg ${primeira} | próximo: ${p.texto}${quando}`;
			});
		return `Funil:\n${out.join("\n")}`;
	}

	private saiHoje(): string[] {
		const { ctx } = this;
		const hoje = ctx.cal.diaId(ctx.agora());
		const out: string[] = [];
		const linhas = new Map(ctx.store.clinicas().map((r) => [r.id, r]));
		let fila = 0;
		for (const c of [...ctx.campanha.clinicas].sort((a, b) => a.leva - b.leva || a.ordem - b.ordem)) {
			const r = linhas.get(c.id) as ClinicaRow;
			const p = this.proximoPasso(c, r);
			if (p.quando !== null && ctx.cal.diaId(p.quando) === hoje) out.push(`${c.nome}: ${p.texto}`);
			else if (r.status === "fila" && c.leva === 1 && fila < ctx.ritmo.maxPrimeirasPorDia) {
				fila++;
				out.push(`${c.nome}: 1ª mensagem`);
			}
		}
		if (ctx.store.estado("liberado") !== "1") return out.length ? ["Nada sai: falta o seu /podeir.", ...out] : [];
		return out;
	}

	status(): string {
		const { ctx } = this;
		const agora = ctx.agora();
		const estado = ctx.store.estado("ban") === "1" ? "BLOQUEADO" : ctx.store.estado("pausado") === "1" ? "pausado" : ctx.store.estado("liberado") === "1" ? "liberado" : "travado (falta /podeir)";
		return [
			`WhatsApp: ${ctx.wa.conectado() ? "conectado" : "desconectado"}`,
			`Robô: ${estado}`,
			`1ªs mensagens hoje: ${ctx.store.primeirasDoDia(ctx.cal.diaId(agora))}/${ctx.ritmo.maxPrimeirasPorDia}`,
			`Respostas na fila: ${ctx.store.saidasPendentes().length}`,
			`Pendências abertas: ${ctx.store.pendenciasAbertas().length}`,
		].join("\n");
	}
}
