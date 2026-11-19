import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calendarioReal } from "../src/calendario.ts";
import { Store } from "../src/db.ts";
import { ritmoDe } from "../src/config.ts";
import { Robo } from "../src/robo.ts";
import { protegerWhatsApp } from "../src/seguro.ts";
import type { Botao, Campanha, Ctx, Ritmo, WhatsAppPort } from "../src/types.ts";

export const MIN = 60_000;
export const HORA = 60 * MIN;
/** Terça 17/11/2026, 09:00 em Brasília (UTC-3). */
export const TER_9H = Date.parse("2026-11-17T12:00:00Z");
export const em = (iso: string) => Date.parse(`${iso}-03:00`);

export const campanha = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../config/campanha.json"), "utf8"),
) as Campanha;

export interface Enviado {
	tipo: "texto" | "video" | "doc";
	jid: string;
	texto?: string;
	arquivo?: string;
}

export function waFalso() {
	const enviados: Enviado[] = [];
	let on = true;
	const port: WhatsAppPort = {
		conectado: () => on,
		enviarTexto: async (jid, texto) => void enviados.push({ tipo: "texto", jid, texto }),
		enviarVideo: async (jid, arquivo) => void enviados.push({ tipo: "video", jid, arquivo }),
		enviarDocumento: async (jid, arquivo) => void enviados.push({ tipo: "doc", jid, arquivo }),
	};
	return { port, enviados, ligar: (v: boolean) => (on = v) };
}

export interface MsgTg {
	texto: string;
	botoes?: Botao[][];
}

export function criar(opts: { agora?: number; rand?: number; ritmo?: Partial<Ritmo>; caminho?: string } = {}) {
	const relogio = { t: opts.agora ?? TER_9H };
	const wa = waFalso();
	const tgMsgs: MsgTg[] = [];
	const store = new Store(opts.caminho ?? ":memory:");
	store.semear(campanha);
	const ctx: Ctx = {
		store,
		wa: protegerWhatsApp(wa.port, campanha),
		tg: {
			enviar: async (texto, botoes) => void tgMsgs.push({ texto, botoes }),
			enviarImagem: async (_p, legenda) => void tgMsgs.push({ texto: `[imagem] ${legenda}` }),
		},
		cal: calendarioReal(),
		ritmo: { ...ritmoDe(false), ...opts.ritmo },
		campanha,
		agora: () => relogio.t,
		rand: () => opts.rand ?? 0,
		midiaDir: "/midia",
		log: () => {},
	};
	const robo = new Robo(ctx, "42");
	return {
		ctx,
		robo,
		store,
		wa,
		tgMsgs,
		relogio,
		avancar: (ms: number) => void (relogio.t += ms),
		irPara: (iso: string) => void (relogio.t = em(iso)),
		/** Gabriel, no chat certo. */
		gabriel: (ev: Parameters<Robo["aoTelegram"]>[1]) => robo.aoTelegram("42", ev),
		liberar: async () => {
			await robo.aoTelegram("42", { tipo: "botao", dado: "lib:1" });
		},
		/** Roda o agendador minuto a minuto. */
		rodar: async (minutos: number) => {
			for (let i = 0; i < minutos; i++) {
				await robo.tick();
				relogio.t += MIN;
			}
		},
		diz: (clinicaId: string, texto: string | null, tipo: "texto" | "audio" | "ligacao" = "texto") => {
			const c = campanha.clinicas.find((x) => x.id === clinicaId);
			return robo.aoReceber({ jid: `${c?.telefone}@s.whatsapp.net`, texto, tipo });
		},
	};
}

export const textos = (enviados: Enviado[]) => enviados.filter((e) => e.tipo === "texto");
import { jidDe as jidDeTel } from "../src/telefone.ts";

export const jidDe = (id: string) => jidDeTel(campanha.clinicas.find((c) => c.id === id)?.telefone as string);
