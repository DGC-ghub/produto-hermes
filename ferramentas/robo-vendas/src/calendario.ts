import type { Calendario } from "./types.ts";

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
/** Brasília é UTC-3 o ano todo (sem horário de verão desde 2019). */
const OFFSET = -3 * 60 * MIN;
/** Feriados fixos (mês-dia). 20/11/2026 é feriado nacional. */
export const FERIADOS = ["11-20", "12-25", "01-01"];
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function partes(ms: number) {
	const d = new Date(ms + OFFSET);
	return {
		ano: d.getUTCFullYear(),
		mes: d.getUTCMonth() + 1,
		dia: d.getUTCDate(),
		dow: d.getUTCDay(),
		min: d.getUTCHours() * 60 + d.getUTCMinutes(),
	};
}

const dd = (n: number) => String(n).padStart(2, "0");

export function calendarioReal(feriados: string[] = FERIADOS): Calendario {
	const ehDiaUtil = (ms: number) => {
		const p = partes(ms);
		if (p.dow === 0 || p.dow === 6) return false;
		return !feriados.includes(`${dd(p.mes)}-${dd(p.dia)}`);
	};
	const janela = (ms: number, de: number, ate: number) => {
		if (!ehDiaUtil(ms)) return false;
		const m = partes(ms).min;
		return m >= de * 60 && m < ate * 60;
	};
	const inicioDoDia = (ms: number) => ms - partes(ms).min * MIN - (ms % MIN);
	const aberturaResposta = (ms: number) => {
		if (janela(ms, 8, 19)) return ms;
		let base = inicioDoDia(ms);
		if (!(ehDiaUtil(ms) && partes(ms).min < 8 * 60)) base += DIA;
		while (!ehDiaUtil(base)) base += DIA;
		return base + 8 * 60 * MIN;
	};
	return {
		diaId: (ms) => {
			const p = partes(ms);
			return `${p.ano}-${dd(p.mes)}-${dd(p.dia)}`;
		},
		ehDiaUtil,
		janelaPrimeira: (ms) => janela(ms, 9, 17),
		janelaResposta: (ms) => janela(ms, 8, 19),
		aberturaResposta,
		somarDiasUteis(ms, n) {
			let t = ms;
			let faltam = n;
			while (faltam > 0) {
				t += DIA;
				if (ehDiaUtil(t)) faltam--;
			}
			return t;
		},
		minutosComerciais(deMs, ateMs) {
			let total = 0;
			let t = deMs - (deMs % MIN);
			// passo de 1 minuto só dentro do intervalo; usa saltos de dia para o que é fechado
			while (t < ateMs) {
				if (!ehDiaUtil(t)) {
					t = inicioDoDia(t) + DIA;
					continue;
				}
				const m = partes(t).min;
				if (m < 9 * 60) {
					t = inicioDoDia(t) + 9 * 60 * MIN;
					continue;
				}
				if (m >= 18 * 60) {
					t = inicioDoDia(t) + DIA;
					continue;
				}
				const fimJanela = inicioDoDia(t) + 18 * 60 * MIN;
				const fim = Math.min(fimJanela, ateMs);
				total += Math.floor((fim - t) / MIN);
				t = fimJanela;
			}
			return total;
		},
		horaDoResumo: (ms) => ehDiaUtil(ms) && partes(ms).min >= 8 * 60,
		proximosDiasUteis(ms, n) {
			const out: string[] = [];
			let t = ms;
			while (out.length < n) {
				t += DIA;
				if (ehDiaUtil(t)) out.push(SEMANA[partes(t).dow] as string);
			}
			return out;
		},
	};
}

/** Modo teste: 1 "dia" = 2 minutos, sem fim de semana, feriado nem janela de horário. */
export function calendarioTeste(diaMs = 2 * MIN): Calendario {
	return {
		diaId: (ms) => String(Math.floor(ms / diaMs)),
		ehDiaUtil: () => true,
		janelaPrimeira: () => true,
		janelaResposta: () => true,
		aberturaResposta: (ms) => ms,
		somarDiasUteis: (ms, n) => ms + n * diaMs,
		minutosComerciais: (a, b) => Math.max(0, Math.floor((b - a) / MIN)),
		horaDoResumo: () => false,
		proximosDiasUteis: (_ms, n) => Array.from({ length: n }, (_, i) => `dia ${i + 1}`),
	};
}

/** dd/mm no fuso de Brasília. */
export function dataBR(ms: number): string {
	const p = partes(ms);
	return `${dd(p.dia)}/${dd(p.mes)}`;
}
