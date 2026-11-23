import type { ChatwootPort, ReservaPort } from "./types.ts";

type Fetch = typeof fetch;

/**
 * Chatwoot, pela API com o token do agent bot (nunca em log).
 * ATENÇÃO: não foi rodado contra um Chatwoot de verdade ainda; o que o token de
 * bot pode fazer (etiquetas e atribuição) precisa ser confirmado na DGC-370.
 */
export function criarChatwoot(
	cfg: { url: string; token: string; conta: number; gabrielId: number },
	f: Fetch = fetch,
): ChatwootPort {
	const base = `${cfg.url.replace(/\/$/, "")}/api/v1/accounts/${cfg.conta}`;

	async function chamar(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<any> {
		const r = await f(`${base}${caminho}`, {
			method: metodo,
			headers: { api_access_token: cfg.token, "content-type": "application/json" },
			body: corpo === undefined ? undefined : JSON.stringify(corpo),
			signal: AbortSignal.timeout(20_000),
		});
		if (!r.ok) throw new Error(`Chatwoot ${metodo} ${caminho.split("?")[0]} -> ${r.status}`);
		return r.status === 204 ? null : r.json();
	}

	const etiquetas = async (id: number): Promise<string[]> =>
		((await chamar("GET", `/conversations/${id}/labels`)) as { payload?: string[] }).payload ?? [];

	return {
		etiquetas,
		async notaPrivada(id, texto) {
			await chamar("POST", `/conversations/${id}/messages`, { content: texto, message_type: "outgoing", private: true });
		},
		async adicionarEtiquetas(id, novas) {
			const atuais = await etiquetas(id);
			const todas = [...new Set([...atuais, ...novas])];
			if (todas.length === atuais.length) return;
			await chamar("POST", `/conversations/${id}/labels`, { labels: todas });
		},
		async atribuirGabriel(id) {
			await chamar("POST", `/conversations/${id}/assignments`, { assignee_id: cfg.gabrielId });
		},
		async status(id, status) {
			await chamar("POST", `/conversations/${id}/toggle_status`, { status });
		},
		async acharConversa(telefone) {
			const mais = telefone.replace(/\D/g, "");
			const contatos = (await chamar("GET", `/contacts/search?q=${encodeURIComponent(mais)}`)) as { payload?: { id: number }[] };
			const contato = contatos.payload?.[0];
			if (!contato) return null;
			const convs = (await chamar("GET", `/contacts/${contato.id}/conversations`)) as { payload?: { id: number }[] };
			const ids = (convs.payload ?? []).map((c) => c.id);
			return ids.length ? Math.max(...ids) : null;
		},
	};
}

/**
 * Canal reserva (seção 6a do plano): mensagem de ENTRADA na conversa fixa da caixa "Alertas do robô"
 * (canal API do Chatwoot), para o Gabriel ser avisado pelo app mesmo com o WhatsApp fora do ar.
 * Não escreve em conversa de clínica. O token nunca entra em log.
 */
export function criarReserva(
	cfg: { url: string; token: string; conta: number; conversaId: number },
	f: Fetch = fetch,
): ReservaPort {
	const url = `${cfg.url.replace(/\/$/, "")}/api/v1/accounts/${cfg.conta}/conversations/${cfg.conversaId}/messages`;
	return {
		async postar(texto) {
			const r = await f(url, {
				method: "POST",
				headers: { api_access_token: cfg.token, "content-type": "application/json" },
				body: JSON.stringify({ content: texto, message_type: "incoming", private: false }),
				signal: AbortSignal.timeout(20_000),
			});
			if (!r.ok) throw new Error(`Chatwoot reserva -> ${r.status}`);
		},
	};
}
