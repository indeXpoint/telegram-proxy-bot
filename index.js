const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

app.post("/", async (req, res) => {
  const update = req.body;

  if (!update.message) {
    return res.send("ok");
  }

  const msg = update.message;
  const fromId = msg.from.id.toString();
  const text = msg.text || "[non-text message]";

  // Admin replying to a forwarded message
  if (
    fromId === ADMIN_ID &&
    msg.reply_to_message &&
    msg.reply_to_message.text
  ) {
    const match = msg.reply_to_message.text.match(/User ID: (\d+)/);
    if (match) {
      const userId = match[1];

      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: userId,
          text,
        }),
      });
    }
  } else {
    // User message → forward to admin
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_ID,
        text: `📩 New message\nUser ID: ${fromId}\n\n${text}`,
      }),
    });
  }

  res.send("ok");
});

// REQUIRED for Render (open port)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
