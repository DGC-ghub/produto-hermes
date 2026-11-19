import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carregarCampanha } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { jidPermitido, protegerWhatsApp } from "../src/seguro.ts";
import { criarWebhook, traduzir } from "../src/webhook.ts";
import { campanha, conversaDe, criar, jidDe, MIN, textos, waFalso } from "./helpers.ts";

const ordem1 = ["amo", "interface", "villaca", "expodonto", "sencis"];
const destinos = (e: ReturnType<typeof criar>["wa"]["enviados"]) => textos(e).map((x) => x.jid);

describe("início travado e envio da 1ª leva", () => {
	it("sem /podeir nada sai", async () => {
		const t = criar();
		await t.rodar(600);
		expect(t.wa.enviados).toHaveLength(0);
	});

	it("/podeir mostra prévia com número mascarado e botões; só Liberar destrava", async () => {
		const t = criar();
		await t.gabriel({ tipo: "comando", nome: "podeir" });
		const m = t.tgMsgs.at(-1);
		expect(m?.texto).toContain("Amo Odontologia");
		expect(m?.texto).toContain("Posso mandar para o responsável pela clínica?");
		expect(m?.texto).not.toContain("5562999585353");
		expect(m?.botoes?.[0]?.map((b) => b.texto)).toEqual(["Liberar", "Cancelar"]);
		await t.gabriel({ tipo: "botao", dado: "lib:0" });
		await t.rodar(30);
		expect(t.wa.enviados).toHaveLength(0);
		await t.liberar();
		await t.rodar(1);
		expect(textos(t.wa.enviados)).toHaveLength(1);
	});

	it("manda na ordem da leva, 5 por dia, e respeita a janela de 9h às 17h", async () => {
		const t = criar({ rand: 1 }); // intervalo máximo (60 min)
		await t.liberar();
		t.irPara("2026-11-17T08:58:00");
		await t.rodar(1);
		expect(t.wa.enviados).toHaveLength(0); // antes das 9h
		await t.rodar(24 * 60);
		const alvo = ordem1.map((id) => jidDe(id));
		expect(destinos(t.wa.enviados)).toEqual(alvo);
	});

	it("limite diário: com máximo 3, o 4º só sai no dia útil seguinte", async () => {
		const t = criar({ ritmo: { maxPrimeirasPorDia: 3, intervaloMinMs: 0, intervaloMaxMs: 0 } });
		await t.liberar();
		await t.rodar(8 * 60); // terça 9h às 17h
		expect(textos(t.wa.enviados)).toHaveLength(3);
		t.irPara("2026-11-18T09:00:00");
		await t.rodar(30);
		expect(textos(t.wa.enviados)).toHaveLength(5);
	});

	it("não envia no feriado de 20/11 nem no fim de semana", async () => {
		const t = criar();
		await t.liberar();
		for (const dia of ["2026-11-20", "2026-11-21", "2026-11-22"]) {
			t.irPara(`${dia}T10:00:00`);
			await t.rodar(8 * 60);
		}
		expect(t.wa.enviados).toHaveLength(0);
		t.irPara("2026-11-23T09:00:00");
		await t.rodar(1);
		expect(textos(t.wa.enviados)).toHaveLength(1);
	});

	it("intervalo entre mensagens: 20 min no mínimo, 60 no máximo", async () => {
		for (const [rand, espera] of [
			[0, 20],
			[1, 60],
		] as const) {
			const t = criar({ rand });
			await t.liberar();
			await t.rodar(1);
			expect(textos(t.wa.enviados)).toHaveLength(1);
			await t.rodar(espera - 1);
			expect(textos(t.wa.enviados)).toHaveLength(1);
			await t.rodar(1);
			expect(textos(t.wa.enviados)).toHaveLength(2);
		}
	});

	it("o texto enviado traz a assinatura do Gabriel e nenhum [nome]", async () => {
		const t = criar();
		await t.liberar();
		await t.rodar(1);
		const txt = textos(t.wa.enviados)[0]?.texto ?? "";
		expect(txt).toContain("Aqui é o Gabriel, da DGC Hub");
		expect(txt).not.toContain("[");
	});
});

