import { createServer, type Server } from "node:http";
import type { Robo } from "./robo.ts";
import type { Entrada, SaidaVista, TipoMidia } from "./types.ts";

/** Evento `message_created` do Chatwoot (só os campos que o robô usa). */
interface Evento {
	event?: string;
	id?: number;
	message_type?: string | number;
	private?: boolean;
	content?: string | null;
	content_type?: string;
	attachments?: { file_type?: string }[];
	sender?: { type?: string; id?: number };
	conversation?: {
		id?: number;
		labels?: string[];
		meta?: { sender?: { phone_number?: string | null; identifier?: string | null } };
		contact_inbox?: { source_id?: string };
	};
}

const TIPO_ANEXO: Record<string, TipoMidia> = { audio: "audio", image: "imagem", video: "outro", file: "documento" };

/** Traduz o evento. Devolve null se não for algo que o robô trata. */
export function traduzir(ev: Evento): { entrada?: Entrada; saida?: SaidaVista } | null {
	if (ev.event !== "message_created" || !ev.conversation?.id) return null;
	const conversaId = ev.conversation.id;
	const tipo = ev.message_type;
	if (tipo === "outgoing" || tipo === 1) {
		// Só mensagens de pessoas contam; o que o robô ou a Evolution espelham nunca volta como ação (sem loop).
		return { saida: { conversaId, humano: ev.sender?.type === "user", privada: ev.private === true } };
	}
	if (tipo !== "incoming" && tipo !== 0) return null;
	const sender = ev.conversation.meta?.sender;
	const fonte = sender?.phone_number || sender?.identifier || ev.conversation.contact_inbox?.source_id || "";
	if (fonte.includes("@g.us")) return null;
	const digitos = fonte.replace(/@.*$/, "").replace(/\D/g, "");
	const texto = ev.content?.trim() ? ev.content : null;
	const anexo = ev.attachments?.[0]?.file_type;
	return {
		entrada: {
			jid: `${digitos}@s.whatsapp.net`,
			texto: anexo ? null : texto,
			tipo: anexo ? (TIPO_ANEXO[anexo] ?? "outro") : texto ? "texto" : "outro",
			conversaId,
			etiquetas: ev.conversation.labels ?? [],
		},
	};
}

/**
 * Servidor do webhook do agent bot. Preso em 127.0.0.1; exige `?token=` com o segredo.
 * Responde 200 logo e trata o evento em seguida (o Chatwoot não espera o robô).
 */
export function criarWebhook(robo: Robo, segredo: string, log: (m: string) => void): Server {
	return createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.method !== "POST" || url.pathname !== "/chatwoot") {
			res.writeHead(404).end();
			return;
		}
		if (url.searchParams.get("token") !== segredo) {
			res.writeHead(401).end();
			return;
		}
		const partes: Buffer[] = [];
		let tamanho = 0;
		req.on("data", (c: Buffer) => {
			tamanho += c.length;
			if (tamanho > 1_000_000) req.destroy();
			else partes.push(c);
		});
		req.on("end", () => {
			res.writeHead(200).end("ok");
			try {
				const t = traduzir(JSON.parse(Buffer.concat(partes).toString("utf8")) as Evento);
				if (t?.entrada) void robo.aoReceber(t.entrada).catch((e) => log(`entrada: ${(e as Error).message}`));
				if (t?.saida) void robo.aoSaida(t.saida).catch((e) => log(`saída vista: ${(e as Error).message}`));
			} catch (e) {
				log(`webhook inválido: ${(e as Error).message}`);
			}
		});
	});
}
