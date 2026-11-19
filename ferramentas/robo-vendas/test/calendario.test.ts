import { describe, expect, it } from "vitest";
import { calendarioReal, calendarioTeste, dataBR } from "../src/calendario.ts";
import { em } from "./helpers.ts";

const cal = calendarioReal();

describe("calendário", () => {
	it("20/11/2026 é feriado e fim de semana não é dia útil", () => {
		expect(cal.ehDiaUtil(em("2026-11-20T10:00:00"))).toBe(false);
		expect(cal.ehDiaUtil(em("2026-11-21T10:00:00"))).toBe(false);
		expect(cal.ehDiaUtil(em("2026-11-22T10:00:00"))).toBe(false);
		expect(cal.ehDiaUtil(em("2026-12-25T10:00:00"))).toBe(false);
		expect(cal.ehDiaUtil(em("2027-01-01T10:00:00"))).toBe(false);
		expect(cal.ehDiaUtil(em("2026-11-19T10:00:00"))).toBe(true);
	});

	it("janela da 1ª mensagem: 9h às 17h", () => {
		expect(cal.janelaPrimeira(em("2026-11-17T08:59:00"))).toBe(false);
		expect(cal.janelaPrimeira(em("2026-11-17T09:00:00"))).toBe(true);
		expect(cal.janelaPrimeira(em("2026-11-17T16:59:00"))).toBe(true);
		expect(cal.janelaPrimeira(em("2026-11-17T17:00:00"))).toBe(false);
	});

	it("3º dia útil depois de terça 17/11 pula o feriado: segunda 23/11", () => {
		expect(dataBR(cal.somarDiasUteis(em("2026-11-17T09:00:00"), 3))).toBe("23/11");
		expect(dataBR(cal.somarDiasUteis(em("2026-11-17T09:00:00"), 7))).toBe("27/11");
	});

	it("resposta fora da janela fica para a abertura do dia útil seguinte", () => {
		expect(cal.aberturaResposta(em("2026-11-17T19:30:00"))).toBe(em("2026-11-18T08:00:00"));
		expect(cal.aberturaResposta(em("2026-11-17T05:00:00"))).toBe(em("2026-11-17T08:00:00"));
		expect(cal.aberturaResposta(em("2026-11-19T20:00:00"))).toBe(em("2026-11-23T08:00:00"));
		expect(cal.aberturaResposta(em("2026-11-17T10:00:00"))).toBe(em("2026-11-17T10:00:00"));
	});

	it("minutos comerciais contam só seg–sex das 9h às 18h", () => {
		expect(cal.minutosComerciais(em("2026-11-17T09:00:00"), em("2026-11-17T13:00:00"))).toBe(240);
		expect(cal.minutosComerciais(em("2026-11-18T17:00:00"), em("2026-11-19T12:00:00"))).toBe(240);
		expect(cal.minutosComerciais(em("2026-11-19T18:00:00"), em("2026-11-23T09:00:00"))).toBe(0);
	});

	it("modo teste: 1 dia = 2 minutos", () => {
		const t = calendarioTeste();
		expect(t.somarDiasUteis(1000, 3)).toBe(1000 + 3 * 120_000);
		expect(t.diaId(0)).not.toBe(t.diaId(120_000));
	});
});
