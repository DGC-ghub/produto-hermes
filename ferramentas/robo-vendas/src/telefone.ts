/** Forma canônica: 55 + DDD + 9 + 8 dígitos (o JID do WhatsApp às vezes vem sem o 9). */
export function canonico(entrada: string): string | null {
	let d = entrada.replace(/@.*$/, "").replace(/\D/g, "");
	if (d.length === 10 || d.length === 11) d = `55${d}`;
	if (!d.startsWith("55")) return null;
	if (d.length === 12 && /^[6-9]/.test(d.slice(4))) d = `${d.slice(0, 4)}9${d.slice(4)}`;
	return d.length === 13 || d.length === 12 ? d : null;
}

export function jidDe(telefone: string): string {
	const c = canonico(telefone);
	if (!c) throw new Error("telefone inválido");
	return `${c}@s.whatsapp.net`;
}

export function mascarar(telefone: string): string {
	const c = canonico(telefone) ?? telefone;
	return `+${c.slice(0, 4)} *****-${c.slice(-4)}`;
}
