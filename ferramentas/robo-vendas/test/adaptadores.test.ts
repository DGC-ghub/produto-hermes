import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarChatwoot } from "../src/adaptador-chatwoot.ts";
import { criarEvolution } from "../src/adaptador-evolution.ts";

interface Chamada {
	metodo: string;
	url: string;
	cabecalhos: Record<string, string>;
	corpo: any;
}

/** fetch falso: nada de rede. `respostas` casa pelo fim da URL. */
function fetchFalso(respostas: Record<string, unknown>) {
	const chamadas: Chamada[] = [];
	const f = (async (url: string, init: RequestInit) => {
		chamadas.push({
			metodo: init.method ?? "GET",
			url,
			cabecalhos: init.headers as Record<string, string>,
			corpo: init.body ? JSON.parse(init.body as string) : undefined,
		});
		const chave = Object.keys(respostas).find((k) => url.includes(k));
		if (!chave) return new Response("{}", { status: 404 });
		return new Response(JSON.stringify(respostas[chave]), { status: 200 });
	}) as unknown as typeof fetch;
	return { f, chamadas };
}

describe("Evolution (fetch falso)", () => {
	const cfg = { url: "http://127.0.0.1:8080/", chave: "segredo-x", instancia: "dgc" };

	it("sendText leva delay (digitando), apikey e o número que o WhatsApp conhece (com ou sem o 9)", async () => {
		const { f, chamadas } = fetchFalso({
			"/chat/whatsappNumbers/dgc": [{ exists: true, jid: "556284776000@s.whatsapp.net" }],
			"/message/sendText/dgc": { key: {} },
		});
		const evo = criarEvolution(cfg, f);
		await evo.enviarTexto("5562984776000@s.whatsapp.net", "oi", { digitarMs: 4000 });
		expect(chamadas[0]?.corpo.numbers).toEqual(["5562984776000", "556284776000"]);
		expect(chamadas[1]?.url).toBe("http://127.0.0.1:8080/message/sendText/dgc");
		expect(chamadas[1]?.corpo).toEqual({ number: "556284776000", text: "oi", delay: 4000 });
		expect(chamadas[1]?.cabecalhos.apikey).toBe("segredo-x");
	});

	it("sendMedia manda o PDF e o vídeo em base64", async () => {
		const dir = mkdtempSync(join(tmpdir(), "evo-"));
		try {
			writeFileSync(join(dir, "a.pdf"), "PDF");
			const { f, chamadas } = fetchFalso({
				"/chat/whatsappNumbers/dgc": [{ exists: true, number: "5562999585353" }],
				"/message/sendMedia/dgc": {},
			});
			const evo = criarEvolution(cfg, f);
			await evo.enviarDocumento("5562999585353@s.whatsapp.net", join(dir, "a.pdf"), "a.pdf");
			const m = chamadas.find((c) => c.url.includes("sendMedia"));
			expect(m?.corpo).toMatchObject({ mediatype: "document", fileName: "a.pdf", media: Buffer.from("PDF").toString("base64") });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("número que não está no WhatsApp não envia", async () => {
		const { f, chamadas } = fetchFalso({ "/chat/whatsappNumbers/dgc": [{ exists: false }] });
		await expect(criarEvolution(cfg, f).enviarTexto("5562999585353@s.whatsapp.net", "oi")).rejects.toThrow(/não está no WhatsApp/);
		expect(chamadas).toHaveLength(1);
	});

	it("estado: open = aberta; close com 401 = permanente; close sem código = queda comum", async () => {
		const casos: [object, unknown][] = [
			[{ connectionStatus: "open" }, { estado: "aberta" }],
			[{ connectionStatus: "close", disconnectionReasonCode: 401 }, { estado: "fechada", permanente: true, motivo: "401" }],
			[{ connectionStatus: "close", disconnectionReasonCode: null }, { estado: "fechada", permanente: false, motivo: "close" }],
		];
		for (const [inst, esperado] of casos) {
			const evo = criarEvolution(cfg, fetchFalso({ "/instance/fetchInstances": [inst] }).f);
			expect(await evo.estado()).toEqual(esperado);
		}
		const evo = criarEvolution(cfg, fetchFalso({ "/instance/fetchInstances": [{ connectionStatus: "open" }] }).f);
		expect(evo.conectado()).toBe(false);
		await evo.estado();
		expect(evo.conectado()).toBe(true);
	});

	it("erro HTTP não vaza a chave na mensagem", async () => {
		const evo = criarEvolution(cfg, fetchFalso({}).f);
		await expect(evo.estado()).rejects.toThrow(/404/);
		await expect(evo.estado()).rejects.not.toThrow(/segredo-x/);
	});
});

describe("Chatwoot (fetch falso)", () => {
	const cfg = { url: "http://127.0.0.1:3000", token: "tok-bot", conta: 1, gabrielId: 7 };

	it("nota privada, atribuição e status usam os caminhos e o token do bot", async () => {
		const { f, chamadas } = fetchFalso({ "/conversations/9/": {} });
		const cw = criarChatwoot(cfg, f);
		await cw.notaPrivada(9, "rascunho");
		await cw.atribuirGabriel(9);
		await cw.status(9, "open");
		expect(chamadas.map((c) => c.url)).toEqual([
			"http://127.0.0.1:3000/api/v1/accounts/1/conversations/9/messages",
			"http://127.0.0.1:3000/api/v1/accounts/1/conversations/9/assignments",
			"http://127.0.0.1:3000/api/v1/accounts/1/conversations/9/toggle_status",
		]);
		expect(chamadas[0]?.corpo).toEqual({ content: "rascunho", message_type: "outgoing", private: true });
		expect(chamadas[1]?.corpo).toEqual({ assignee_id: 7 });
		expect(chamadas[2]?.corpo).toEqual({ status: "open" });
		expect(chamadas[0]?.cabecalhos.api_access_token).toBe("tok-bot");
	});

	it("etiquetas: soma às existentes (a API troca o conjunto) e não repete chamada à toa", async () => {
		const { f, chamadas } = fetchFalso({ "/conversations/9/labels": { payload: ["1a-msg"] } });
		const cw = criarChatwoot(cfg, f);
		await cw.adicionarEtiquetas(9, ["respondeu"]);
		expect(chamadas.at(-1)?.corpo).toEqual({ labels: ["1a-msg", "respondeu"] });
		const n = chamadas.length;
		await cw.adicionarEtiquetas(9, ["1a-msg"]);
		expect(chamadas.length).toBe(n + 1); // só a leitura
	});

	it("acharConversa: contato pelo telefone e a conversa mais recente", async () => {
		const { f } = fetchFalso({
			"/contacts/search": { payload: [{ id: 3 }] },
			"/contacts/3/conversations": { payload: [{ id: 4 }, { id: 12 }] },
		});
		expect(await criarChatwoot(cfg, f).acharConversa("5562999585353")).toBe(12);
		const vazio = fetchFalso({ "/contacts/search": { payload: [] } }).f;
		expect(await criarChatwoot(cfg, vazio).acharConversa("5562999585353")).toBeNull();
	});
});
