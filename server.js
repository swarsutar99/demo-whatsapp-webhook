import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import http from "http";
import https from "https";
import fs from "fs";
import qs from "qs"; // For encoding the body as x-www-form-urlencoded

dotenv.config();
const app = express();
app.use(express.json());

const options = {
  key: fs.readFileSync("/etc/ssl/private/private.key"), 
  cert: fs.readFileSync("/etc/ssl/certificate_plus_ca_bundle.crt")
};

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, HEROIC_API_URL, API_KEY, PORT, RAILS_API_URL } = process.env;
const port = 3002;
let sessionCookie = ""; // Variable to store the session cookie

// Webhook verification
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
      const userPhone = message.from;

      try {
        if (userMessage === "hi") {
          await sendTextMessage(business_phone_number_id, userPhone, "Please send your username and password in this format: \n\n*username|password*");
          return;
        }

        // If the user sends credentials in the format "username|password"
        if (userMessage.includes("|")) {
          const credentials = userMessage.split("|");
          if (credentials.length !== 2) {
            await sendTextMessage(business_phone_number_id, userPhone, "Invalid format. Please send your credentials as: \n\n*username|password*");
            return;
          }

          const userName = credentials[0].trim();
          const password = credentials[1].trim();

          // Authenticate user with Rails API
          const authData = qs.stringify({
            "utf8": "✓",
            "user[user_name]": userName,
            "user[password]": password,
            "captcha": "1",
            "captcha_key": "123"
          });

          const authResponse = await axios.post(`${HEROIC_API_URL}/users/sign_in`, authData, {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Api-Key": "2tnFcmn5Lk-a7xwmazAF",
              "Accept": "application/xhtml+xml",
            }
          });

          if (authResponse.status === 200) {
            sessionCookie = authResponse.headers["set-cookie"][0]; // Store session cookie

            await sendTextMessage(business_phone_number_id, userPhone, "✅ Login successful! Fetching available games...");
            
            // Fetch games
            const gamesResponse = await axios.get(`${HEROIC_API_URL}/user/games`, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/xhtml+xml",
                "API_KEY": API_KEY,
                "Cookie": sessionCookie, 
              },
            });

            const games = gamesResponse.data.casinotables;
            if (games.length === 0) {
              await sendTextMessage(business_phone_number_id, userPhone, "No games available right now.");
            } else {
              await sendInteractiveMessage(business_phone_number_id, userPhone, games);
            }
          } else {
            await sendTextMessage(business_phone_number_id, userPhone, "❌ Authentication failed. Please check your credentials and try again.");
          }
          return;
        }
      } catch (error) {
        console.error("Error processing message:", error.response?.data || error);
        await sendTextMessage(business_phone_number_id, userPhone, "❌ Something went wrong. Please try again later.");
      }
    }

    res.sendStatus(200);
  });

// **Function to send interactive game selection message**
async function sendInteractiveMessage(phoneNumberId, userPhone, games) {
  const buttons = games.slice(0, 3).map((game) => ({
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
      action: { buttons },
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

// Start HTTP Server
https.createServer(options, app).listen(port, () => {
  console.log(` Server is running securely on HTTPS port ${port}`);
});