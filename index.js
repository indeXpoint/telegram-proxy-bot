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
// Structure: tickets[userId] = { ticketId, status, lastBotKey }
const tickets = {};

// Admin reply tracker: replyQueue[userId] = botKey
const replyQueue = {}; // tracks which bot the admin is replying through

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
function getTicket(userId, botKey) {
  if (!tickets[userId]) {
    tickets[userId] = { ticketId: crypto.randomBytes(3).toString("hex"), status: "open", lastBotKey: botKey };
  } else {
    tickets[userId].lastBotKey = botKey;
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

    // =======================
    // CALLBACK QUERY (admin buttons)
    // =======================
    if (update.callback_query) {
      const callback = update.callback_query;
      const data = callback.data; // "reply_userId" or "close_userId"
      const userId = data.split("_")[1];

      if (!tickets[userId]) {
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: "Ticket not found ❌" }),
        });
        return res.send("ok");
      }

      if (data.startsWith("close_")) {
        tickets[userId].status = "closed";
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: `Ticket #${tickets[userId].ticketId} closed ✅` }),
        });
      } else if (data.startsWith("reply_")) {
        replyQueue[userId] = tickets[userId].lastBotKey; // mark admin is replying to this user
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: `Send your reply to ticket #${tickets[userId].ticketId}` }),
        });
      }

      return res.send("ok");
    }

    // =======================
    // MESSAGE HANDLER
    // =======================
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const fromId = msg.from.id.toString();
    const text = msg.text || msg.caption || "";

    const botName = await getBotName(token);

    // =======================
    // START COMMAND → generate ticket
    // =======================
    if (text === "/start") {
      const ticketId = getTicket(fromId, botKey);
      const welcomeMessage = `👋 Welcome!

This is a relay support bot of *${botName}*.
Your ticket ID is: *#${ticketId}*.
Send your message and it will be delivered to our team.
We’ll reply here as soon as possible.`;

      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: fromId, text: welcomeMessage, parse_mode: "Markdown" }),
      });
      return res.send("ok");
    }

    // =======================
    // ADMIN REPLY → check replyQueue
    // =======================
    if (fromId === ADMIN_ID) {
      // Find which user the admin is replying to
      const replyingUserId = Object.keys(replyQueue).find((u) => replyQueue[u] === botKey);
      if (replyingUserId) {
        // Handle media/text forwarding
        if (msg.photo) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          await fetch(`${api(token)}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: replyingUserId, photo: fileId, caption: text || "" }),
          });
        } else if (msg.video) {
          await fetch(`${api(token)}/sendVideo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: replyingUserId, video: msg.video.file_id, caption: text || "" }),
          });
        } else if (msg.document) {
          await fetch(`${api(token)}/sendDocument`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: replyingUserId, document: msg.document.file_id, caption: text || "" }),
          });
        } else if (msg.audio) {
          await fetch(`${api(token)}/sendAudio`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: replyingUserId, audio: msg.audio.file_id, caption: text || "" }),
          });
        } else if (msg.voice) {
          await fetch(`${api(token)}/sendVoice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: replyingUserId, voice: msg.voice.file_id, caption: text || "" }),
          });
        } else {
          await fetch(`${api(token)}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: replyingUserId, text: text || "[reply]" }),
          });
        }

        // Clear reply queue for this user
        delete replyQueue[replyingUserId];
        return res.send("ok");
      }
    }

    // =======================
    // USER → ADMIN RELAY
    // =======================
    const username = msg.from.username ? `@${msg.from.username}` : "(no username)";
    const ticketId = getTicket(fromId, botKey);
    const header =
      `📩 New message\n` +
      `Bot: ${botKey}\n` +
      `Ticket: #${ticketId}\n` +
      `From: ${username}\n` +
      `User ID: ${fromId}`;

    // Inline buttons
    const inlineKeyboard = { inline_keyboard: [
      [{ text: "Reply", callback_data: `reply_${fromId}` }, { text: "Close Ticket", callback_data: `close_${fromId}` }]
    ]};

    const options = {
      chat_id: ADMIN_ID,
      caption: `${header}\n\n${text || ""}`,
      reply_markup: inlineKeyboard,
    };

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

    if (method === "sendPhoto") options.photo = msg.photo[msg.photo.length - 1].file_id;
    if (method === "sendVideo") options.video = msg.video.file_id;
    if (method === "sendDocument") options.document = msg.document.file_id;
    if (method === "sendAudio") options.audio = msg.audio.file_id;
    if (method === "sendVoice") options.voice = msg.voice.file_id;
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
