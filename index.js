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
  // Add more bots here or via a JSON env var
};

// Cache bot names
const BOT_INFO_CACHE = {};

// In-memory ticket store (for simplicity, can replace with DB)
const tickets = {}; // userId -> ticketId

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

// Helper: Generate ticket ID
function generateTicketId(userId) {
  if (!tickets[userId]) {
    tickets[userId] = crypto.randomBytes(3).toString("hex"); // 6-char hex
  }
  return tickets[userId];
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
    // START COMMAND
    // =======================
    if (text === "/start") {
      const welcomeMessage = `👋 Welcome!

This is a relay support bot of *${botName}*.
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
    // ADMIN REPLY
    // =======================
    if (fromId === ADMIN_ID && msg.reply_to_message) {
      const original = msg.reply_to_message.caption || msg.reply_to_message.text || "";
      const match = original.match(/User ID:\s*(\d+)/);
      if (!match) return res.send("ok");

      const userId = match[1];

      // Handle all media types
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
    const ticketId = generateTicketId(fromId);
    const header =
      `📩 New message\n` +
      `Bot: ${botKey}\n` +
      `Ticket: #${ticketId}\n` +
      `From: ${username}\n` +
      `User ID: ${fromId}`;

    // Media relay
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await fetch(`${api(token)}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, photo: fileId, caption: `${header}\n\n${text || ""}` }),
      });
    } else if (msg.video) {
      await fetch(`${api(token)}/sendVideo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, video: msg.video.file_id, caption: `${header}\n\n${text || ""}` }),
      });
    } else if (msg.document) {
      await fetch(`${api(token)}/sendDocument`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, document: msg.document.file_id, caption: `${header}\n\n${text || ""}` }),
      });
    } else if (msg.audio) {
      await fetch(`${api(token)}/sendAudio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, audio: msg.audio.file_id, caption: `${header}\n\n${text || ""}` }),
      });
    } else if (msg.voice) {
      await fetch(`${api(token)}/sendVoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, voice: msg.voice.file_id, caption: `${header}\n\n${text || ""}` }),
      });
    } else {
      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: `${header}\n\n${text || "[non-text message]"}` }),
      });
    }

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
