import { readFile } from "node:fs/promises";
import makeWASocket, {
	Browsers,
	DisconnectReason,
	fetchLatestBaileysVersion,
	useMultiFileAuthState,
	type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { canonico } from "./telefone.ts";
import type { Entrada, TipoMidia, WhatsAppPort } from "./types.ts";

export interface EventosWhatsApp {
	aoQr(qr: string): void;
	aoConexao(ev: { estado: "aberta" } | { estado: "fechada"; permanente: boolean; motivo?: string }): void;
	aoMensagem(e: Entrada): void;
}

const PERMANENTES: number[] = [DisconnectReason.loggedOut, DisconnectReason.forbidden, 403, 401];
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Baileys como aparelho conectado. Só envia para JIDs que o núcleo já validou
 * contra campanha.json (ver seguro.ts). Reconecta com backoff; não reconecta
 * quando o número foi deslogado ou bloqueado.
 */
export function criarWhatsApp(authDir: string, ev: EventosWhatsApp): { port: WhatsAppPort; iniciar(): Promise<void> } {
	let sock: WASocket | null = null;
	let aberto = false;
	let tentativas = 0;
	const jids = new Map<string, string>();

	async function resolver(jid: string): Promise<string> {
		const c = canonico(jid);
		if (!c || !sock) return jid;
		const em = jids.get(c);
		if (em) return em;
		const variantes = [c];
		if (c.length === 13) variantes.push(c.slice(0, 4) + c.slice(5)); // sem o 9
		const r = await sock.onWhatsApp(...variantes.map((v) => `${v}@s.whatsapp.net`));
		const achado = r?.find((x) => x.exists)?.jid;
		if (!achado) throw new Error("número não está no WhatsApp");
		jids.set(c, achado);
		return achado;
	}

	// biome-ignore lint/suspicious/noExplicitAny: mensagem do Baileys tem tipo gigante
	function tipoDe(m: any): { texto: string | null; tipo: TipoMidia } {
		const msg = m?.message ?? {};
		const texto = msg.conversation ?? msg.extendedTextMessage?.text ?? null;
		if (texto) return { texto, tipo: "texto" };
		if (msg.audioMessage) return { texto: null, tipo: "audio" };
		if (msg.imageMessage) return { texto: msg.imageMessage.caption ?? null, tipo: msg.imageMessage.caption ? "texto" : "imagem" };
		if (msg.documentMessage) return { texto: null, tipo: "documento" };
		return { texto: null, tipo: "outro" };
	}

	async function conectar() {
		const { state, saveCreds } = await useMultiFileAuthState(authDir);
		const { version } = await fetchLatestBaileysVersion();
		const s = makeWASocket({
			version,
			auth: state,
			browser: Browsers.macOS("Desktop"),
			logger: pino({ level: "silent" }),
			markOnlineOnConnect: false,
			syncFullHistory: false,
		});
		sock = s;
		s.ev.on("creds.update", saveCreds);
		s.ev.on("connection.update", (u) => {
			if (u.qr) ev.aoQr(u.qr);
			if (u.connection === "open") {
				aberto = true;
				tentativas = 0;
				ev.aoConexao({ estado: "aberta" });
			}
			if (u.connection === "close") {
				aberto = false;
				const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
				const permanente = codigo !== undefined && PERMANENTES.includes(codigo);
				ev.aoConexao({ estado: "fechada", permanente, motivo: String(codigo ?? "desconhecido") });
				if (!permanente) {
					const espera = Math.min(5 * 60_000, 2_000 * 2 ** tentativas++);
					void dormir(espera).then(() => conectar().catch(() => {}));
				}
			}
		});
		s.ev.on("messages.upsert", ({ messages, type }) => {
			if (type !== "notify") return;
			for (const m of messages) {
				const k = m.key;
				const jidBruto = k.remoteJid ?? "";
				const jid = jidBruto.endsWith("@lid") && k.remoteJidAlt ? k.remoteJidAlt : jidBruto;
				const { texto, tipo } = tipoDe(m);
				ev.aoMensagem({ jid, texto, tipo, grupo: jid.endsWith("@g.us"), deMim: !!k.fromMe });
			}
		});
		s.ev.on("call", (chamadas) => {
			for (const c of chamadas) {
				if (c.status !== "offer" && c.status !== "timeout") continue;
				ev.aoMensagem({ jid: c.chatId, texto: null, tipo: "ligacao" });
			}
		});
	}

	const port: WhatsAppPort = {
		conectado: () => aberto,
		async enviarTexto(jid, texto, opts) {
			if (!sock) throw new Error("WhatsApp não iniciado");
			const j = await resolver(jid);
			if (opts?.digitarMs) {
				await sock.presenceSubscribe(j);
				await sock.sendPresenceUpdate("composing", j);
				await dormir(opts.digitarMs);
				await sock.sendPresenceUpdate("paused", j);
			}
			await sock.sendMessage(j, { text: texto });
		},
		async enviarVideo(jid, arquivo, legenda) {
			if (!sock) throw new Error("WhatsApp não iniciado");
			await sock.sendMessage(await resolver(jid), { video: await readFile(arquivo), mimetype: "video/mp4", caption: legenda });
		},
		async enviarDocumento(jid, arquivo, nomeArquivo) {
			if (!sock) throw new Error("WhatsApp não iniciado");
			await sock.sendMessage(await resolver(jid), {
				document: await readFile(arquivo),
				mimetype: "application/pdf",
				fileName: nomeArquivo,
			});
		},
	};
	return { port, iniciar: conectar };
}