describe("lembretes D3 e D7", () => {
	async function primeiraLevaEnviada() {
		const t = criar({ ritmo: { intervaloMinMs: 0, intervaloMaxMs: 0 } });
		await t.liberar();
		await t.rodar(10);
		expect(textos(t.wa.enviados)).toHaveLength(5);
		return t;
	}

	it("D3 na segunda 23/11 (3º dia útil, pulando o feriado), D7 na sexta 27/11 e depois encerra", async () => {
		const t = await primeiraLevaEnviada();
		t.irPara("2026-11-19T10:00:00");
		await t.rodar(8 * 60);
		expect(textos(t.wa.enviados)).toHaveLength(5); // nada antes do 3º dia útil
		t.irPara("2026-11-23T09:00:00");
		await t.rodar(10 * 60);
		const d3 = textos(t.wa.enviados).slice(5);
		expect(d3).toHaveLength(5);
		expect(d3[0]?.texto).toContain("Só passando para saber");
		t.irPara("2026-11-27T09:00:00");
		await t.rodar(10 * 60);
		const d7 = textos(t.wa.enviados).slice(10);
		expect(d7).toHaveLength(5);
		expect(d7[0]?.texto).toContain("Última mensagem da minha parte");
		expect(t.store.clinicas().filter((c) => c.status !== "fila").every((c) => c.status === "encerrado")).toBe(true);
		t.irPara("2026-12-02T09:00:00");
		await t.rodar(10 * 60);
		expect(textos(t.wa.enviados)).toHaveLength(15); // nada além do 7º dia
	});

	it("qualquer mensagem da clínica cancela os lembretes dela", async () => {
		const t = await primeiraLevaEnviada();
		await t.diz("villaca", "oi, quem fala?");
		t.irPara("2026-11-23T09:00:00");
		await t.rodar(10 * 60);
		const d3 = textos(t.wa.enviados).slice(5).map((x) => x.jid);
		expect(d3).toHaveLength(4);
		expect(d3).not.toContain(jidDe("villaca"));
		t.irPara("2026-11-27T09:00:00");
		await t.rodar(10 * 60);
		expect(textos(t.wa.enviados).map((x) => x.jid).filter((j) => j === jidDe("villaca"))).toHaveLength(1);
	});

	it("depois de uma parada longa, manda só o D7 (nunca D3 e D7 seguidos)", async () => {
		const t = await primeiraLevaEnviada();
		t.irPara("2026-12-01T09:00:00");
		await t.rodar(10 * 60);
		const novos = textos(t.wa.enviados).slice(5);
		expect(novos).toHaveLength(5);
		expect(novos.every((x) => x.texto?.includes("Última mensagem"))).toBe(true);
	});
});

