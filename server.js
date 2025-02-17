import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import http from "http";
import qs from "qs"; // For encoding the body as x-www-form-urlencoded

dotenv.config();
const app = express();
app.use(express.json());

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
      // **If user sends "hi", authenticate the user and fetch game list**
      if (userMessage === "hi") {
        // Step 1: Ask for the username and password
        await sendTextMessage(business_phone_number_id, userPhone, "Please provide your username:");
        
        // Store username in session (you might want to implement a session management system)
        // This assumes you'll be waiting for another response for the password
        return; // Exit to handle the username request next
      }

      // Handle username input from user
      if (userMessage && !sessionCookie) {
        // Assuming the message contains the username
        const userName = userMessage;

        await sendTextMessage(business_phone_number_id, userPhone, "Please provide your password:");
        
        // Store username for later
        // You'll need to save the username securely for further authentication
        return; // Exit to handle the password request next
      }

      // Handle password input from user
      if (userMessage && sessionCookie) {
        const password = userMessage;

        // Step 2: Authenticate user with Rails API
        const authData = qs.stringify({
          "utf8": "✓",
          "user[user_name]": userName,  // Use the username saved earlier
          "user[password]": password,
          "captcha": "1",
          "captcha_key": "123"
        });

        const authResponse = await axios.post(`${RAILS_API_URL}/users/sign_in`, authData, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Api-Key": "2tnFcmn5Lk-a7xwmazAF",
            "Accept": "application/xhtml+xml",
          }
        });

        if (authResponse.status === 200) {
          // Step 3: Save the session cookie for future API calls
          sessionCookie = authResponse.headers["set-cookie"][0]; // Get the cookie from the response headers

          // Now that user is authenticated, proceed with fetching games
          const gamesResponse = await axios.get(`${HEROIC_API_URL}/user/games`, {
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/xhtml+xml",
              "API_KEY": API_KEY,
              "Cookie": sessionCookie, // Use the stored cookie for subsequent requests
            },
          });

          const games = gamesResponse.data.casinotables;
          if (games.length === 0) {
            await sendTextMessage(business_phone_number_id, userPhone, "No games available right now.");
          } else {
            await sendInteractiveMessage(business_phone_number_id, userPhone, games);
          }
        } else {
          await sendTextMessage(business_phone_number_id, userPhone, "Authentication failed. Please check your credentials.");
        }
      }
      // Handle game selection or other commands as before
      else if (message.interactive?.type === "button_reply") {
        const selectedGame = message.interactive.button_reply.title;
        const selectedGameId = message.interactive.button_reply.id.split("_")[1]; // Extract game ID

        await sendTextMessage(business_phone_number_id, userPhone, `You selected: ${selectedGame}`);

        // **If selected game ID is 3 (Main Bazar), fetch match details**
        if (selectedGameId === "3") {
          const matkaResponse = await axios.get(`${HEROIC_API_URL}/lottery/casino_tables/3/matka_games`, {
            headers: {
              "API_KEY": API_KEY,
              "Accept": "application/xhtml+xml",
              "Cookie": sessionCookie // Use the stored cookie
            }
          });

          const match = matkaResponse.data.in_play_matches?.[0];
          if (match) {
            await sendTextMessage(
              business_phone_number_id,
              userPhone,
              `Match: ${match.title}\nStart Time: ${match.start_time}\n\nTo place a bet, send: aakdaOpen|1|500`
            );
          } else {
            await sendTextMessage(business_phone_number_id, userPhone, "No active Matka matches available.");
          }
        }
      }
    } catch (error) {
      console.error("Error processing message:", error.response?.data || error);
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
http.createServer(app).listen(port, () => {
  console.log(`Server running on port ${port}`);
});
