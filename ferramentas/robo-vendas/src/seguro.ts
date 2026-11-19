import { canonico } from "./telefone.ts";
import type { Campanha, WhatsAppPort } from "./types.ts";

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
	};
}