describe("respostas da clínica", () => {
	async function comAmoAguardando() {
		const t = criar({ ritmo: { esperaRespostaMinMs: 5 * MIN, esperaRespostaMaxMs: 5 * MIN } });
		await t.liberar();
		await t.rodar(1);
		t.wa.enviados.length = 0;
		return t;
	}

	it("sim claro: espera, depois manda 2ª mensagem, vídeo e PDF da clínica", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "Pode mandar!");
		await t.rodar(4);
		expect(t.wa.enviados).toHaveLength(0);
		await t.rodar(2);
		expect(t.wa.enviados.map((e) => e.tipo)).toEqual(["texto", "video", "doc"]);
		expect(t.wa.enviados[1]?.arquivo).toBe("/midia/demo-recepcionista-ia-v2.mp4");
		expect(t.wa.enviados[2]?.arquivo).toBe("/midia/amo-odontologia.pdf");
		expect(t.store.clinica("amo").status).toBe("kit_enviado");
		await t.diz("amo", "sim"); // um segundo "sim" não duplica o kit
		await t.rodar(30);
		expect(t.wa.enviados.filter((e) => e.jid === jidDe("amo"))).toHaveLength(3);
	});

	it("resposta automática fora da janela fica para as 8h do dia seguinte", async () => {
		const t = criar({ ritmo: { esperaRespostaMinMs: 5 * MIN, esperaRespostaMaxMs: 5 * MIN } });
		await t.liberar();
		await t.rodar(1);
		t.wa.enviados.length = 0;
		t.irPara("2026-11-17T18:58:00");
		await t.diz("amo", "sim");
		await t.rodar(60);
		expect(t.wa.enviados).toHaveLength(0);
		t.irPara("2026-11-18T08:00:00");
		await t.rodar(1);
		expect(t.wa.enviados).toHaveLength(3);
	});

	it("não: agradece, marca 'parou' e nunca mais escreve (nem lembrete)", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "Não tenho interesse");
		await t.rodar(10);
		expect(textos(t.wa.enviados).map((e) => e.texto)).toEqual([
			"Entendido, obrigado por responder! Não vou mais mandar mensagem.",
		]);
		expect(t.store.clinica("amo").status).toBe("parou");
		t.irPara("2026-11-30T09:00:00");
		t.wa.enviados.length = 0;
		await t.rodar(8 * 60);
		expect(t.wa.enviados.filter((e) => e.jid === jidDe("amo"))).toHaveLength(0);
		await t.diz("amo", "pode mandar");
		await t.rodar(30);
		expect(t.wa.enviados.filter((e) => e.jid === jidDe("amo"))).toHaveLength(0);
	});

	it("é robô?: manda a frase honesta, passa ao Gabriel e avisa no Telegram", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "isso é um robô?");
		expect(textos(t.wa.enviados).map((e) => e.texto)).toEqual(["Sou o assistente do Gabriel; ele mesmo te responde já já."]);
		expect(t.tgMsgs.at(-1)?.texto).toContain("perguntou se é robô");
		expect(t.cw.etiquetasDe("amo")).toContain("com-gabriel");
		expect(t.cw.atribuidas).toContain(conversaDe("amo"));
		expect(t.cw.status.at(-1)).toEqual({ conversaId: conversaDe("amo"), status: "open" });
	});

	it("preço: nada vai à clínica; nota privada com rascunho, etiqueta, atribuição e open", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "Quanto custa?");
		await t.rodar(60);
		expect(t.wa.enviados.filter((e) => e.jid === jidDe("amo"))).toHaveLength(0);
		const nota = t.cw.notas.at(-1);
		expect(nota?.conversaId).toBe(conversaDe("amo"));
		expect(nota?.texto).toContain("Quanto custa?");
		expect(nota?.texto).toContain("R$ 990");
		expect(nota?.texto).toMatch(/quarta às 10h/);
		expect(t.cw.etiquetasDe("amo")).toEqual(expect.arrayContaining(["com-gabriel", "respondeu"]));
		expect(t.cw.atribuidas).toEqual([conversaDe("amo")]);
		expect(t.cw.status.at(-1)?.status).toBe("open");
		expect(t.store.pendenciasAbertas()).toHaveLength(1);
	});

	it("áudio e ligação escalam com o rótulo, sem mensagem à clínica", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", null, "audio");
		expect(t.cw.notas.at(-1)?.texto).toContain("[áudio]");
		await t.diz("interface", null, "ligacao"); // na mesma conversa, com com-gabriel, o robô já fica quieto
		expect(t.cw.notas.at(-1)?.texto).toContain("[ligação perdida]");
		expect(t.wa.enviados).toHaveLength(0);
	});

	it("mensagem depois do kit vai para o Gabriel; o kit ganha a etiqueta", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "sim");
		await t.rodar(10);
		expect(t.cw.etiquetasDe("amo")).toContain("kit-enviado");
		const antes = t.cw.notas.length;
		t.wa.enviados.length = 0;
		await t.diz("amo", "sim, gostei");
		expect(t.cw.notas).toHaveLength(antes + 1);
		expect(t.wa.enviados).toHaveLength(0);
	});

	it("sim e depois pare: o kit não sai, nada vai à clínica, o Gabriel decide", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		await t.diz("amo", "sim");
		await t.diz("amo", "pare, não quero mais");
		await t.rodar(30);
		expect(amo()).toHaveLength(0);
		expect(t.store.clinica("amo").status).toBe("manual");
		expect(t.cw.etiquetasDe("amo")).toContain("com-gabriel");
		expect(t.cw.etiquetasDe("amo")).not.toContain("nao-quer");
		expect(t.cw.notas.at(-1)?.texto).toContain("parece pedido para parar, confira");
		expect(t.cw.atribuidas).toContain(conversaDe("amo"));
		expect(t.cw.status.at(-1)).toEqual({ conversaId: conversaDe("amo"), status: "open" });
	});

	it("'pare' depois do kit: sem resposta automática, nota privada e com-gabriel", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		await t.diz("amo", "sim");
		await t.rodar(10);
		t.cw.tiraEtiqueta("amo", "com-gabriel");
		t.wa.enviados.length = 0;
		await t.diz("amo", "pode parar de mandar");
		await t.rodar(10);
		expect(amo()).toHaveLength(0);
		expect(t.store.clinica("amo").status).not.toBe("parou");
		expect(t.cw.etiquetasDe("amo")).toContain("com-gabriel");
		expect(t.cw.notas.at(-1)?.texto).toContain("parece pedido para parar, confira");
	});

	it("depois do kit, 'Não quero perder isso, me liga amanhã': nada para a clínica, nota e com-gabriel", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		await t.diz("amo", "sim");
		await t.rodar(10);
		t.cw.tiraEtiqueta("amo", "com-gabriel");
		t.wa.enviados.length = 0;
		const notas = t.cw.notas.length;
		await t.diz("amo", "Não quero perder isso, me liga amanhã");
		await t.rodar(10);
		expect(amo()).toHaveLength(0);
		expect(t.cw.notas).toHaveLength(notas + 1);
		expect(t.cw.notas.at(-1)?.texto).not.toContain("parece pedido para parar");
		expect(t.cw.etiquetasDe("amo")).toContain("com-gabriel");
		expect(t.cw.etiquetasDe("amo")).not.toContain("nao-quer");
		expect(t.store.clinica("amo").status).toBe("kit_enviado");
		expect(t.cw.status.at(-1)).toEqual({ conversaId: conversaDe("amo"), status: "open" });
	});

	it("'Não quero agora, mas me manda o vídeo' (aguardando): passa ao Gabriel e não responde", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		await t.diz("amo", "Não quero agora, mas me manda o vídeo");
		await t.rodar(10);
		expect(amo()).toHaveLength(0);
		expect(t.store.clinica("amo").status).toBe("aguardando");
		expect(t.cw.etiquetasDe("amo")).toContain("com-gabriel");
	});

	it("corrida: o 'pare' chega no meio do envio do vídeo e o PDF não sai", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		const video = t.wa.port.enviarVideo;
		t.wa.port.enviarVideo = async (jid, arq, l) => {
			await video(jid, arq, l);
			t.cw.poeEtiqueta("amo", "com-gabriel");
			await t.diz("amo", "pare");
		};
		await t.diz("amo", "sim");
		await t.rodar(10);
		expect(amo().map((e) => e.tipo)).toEqual(["texto", "video"]);
		expect(t.store.clinica("amo").status).not.toBe("kit_enviado");
		expect(t.cw.etiquetasDe("amo")).not.toContain("kit-enviado");
		await t.rodar(30);
		expect(amo().map((e) => e.tipo)).toEqual(["texto", "video"]);
	});

	it("corrida só de etiqueta (nao-quer posta no meio do envio): o PDF não sai", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		const video = t.wa.port.enviarVideo;
		t.wa.port.enviarVideo = async (jid, arq, l) => {
			await video(jid, arq, l);
			t.cw.poeEtiqueta("amo", "nao-quer");
		};
		await t.diz("amo", "sim");
		await t.rodar(10);
		expect(amo().map((e) => e.tipo)).toEqual(["texto", "video"]);
		expect(t.store.clinica("amo").status).not.toBe("kit_enviado");
	});

	it("corrida só de status (Gabriel assumiu no meio do envio): o PDF não sai", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		const video = t.wa.port.enviarVideo;
		t.wa.port.enviarVideo = async (jid, arq, l) => {
			await video(jid, arq, l);
			t.store.atualizarClinica("amo", { status: "manual" });
		};
		await t.diz("amo", "sim");
		await t.rodar(10);
		expect(amo().map((e) => e.tipo)).toEqual(["texto", "video"]);
		expect(t.store.clinica("amo").status).toBe("manual");
	});

	it("corrida: se virou 'parou' durante o envio, o status nunca volta para kit_enviado", async () => {
		const t = await comAmoAguardando();
		const amo = () => t.wa.enviados.filter((e) => e.jid === jidDe("amo"));
		const pdf = t.wa.port.enviarDocumento;
		t.wa.port.enviarDocumento = async (jid, arq, n) => {
			await pdf(jid, arq, n);
			t.store.atualizarClinica("amo", { status: "parou" });
		};
		await t.diz("amo", "sim");
		await t.rodar(10);
		expect(t.store.clinica("amo").status).toBe("parou");
	});

	it("'não' põe nao-quer e resolve a conversa depois de agradecer", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "pare, por favor");
		await t.rodar(10);
		expect(t.cw.etiquetasDe("amo")).toContain("nao-quer");
		expect(t.cw.status.at(-1)).toEqual({ conversaId: conversaDe("amo"), status: "resolved" });
	});

	it("1ª mensagem ganha a etiqueta 1a-msg, mesmo se a conversa só aparecer depois", async () => {
		const t = criar();
		t.cw.estado.existe = false;
		await t.liberar();
		await t.rodar(3);
		expect(t.cw.etiquetasDe("amo")).not.toContain("1a-msg");
		t.cw.estado.existe = true;
		await t.rodar(1);
		expect(t.cw.etiquetasDe("amo")).toContain("1a-msg");
	});
});

