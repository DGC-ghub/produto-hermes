import { DatabaseSync } from "node:sqlite";
import type { Campanha, Status } from "./types.ts";

export interface ClinicaRow {
	id: string;
	status: Status;
	primeira_em: number | null;
	respondeu_em: number | null;
	encerrada_em: number | null;
}

export interface SaidaRow {
	id: number;
	chave: string;
	clinica_id: string;
	tipo: "kit" | "pare" | "robo" | "manual";
	texto: string | null;
	executar_apos: number;
	imediata: number;
}

export interface PendenciaRow {
	id: number;
	clinica_id: string;
	categoria: string;
	mensagem: string;
	rascunho: string | null;
	texto_final: string | null;
	status: "aberta" | "enviada" | "manual";
	criada_em: number;
	ultimo_aviso_em: number;
}

export class Store {
	readonly db: DatabaseSync;

	constructor(caminho: string) {
		this.db = new DatabaseSync(caminho);
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS clinicas (
				id TEXT PRIMARY KEY, status TEXT NOT NULL, primeira_em INTEGER,
				respondeu_em INTEGER, encerrada_em INTEGER
			);
			CREATE TABLE IF NOT EXISTS envios (
				chave TEXT PRIMARY KEY, clinica_id TEXT NOT NULL, tipo TEXT NOT NULL,
				em INTEGER NOT NULL, dia TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS saidas (
				id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL UNIQUE,
				clinica_id TEXT NOT NULL, tipo TEXT NOT NULL, texto TEXT,
				executar_apos INTEGER NOT NULL, imediata INTEGER NOT NULL DEFAULT 0,
				concluida INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS pendencias (
				id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id TEXT NOT NULL,
				categoria TEXT NOT NULL, mensagem TEXT NOT NULL, rascunho TEXT,
				texto_final TEXT, status TEXT NOT NULL DEFAULT 'aberta',
				criada_em INTEGER NOT NULL, ultimo_aviso_em INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
		`);
	}

	fechar() {
		this.db.close();
	}

	/** Cria as linhas das clínicas que ainda não existem. */
	semear(campanha: Campanha) {
		const ins = this.db.prepare("INSERT OR IGNORE INTO clinicas (id, status) VALUES (?, ?)");
		for (const c of campanha.clinicas) ins.run(c.id, c.telefone ? "fila" : "sem_telefone");
	}

	clinica(id: string): ClinicaRow {
		const r = this.db.prepare("SELECT * FROM clinicas WHERE id = ?").get(id) as ClinicaRow | undefined;
		if (!r) throw new Error(`clínica desconhecida: ${id}`);
		return r;
	}

	clinicas(): ClinicaRow[] {
		return this.db.prepare("SELECT * FROM clinicas").all() as unknown as ClinicaRow[];
	}

	atualizarClinica(id: string, p: Partial<Omit<ClinicaRow, "id">>) {
		const cols = Object.keys(p);
		if (cols.length === 0) return;
		const set = cols.map((c) => `${c} = ?`).join(", ");
		this.db
			.prepare(`UPDATE clinicas SET ${set} WHERE id = ?`)
			.run(...(Object.values(p) as (string | number | null)[]), id);
	}

	estado(chave: string): string | null {
		const r = this.db.prepare("SELECT valor FROM estado WHERE chave = ?").get(chave) as { valor: string } | undefined;
		return r ? r.valor : null;
	}

	definirEstado(chave: string, valor: string | null) {
		if (valor === null) this.db.prepare("DELETE FROM estado WHERE chave = ?").run(chave);
		else this.db.prepare("INSERT OR REPLACE INTO estado (chave, valor) VALUES (?, ?)").run(chave, valor);
	}

	/** Registra o envio. Devolve false se a chave já existia (idempotência). */
	registrarEnvio(chave: string, clinicaId: string, tipo: string, em: number, dia: string): boolean {
		const r = this.db
			.prepare("INSERT OR IGNORE INTO envios (chave, clinica_id, tipo, em, dia) VALUES (?, ?, ?, ?, ?)")
			.run(chave, clinicaId, tipo, em, dia);
		return Number(r.changes) > 0;
	}

	desfazerEnvio(chave: string) {
		this.db.prepare("DELETE FROM envios WHERE chave = ?").run(chave);
	}

	temEnvio(chave: string): boolean {
		return !!this.db.prepare("SELECT 1 FROM envios WHERE chave = ?").get(chave);
	}

	envioEm(chave: string): number | null {
		const r = this.db.prepare("SELECT em FROM envios WHERE chave = ?").get(chave) as { em: number } | undefined;
		return r ? r.em : null;
	}

	primeirasDoDia(dia: string): number {
		const r = this.db
			.prepare("SELECT COUNT(*) AS n FROM envios WHERE tipo = 'primeira' AND dia = ?")
			.get(dia) as { n: number };
		return r.n;
	}

	/** Devolve false se a chave já estava na fila ou já foi concluída. */
	agendarSaida(s: Omit<SaidaRow, "id">): boolean {
		const r = this.db
			.prepare(
				"INSERT OR IGNORE INTO saidas (chave, clinica_id, tipo, texto, executar_apos, imediata) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(s.chave, s.clinica_id, s.tipo, s.texto, s.executar_apos, s.imediata);
		return Number(r.changes) > 0;
	}

	saidasVencidas(agora: number): SaidaRow[] {
		return this.db
			.prepare("SELECT * FROM saidas WHERE concluida = 0 AND executar_apos <= ? ORDER BY executar_apos, id")
			.all(agora) as unknown as SaidaRow[];
	}

	saidasPendentes(): SaidaRow[] {
		return this.db.prepare("SELECT * FROM saidas WHERE concluida = 0 ORDER BY executar_apos, id").all() as unknown as SaidaRow[];
	}

	cancelarSaidasDaClinica(clinicaId: string) {
		this.db.prepare("UPDATE saidas SET concluida = 1 WHERE clinica_id = ? AND concluida = 0").run(clinicaId);
	}

	concluirSaida(id: number) {
		this.db.prepare("UPDATE saidas SET concluida = 1 WHERE id = ?").run(id);
	}

	criarPendencia(p: { clinica_id: string; categoria: string; mensagem: string; rascunho: string | null; agora: number }): number {
		const r = this.db
			.prepare(
				"INSERT INTO pendencias (clinica_id, categoria, mensagem, rascunho, criada_em, ultimo_aviso_em) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(p.clinica_id, p.categoria, p.mensagem, p.rascunho, p.agora, p.agora);
		return Number(r.lastInsertRowid);
	}

	pendencia(id: number): PendenciaRow | undefined {
		return this.db.prepare("SELECT * FROM pendencias WHERE id = ?").get(id) as PendenciaRow | undefined;
	}

	pendenciasAbertas(): PendenciaRow[] {
		return this.db.prepare("SELECT * FROM pendencias WHERE status = 'aberta' ORDER BY id").all() as unknown as PendenciaRow[];
	}

	atualizarPendencia(id: number, p: Partial<Pick<PendenciaRow, "texto_final" | "status" | "ultimo_aviso_em">>) {
		const cols = Object.keys(p);
		if (cols.length === 0) return;
		const set = cols.map((c) => `${c} = ?`).join(", ");
		this.db
			.prepare(`UPDATE pendencias SET ${set} WHERE id = ?`)
			.run(...(Object.values(p) as (string | number | null)[]), id);
	}
}
