import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import http from "http";
import https from "https";
import fs from "fs";
import qs from "qs";
import tough from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

dotenv.config();
const app = express();
app.use(express.json());
let matchId = "";

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, HEROIC_API_URL, API_KEY, PORT, RAILS_API_URL } = process.env;
const port = 3002;

const options = {
  key: fs.readFileSync("/etc/ssl/private/private.key"), 
  cert: fs.readFileSync("/etc/ssl/certificate_plus_ca_bundle.crt")
};



const cookieJar = new tough.CookieJar();
const client = wrapper(axios.create({
  baseURL: HEROIC_API_URL,
  headers: { "Api-Key": API_KEY, "Accept": "application/xhtml+xml" },
  withCredentials: true,
  jar: cookieJar // Stores cookies automatically
}));

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

  const processedEvents = new Set(); // To track processed event IDs

  app.post("/webhook", async (req, res) => {
    console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));

    // Send 200 response immediately to avoid redelivery
    res.sendStatus(200);

    // Extract message and metadata
    const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
    const business_phone_number_id = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;
    const eventId = req.body.entry?.[0]?.id; // Unique event ID

    if (!message || !eventId) return;

    // Prevent duplicate event processing
    if (processedEvents.has(eventId)) {
      console.log(`Duplicate event detected: ${eventId}, skipping...`);
      return;
    }
    processedEvents.add(eventId); // Mark event as processed

    let userMessage = "";
    if (message.text) {
      userMessage = message.text.body;
    } else if (message.interactive?.button_reply) {
      userMessage = message.interactive.button_reply.id; // Game ID or Match ID
    }

    console.log("userMessage:", userMessage);
    const userPhone = message.from;

    try {
      // Step 1: User sends "hi"
      if (userMessage === "hi") {
        try {
          await sendTextMessage(business_phone_number_id, userPhone, "Please send your username and password in this format: \n\n*username|password*");
        } catch (error) {
          if (error.response?.data?.error?.code === 131047) {
            await sendTextMessage(business_phone_number_id, userPhone, "❌ You can only interact within 24 hours of your last message. Send a new message to restart.");
          } else {
            console.error("Error sending message:", error.response?.data || error);
            await sendTextMessage(business_phone_number_id, userPhone, "❌ Something went wrong. Please try again later.");
          }
        }
        return;
      }

      // Step 2: User sends credentials
      if (userMessage.includes("|")) {
        const credentials = userMessage.split("|").map((cred) => cred.trim());
        if (credentials.length !== 2) {
          await sendTextMessage(business_phone_number_id, userPhone, "Invalid format. Please send your credentials as: \n\n*username|password*");
          return;
        }

        const [userName, password] = credentials;
        console.log("userName:", userName);
        console.log("password:", password);

        let csrfResponse = await axios.get(`${HEROIC_API_URL}/users/sign_in`, {
          headers: { "Api-Key": "2tnFcmn5Lk-a7xwmazAF", "Accept": "application/xhtml+xml" },
          withCredentials: true,
        });

        const csrfTokenMatch = csrfResponse.data.match(/<meta content="(.*?)" name="csrf-token" \/>/);
        const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;
        console.log("CSRF Token:", csrfToken);
        if (!csrfToken) throw new Error("CSRF Token not found!");

        const authData = new URLSearchParams({
          utf8: "✓",
          "user[user_name]": userName,
          "user[password]": password,
          captcha: "1",
          captcha_key: "123",
        });

        let authResponse = await axios.post(`${HEROIC_API_URL}/users/sign_in`, authData.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded", "Api-Key": "2tnFcmn5Lk-a7xwmazAF", "Accept": "application/json", "X-CSRF-Token": csrfToken },
          withCredentials: true,
          maxRedirects: 0,
        });

        global.sessionCookie = authResponse.headers["set-cookie"]?.[0] || "";

        if (authResponse.status === 200) {
          await sendTextMessage(business_phone_number_id, userPhone, "✅ Login successful! Fetching available games...");
          const gamesResponse = await axios.get(`${HEROIC_API_URL}/user/games`, { headers: { "Accept": "application/json", "API_KEY": API_KEY } });

          const games = gamesResponse.data.casinotables || [];
          games.length === 0
            ? await sendTextMessage(business_phone_number_id, userPhone, "No games available right now.")
            : await sendInteractiveMessage(business_phone_number_id, userPhone, games);
        } else {
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Authentication failed. Please check your credentials.");
        }
        return;
      }

      // Step 3: User selects a game
      if (userMessage.startsWith("game_")) {
        const gameId = userMessage.replace("game_", "");
        const headers = { "Api-Key": "2tnFcmn5Lk-a7xwmazAF", "Accept": "application/json", "Cookie": global.sessionCookie };

        const matchesResponse = await axios.get(`${HEROIC_API_URL}/lottery/casino_tables/${gameId}/matka_games`, { headers });
        const matches = matchesResponse.data.matka_in_play_matches || [];

        matches.length === 0
          ? await sendTextMessage(business_phone_number_id, userPhone, "No matches available for this game.")
          : await sendInteractiveMessageForMatch(
              business_phone_number_id,
              userPhone,
              matches.map((match) => ({
                id: `match_${match.provider_id}`,
                title: `${match.title} - ${new Date(match.start_time).toLocaleString()}`,
              })),
              "Select a match:"
            );
        return;
      }

      // Step 4: User selects a match
      if (userMessage.startsWith("game_match_")) {
        const matchId = userMessage.replace("game_match_", ""); // Locally scoped matchId
        console.log("matchId:", matchId);
        await sendTextMessage(business_phone_number_id, userPhone, `✅ You selected Match ID: ${matchId}\n\nTo place a bet, send: \naakdaOpen/1/500/${matchId}`);
        return;
      }

      // Step 5: User places a bet
      if (userMessage.includes("/")) {
        const betParts = userMessage.split("/").map((part) => part.trim());
        if (betParts.length !== 4) {
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Invalid format. Use: \naakdaOpen/{runnerId}/{stake}/{matchId}");
          return;
        }

        const [heroicMarketType, runnerId, stake, matchId] = betParts;
        const betData = {
          provider_match_id: String(matchId),
          market_id: "93",
          stake: String(stake),
          runner_id: String(runnerId),
          odds_val: "10.5",
          odds_type: "LAGAI",
          heroic_market_type: String(heroicMarketType),
        };

        try {
          const betResponse = await axios.post(`${HEROIC_API_URL}/api/v1/casino_tables/card_game/new_matka/matches/create_bet`, betData, {
            headers: { "Content-Type": "application/json", "Api-Key": "2tnFcmn5Lk-a7xwmazAF", "Accept": "application/json", "Cookie": global.sessionCookie },
          });

          betResponse.status === 200
            ? await sendTextMessage(business_phone_number_id, userPhone, "✅ Bet placed successfully!")
            : await sendTextMessage(business_phone_number_id, userPhone, "❌ Failed to place bet.");
        } catch (error) {
          console.error("Error placing bet:", error.response?.data.message || error);
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Bet placement failed.");
        }
        return;
      }
    } catch (error) {
      console.error("Error processing message:", error.response?.data || error);
    }
  });