describe("conversa no Chatwoot: etiquetas e fora da campanha", () => {
	async function comAmoAguardando() {
		const t = criar({ ritmo: { esperaRespostaMinMs: MIN, esperaRespostaMaxMs: MIN } });
		await t.liberar();
		await t.rodar(1);
		t.wa.enviados.length = 0;
		return t;
	}

	it("conversa de quem não está na campanha: open, sem resposta e sem nota", async () => {
		const t = criar();
		await t.liberar();
		t.wa.enviados.length = 0;
		await t.robo.aoReceber({ jid: "5511999999999@s.whatsapp.net", texto: "sim", tipo: "texto", conversaId: 777 });
		expect(t.wa.enviados).toHaveLength(0);
		t.store.definirEstado("pausado", "1"); // só a conversa de fora é o que importa daqui para a frente
		await t.rodar(30);
		expect(t.cw.status).toEqual([{ conversaId: 777, status: "open" }]);
		expect(t.cw.notas).toHaveLength(0);
		expect(t.cw.atribuidas).toHaveLength(0);
		expect(t.wa.enviados).toHaveLength(0);
		await t.robo.aoReceber({ jid: "123@g.us", texto: "sim", tipo: "texto", conversaId: 778, grupo: true });
		expect(t.cw.status).toHaveLength(1);
	});

	for (const etq of ["robo-pausado", "com-gabriel", "nao-quer"]) {
		it(`com a etiqueta ${etq} o robô não escreve nada nem anota`, async () => {
			const t = await comAmoAguardando();
			t.cw.poeEtiqueta("amo", etq);
			await t.diz("amo", "sim");
			await t.diz("amo", "Quanto custa?");
			await t.rodar(30);
			expect(t.wa.enviados.filter((e) => e.jid === jidDe("amo"))).toHaveLength(0);
			expect(t.cw.notas).toHaveLength(0);
		});
	}

	it("etiqueta posta depois do 'sim' cancela o kit que estava na fila", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "sim");
		t.cw.poeEtiqueta("amo", "robo-pausado");
		await t.rodar(10);
		expect(t.wa.enviados).toHaveLength(0);
	});

	it("robo-pausado na conversa bloqueia também o lembrete D3, só dessa clínica", async () => {
		const t = criar({ ritmo: { intervaloMinMs: 0, intervaloMaxMs: 0 } });
		await t.liberar();
		await t.rodar(10);
		t.wa.enviados.length = 0;
		t.cw.poeEtiqueta("villaca", "robo-pausado");
		t.irPara("2026-11-23T09:00:00");
		await t.rodar(10 * 60);
		const alvos = textos(t.wa.enviados).map((x) => x.jid);
		expect(alvos).toHaveLength(4);
		expect(alvos).not.toContain(jidDe("villaca"));
	});

	it("se o Chatwoot cair, o robô não escreve e tenta de novo depois", async () => {
		const t = await comAmoAguardando();
		await t.diz("amo", "sim");
		t.cw.estado.falha = true;
		await t.rodar(10);
		expect(t.wa.enviados).toHaveLength(0);
		t.cw.estado.falha = false;
		await t.rodar(2);
		expect(t.wa.enviados.map((e) => e.tipo)).toEqual(["texto", "video", "doc"]);
	});

	it("lembrete das 4h só vale sem resposta humana: se o Gabriel escreveu, não lembra", async () => {
		const t = criar();
		t.irPara("2026-11-18T17:00:00");
		await t.diz("sencis", "Quanto custa?");
		await t.robo.aoSaida({ conversaId: conversaDe("sencis"), humano: true, privada: false });
		t.irPara("2026-11-19T12:00:00");
		await t.robo.tick();
		expect(t.tgMsgs.filter((m) => m.texto.startsWith("Lembrete"))).toHaveLength(0);
	});

	it("4 horas comerciais sem resposta humana: lembra no Telegram e não envia nada", async () => {
		const t = criar();
		t.irPara("2026-11-18T17:00:00"); // quarta: 1h comercial na quarta + 3h na quinta
		await t.diz("sencis", "Quanto custa?");
		await t.robo.aoSaida({ conversaId: conversaDe("sencis"), humano: false, privada: false });
		await t.robo.aoSaida({ conversaId: conversaDe("sencis"), humano: true, privada: true }); // nota privada não conta
		t.irPara("2026-11-19T11:59:00");
		await t.robo.tick();
		expect(t.tgMsgs.filter((m) => m.texto.startsWith("Lembrete"))).toHaveLength(0);
		t.irPara("2026-11-19T12:00:00");
		await t.robo.tick();
		expect(t.tgMsgs.filter((m) => m.texto.startsWith("Lembrete")).length).toBeGreaterThan(0);
		expect(textos(t.wa.enviados)).toHaveLength(0);
	});

	it("lembrete das 4h: nenhum para clínica parou ou com nao-quer", async () => {
		const t = criar();
		t.irPara("2026-11-18T17:00:00");
		await t.diz("sencis", "Quanto custa?");
		await t.diz("interface", "Quanto custa?");
		t.store.atualizarClinica("sencis", { status: "parou" });
		t.cw.poeEtiqueta("interface", "nao-quer");
		t.irPara("2026-11-19T12:00:00");
		await t.robo.tick();
		expect(t.tgMsgs.filter((m) => m.texto.startsWith("Lembrete"))).toHaveLength(0);
	});

	it("o robô só obedece ao chat do Gabriel", async () => {
		const t = criar();
		await t.robo.aoTelegram("999", { tipo: "comando", nome: "pausar" });
		await t.robo.aoTelegram("999", { tipo: "botao", dado: "lib:1" });
		expect(t.store.estado("pausado")).toBeNull();
		expect(t.store.estado("liberado")).toBeNull();
		expect(t.tgMsgs).toHaveLength(0);
	});
});

