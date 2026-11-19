import { Bot, InlineKeyboard } from "grammy";
import type { Robo } from "./robo.ts";
import type { Botao, TelegramPort } from "./types.ts";

/** O token nunca entra em log. */
export function criarTelegram(token: string, chatId: string): { port: TelegramPort; bot: Bot } {
	const bot = new Bot(token);
	const port: TelegramPort = {
		async enviar(texto, botoes?: Botao[][]) {
			const teclado = botoes ? new InlineKeyboard() : undefined;
			if (teclado && botoes) {
				botoes.forEach((linha, i) => {
					for (const b of linha) teclado.text(b.texto, b.dado);
					if (i < botoes.length - 1) teclado.row();
				});
			}
			await bot.api.sendMessage(chatId, texto, teclado ? { reply_markup: teclado } : undefined);
		},
	};
	return { port, bot };
}

export function ligarRobo(bot: Bot, robo: Robo) {
	bot.on("message:text", async (c) => {
		const t = c.message.text;
		const chat = String(c.chat.id);
		const m = /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/.exec(t);
		if (m) await robo.aoTelegram(chat, { tipo: "comando", nome: (m[1] as string).toLowerCase(), arg: m[2]?.trim() });
		else await robo.aoTelegram(chat, { tipo: "texto", texto: t });
	});
	bot.on("callback_query:data", async (c) => {
		await c.answerCallbackQuery().catch(() => {});
		await robo.aoTelegram(String(c.chat?.id ?? c.from.id), { tipo: "botao", dado: c.callbackQuery.data });
	});
	bot.catch((e) => console.error("telegram:", e.message));
}
