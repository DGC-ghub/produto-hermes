import { describe, expect, it } from "vitest";
import { criarReserva } from "../src/adaptador-chatwoot.ts";
import { canonico } from "../src/telefone.ts";
import { conferirComandoForaDaCampanha, lerNumerosComando, protegerComando, protegerWhatsApp } from "../src/seguro.ts";
import { campanha, criar, JID_COMANDO, MIN, NUM_COMANDO, NUM_OUTRO, textos } from "./helpers.ts";

const sabado = "2026-11-21T03:00:00";

describe("comandos do Gabriel pelo WhatsApp", () => {
	it("/podeir + /liberar libera e o 1º envio sai na janela", async () => {
		const t = criar();
		await t.gabriel("/podeir");
		expect(t.store.estado("liberado")).toBeNull();
		await t.gabriel("/liberar");
		expect(t.store.estado("liberado")).toBe("1");
		await t.rodar(1);
		expect(textos(t.wa.enviados)).toHaveLength(1);
	});

	it("/liberar sem /podeir não libera", async () => {
		const t = criar();
		await t.gabriel("/liberar");
		expect(t.store.estado("liberado")).toBeNull();
		expect(t.avisos.at(-1)?.texto).toContain("/podeir");
	});

	it("/liberar 31 min depois do /podeir não libera; 29 min libera", async () => {
		const velho = criar();
		await velho.gabriel("/podeir");
		velho.avancar(31 * MIN);
		await velho.gabriel("/liberar");
		expect(velho.store.estado("liberado")).toBeNull();
		expect(velho.avisos.at(-1)?.texto).toContain("30 minutos");
		await velho.gabriel("/liberar"); // o /podeir velho não vale mais
		expect(velho.store.estado("liberado")).toBeNull();

		const novo = criar();
		await novo.gabriel("/podeir");
		novo.avancar(29 * MIN);
		await novo.gabriel("/liberar");
		expect(novo.store.estado("liberado")).toBe("1");
	});

	it("/cancelar não libera, nem um /liberar logo depois", async () => {
		const t = criar();
		await t.gabriel("/podeir");
		await t.gabriel("/cancelar");
		await t.gabriel("/liberar");
		expect(t.store.estado("liberado")).toBeNull();
	});

	it("/pausar e /retomar", async () => {
		const t = criar();
		await t.liberar();
		await t.gabriel("/pausar");
		expect(t.store.estado("pausado")).toBe("1");
		await t.rodar(5);
		expect(t.wa.enviados).toHaveLength(0);
		await t.gabriel("/retomar");
		expect(t.store.estado("pausado")).toBeNull();
		await t.rodar(1);
		expect(textos(t.wa.enviados)).toHaveLength(1);
	});

	it("/leva2 nao recusa; /leva2 sim sem pergunta aberta não faz nada", async () => {
		const t = criar();
		await t.gabriel("/leva2 sim");
		expect(t.store.estado("leva2")).toBeNull();
		t.store.definirEstado("leva2", "perguntada");
		await t.gabriel("/leva2 nao");
		expect(t.store.estado("leva2")).toBe("recusada");
	});

	it("comando vindo de outro número não vira comando", async () => {
		const t = criar();
		await t.gabriel("/pausar", `${NUM_OUTRO}@s.whatsapp.net`);
		await t.gabriel("/podeir", `${NUM_OUTRO}@s.whatsapp.net`);
		await t.gabriel("/liberar", `${NUM_OUTRO}@s.whatsapp.net`);
		expect(t.store.estado("pausado")).toBeNull();
		expect(t.store.estado("liberado")).toBeNull();
		expect(t.avisos).toHaveLength(0);
	});

	it("'/' vindo de uma clínica é mensagem comum", async () => {
		const t = criar();
		await t.diz("amo", "/pausar");
		expect(t.store.estado("pausado")).toBeNull();
		expect(t.avisos).toHaveLength(0);
		expect(t.cw.notas).toHaveLength(1); // passou ao Gabriel como qualquer mensagem
	});

	it("texto sem barra do sócio fica sem resposta (é do Hermes)", async () => {
		const t = criar();
		await t.gabriel("fiz a conta da B2");
		await t.gabriel("  oi, tudo bem?  ");
		await t.gabriel(null);
		expect(t.avisos).toHaveLength(0);
		expect(t.wa.enviados).toHaveLength(0);
		expect(t.store.estado("pausado")).toBeNull();
		expect(t.store.estado("liberado")).toBeNull();
		await t.gabriel("  /inventado");
		expect(t.avisos).toHaveLength(1);
		expect(t.avisos.at(-1)?.texto).toContain("Comando desconhecido");
		await t.gabriel("/podeir");
		expect(t.avisos.at(-1)?.texto).toContain("/liberar");
	});

	it("mensagem enviada pelo outro aparelho na conversa de comando não mexe no funil", async () => {
		const t = criar();
		t.irPara("2026-11-18T17:00:00");
		await t.diz("sencis", "Quanto custa?");
		const antes = t.store.pendenciasAbertas();
		expect(antes).toHaveLength(1);
		// O Hermes escreve pelo 2º aparelho na conversa do número de comando (conversa 900): saída humana, não privada.
		await t.robo.aoSaida({ conversaId: 900, humano: true, privada: false });
		expect(t.store.pendenciasAbertas()).toEqual(antes); // o lembrete das 4h continua de pé
		t.irPara("2026-11-19T12:00:00");
		await t.robo.tick();
		expect(t.avisos.filter((m) => m.texto.startsWith("Lembrete"))).toHaveLength(1);
		expect(t.wa.enviados).toHaveLength(0);
		expect(t.store.saidasPendentes()).toHaveLength(0);
	});

	it("a conversa do número de comando nunca é clínica: sem etiqueta, nota, atribuição, status, kit, funil", async () => {
		const t = criar();
		await t.gabriel("/pausar");
		await t.gabriel("sim, pode mandar o kit");
		await t.gabriel("pare");
		await t.gabriel(null);
		expect(t.cw.notas).toHaveLength(0);
		expect(t.cw.atribuidas).toHaveLength(0);
		expect(t.cw.status).toHaveLength(0);
		expect(t.store.saidasPendentes()).toHaveLength(0);
		expect(t.store.clinicas().every((c) => c.respondeu_em === null && c.status !== "kit_agendado" && c.status !== "parou")).toBe(true);
		expect(t.store.pendenciasAbertas()).toHaveLength(0);
		expect(t.wa.enviados).toHaveLength(0);
		expect(t.cw.etiquetasDe("amo")).toEqual([]);
	});
});