describe("webhook do Chatwoot", () => {
	const base = {
		event: "message_created",
		message_type: "incoming",
		content: "Quanto custa?",
		conversation: { id: 55, labels: ["1a-msg"], meta: { sender: { phone_number: "+5562999585353" } } },
	};

	it("traduz mensagem de entrada com telefone, conversa e etiquetas", () => {
		const t = traduzir(base);
		expect(t?.entrada).toEqual({
			jid: "5562999585353@s.whatsapp.net",
			texto: "Quanto custa?",
			tipo: "texto",
			conversaId: 55,
			etiquetas: ["1a-msg"],
		});
	});

	it("anexo vira áudio, imagem ou documento, sem texto", () => {
		expect(traduzir({ ...base, content: null, attachments: [{ file_type: "audio" }] })?.entrada?.tipo).toBe("audio");
		expect(traduzir({ ...base, content: "", attachments: [{ file_type: "image" }] })?.entrada?.tipo).toBe("imagem");
		expect(traduzir({ ...base, attachments: [{ file_type: "file" }] })?.entrada?.texto).toBeNull();
	});

	it("mensagem de saída nunca vira entrada (sem loop): só diz se foi gente", () => {
		const humano = traduzir({ ...base, message_type: "outgoing", sender: { type: "user" } });
		expect(humano?.entrada).toBeUndefined();
		expect(humano?.saida).toEqual({ conversaId: 55, humano: true, privada: false });
		expect(traduzir({ ...base, message_type: "outgoing", sender: { type: "agent_bot" } })?.saida?.humano).toBe(false);
	});

	it("ignora outros eventos e grupos", () => {
		expect(traduzir({ ...base, event: "conversation_status_changed" })).toBeNull();
		expect(traduzir({ ...base, conversation: { id: 1, meta: { sender: { identifier: "123@g.us" } } } })).toBeNull();
	});
});

