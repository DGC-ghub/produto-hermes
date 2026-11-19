import { readFileSync } from "node:fs";
import { calendarioReal, calendarioTeste } from "./calendario.ts";
import { canonico } from "./telefone.ts";
import type { Calendario, Campanha, Ritmo } from "./types.ts";

const MIN = 60_000;

export function carregarCampanha(caminho: string, modoTeste: boolean): Campanha {
	const c = JSON.parse(readFileSync(caminho, "utf8")) as Campanha;
	const ids = new Set<string>();
	for (const cl of c.clinicas) {
		if (ids.has(cl.id)) throw new Error(`id repetido: ${cl.id}`);
		ids.add(cl.id);
		if (cl.telefone === "") cl.telefone = null;
		if (cl.telefone && !canonico(cl.telefone)) throw new Error(`telefone inválido em ${cl.id}`);
		if (!modoTeste && cl.telefone && !cl.fonteTelefone) throw new Error(`falta fonteTelefone em ${cl.id}`);
	}
	if (modoTeste && c.clinicas.some((x) => !x.telefone)) {
		throw new Error("MODO_TESTE: preencha o telefone em config/campanha-teste.json");
	}
	return c;
}

export function ritmoDe(modoTeste: boolean): Ritmo {
	if (modoTeste) {
		return {
			maxPrimeirasPorDia: 5,
			intervaloMinMs: 5_000,
			intervaloMaxMs: 20_000,
			esperaRespostaMinMs: 5_000,
			esperaRespostaMaxMs: 20_000,
			digitarMs: 1_500,
			lembretePendenciaMin: 4,
			quedaAvisoMs: 10 * MIN,
		};
	}
	return {
		maxPrimeirasPorDia: 5,
		intervaloMinMs: 20 * MIN,
		intervaloMaxMs: 60 * MIN,
		esperaRespostaMinMs: 2 * MIN,
		esperaRespostaMaxMs: 15 * MIN,
		digitarMs: 4_000,
		lembretePendenciaMin: 240,
		quedaAvisoMs: 10 * MIN,
	};
}

export function calendarioDe(modoTeste: boolean): Calendario {
	return modoTeste ? calendarioTeste() : calendarioReal();
}
