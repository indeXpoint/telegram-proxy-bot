const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// =======================
// CONFIGURATION
// =======================

const ADMIN_ID = process.env.ADMIN_CHAT_ID;

// Map bot keys → tokens
const BOTS = {
  botA: process.env.BOT_TOKEN_A,
  botB: process.env.BOT_TOKEN_B,
  botC: process.env.BOT_TOKEN_C,
  // Add more bots here
};

// Cache bot names
const BOT_INFO_CACHE = {};

// In-memory ticket store
const tickets = {}; // userId -> { ticketId, status: 'open' }

// Helper: get bot name dynamically
async function getBotName(token) {
  if (BOT_INFO_CACHE[token]) return BOT_INFO_CACHE[token];
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json();
  const name = data.result.first_name;
  BOT_INFO_CACHE[token] = name;
  return name;
}

// Helper: Telegram API
const api = (token) => `https://api.telegram.org/bot${token}`;

// Helper: Generate or get ticket for user
function getTicket(userId) {
  if (!tickets[userId]) {
    tickets[userId] = { ticketId: crypto.randomBytes(3).toString("hex"), status: "open" };
  }
  return tickets[userId].ticketId;
}

// =======================
// WEBHOOK HANDLER
// =======================

app.post("/webhook/:botKey", async (req, res) => {
  try {
    const { botKey } = req.params;
    const token = BOTS[botKey];
    if (!token) return res.send("Unknown bot");

    const update = req.body;
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const fromId = msg.from.id.toString();
    const text = msg.text || msg.caption || "";

    const botName = await getBotName(token);

    // =======================
    // START COMMAND → generate ticket
    // =======================
    if (text === "/start") {
      const ticketId = getTicket(fromId);
      const welcomeMessage = `👋 Welcome!

This is a relay support bot of *${botName}*.
Your ticket ID is: *#${ticketId}*.
Send your message and it will be delivered to our team.
We’ll reply here as soon as possible.`;

      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: fromId,
          text: welcomeMessage,
          parse_mode: "Markdown",
        }),
      });
      return res.send("ok");
    }

    // =======================
    // ADMIN BUTTON HANDLER
    // =======================
    if (update.callback_query) {
      const callback = update.callback_query;
      const data = callback.data; // e.g., "reply_<userId>" or "close_<userId>"
      const userId = data.split("_")[1];

      if (data.startsWith("close_")) {
        if (tickets[userId]) tickets[userId].status = "closed";

        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: `Ticket #${tickets[userId].ticketId} closed ✅` }),
        });

      } else if (data.startsWith("reply_")) {
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: "Send your reply as a normal message" }),
        });
      }
      return res.send("ok");
    }

    // =======================
    // ADMIN REPLY
    // =======================
    if (fromId === ADMIN_ID && msg.reply_to_message) {
      const original = msg.reply_to_message.caption || msg.reply_to_message.text || "";
      const match = original.match(/User ID:\s*(\d+)/);
      if (!match) return res.send("ok");

      const userId = match[1];

      // Handle media and text
      if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        await fetch(`${api(token)}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, photo: fileId, caption: text || "" }),
        });
      } else if (msg.video) {
        await fetch(`${api(token)}/sendVideo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, video: msg.video.file_id, caption: text || "" }),
        });
      } else if (msg.document) {
        await fetch(`${api(token)}/sendDocument`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, document: msg.document.file_id, caption: text || "" }),
        });
      } else if (msg.audio) {
        await fetch(`${api(token)}/sendAudio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, audio: msg.audio.file_id, caption: text || "" }),
        });
      } else if (msg.voice) {
        await fetch(`${api(token)}/sendVoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, voice: msg.voice.file_id, caption: text || "" }),
        });
      } else {
        await fetch(`${api(token)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, text: text || "[reply]" }),
        });
      }

      return res.send("ok");
    }

    // =======================
    // USER → ADMIN RELAY
    // =======================
    const username = msg.from.username ? `@${msg.from.username}` : "(no username)";
    const ticketId = getTicket(fromId);
    const header =
      `📩 New message\n` +
      `Bot: ${botKey}\n` +
      `Ticket: #${ticketId}\n` +
      `From: ${username}\n` +
      `User ID: ${fromId}`;

    // Inline buttons for admin
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "Reply", callback_data: `reply_${fromId}` },
          { text: "Close Ticket", callback_data: `close_${fromId}` },
        ],
      ],
    };

    // Media relay with caption
    const options = {
      chat_id: ADMIN_ID,
      caption: `${header}\n\n${text || ""}`,
      reply_markup: inlineKeyboard,
    };

    if (msg.photo) options.photo = msg.photo[msg.photo.length - 1].file_id;
    else if (msg.video) options.video = msg.video.file_id;
    else if (msg.document) options.document = msg.document.file_id;
    else if (msg.audio) options.audio = msg.audio.file_id;
    else if (msg.voice) options.voice = msg.voice.file_id;

    const method = msg.photo
      ? "sendPhoto"
      : msg.video
      ? "sendVideo"
      : msg.document
      ? "sendDocument"
      : msg.audio
      ? "sendAudio"
      : msg.voice
      ? "sendVoice"
      : "sendMessage";

    if (method === "sendMessage") options.text = `${header}\n\n${text || "[non-text message]"}`;

    await fetch(`${api(token)}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    res.send("ok");

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("error");
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Multi-bot support relay running on port ${PORT}`));
