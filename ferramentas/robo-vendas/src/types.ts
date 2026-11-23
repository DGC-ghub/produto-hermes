export type Status =
	| "fila"
	| "sem_telefone"
	| "aguardando"
	| "kit_agendado"
	| "kit_enviado"
	| "parou"
	| "manual"
	| "encerrado";

export interface ClinicaConfig {
	id: string;
	nome: string;
	leva: 1 | 2;
	ordem: number;
	telefone: string | null;
	fonteTelefone: string | null;
	pdf: string;
	primeira: string;
	segunda: string;
	lembreteD3: string;
	ultimoD7: string;
	pare: string;
}

export interface Campanha {
	video: string;
	textos: { robo: string; rascunhos: Record<string, string | null> };
	clinicas: ClinicaConfig[];
}

/** Evolution API. Só envia o que o núcleo já validou contra campanha.json (ver seguro.ts). */
export interface WhatsAppPort {
	enviarTexto(jid: string, texto: string, opts?: { digitarMs?: number }): Promise<void>;
	enviarVideo(jid: string, arquivo: string, legenda?: string): Promise<void>;
	enviarDocumento(jid: string, arquivo: string, nomeArquivo: string): Promise<void>;
	/** Último estado conhecido (atualizado por `estado()`). */
	conectado(): boolean;
	/** Consulta a Evolution. `permanente` = deslogado ou banido (401/403). */
	estado(): Promise<{ estado: "aberta" } | { estado: "fechada"; permanente: boolean; motivo?: string }>;
}

export type Status_ = "open" | "pending" | "resolved";

/** Chatwoot (API do agent bot). Nada aqui escreve para a clínica, exceto nota privada. */
export interface ChatwootPort {
	notaPrivada(conversaId: number, texto: string): Promise<void>;
	etiquetas(conversaId: number): Promise<string[]>;
	/** Soma as etiquetas às que já existem (a API do Chatwoot troca o conjunto inteiro). */
	adicionarEtiquetas(conversaId: number, novas: string[]): Promise<void>;
	atribuirGabriel(conversaId: number): Promise<void>;
	status(conversaId: number, status: Status_): Promise<void>;
	/** Conversa do contato com esse telefone (a integração da Evolution a cria no 1º envio). */
	acharConversa(telefone: string): Promise<number | null>;
}

/** Avisos ao Gabriel pelo WhatsApp. Função separada da de envio às clínicas: só aceita NUMEROS_COMANDO (ver seguro.ts). */
export interface ComandoWhatsAppPort {
	enviarTexto(jid: string, texto: string): Promise<void>;
}

/** Canal reserva: mensagem de entrada na conversa fixa da caixa "Alertas do robô" (Chatwoot, canal API). */
export interface ReservaPort {
	postar(texto: string): Promise<void>;
}

/** Aviso ao Gabriel. `critico` (ban, queda longa) vai também para a reserva; qualquer falha no WhatsApp cai nela. */
export interface AvisoPort {
	enviar(texto: string, opts?: { critico?: boolean }): Promise<void>;
}

export type TipoMidia = "texto" | "audio" | "ligacao" | "imagem" | "documento" | "outro";

/** Mensagem de entrada, já traduzida do webhook do Chatwoot. */
export interface Entrada {
	jid: string;
	texto: string | null;
	tipo: TipoMidia;
	conversaId: number;
	/** Etiquetas da conversa no momento do evento. */
	etiquetas?: string[];
	grupo?: boolean;
}

/** Mensagem de saída vista no webhook (para saber se um humano respondeu). */
export interface SaidaVista {
	conversaId: number;
	/** true = escrita por pessoa (Gabriel/Danilo), não pelo robô nem pelo espelho da Evolution. */
	humano: boolean;
	privada: boolean;
}

export interface Ritmo {
	maxPrimeirasPorDia: number;
	intervaloMinMs: number;
	intervaloMaxMs: number;
	esperaRespostaMinMs: number;
	esperaRespostaMaxMs: number;
	digitarMs: number;
	lembretePendenciaMin: number;
	quedaAvisoMs: number;
}

export interface Calendario {
	/** Identifica "o dia de hoje" (no modo teste, 1 dia = 2 minutos). */
	diaId(ms: number): string;
	ehDiaUtil(ms: number): boolean;
	janelaPrimeira(ms: number): boolean;
	janelaResposta(ms: number): boolean;
	/** Próxima abertura da janela de resposta (8h de dia útil), a partir de ms. */
	aberturaResposta(ms: number): number;
	somarDiasUteis(ms: number, n: number): number;
	minutosComerciais(deMs: number, ateMs: number): number;
	/** Já passou das 8h de um dia útil? */
	horaDoResumo(ms: number): boolean;
	/** Rótulos dos próximos dias úteis, ex.: "sexta". */
	proximosDiasUteis(ms: number, n: number): string[];
}

export interface Ctx {
	store: import("./db.ts").Store;
	wa: WhatsAppPort;
	cw: ChatwootPort;
	avisos: AvisoPort;
	/** Números de comando (canônicos). Nunca clínica; conversa deles não entra no funil. */
	numerosComando: string[];
	cal: Calendario;
	ritmo: Ritmo;
	campanha: Campanha;
	agora: () => number;
	rand: () => number;
	midiaDir: string;
	log: (msg: string) => void;
}
