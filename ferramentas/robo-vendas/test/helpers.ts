import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calendarioReal } from "../src/calendario.ts";
import { Store } from "../src/db.ts";
import { ritmoDe } from "../src/config.ts";
import { Robo } from "../src/robo.ts";
import { criarAvisos } from "../src/avisos.ts";
import { protegerComando, protegerWhatsApp } from "../src/seguro.ts";
import { canonico } from "../src/telefone.ts";
import type { Campanha, ChatwootPort, Ctx, Ritmo, Status_, WhatsAppPort } from "../src/types.ts";

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
		estado: async () => (on ? { estado: "aberta" as const } : { estado: "fechada" as const, permanente: false }),
		enviarTexto: async (jid, texto) => void enviados.push({ tipo: "texto", jid, texto }),
		enviarVideo: async (jid, arquivo) => void enviados.push({ tipo: "video", jid, arquivo }),
		enviarDocumento: async (jid, arquivo) => void enviados.push({ tipo: "doc", jid, arquivo }),
	};
	return { port, enviados, ligar: (v: boolean) => (on = v) };
}

export const conversaDe = (clinicaId: string) => 100 + campanha.clinicas.findIndex((c) => c.id === clinicaId);

/** Chatwoot falso: guarda notas, etiquetas, atribuições e status. Nada de rede. */
export function cwFalso() {
	const etiquetas = new Map<number, Set<string>>();
	const notas: { conversaId: number; texto: string }[] = [];
	const atribuidas: number[] = [];
	const status: { conversaId: number; status: Status_ }[] = [];
	const estado = { existe: true, falha: false };
	const set = (id: number) => etiquetas.get(id) ?? etiquetas.set(id, new Set()).get(id) as Set<string>;
	const falha = () => {
		if (estado.falha) throw new Error("chatwoot fora do ar");
	};
	const port: ChatwootPort = {
		notaPrivada: async (conversaId, texto) => {
			falha();
			notas.push({ conversaId, texto });
		},
		etiquetas: async (id) => {
			falha();
			return [...set(id)];
		},
		adicionarEtiquetas: async (id, novas) => {
			falha();
			for (const n of novas) set(id).add(n);
		},
		atribuirGabriel: async (id) => {
			falha();
			atribuidas.push(id);
		},
		status: async (conversaId, st) => {
			falha();
			status.push({ conversaId, status: st });
		},
		acharConversa: async (tel) => {
			if (!estado.existe) return null;
			const n = canonico(tel);
			const i = campanha.clinicas.findIndex((c) => c.telefone && canonico(c.telefone) === n);
			return i < 0 ? null : 100 + i;
		},
	};
	return {
		port,
		notas,
		atribuidas,
		status,
		estado,
		etiquetasDe: (id: string) => [...set(conversaDe(id))].sort(),
		poeEtiqueta: (id: string, e: string) => set(conversaDe(id)).add(e),
		tiraEtiqueta: (id: string, e: string) => set(conversaDe(id)).delete(e),
	};
}

/** Números FALSOS de teste (nunca um número real). */
export const NUM_COMANDO = "5511900000001";
export const NUM_OUTRO = "5511900000002";
export const JID_COMANDO = `${NUM_COMANDO}@s.whatsapp.net`;

export interface MsgAviso {
	texto: string;
}

export function criar(opts: { agora?: number; rand?: number; ritmo?: Partial<Ritmo>; caminho?: string } = {}) {
	const relogio = { t: opts.agora ?? TER_9H };
	const wa = waFalso();
	const cw = cwFalso();
	const avisos: MsgAviso[] = [];
	const reserva: MsgAviso[] = [];
	const avisoWa = { falha: false, jids: [] as string[] };
	const comandoWa = {
		enviarTexto: async (jid: string, texto: string) => {
			if (avisoWa.falha) throw new Error("evolution fora do ar");
			avisoWa.jids.push(jid);
			avisos.push({ texto });
		},
	};
	const reservaFalsa = { falha: false };
	const reservaPort = {
		postar: async (texto: string) => {
			if (reservaFalsa.falha) throw new Error("chatwoot fora do ar");
			reserva.push({ texto });
		},
	};
	const store = new Store(opts.caminho ?? ":memory:");
	store.semear(campanha);
	const ctx: Ctx = {
		store,
		wa: protegerWhatsApp(wa.port, campanha),
		cw: cw.port,
		avisos: criarAvisos({
			wa: protegerComando(comandoWa, [NUM_COMANDO]),
			numeros: [NUM_COMANDO],
			reserva: reservaPort,
			log: () => {},
		}),
		numerosComando: [NUM_COMANDO],
		cal: calendarioReal(),
		ritmo: { ...ritmoDe(false), ...opts.ritmo },
		campanha,
		agora: () => relogio.t,
		rand: () => opts.rand ?? 0,
		midiaDir: "/midia",
		log: () => {},
	};
	const robo = new Robo(ctx);
	return {
		ctx,
		robo,
		store,
		wa,
		cw,
		avisos,
		reserva,
		avisoWa,
		reservaFalsa,
		relogio,
		avancar: (ms: number) => void (relogio.t += ms),
		irPara: (iso: string) => void (relogio.t = em(iso)),
		/** Mensagem do número de comando (Gabriel) pelo webhook do Chatwoot. */
		gabriel: (texto: string | null, jid = JID_COMANDO) =>
			robo.aoReceber({ jid, texto, tipo: texto === null ? "audio" : "texto", conversaId: 900, etiquetas: [] }),
		/** /podeir e /liberar, como o Gabriel faz. */
		liberar: async () => {
			await robo.aoReceber({ jid: JID_COMANDO, texto: "/podeir", tipo: "texto", conversaId: 900, etiquetas: [] });
			await robo.aoReceber({ jid: JID_COMANDO, texto: "/liberar", tipo: "texto", conversaId: 900, etiquetas: [] });
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
			return robo.aoReceber({
				jid: `${c?.telefone}@s.whatsapp.net`,
				texto,
				tipo,
				conversaId: conversaDe(clinicaId),
				etiquetas: cw.etiquetasDe(clinicaId),
			});
		},
	};
}

export const textos = (enviados: Enviado[]) => enviados.filter((e) => e.tipo === "texto");
import { jidDe as jidDeTel } from "../src/telefone.ts";

export const jidDe = (id: string) => jidDeTel(campanha.clinicas.find((c) => c.id === id)?.telefone as string);
