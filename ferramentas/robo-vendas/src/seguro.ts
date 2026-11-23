import { canonico } from "./telefone.ts";
import type { Campanha, ComandoWhatsAppPort, WhatsAppPort } from "./types.ts";

/** Números das clínicas da campanha, na forma canônica. */
export function numerosPermitidos(c: Campanha): Set<string> {
	const s = new Set<string>();
	for (const cl of c.clinicas) {
		const n = cl.telefone ? canonico(cl.telefone) : null;
		if (n) s.add(n);
	}
	return s;
}

export function jidPermitido(c: Campanha, jid: string): boolean {
	if (!jid.endsWith("@s.whatsapp.net")) return false;
	const n = canonico(jid);
	return !!n && numerosPermitidos(c).has(n);
}

/**
 * Trava dura: o envio recusa qualquer JID que não esteja em campanha.json.
 * Todo envio do robô passa por aqui, nunca direto pelo adaptador.
 */
export function protegerWhatsApp(real: WhatsAppPort, campanha: Campanha): WhatsAppPort {
	const checa = (jid: string) => {
		if (!jidPermitido(campanha, jid)) throw new Error("JID fora da campanha: envio recusado");
	};
	return {
		enviarTexto: async (jid, t, o) => {
			checa(jid);
			await real.enviarTexto(jid, t, o);
		},
		enviarVideo: async (jid, a, l) => {
			checa(jid);
			await real.enviarVideo(jid, a, l);
		},
		enviarDocumento: async (jid, a, n) => {
			checa(jid);
			await real.enviarDocumento(jid, a, n);
		},
		conectado: () => real.conectado(),
		estado: () => real.estado(),
	};
}

/** Lê `NUMEROS_COMANDO` (lista separada por vírgula). Valor inválido não vai para a mensagem de erro. */
export function lerNumerosComando(bruto: string | undefined): string[] {
	const out: string[] = [];
	for (const parte of (bruto ?? "").split(",")) {
		if (!parte.trim()) continue;
		const n = canonico(parte.trim());
		if (!n) throw new Error("NUMEROS_COMANDO: um dos números é inválido (use 55 + DDD + número, separados por vírgula)");
		if (!out.includes(n)) out.push(n);
	}
	if (out.length === 0) throw new Error("NUMEROS_COMANDO está vazio: informe o número do Gabriel no robo.env");
	return out;
}

/** Trava de partida: número de comando nunca pode ser de clínica da campanha. */
export function conferirComandoForaDaCampanha(c: Campanha, numeros: string[]): void {
	const clinicas = numerosPermitidos(c);
	if (numeros.some((n) => clinicas.has(n))) {
		throw new Error("Um número de comando (NUMEROS_COMANDO) está na campanha. O robô não sobe: tire-o do campanha.json.");
	}
}

export function ehNumeroDeComando(numeros: string[], jid: string): boolean {
	if (!jid.endsWith("@s.whatsapp.net")) return false;
	const n = canonico(jid);
	return !!n && numeros.includes(n);
}

/** Trava dura dos avisos: só sai para NUMEROS_COMANDO. A função das clínicas (protegerWhatsApp) continua só com o campanha.json. */
export function protegerComando(real: Pick<WhatsAppPort, "enviarTexto">, numeros: string[]): ComandoWhatsAppPort {
	return {
		enviarTexto: async (jid, texto) => {
			if (!ehNumeroDeComando(numeros, jid)) throw new Error("JID fora de NUMEROS_COMANDO: aviso recusado");
			await real.enviarTexto(jid, texto);
		},
	};
}