describe("token do webhook", () => {
	it("aceita só o token exato (comparação em tempo constante)", async () => {
		const t = criar();
		const srv = criarWebhook(t.robo, "segredo-certo", () => {});
		await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
		const porta = (srv.address() as { port: number }).port;
		const post = (q: string) => fetch(`http://127.0.0.1:${porta}/chatwoot${q}`, { method: "POST", body: "{}" }).then((r) => r.status);
		try {
			expect(await post("")).toBe(401);
			expect(await post("?token=errado")).toBe(401);
			expect(await post("?token=segredo-certo-")).toBe(401);
			expect(await post("?token=segredo-certo")).toBe(200);
		} finally {
			srv.close();
		}
	});
});

describe("pausa, trava e bloqueio", () => {
	it("/pausar congela tudo, inclusive a fila; /retomar volta", async () => {
		const t = criar({ ritmo: { esperaRespostaMinMs: MIN, esperaRespostaMaxMs: MIN } });
		await t.liberar();
		await t.rodar(1);
		await t.diz("amo", "sim");
		await t.gabriel({ tipo: "comando", nome: "pausar" });
		t.wa.enviados.length = 0;
		await t.rodar(120);
		expect(t.wa.enviados).toHaveLength(0);
		await t.gabriel({ tipo: "comando", nome: "retomar" });
		await t.rodar(2);
		expect(t.wa.enviados.some((e) => e.tipo === "doc")).toBe(true);
	});

	it("trava do JID: número fora da campanha e grupos são recusados no envio", async () => {
		const wa = waFalso();
		const seguro = protegerWhatsApp(wa.port, campanha);
		await expect(seguro.enviarTexto("5511999999999@s.whatsapp.net", "oi")).rejects.toThrow(/fora da campanha/);
		await expect(seguro.enviarTexto("123456@g.us", "oi")).rejects.toThrow();
		await expect(seguro.enviarVideo("5511999999999@s.whatsapp.net", "/x.mp4")).rejects.toThrow();
		await expect(seguro.enviarDocumento("5511999999999@s.whatsapp.net", "/x.pdf", "x.pdf")).rejects.toThrow();
		expect(wa.enviados).toHaveLength(0);
		expect(jidPermitido(campanha, jidDe("amo"))).toBe(true);

	});

	it("loggedOut/ban: pausa tudo, avisa e só volta com /retomar forcar", async () => {
		const t = criar();
		await t.liberar();
		await t.robo.aoConexao({ estado: "fechada", permanente: true, motivo: "401" });
		expect(t.tgMsgs.at(-1)?.texto).toContain("Não troque de chip");
		await t.rodar(60);
		expect(t.wa.enviados).toHaveLength(0);
		await t.gabriel({ tipo: "comando", nome: "retomar" });
		await t.rodar(5);
		expect(t.wa.enviados).toHaveLength(0);
		await t.gabriel({ tipo: "comando", nome: "retomar", arg: "forcar" });
		await t.rodar(1);
		expect(textos(t.wa.enviados)).toHaveLength(1);
	});

	it("queda comum de rede: avisa só depois de 10 minutos, uma vez", async () => {
		const t = criar();
		t.irPara("2026-11-21T10:00:00"); // sábado: sem resumo das 8h no meio
		t.wa.ligar(false);
		await t.rodar(9);
		expect(t.tgMsgs).toHaveLength(0);
		await t.rodar(3);
		expect(t.tgMsgs.filter((m) => m.texto.includes("fora do ar"))).toHaveLength(1);
		await t.rodar(30);
		expect(t.tgMsgs.filter((m) => m.texto.includes("fora do ar"))).toHaveLength(1);
		t.wa.ligar(true);
		await t.rodar(1);
		expect(t.tgMsgs.at(-1)?.texto).toContain("voltou");
	});

	it("com o WhatsApp desconectado nada é enviado", async () => {
		const t = criar();
		await t.liberar();
		t.wa.ligar(false);
		await t.rodar(30);
		expect(t.wa.enviados).toHaveLength(0);
	});
});

