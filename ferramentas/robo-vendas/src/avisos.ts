import { jidDe } from "./telefone.ts";
import type { AvisoPort, ComandoWhatsAppPort, ReservaPort } from "./types.ts";

/**
 * Avisos ao Gabriel: WhatsApp (número de comando) e, quando precisa, a reserva no Chatwoot.
 * Não passa pelo limite de 5 por dia, pela janela de horário, pela pausa nem pelo ban: aviso não é envio à clínica.
 * Crítico (ban, queda longa) vai pelos dois caminhos. Aviso comum só cai na reserva se o WhatsApp falhar.
 */
export function criarAvisos(o: {
	wa: ComandoWhatsAppPort;
	numeros: string[];
	reserva: ReservaPort | null;
	log: (m: string) => void;
}): AvisoPort {
	const porWhatsApp = async (texto: string): Promise<boolean> => {
		let ok = true;
		for (const n of o.numeros) {
			try {
				await o.wa.enviarTexto(jidDe(n), texto);
			} catch (e) {
				ok = false;
				o.log(`aviso por WhatsApp falhou: ${(e as Error).message}`);
			}
		}
		return ok;
	};
	const porReserva = async (texto: string): Promise<void> => {
		if (!o.reserva) return o.log("sem canal reserva configurado");
		try {
			await o.reserva.postar(texto);
		} catch (e) {
			o.log(`reserva falhou: ${(e as Error).message}`);
		}
	};
	return {
		async enviar(texto, opts) {
			if (opts?.critico) {
				await Promise.all([porWhatsApp(texto), porReserva(texto)]);
				return;
			}
			if (!(await porWhatsApp(texto))) await porReserva(texto);
		},
	};
}
