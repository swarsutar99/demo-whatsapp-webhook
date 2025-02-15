import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import https from "https";

dotenv.config();
const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, HEROIC_API_URL, API_KEY, PORT } = process.env;
const port = 3002; // Run directly on 443

const options = {
  key: fs.readFileSync("/etc/ssl/private/private.key"), 
  cert: fs.readFileSync("/etc/ssl/certificate_plus_ca_bundle.crt")
};

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed.");
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));

  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
  const business_phone_number_id = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;

  if (message) {
    const userMessage = message.text?.body.toLowerCase();

    try {
      // **If user sends "hi", fetch game list and send options**
      if (userMessage === "hi") {
        const gamesResponse = await axios.get(`${HEROIC_API_URL}/user/games`, {
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "API_KEY": "2tnFcmn5Lk-a7xwmazAF",
          },
        });

        const games = gamesResponse.data.casinotables;
        if (games.length === 0) {
          await sendTextMessage(business_phone_number_id, message.from, "No games available right now.");
        } else {
          await sendInteractiveMessage(business_phone_number_id, message.from, games);
        }
      }
      // **Handle game selection response**
      else if (message.interactive?.type === "button_reply") {
        const selectedGame = message.interactive.button_reply.title;
        await sendTextMessage(business_phone_number_id, message.from, `You have selected this game: ${selectedGame}`);
      }

    } catch (error) {
      console.error("Error processing message:", error.response?.data || error);
    }
  }

  res.sendStatus(200);
});

// **Function to send interactive game selection message**
async function sendInteractiveMessage(phoneNumberId, userPhone, games) {
  const buttons = games.slice(0, 3).map((game, index) => ({
    type: "reply",
    reply: {
      id: `game_${game.id}`,
      title: game.title,
    },
  }));

  const payload = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Select a game to play:" },
      action: {
        buttons: buttons,
      },
    },
  };

  await axios.post(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, payload, {
    headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` },
  });

  console.log("Interactive message sent.");
}

// **Function to send a text message**
async function sendTextMessage(phoneNumberId, userPhone, text) {
  const payload = {
    messaging_product: "whatsapp",
    to: userPhone,
    text: { body: text },
  };

  await axios.post(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, payload, {
    headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` },
  });

  console.log("Text message sent.");
}

// Start HTTPS Server
https.createServer(options, app).listen(port, () => {
  console.log(` Server is running securely on HTTPS port ${port}`);
});
