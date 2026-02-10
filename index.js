const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const ADMIN_ID = process.env.ADMIN_CHAT_ID;

// Map bot keys → tokens
const BOTS = {
  botA: process.env.BOT_TOKEN_A,
  botB: process.env.BOT_TOKEN_B,
  botC: process.env.BOT_TOKEN_C,
};

const WELCOME_MESSAGE = `👋 Welcome!

This is a relay support bot.
Send your message and it will be delivered to our team.
We’ll reply here as soon as possible.`;

// helper
const api = (token) => `https://api.telegram.org/bot${token}`;

app.post("/webhook/:botKey", async (req, res) => {
  const { botKey } = req.params;
  const token = BOTS[botKey];

  if (!token) return res.send("unknown bot");

  const update = req.body;
  if (!update.message) return res.send("ok");

  const msg = update.message;
  const fromId = msg.from.id.toString();
  const text = msg.text || msg.caption || "";

  /* START */
  if (text === "/start") {
    await fetch(`${api(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: fromId,
        text: WELCOME_MESSAGE,
      }),
    });
    return res.send("ok");
  }

  /* ADMIN REPLY */
  if (fromId === ADMIN_ID && msg.reply_to_message) {
    const original = msg.reply_to_message.text || "";
    const match = original.match(/User ID:\s*(\d+)/);

    if (!match) return res.send("ok");

    const userId = match[1];

    await fetch(`${api(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: text || "[reply]",
      }),
    });

    return res.send("ok");
  }

  /* USER → ADMIN */
  const username = msg.from.username
    ? `@${msg.from.username}`
    : "(no username)";

  await fetch(`${api(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: ADMIN_ID,
      text:
        `📩 New message\n` +
        `Bot: ${botKey}\n` +
        `From: ${username}\n` +
        `User ID: ${fromId}\n\n` +
        `${text || "[non-text message]"}`,
    }),
  });

  res.send("ok");
});

// Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Multi-bot relay running on port", PORT);
});