describe("reinício e idempotência", () => {
	it("depois de reiniciar, não repete o que já foi enviado", async () => {
		const dir = mkdtempSync(join(tmpdir(), "robo-"));
		const caminho = join(dir, "funil.sqlite");
		try {
			const a = criar({ caminho, ritmo: { intervaloMinMs: 0, intervaloMaxMs: 0 } });
			await a.liberar();
			await a.rodar(2);
			expect(textos(a.wa.enviados)).toHaveLength(2);
			a.store.fechar();

			const b = criar({ caminho, agora: a.relogio.t, ritmo: { intervaloMinMs: 0, intervaloMaxMs: 0 } });
			await b.rodar(1);
			expect(destinos(b.wa.enviados)).toEqual([jidDe("villaca")]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("envio gravado mas status perdido (queda no meio): não reenvia e segue para a próxima", async () => {
		const t = criar({ ritmo: { intervaloMinMs: 0, intervaloMaxMs: 0 } });
		await t.liberar();
		t.store.registrarEnvio("amo:primeira", "amo", "primeira", t.relogio.t, t.ctx.cal.diaId(t.relogio.t));
		await t.rodar(1);
		expect(t.store.clinica("amo").status).toBe("aguardando");
		expect(destinos(t.wa.enviados)).toEqual([jidDe("interface")]);
	});

	it("se o envio falhar, a chave é desfeita e tenta de novo", async () => {
		const t = criar();
		await t.liberar();
		let falhar = true;
		const original = t.wa.port.enviarTexto;
		t.wa.port.enviarTexto = async (...a) => {
			if (falhar) throw new Error("rede");
			return original(...a);
		};
		await t.rodar(1);
		expect(t.store.temEnvio("amo:primeira")).toBe(false);
		falhar = false;
		await t.rodar(1);
		expect(t.store.temEnvio("amo:primeira")).toBe(true);
	});

	it("o Store reabre com o mesmo estado", () => {
		const s = new Store(":memory:");
		s.definirEstado("x", "1");
		expect(s.estado("x")).toBe("1");
	});
});

describe("2ª leva e resumo", () => {
	async function leva1Enviada() {
		const t = criar({ ritmo: { intervaloMinMs: 0, intervaloMaxMs: 0 } });
		await t.liberar();
		await t.rodar(10);
		return t;
	}

	it("pede o toque do Gabriel 3 dias úteis depois; só começa depois de 'Começar 2ª leva'", async () => {
		const t = await leva1Enviada();
		t.irPara("2026-11-23T09:00:00");
		await t.rodar(2); // vai o D3 antes; a 2ª leva fica atrás dos lembretes
		await t.rodar(20);
		const pergunta = t.tgMsgs.filter((m) => m.texto.includes("Começar a 2ª leva"));
		expect(pergunta).toHaveLength(1);
		expect(t.wa.enviados.some((e) => e.jid === jidDe("cco"))).toBe(false);
		await t.gabriel({ tipo: "botao", dado: "leva2:sim" });
		await t.rodar(5);
		expect(destinos(t.wa.enviados)).toContain(jidDe("cco"));
	});

	it("se alguém da 1ª leva respondeu, a 2ª leva não começa nem pergunta", async () => {
		const t = await leva1Enviada();
		await t.diz("sencis", "Quanto custa?");
		t.irPara("2026-11-24T09:00:00");
		await t.rodar(6 * 60);
		expect(t.tgMsgs.some((m) => m.texto.includes("Começar a 2ª leva"))).toBe(false);
		expect(t.wa.enviados.some((e) => e.jid === jidDe("cco"))).toBe(false);
	});

	it("resumo das 8h: uma vez por dia útil, nunca no feriado", async () => {
		const t = criar();
		t.irPara("2026-11-18T07:59:00");
		await t.rodar(1);
		expect(t.tgMsgs).toHaveLength(0);
		await t.rodar(3);
		await t.rodar(600);
		const resumos = t.tgMsgs.filter((m) => m.texto.startsWith("Resumo de hoje (18/11)"));
		expect(resumos).toHaveLength(1);
		expect(resumos[0]?.texto).toContain("Funil:");
		expect(resumos[0]?.texto).toContain("Nada sai: falta o seu /podeir.");
		t.tgMsgs.length = 0;
		t.irPara("2026-11-20T08:30:00");
		await t.rodar(30);
		expect(t.tgMsgs).toHaveLength(0);
	});

	it("/funil e /status respondem", async () => {
		const t = await leva1Enviada();
		await t.gabriel({ tipo: "comando", nome: "funil" });
		expect(t.tgMsgs.at(-1)?.texto).toContain("Amo Odontologia: aguardando | 1ª msg 17/11 | próximo: lembrete do 3º dia em 23/11");
		await t.gabriel({ tipo: "comando", nome: "status" });
		expect(t.tgMsgs.at(-1)?.texto).toContain("1ªs mensagens hoje: 5/5");
	});
});

describe("campanha.json", () => {
	it("tem as 10 clínicas, na ordem do plano, com telefone público e fonte", () => {
		expect(campanha.clinicas.map((c) => c.id)).toEqual([
			"amo", "interface", "villaca", "expodonto", "sencis", "cco", "odontosin", "angela", "vintage", "stoa",
		]);
		for (const c of campanha.clinicas) {
			expect(c.telefone, c.id).toMatch(/^55\d{10,11}$/);
			expect(c.fonteTelefone, c.id).toMatch(/^https:\/\//);
			expect(c.pdf, c.id).toMatch(/\.pdf$/);
			for (const t of [c.primeira, c.segunda, c.lembreteD3, c.ultimoD7, c.pare]) expect(t).not.toContain("[");
			expect(c.primeira).toContain("Aqui é o Gabriel, da DGC Hub");
			expect(c.primeira).toMatch(/Posso mandar para (o responsável pela clínica|o Dr\. Rafael ou para quem cuida da clínica)\?$/);
		}
		expect(campanha.clinicas.filter((c) => c.leva === 1)).toHaveLength(5);
	});
});

describe("modo teste", () => {
	it("recusa campanha-teste.json com o telefone vazio e aceita preenchido", () => {
		const caminho = join(import.meta.dirname, "../config/campanha-teste.json");
		expect(() => carregarCampanha(caminho, true)).toThrow(/preencha o telefone/);
		expect(() => carregarCampanha(join(import.meta.dirname, "../config/campanha.json"), false)).not.toThrow();
	});
});
