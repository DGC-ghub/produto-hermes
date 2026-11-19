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
 * Pedido de parar: só vale quando a mensagem INTEIRA é o pedido (com cortesia opcional).
 * Com "?", ou com "mas", "agora", "só", "pro email"..., nunca conta: o robô passa ao Gabriel.
 */
const CORTESIA_INI = /^(oi|ola|bom dia|boa tarde|boa noite)( |$)/;
const CORTESIA_FIM = /( (por favor|pf|pfv|obrigad[oa]|obrigadao|valeu|grato|grata))+$/;
const RESSALVA = /\b(mas|porem|agora|so|apenas|depois|amanha|semana|janeiro|email|pro|pra|quando|video|ligar|liga|procura)\b/;
const MSG = "( (mensagem|mensagens|msg|msgs|nada|recado|recados|whatsapp|zap))?";
const PARAR = new RegExp(
	"^(" +
		[
			"(pode |podem )?(pare|parem|parar|para|stop|sair|remover|remova|descadastrar|descadastre|descadastra)",
			"(me |nos )?(descadastrar|descadastre|descadastra|descadastrem)",
			"(pode |podem )?(pare|parem|parar|para) de (me |nos )?(mandar|enviar|escrever|chamar|incomodar)" + MSG,
			"(nao|n) (tenho|temos) interesse",
			"nao (estou|estamos) interessad[oa]s?",
			"sem interesse",
			"nao (quero|queremos)( mais)?( receber( mais)?( mensagens?| msgs?)?)?",
			"nao (me |nos )?(mande|manda|mandem|envie|enviem|escreva|escrevam)( mais)?" + MSG,
			"(me |nos )(tire|tira|tirem|remova|remove|removam|exclua|exclui|excluam|retire|retira) (daqui|(d[aoe]s? |dessa |desse )?(sua |essa |nossa )?(lista|contato|contatos|cadastro|numero))",
			"(pode |podem )?(tirar|remover|excluir|retirar|tire|tira|remova|remove|exclua|exclui) (meu|nosso) (numero|contato|telefone|cadastro)( d[aoe]s? (lista|cadastro|contatos?))?",
			"(quero |queremos |gostaria de |preciso )?(sair|remover|excluir) d[aoe]s? (lista|cadastro|contatos?|mensagens)",
		].join("|") +
		")$",
);

/** Texto sem cortesia, pronto para o PARAR. */
function nucleo(n: string): string {
	return n.replace(CORTESIA_INI, "").replace(CORTESIA_FIM, "").trim();
}

function ehPararClaro(n: string): boolean {
	if (n.includes("?") || RESSALVA.test(n)) return false;
	return PARAR.test(nucleo(n));
}
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
	if (ehPararClaro(n)) return { classe: "nao", categoria: "outro" };
	if (ROBO.test(n)) return { classe: "robo", categoria: "outro" };
	if (ehSim(n)) return { classe: "sim", categoria: "interesse" };
	const palavras = n.split(" ").filter(Boolean);
	if (palavras[0] === "nao" && palavras.length <= 3 && !n.includes("?") && !RESSALVA.test(n) && cat === "outro") {
		return { classe: "nao", categoria: "outro" };
	}
	return { classe: "escalar", categoria: cat };
}

/** Pedido claro de parar ("pare", "sair", "remover", "não tenho interesse"...), em qualquer fase da conversa. */
export function pedidoDeParar(texto: string | null): boolean {
	return texto !== null && ehPararClaro(normalizar(texto));
}
