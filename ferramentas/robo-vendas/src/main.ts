import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { calendarioDe, carregarCampanha, ritmoDe } from "./config.ts";
import { Store } from "./db.ts";
import { criarTelegram, ligarRobo } from "./adaptador-telegram.ts";
import { criarWhatsApp } from "./adaptador-whatsapp.ts";
import { Robo } from "./robo.ts";
import { protegerWhatsApp } from "./seguro.ts";
import type { Ctx, WhatsAppPort } from "./types.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const modoTeste = process.env.MODO_TESTE === "1";
// A escala de tempo (1 dia = 2 min) só vale no modo teste: nunca em produção.
const escala = modoTeste && process.env.ESCALA_TEMPO !== "0";
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
	console.error("Faltam TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (veja ~/.config/dgc-robo-vendas/env).");
	process.exit(1);
}

const dados = process.env.DADOS_DIR ?? join(homedir(), ".local/share/dgc-robo-vendas");
mkdirSync(join(dados, "wa-auth"), { recursive: true, mode: 0o700 });
const campanha = carregarCampanha(join(raiz, "config", modoTeste ? "campanha-teste.json" : "campanha.json"), modoTeste);
const store = new Store(join(dados, modoTeste ? "funil-teste.sqlite" : "funil.sqlite"));
store.semear(campanha);

const { port: tg, bot } = criarTelegram(token, chatId);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

let robo: Robo;
const wa = criarWhatsApp(join(dados, "wa-auth"), {
	aoQr: (qr) => {
		QRCode.toBuffer(qr, { width: 480 })
			.then((png) => tg.enviarImagem(png, "Escaneie no WhatsApp Business > Aparelhos conectados."))
			.catch((e) => log(`erro ao mandar o QR: ${(e as Error).message}`));
	},
	aoConexao: (ev) => void robo.aoConexao(ev).catch((e) => log(`conexão: ${(e as Error).message}`)),
	aoMensagem: (e) => void robo.aoReceber(e).catch((err) => log(`entrada: ${(err as Error).message}`)),
});

const ctx: Ctx = {
	store,
	wa: protegerWhatsApp(wa.port as WhatsAppPort, campanha),
	tg,
	cal: calendarioDe(escala),
	ritmo: ritmoDe(escala),
	campanha,
	agora: () => Date.now(),
	rand: Math.random,
	midiaDir: join(dados, "midia"),
	log,
};
robo = new Robo(ctx, chatId);
ligarRobo(bot, robo);

await wa.iniciar();
setInterval(() => void robo.tick(), escala ? 5_000 : 60_000);
log(`robô no ar (${modoTeste ? "MODO_TESTE" : "produção"}; ${store.estado("liberado") === "1" ? "liberado" : "travado"})`);
bot.start({ onStart: () => log("telegram conectado") }).catch((e) => {
	console.error("telegram parou:", (e as Error).message);
	process.exit(1);
});
