const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

app.post("/", async (req, res) => {
  const update = req.body;
  console.log("UPDATE:", JSON.stringify(update));

  if (!update.message) {
    return res.send("ok");
  }

  const msg = update.message;
  const fromId = msg.from.id.toString();
  const text = msg.text || msg.caption || "";

  // 👑 ADMIN replying
  if (
    fromId === ADMIN_ID &&
    msg.reply_to_message
  ) {
    const original =
      msg.reply_to_message.text ||
      msg.reply_to_message.caption ||
      "";

    const match = original.match(/User ID:\s*(\d+)/);

    if (!match) {
      console.log("❌ No User ID found in reply");
      return res.send("ok");
    }

    const userId = match[1];

    console.log("➡️ Sending reply to user:", userId);

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

  // 👤 USER → ADMIN
  console.log("📩 New user message:", fromId);

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
