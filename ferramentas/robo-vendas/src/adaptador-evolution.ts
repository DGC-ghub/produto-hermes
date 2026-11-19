import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { canonico } from "./telefone.ts";
import type { WhatsAppPort } from "./types.ts";

type Fetch = typeof fetch;
const PERMANENTES = [401, 403];

/**
 * Evolution API v2. A chave nunca entra em log. Só recebe JIDs que o núcleo
 * já validou contra campanha.json (ver seguro.ts).
 * ATENÇÃO: os caminhos abaixo seguem a documentação da v2 e ainda não foram
 * rodados contra uma Evolution de verdade (spike da DGC-369 / ponta a ponta da DGC-370).
 */
export function criarEvolution(
	cfg: { url: string; chave: string; instancia: string },
	f: Fetch = fetch,
): WhatsAppPort {
	let aberto = false;
	const numeros = new Map<string, string>();
	const base = cfg.url.replace(/\/$/, "");

	async function chamar(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<any> {
		const r = await f(`${base}${caminho}`, {
			method: metodo,
			headers: { apikey: cfg.chave, "content-type": "application/json" },
			body: corpo === undefined ? undefined : JSON.stringify(corpo),
			signal: AbortSignal.timeout(30_000),
		});
		if (!r.ok) throw new Error(`Evolution ${metodo} ${caminho.split("?")[0]} -> ${r.status}`);
		return r.json();
	}

	/** Número no formato que o WhatsApp conhece (com ou sem o 9). */
	async function resolver(jid: string): Promise<string> {
		const c = canonico(jid);
		if (!c) throw new Error("telefone inválido");
		const em = numeros.get(c);
		if (em) return em;
		const variantes = [c];
		if (c.length === 13) variantes.push(c.slice(0, 4) + c.slice(5));
		const r = (await chamar("POST", `/chat/whatsappNumbers/${cfg.instancia}`, { numbers: variantes })) as {
			exists: boolean;
			number?: string;
			jid?: string;
		}[];
		const achado = r.find((x) => x.exists);
		if (!achado) throw new Error("número não está no WhatsApp");
		const numero = (achado.jid ?? achado.number ?? c).replace(/@.*$/, "");
		numeros.set(c, numero);
		return numero;
	}

	const midia = async (jid: string, arquivo: string, mediatype: "video" | "document", mimetype: string, caption?: string) =>
		chamar("POST", `/message/sendMedia/${cfg.instancia}`, {
			number: await resolver(jid),
			mediatype,
			mimetype,
			caption,
			fileName: basename(arquivo),
			media: (await readFile(arquivo)).toString("base64"),
		});

	return {
		conectado: () => aberto,
		async estado() {
			const lista = (await chamar("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(cfg.instancia)}`)) as {
				connectionStatus?: string;
				disconnectionReasonCode?: number | null;
			}[];
			const i = lista[0];
			aberto = i?.connectionStatus === "open";
			if (aberto) return { estado: "aberta" };
			const codigo = i?.disconnectionReasonCode ?? undefined;
			return {
				estado: "fechada",
				permanente: codigo !== undefined && PERMANENTES.includes(codigo),
				motivo: codigo === undefined ? i?.connectionStatus : String(codigo),
			};
		},
		async enviarTexto(jid, texto, opts) {
			await chamar("POST", `/message/sendText/${cfg.instancia}`, {
				number: await resolver(jid),
				text: texto,
				delay: opts?.digitarMs ?? 0,
			});
		},
		async enviarVideo(jid, arquivo, legenda) {
			await midia(jid, arquivo, "video", "video/mp4", legenda);
		},
		async enviarDocumento(jid, arquivo) {
			await midia(jid, arquivo, "document", "application/pdf");
		},
	};
}