describe("avisos ao Gabriel", () => {
	it("aviso nunca vai para número fora de NUMEROS_COMANDO", async () => {
		const enviados: string[] = [];
		const real = { enviarTexto: async (jid: string) => void enviados.push(jid) };
		const cmd = protegerComando(real, [NUM_COMANDO]);
		await cmd.enviarTexto(JID_COMANDO, "oi");
		await expect(cmd.enviarTexto(`${NUM_OUTRO}@s.whatsapp.net`, "oi")).rejects.toThrow(/fora de NUMEROS_COMANDO/);
		const clinica = `${campanha.clinicas[0]?.telefone}@s.whatsapp.net`;
		await expect(cmd.enviarTexto(clinica, "oi")).rejects.toThrow();
		await expect(cmd.enviarTexto("120363000000000000@g.us", "oi")).rejects.toThrow();
		expect(enviados).toEqual([JID_COMANDO]);
	});

	it("a função das clínicas continua recusando o número de comando", async () => {
		const wa = { enviarTexto: async () => {}, enviarVideo: async () => {}, enviarDocumento: async () => {}, conectado: () => true, estado: async () => ({ estado: "aberta" as const }) };
		await expect(protegerWhatsApp(wa, campanha).enviarTexto(JID_COMANDO, "oi")).rejects.toThrow(/fora da campanha/);
	});

	it("aviso sai fora da janela, não conta no limite de 5 e não segue pausa nem ban", async () => {
		const t = criar({ agora: Date.parse(`${sabado}-03:00`) });
		t.store.definirEstado("pausado", "1");
		t.store.definirEstado("ban", "1");
		await t.gabriel("/status");
		await t.gabriel("/funil");
		expect(t.avisos).toHaveLength(2);
		expect(t.avisoWa.jids.every((j) => j === JID_COMANDO)).toBe(true);
		expect(t.store.primeirasDoDia(t.ctx.cal.diaId(t.relogio.t))).toBe(0);
		expect(t.reserva).toHaveLength(0); // aviso comum, WhatsApp ok: reserva não entra
	});

	it("ban posta na reserva e também avisa pelo WhatsApp", async () => {
		const t = criar();
		await t.robo.aoConexao({ estado: "fechada", permanente: true, motivo: "401" });
		expect(t.reserva).toHaveLength(1);
		expect(t.reserva[0]?.texto).toContain("Número desconectado ou bloqueado");
		expect(t.avisos.at(-1)?.texto).toContain("Número desconectado ou bloqueado");
	});

	it("queda de mais de 10 min vai pelo WhatsApp e pela reserva; queda curta não avisa", async () => {
		const t = criar();
		t.wa.ligar(false);
		await t.rodar(9);
		expect(t.avisos.filter((m) => m.texto.includes("fora do ar"))).toHaveLength(0);
		expect(t.reserva).toHaveLength(0);
		await t.rodar(3);
		expect(t.avisos.filter((m) => m.texto.includes("fora do ar"))).toHaveLength(1);
		expect(t.reserva.filter((m) => m.texto.includes("fora do ar"))).toHaveLength(1);
	});

	it("se o WhatsApp falhar, o aviso cai na reserva", async () => {
		const t = criar();
		t.avisoWa.falha = true;
		await t.gabriel("/status");
		expect(t.avisos).toHaveLength(0);
		expect(t.reserva).toHaveLength(1);
		expect(t.reserva[0]?.texto).toContain("WhatsApp:");
	});

	it("se a reserva também falhar, o robô segue (sem exceção)", async () => {
		const t = criar();
		t.avisoWa.falha = true;
		t.reservaFalsa.falha = true;
		await expect(t.gabriel("/status")).resolves.toBeUndefined();
	});

	it("resumo das 8h e lembrete das 4h saem pelo WhatsApp do Gabriel", async () => {
		const t = criar();
		t.irPara("2026-11-18T08:05:00");
		await t.rodar(1);
		expect(t.avisos.some((m) => m.texto.startsWith("Resumo de hoje"))).toBe(true);
		expect(t.reserva).toHaveLength(0);
	});
});

