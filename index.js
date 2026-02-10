const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const WELCOME_MESSAGE = `👋 Welcome!

This is a relay support bot.
Send your message and it will be delivered to our team.
We’ll reply here as soon as possible.`;

app.post("/", async (req, res) => {
  const update = req.body;

  if (!update.message) {
    return res.send("ok");
  }

  const msg = update.message;
  const fromId = msg.from.id.toString();
  const text = msg.text || msg.caption || "";

  // 🚀 START command
  if (text === "/start") {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: fromId,
        text: WELCOME_MESSAGE,
      }),
    });

    return res.send("ok");
  }

  // 👑 ADMIN replying
  if (fromId === ADMIN_ID && msg.reply_to_message) {
    const original =
      msg.reply_to_message.text ||
      msg.reply_to_message.caption ||
      "";

    const match = original.match(/User ID:\s*(\d+)/);
    if (!match) return res.send("ok");

    const userId = match[1];

    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: text || "[reply]",
      }),
    });

    return res.send("ok");
  }

  // 👤 USER → ADMIN (relay)
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: ADMIN_ID,
      text: `📩 New message\nUser ID: ${fromId}\n\n${text || "[non-text message]"}`,
    }),
  });

  res.send("ok");
});

// REQUIRED FOR RENDER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Bot running on port", PORT);
});
