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

export interface Botao {
	texto: string;
	dado: string;
}

export interface WhatsAppPort {
	enviarTexto(jid: string, texto: string, opts?: { digitarMs?: number }): Promise<void>;
	enviarVideo(jid: string, arquivo: string, legenda?: string): Promise<void>;
	enviarDocumento(jid: string, arquivo: string, nomeArquivo: string): Promise<void>;
	conectado(): boolean;
}

export interface TelegramPort {
	enviar(texto: string, botoes?: Botao[][]): Promise<void>;
	enviarImagem(png: Buffer, legenda: string): Promise<void>;
}

export type TipoMidia = "texto" | "audio" | "ligacao" | "imagem" | "documento" | "outro";

export interface Entrada {
	jid: string;
	texto: string | null;
	tipo: TipoMidia;
	grupo?: boolean;
	deMim?: boolean;
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
	tg: TelegramPort;
	cal: Calendario;
	ritmo: Ritmo;
	campanha: Campanha;
	agora: () => number;
	rand: () => number;
	midiaDir: string;
	log: (msg: string) => void;
}
