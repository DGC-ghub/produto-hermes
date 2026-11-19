import { describe, expect, it } from "vitest";
import { classificar, pedidoDeParar } from "../src/classificador.ts";

const c = (t: string | null, aguardando = true) => classificar(t, aguardando);

describe("classificador", () => {
	it.each(["sim", "Sim!", "pode", "Pode mandar", "claro", "manda", "ok", "👍", "Pode sim, obrigado"])("%s é sim", (t) => {
		expect(c(t).classe).toBe("sim");
	});

	it.each(["não", "Não tenho interesse", "pare", "sair", "remover", "Não quero, obrigado", "pode parar de mandar"])(
		"%s é não",
		(t) => {
			expect(c(t).classe).toBe("nao");
		},
	);

	it.each(["você é robô?", "é um bot?", "Isso é IA?", "é automático", "vc é uma pessoa?"])("%s é robô", (t) => {
		expect(c(t).classe).toBe("robo");
	});

	it("preço vai para o Gabriel com a categoria preço", () => {
		expect(c("Quanto custa?")).toEqual({ classe: "escalar", categoria: "preco" });
		expect(c("sim, quanto custa")).toEqual({ classe: "escalar", categoria: "preco" });
	});

	it("sim com pergunta, ou longo, ou com outra categoria, escala", () => {
		expect(c("pode mandar?").classe).toBe("escalar");
		expect(c("sim pode mandar aqui mesmo para mim hoje").classe).toBe("escalar");
		expect(c("sim, mas e os dados dos pacientes").categoria).toBe("lgpd");
		expect(c("pode me ligar amanhã").classe).toBe("escalar");
	});

	it("outras categorias", () => {
		expect(c("Isso é golpe?").categoria).toBe("golpe");
		expect(c("Tenho interesse, me explica melhor").categoria).toBe("interesse");
		expect(c("já tenho secretária").categoria).toBe("ja_tenho");
		expect(c("qual o horário de vocês?").categoria).toBe("interesse");
	});

	it("áudio, ligação e imagem (sem texto) escalam", () => {
		expect(c(null)).toEqual({ classe: "escalar", categoria: "midia" });
	});

	it("depois do kit (ou fora de 'aguardando') tudo escala, até 'sim'", () => {
		expect(c("sim", false).classe).toBe("escalar");
		expect(c("pare", false).classe).toBe("escalar");
	});

	it("não com pergunta, na dúvida, escala", () => {
		expect(c("não entendi, quem é?").classe).toBe("escalar");
	});

	it.each([
		"pare",
		"Para de me mandar mensagem",
		"não tenho interesse",
		"Não quero",
		"Não quero, obrigado",
		"me tira da lista",
		"Me tire da lista por favor",
		"sair da lista",
		"sair",
		"remover",
	])("pedido claro de parar: %s", (t) => {
		expect(pedidoDeParar(t)).toBe(true);
	});

	it.each([
		"Não quero perder isso, me liga amanhã",
		"Recebi! Vou sair agora, depois vejo",
		"A gente para de atender às 18h",
		"Não quero agora, mas me manda o vídeo",
		"Pode me ligar para marcar? Não tenho tempo hoje",
		"vou parar de atender e já te retorno",
		"Eu vou sair",
		"Sair agora, depois vejo",
		"Para amanhã, pode ser?",
	])("NÃO é pedido de parar: %s", (t) => {
		expect(pedidoDeParar(t)).toBe(false);
		expect(c(t).classe).toBe("escalar");
	});

	it("'não quero agora, mas me manda o vídeo' passa ao Gabriel, não responde", () => {
		expect(c("Não quero agora, mas me manda o vídeo").classe).toBe("escalar");
	});

	it.each([
		"Não me mande por aqui, manda pro email da clínica",
		"Não mande pra esse número, manda pro da Dra. Ana",
		"Não envie agora, só segunda",
		"Não tenho interesse em trocar de sistema, mas quanto custa?",
		"Não tenho interesse agora, me procura em janeiro",
		"O sistema para de enviar lembrete se o paciente responder?",
		"Ele para de chamar o paciente depois que confirma?",
		"Como faço para remover do cadastro um paciente?",
		"Dá pra descadastrar paciente pelo sistema?",
		"Sair da lista de espera é automático?",
		"Tira meu número antigo e coloca esse",
		"tenho nao quero",
		"Não agora",
	])("1ª resposta: NÃO vira 'não' (vai ao Gabriel): %s", (t) => {
		expect(pedidoDeParar(t)).toBe(false);
		expect(c(t).classe).not.toBe("nao");
	});

	it.each([
		"Parem",
		"Parem de mandar mensagem",
		"Não temos interesse, obrigado",
		"Não estamos interessados",
		"Não quero receber mensagens",
		"Não quero receber mais mensagens",
		"Me exclui da lista",
		"Me remove daqui",
		"Pode tirar meu número",
		"Não manda mais nada",
		"Sem interesse, obrigado",
		"Stop",
		"para",
		"Para, obrigado",
		"descadastrar",
		"Me descadastra",
		"Não me mande mensagem",
		"Bom dia, não tenho interesse",
		"sem interesse",
		"Quero sair da lista",
	])("pedido claro de parar (1ª resposta vira 'não'): %s", (t) => {
		expect(pedidoDeParar(t)).toBe(true);
		expect(c(t).classe).toBe("nao");
	});

	it("pedidoDeParar de mídia (sem texto) é falso", () => {
		expect(pedidoDeParar(null)).toBe(false);
	});
});
