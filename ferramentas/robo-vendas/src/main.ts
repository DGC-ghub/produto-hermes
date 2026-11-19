import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarChatwoot } from "./adaptador-chatwoot.ts";
import { criarEvolution } from "./adaptador-evolution.ts";
import { criarTelegram, ligarRobo } from "./adaptador-telegram.ts";
import { calendarioDe, carregarCampanha, ritmoDe } from "./config.ts";
import { Store } from "./db.ts";
import { Robo } from "./robo.ts";
import { protegerWhatsApp } from "./seguro.ts";
import type { Ctx } from "./types.ts";
import { criarWebhook } from "./webhook.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const modoTeste = process.env.MODO_TESTE === "1";
// A escala de tempo (1 dia = 2 min) só vale no modo teste: nunca em produção.
const escala = modoTeste && process.env.ESCALA_TEMPO !== "0";

function exigir(nome: string): string {
	const v = process.env[nome];
	if (!v) {
		console.error(`Falta ${nome} (veja ~/.config/dgc-atendimento/robo.env e o README).`);
		process.exit(1);
	}
	return v;
}

const chatId = exigir("TELEGRAM_CHAT_ID");
const tgToken = exigir("TELEGRAM_BOT_TOKEN");
const segredoWebhook = exigir("WEBHOOK_SECRET");
const dados = process.env.DADOS_DIR ?? join(homedir(), ".local/share/dgc-atendimento/robo");
mkdirSync(dados, { recursive: true, mode: 0o700 });
const campanha = carregarCampanha(join(raiz, "config", modoTeste ? "campanha-teste.json" : "campanha.json"), modoTeste);
const store = new Store(join(dados, modoTeste ? "funil-teste.sqlite" : "funil.sqlite"));
store.semear(campanha);

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const { port: tg, bot } = criarTelegram(tgToken, chatId);
const wa = criarEvolution({
	url: process.env.EVOLUTION_URL ?? "http://127.0.0.1:8080",
	chave: exigir("EVOLUTION_API_KEY"),
	instancia: process.env.EVOLUTION_INSTANCIA ?? "dgc",
});
const cw = criarChatwoot({
	url: process.env.CHATWOOT_URL ?? "http://127.0.0.1:3000",
	token: exigir("CHATWOOT_BOT_TOKEN"),
	conta: Number(process.env.CHATWOOT_CONTA ?? "1"),
	gabrielId: Number(exigir("CHATWOOT_GABRIEL_ID")),
});

const ctx: Ctx = {
	store,
	wa: protegerWhatsApp(wa, campanha),
	cw,
	tg,
	cal: calendarioDe(escala),
	ritmo: ritmoDe(escala),
	campanha,
	agora: () => Date.now(),
	rand: Math.random,
	midiaDir: process.env.MIDIA_DIR ?? join(dados, "..", "midia"),
	log,
};
const robo = new Robo(ctx, chatId);
ligarRobo(bot, robo);

const porta = Number(process.env.WEBHOOK_PORTA ?? "8090");
criarWebhook(robo, segredoWebhook, log).listen(porta, "127.0.0.1", () => log(`webhook em 127.0.0.1:${porta}`));
void robo.tick();
setInterval(() => void robo.tick(), escala ? 5_000 : 60_000);
log(`robô no ar (${modoTeste ? "MODO_TESTE" : "produção"}; ${store.estado("liberado") === "1" ? "liberado" : "travado"})`);
bot.start({ onStart: () => log("telegram conectado") }).catch((e) => {
	console.error("telegram parou:", (e as Error).message);
	process.exit(1);
});
