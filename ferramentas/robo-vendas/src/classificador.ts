export type Classe = "sim" | "nao" | "robo" | "escalar";
export type Categoria = "interesse" | "preco" | "ja_tenho" | "golpe" | "lgpd" | "midia" | "outro";

export interface Resultado {
	classe: Classe;
	categoria: Categoria;
}

export function normalizar(t: string): string {
	return t
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\p{L}\p{N}?\u{1F44D}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Pedido de parar: só vale quando é claro. Na dúvida, não conta (o robô passa ao Gabriel).
 * Frases inteiras ("pare", "sair"), "não quero" sozinho ou no fim, "me tira da lista", "para de me mandar".
 */
const PARAR = new RegExp(
	[
		"^(pare|parar|para|sair|remover|remova|descadastrar|descadastre)( por favor| pf| pfv| obrigad[oa])?$",
		"\\b(pare|parar|para) de (me )?(mandar|enviar|escrever|chamar|incomodar)\\b",
		"\\b(me tire|me tira|tire meu|tira meu) (d[aoe]s? |dessa |desse )?(sua |essa |nossa )?(lista|contato|cadastro|numero)\\b",
		"\\b(sair|remover|remova|me remova|me remove) d[aoe]s? (lista|cadastro|contatos?|mensagens)\\b",
		"\\bdescadastr\\w*",
		"\\bnao tenho interesse\\b",
		"\\bsem interesse$",
		"\\bnao (me )?(mande|mandem|envie|enviem|escreva|escrevam)\\b",
		"(^| )nao quero( mais)?( obrigad[oa])?$",
	].join("|"),
);
const ROBO =
	/\b(e|eh|voce e|vc e|isso e|sera que e) (um |uma )?(robo|bot|chatbot|ia|inteligencia artificial|automatic\w*|maquina|pessoa|gente|humano|real)\b|\bchatbot\b|\bresposta automatica\b|\b(robo|bot)\b/;
const PRECO = /\b(quanto|preco|valor|valores|custa|custo|mensalidade|investimento|orcamento|cobram|cobra)\b/;
const JA_TENHO = /\b(ja tenho|temos) (uma |a )?(secretaria|recepcionista|atendente|sistema)\b|\bnao preciso\b|\bnao precisamos\b/;
const GOLPE = /\b(golpe|fraude|spam|como (voce )?conseguiu|onde (voce )?(conseguiu|pegou)|quem (e|eh) (voce|vc)|de onde)\b/;
const LGPD = /\b(lgpd|dados|privacidade|sigilo|prontuario|paciente\w*)\b/;
const INTERESSE = /\b(interesse|interessad\w*|me explica|explica melhor|saber mais|reuniao|conversar|ligar|ligacao|marcar|horario|agendar|apresentacao)\b/;
const SIM_PALAVRAS = new Set([
	"sim", "pode", "claro", "manda", "mandar", "ok", "okay", "pode mandar", "por favor", "pf", "pfv",
	"beleza", "fechado", "bora", "com certeza", "quero", "gostaria", "favor", "ver", "vamos", "ta", "bom",
	"tudo", "bem", "sim,", "\u{1F44D}", "pode sim", "manda sim", "claro que sim", "por gentileza",
]);

function ehSim(n: string): boolean {
	if (n.includes("?")) return false;
	const palavras = n.split(" ").filter(Boolean);
	if (palavras.length === 0 || palavras.length > 6) return false;
	if (PRECO.test(n) || INTERESSE.test(n) || GOLPE.test(n) || LGPD.test(n) || JA_TENHO.test(n)) return false;
	if (/\bnao\b/.test(n)) return false;
	const temSim = palavras.some((p) => ["sim", "pode", "claro", "manda", "mandar", "ok", "okay", "\u{1F44D}", "fechado", "beleza", "bora", "quero"].includes(p));
	if (!temSim) return false;
	return palavras.every((p) => SIM_PALAVRAS.has(p) || p === "o" || p === "a" || p === "pra" || p === "me" || p === "mim" || p === "voce" || p === "vc" || p === "e" || p === "obrigado" || p === "obrigada");
}

export function categoriaDe(n: string): Categoria {
	if (PRECO.test(n)) return "preco";
	if (JA_TENHO.test(n)) return "ja_tenho";
	if (GOLPE.test(n)) return "golpe";
	if (LGPD.test(n)) return "lgpd";
	if (INTERESSE.test(n)) return "interesse";
	return "outro";
}

/**
 * Regras simples, sem LLM. Na dúvida, escala.
 * `aguardandoResposta`: só a 1ª mensagem foi enviada e a clínica ainda não respondeu "sim".
 */
export function classificar(texto: string | null, aguardandoResposta: boolean): Resultado {
	if (texto === null || texto.trim() === "") return { classe: "escalar", categoria: "midia" };
	const n = normalizar(texto);
	const cat = categoriaDe(n);
	if (!aguardandoResposta) return { classe: "escalar", categoria: cat };
	if (PARAR.test(n)) return { classe: "nao", categoria: "outro" };
	if (ROBO.test(n)) return { classe: "robo", categoria: "outro" };
	if (ehSim(n)) return { classe: "sim", categoria: "interesse" };
	const palavras = n.split(" ").filter(Boolean);
	if (palavras[0] === "nao" && palavras.length <= 3 && !n.includes("?") && cat === "outro") {
		return { classe: "nao", categoria: "outro" };
	}
	return { classe: "escalar", categoria: cat };
}

/** Pedido claro de parar ("pare", "sair", "remover", "não tenho interesse"...), em qualquer fase da conversa. */
export function pedidoDeParar(texto: string | null): boolean {
	return texto !== null && PARAR.test(normalizar(texto));
}
