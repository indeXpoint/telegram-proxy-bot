const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// =======================
// CONFIGURATION
// =======================
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

// Define all your bots here
const BOTS = {
  botA: process.env.BOT_TOKEN_A,
  botB: process.env.BOT_TOKEN_B,
  // add more bots as needed
};

// In-memory storage
const tickets = {}; // { userId: { ticketId, botKey } }
const replyQueue = {}; // { userId: botKey }

// Cache bot names
const botNames = {};

// =======================
// TELEGRAM HELPERS
// =======================
const api = (token) => `https://api.telegram.org/bot${token}`;

async function getBotName(token) {
  if (botNames[token]) return botNames[token];
  try {
    const res = await fetch(`${api(token)}/getMe`);
    const data = await res.json();
    botNames[token] = data.result.first_name;
    return botNames[token];
  } catch {
    return "Support Bot";
  }
}

// Detect type and file_id for media messages
function getMedia(msg) {
  if (msg.photo) return { type: "photo", file_id: msg.photo[msg.photo.length - 1].file_id };
  if (msg.video) return { type: "video", file_id: msg.video.file_id };
  if (msg.document) return { type: "document", file_id: msg.document.file_id };
  if (msg.audio) return { type: "audio", file_id: msg.audio.file_id };
  if (msg.voice) return { type: "voice", file_id: msg.voice.file_id };
  return { type: "text", file_id: null };
}

// Send message (text or media)
async function sendMessage(token, chat_id, content) {
  const { type, file_id, text } = content;
  const body = { chat_id };
  let method = "sendMessage";

  if (type === "text") body.text = text || "[non-text message]";
  if (type === "photo") { body.photo = file_id; method = "sendPhoto"; }
  if (type === "video") { body.video = file_id; method = "sendVideo"; }
  if (type === "document") { body.document = file_id; method = "sendDocument"; }
  if (type === "audio") { body.audio = file_id; method = "sendAudio"; }
  if (type === "voice") { body.voice = file_id; method = "sendVoice"; }

  try {
    await fetch(`${api(token)}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("SendMessage error:", err);
  }
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
    // CALLBACK BUTTONS
    // =======================
    if (update.callback_query) {
      const callback = update.callback_query;
      const data = callback.data; // reply_userId or close_userId
      const userId = data.split("_")[1];

      if (data.startsWith("close_")) {
        delete tickets[userId];
        delete replyQueue[userId];

        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: "Ticket closed ✅" }),
        });

        await sendMessage(token, userId, { type: "text", text: "💬 Chat closed. Please click /start to begin a new conversation." });
      } else if (data.startsWith("reply_")) {
        replyQueue[userId] = botKey;
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: "Reply mode activated. Send your message to user." }),
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
    const media = getMedia(msg);

    const botName = await getBotName(token);

    // START command → create ticket
    if (text === "/start") {
      tickets[fromId] = { ticketId: crypto.randomBytes(3).toString("hex"), botKey };
      await sendMessage(token, fromId, { type: "text", text: `👋 Welcome!\nThis is *${botName}*.\nSend a message to start.\nYour ticket ID: #${tickets[fromId].ticketId}` });
      return res.send("ok");
    }

    // ADMIN message → reply mode
    if (fromId === ADMIN_ID) {
      const replyingUserId = Object.keys(replyQueue).find(u => replyQueue[u] === botKey);
      if (replyingUserId) {
        await sendMessage(token, replyingUserId, media.type === "text" ? { type: "text", text } : media);
        delete replyQueue[replyingUserId];
        return res.send("ok");
      }
    }

    // USER message → forward to admin
    if (tickets[fromId] && tickets[fromId].botKey === botKey) {
      const username = msg.from.username ? `@${msg.from.username}` : "(no username)";
      const ticketId = tickets[fromId].ticketId;
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: "Reply", callback_data: `reply_${fromId}` }, { text: "Close Ticket", callback_data: `close_${fromId}` }],
        ],
      };
      const header = `📩 New message\nBot: ${botKey}\nTicket: #${ticketId}\nFrom: ${username}\nUser ID: ${fromId}`;

      const adminContent = media.type === "text"
        ? { type: "text", text: `${header}\n\n${text}` }
        : { ...media, text: `${header}` };

      await sendMessage(token, ADMIN_ID, adminContent);

      // Send inline keyboard for buttons
      if (media.type === "text") {
        await fetch(`${api(token)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: ADMIN_ID, text: " ", reply_markup: inlineKeyboard }),
        });
      }

      return res.send("ok");
    } else {
      await sendMessage(token, fromId, { type: "text", text: "❌ Please click /start to begin a conversation." });
      return res.send("ok");
    }

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("error");
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Multi-bot relay running on port ${PORT}`));
