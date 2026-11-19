import { join } from "node:path";
import type { ClinicaConfig, Ctx } from "./types.ts";
import { jidDe } from "./telefone.ts";

export function clinicaCfg(ctx: Ctx, id: string): ClinicaConfig {
	const c = ctx.campanha.clinicas.find((x) => x.id === id);
	if (!c) throw new Error(`clínica fora da campanha: ${id}`);
	return c;
}

export function bloqueado(ctx: Ctx): "ban" | "pausa" | "travado" | null {
	if (ctx.store.estado("ban") === "1") return "ban";
	if (ctx.store.estado("pausado") === "1") return "pausa";
	if (ctx.store.estado("liberado") !== "1") return "travado";
	return null;
}

export function aleatorio(ctx: Ctx, min: number, max: number): number {
	return Math.round(min + ctx.rand() * (max - min));
}

/**
 * Executa um envio de uma vez só: grava a chave idempotente antes de enviar
 * (no máximo uma vez) e desfaz a chave se o envio falhar, para tentar de novo.
 */
export async function enviarUnico(
	ctx: Ctx,
	chave: string,
	clinicaId: string,
	tipo: string,
	acao: () => Promise<void>,
): Promise<boolean> {
	const agora = ctx.agora();
	if (!ctx.store.registrarEnvio(chave, clinicaId, tipo, agora, ctx.cal.diaId(agora))) return false;
	try {
		await acao();
		return true;
	} catch (e) {
		ctx.store.desfazerEnvio(chave);
		ctx.log(`falha ao enviar ${chave}: ${(e as Error).message}`);
		return false;
	}
}

export function digitar(ctx: Ctx) {
	return { digitarMs: ctx.ritmo.digitarMs };
}

export async function enviarTexto(ctx: Ctx, clinicaId: string, texto: string) {
	const c = clinicaCfg(ctx, clinicaId);
	if (!c.telefone) throw new Error("clínica sem telefone");
	await ctx.wa.enviarTexto(jidDe(c.telefone), texto, digitar(ctx));
}

/** Envia o kit em 3 passos, cada um com a sua chave. Devolve true se os 3 já saíram. */
export async function enviarKit(ctx: Ctx, clinicaId: string): Promise<boolean> {
	const c = clinicaCfg(ctx, clinicaId);
	if (!c.telefone) throw new Error("clínica sem telefone");
	const jid = jidDe(c.telefone);
	const passos: [string, () => Promise<void>][] = [
		["kit-texto", () => ctx.wa.enviarTexto(jid, c.segunda, digitar(ctx))],
		["kit-video", () => ctx.wa.enviarVideo(jid, join(ctx.midiaDir, ctx.campanha.video))],
		["kit-pdf", () => ctx.wa.enviarDocumento(jid, join(ctx.midiaDir, c.pdf), c.pdf)],
	];
	for (const [nome, acao] of passos) {
		const chave = `${clinicaId}:${nome}`;
		if (ctx.store.temEnvio(chave)) continue;
		if (!(await enviarUnico(ctx, chave, clinicaId, nome, acao))) return false;
	}
	return true;
}