describe("trava de partida", () => {
	it("número de comando dentro do campanha.json: não sobe e diz por quê, sem mostrar o número", () => {
		const tel = canonico(campanha.clinicas.find((c) => c.telefone)?.telefone as string) as string;
		expect(() => conferirComandoForaDaCampanha(campanha, [NUM_COMANDO, tel])).toThrow(/está na campanha/);
		try {
			conferirComandoForaDaCampanha(campanha, [tel]);
		} catch (e) {
			expect((e as Error).message).not.toContain(tel);
		}
		expect(() => conferirComandoForaDaCampanha(campanha, [NUM_COMANDO])).not.toThrow();
	});

	it("NUMEROS_COMANDO: lista, formatos livres, vazio e inválido recusados", () => {
		expect(lerNumerosComando(`+${NUM_COMANDO}, ${NUM_OUTRO}`)).toEqual([NUM_COMANDO, NUM_OUTRO]);
		expect(() => lerNumerosComando(undefined)).toThrow(/vazio/);
		expect(() => lerNumerosComando("12345")).toThrow(/inválido/);
	});
});

describe("reserva (Chatwoot, canal API)", () => {
	it("posta mensagem de entrada na conversa fixa, com o token", async () => {
		const chamadas: { url: string; corpo: any; token: string }[] = [];
		const f = (async (url: string, init: RequestInit) => {
			chamadas.push({ url, corpo: JSON.parse(init.body as string), token: (init.headers as Record<string, string>).api_access_token as string });
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		await criarReserva({ url: "http://127.0.0.1:3000/", token: "tok-r", conta: 1, conversaId: 55 }, f).postar("alerta");
		expect(chamadas).toEqual([
			{ url: "http://127.0.0.1:3000/api/v1/accounts/1/conversations/55/messages", corpo: { content: "alerta", message_type: "incoming", private: false }, token: "tok-r" },
		]);
		const ruim = (async () => new Response("", { status: 500 })) as typeof fetch;
		await expect(criarReserva({ url: "http://x", token: "t", conta: 1, conversaId: 1 }, ruim).postar("a")).rejects.toThrow(/500/);
	});
});