// **Function to send interactive game selection message**
async function sendInteractiveMessage(phoneNumberId, userPhone, games) {
  const filteredGames = games.filter(game => game.event_type === "matka").slice(0, 3);

  const buttons = filteredGames.map((game) => {
    let title = game.title;

    // Validate the title length (1 to 20 characters)
    if (title.length > 20) {
      title = title.slice(0, 20);
    }

    if (title.length < 1) {
      title = "Game"; // Fallback title
    }

    console.log(`Button title for game ${game.id}: "${title}"`);

    return {
      type: "reply",
      reply: {
        id: `game_${game.id}`,
        title: title,
      },
    };
  });

  const messageData = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Select a game:",
      },
      body: {
        text: "Please select a game to play.",
      },
      action: {
        buttons: buttons,
      },
    },
  };

  await sendMessage(phoneNumberId, userPhone, messageData);
}


async function sendInteractiveMessageForMatch(phoneNumberId, userPhone, games) {
  const buttons = games.slice(0, 3).map((game) => {
    // Validate the title length to ensure it's between 1 and 20 characters
    let title = game.title;

    if (title.length > 20) {
      // Truncate if title exceeds 20 characters
      title = title.slice(0, 20);
    }

    // Ensure there's at least one character
    if (title.length < 1) {
      title = "Game"; // Set a fallback title
    }

    // Log the button title for debugging
    console.log(`Button title for game ${game.id}: "${title}"`);

    return {
      type: "reply",
      reply: {
        id: `game_${game.id}`,
        title: title,
      },
    };
  });

  const messageData = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Select a game:",
      },
      body: {
        text: "Please select a match to play.",
      },
      action: {
        buttons: buttons,
      },
    },
  };

  await sendMessage(phoneNumberId, userPhone, messageData);
}

// **Function to send a text message**
async function sendTextMessage(phoneNumberId, userPhone, message) {
  const messageData = {
    messaging_product: "whatsapp",
    to: userPhone,
    text: { body: message },
  };

  await sendMessage(phoneNumberId, userPhone, messageData);
}

// **Function to send any message via the WhatsApp API**
async function sendMessage(phoneNumberId, userPhone, messageData) {
  const url = `https://graph.facebook.com/v16.0/${phoneNumberId}/messages`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${GRAPH_API_TOKEN}`,
  };

  try {
    const response = await axios.post(url, messageData, { headers });
    console.log("Message sent:", response.data);
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error);
  }
}

https.createServer(options, app).listen(port, () => {
  console.log(` Server is running securely on HTTPS port ${port}`);
});
