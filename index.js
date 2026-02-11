const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// =======================
// CONFIG
// =======================
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

const BOTS = {
  botA: process.env.BOT_TOKEN_A,
  botB: process.env.BOT_TOKEN_B,
  botC: process.env.BOT_TOKEN_C,
};

// In-memory storage (Render-safe but resets on restart)
const tickets = {}; // userId → { ticketId, botKey }
let replyMode = null; // { userId, botKey }

const BOT_NAME_CACHE = {};
const api = (token) => `https://api.telegram.org/bot${token}`;

// =======================
// HELPERS
// =======================
async function getBotName(token) {
  if (BOT_NAME_CACHE[token]) return BOT_NAME_CACHE[token];
  const res = await fetch(`${api(token)}/getMe`);
  const data = await res.json();
  BOT_NAME_CACHE[token] = data.result.first_name;
  return BOT_NAME_CACHE[token];
}

function createTicket(userId, botKey) {
  const ticketId = crypto.randomBytes(3).toString("hex");
  tickets[userId] = { ticketId, botKey };
  return ticketId;
}

function detectMedia(msg) {
  if (msg.photo) return { method: "sendPhoto", file: msg.photo.at(-1).file_id };
  if (msg.video) return { method: "sendVideo", file: msg.video.file_id };
  if (msg.document) return { method: "sendDocument", file: msg.document.file_id };
  if (msg.audio) return { method: "sendAudio", file: msg.audio.file_id };
  if (msg.voice) return { method: "sendVoice", file: msg.voice.file_id };
  return null;
}

// =======================
// WEBHOOK
// =======================
app.post("/webhook/:botKey", async (req, res) => {
  try {
    const { botKey } = req.params;
    const token = BOTS[botKey];
    if (!token) return res.send("Unknown bot");

    const update = req.body;

    // =======================
    // CALLBACK BUTTONS
    // =======================
    if (update.callback_query) {
      const { data, id } = update.callback_query;
      const userId = data.split("_")[1];

      if (data.startsWith("reply_")) {
        replyMode = { userId, botKey };
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: id,
            text: "Reply mode ON ✍️",
          }),
        });
      }

      if (data.startsWith("close_")) {
        delete tickets[userId];
        replyMode = null;

        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: id,
            text: "Ticket closed ✅",
          }),
        });

        await fetch(`${api(token)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: userId,
            text: "💬 Chat closed.\nPlease send /start to open a new ticket.",
          }),
        });
      }

      return res.send("ok");
    }

    // =======================
    // MESSAGE
    // =======================
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const fromId = msg.from.id.toString();
    const text = msg.text || msg.caption || "";
    const media = detectMedia(msg);

    // =======================
    // START
    // =======================
    if (text === "/start") {
      const botName = await getBotName(token);
      const ticketId = createTicket(fromId, botKey);

      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: fromId,
          text:
            `👋 Welcome!\n\n` +
            `This is *${botName}* support.\n` +
            `🎫 Ticket ID: *#${ticketId}*\n\n` +
            `Send your message below.`,
          parse_mode: "Markdown",
        }),
      });

      return res.send("ok");
    }

    // =======================
    // ADMIN REPLY
    // =======================
    if (fromId === ADMIN_ID && replyMode) {
      const { userId } = replyMode;

      const payload = {
        chat_id: userId,
        caption: text || "",
      };

      if (media) payload[media.method.replace("send", "").toLowerCase()] = media.file;

      await fetch(`${api(token)}/${media ? media.method : "sendMessage"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          media ? payload : { chat_id: userId, text }
        ),
      });

      replyMode = null;
      return res.send("ok");
    }

    // =======================
    // USER → ADMIN
    // =======================
    if (!tickets[fromId]) {
      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: fromId,
          text: "❌ Please send /start first.",
        }),
      });
      return res.send("ok");
    }

    const { ticketId } = tickets[fromId];
    const username = msg.from.username ? `@${msg.from.username}` : "No username";

    const buttons = {
      inline_keyboard: [[
        { text: "Reply", callback_data: `reply_${fromId}` },
        { text: "Close Ticket", callback_data: `close_${fromId}` },
      ]],
    };

    const header =
      `📩 New Message\n` +
      `Bot: ${botKey}\n` +
      `Ticket: #${ticketId}\n` +
      `User: ${username}\n` +
      `ID: ${fromId}`;

    const adminPayload = {
      chat_id: ADMIN_ID,
      caption: `${header}\n\n${text || ""}`,
      reply_markup: buttons,
    };

    if (media) adminPayload[media.method.replace("send", "").toLowerCase()] = media.file;

    await fetch(`${api(token)}/${media ? media.method : "sendMessage"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        media
          ? adminPayload
          : { chat_id: ADMIN_ID, text: `${header}\n\n${text}`, reply_markup: buttons }
      ),
    });

    res.send("ok");
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// =======================
app.listen(process.env.PORT || 3000, () =>
  console.log("✅ Multi-bot support relay running"),
);
