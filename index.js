const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const ADMIN_ID = process.env.ADMIN_CHAT_ID;

const BOTS = {
  botA: process.env.BOT_TOKEN_A,
  botB: process.env.BOT_TOKEN_B,
};

// In-memory tickets: { userId: botKey }
const tickets = {};
// Admin reply queue
const replyQueue = {};

// Bot name cache
const botNames = {};

const api = (token) => `https://api.telegram.org/bot${token}`;

async function getBotName(token) {
  if (botNames[token]) return botNames[token];
  const res = await fetch(`${api(token)}/getMe`);
  const data = await res.json();
  botNames[token] = data.result.first_name;
  return botNames[token];
}

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
      const data = callback.data; // "reply_userId" or "close_userId"
      const userId = data.split("_")[1];

      if (data.startsWith("close_")) {
        // Remove ticket
        delete tickets[userId];
        delete replyQueue[userId];

        // Notify admin
        await fetch(`${api(token)}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: callback.id, text: "Ticket closed ✅" }),
        });

        // Notify user
        await fetch(`${api(token)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, text: "💬 Chat closed. Please click /start to begin a new conversation." }),
        });
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

    // START command → creates ticket
    if (text === "/start") {
      tickets[fromId] = botKey;
      const botName = await getBotName(token);
      const welcomeMessage = `👋 Welcome!\nThis is a relay support bot of *${botName}*.\nSend your message and it will be delivered to our team.`;
      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: fromId, text: welcomeMessage, parse_mode: "Markdown" }),
      });
      return res.send("ok");
    }

    // ADMIN REPLY
    if (fromId === ADMIN_ID) {
      const replyingUserId = Object.keys(replyQueue).find(u => replyQueue[u] === botKey);
      if (replyingUserId) {
        // Forward message to user
        await fetch(`${api(token)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: replyingUserId, text: text || "[reply]" }),
        });
        // Exit reply mode
        delete replyQueue[replyingUserId];
        return res.send("ok");
      }
    }

    // USER MESSAGE → ADMIN relay
    if (tickets[fromId] === botKey) {
      const username = msg.from.username ? `@${msg.from.username}` : "(no username)";
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: "Reply", callback_data: `reply_${fromId}` },
            { text: "Close Ticket", callback_data: `close_${fromId}` },
          ],
        ],
      };
      const header = `📩 New message\nFrom: ${username}\nUser ID: ${fromId}`;
      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: ADMIN_ID,
          text: `${header}\n\n${text || "[non-text message]"}`,
          reply_markup: inlineKeyboard,
        }),
      });
      return res.send("ok");
    } else {
      // User has not started ticket yet
      await fetch(`${api(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: fromId, text: "❌ Please click /start to begin a new conversation." }),
      });
      return res.send("ok");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Multi-bot support relay running on port ${PORT}`));
