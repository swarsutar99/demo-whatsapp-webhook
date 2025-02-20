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

const userSelections = {}; // To temporarily store user choices

const processedMessages = new Set(); // Store processed message IDs

app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));

  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
  const business_phone_number_id = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;

  if (message) {
    const messageId = message.id;
    if (processedMessages.has(messageId)) {
      console.log("⚠️ Duplicate message detected, ignoring...");
      return res.sendStatus(200);
    }
    processedMessages.add(messageId);

    let userMessage = message.text ? message.text.body.trim() : message.interactive?.button_reply?.id;
    console.log("User Message:", userMessage);
    const userPhone = message.from;

    try {
      // Step 1: User sends "hi"
      if (userMessage.toLowerCase() === "hi") {
        await sendTextMessage(business_phone_number_id, userPhone, "Welcome! Please select a game:");
        await sendInteractiveMessage(
          business_phone_number_id,
          userPhone,
          [
            { id: "game_1", title: "Kalyan" },
            { id: "game_2", title: "Rajdjani" },
            { id: "game_3", title: "Matka" }
          ],
          "Select a game:",
          "Please select a game to play."
        );
        return res.sendStatus(200);
      }

      // Step 2: User selects a game
      if (userMessage.startsWith("game_")) {
        await sendInteractiveMessage(
          business_phone_number_id,
          userPhone,
          [
            { id: "match_101", title: "Match - 20/02/2025 10:00 AM" },
            { id: "match_102", title: "Match - 19/02/2025 2:00 PM" },
            { id: "match_103", title: "Match - 18/02/2025 3:00 PM" }
          ],
          "Select a match:",
          "Please select a match to proceed."
        );
        return res.sendStatus(200);
      }

      // Step 3: User selects a match
      if (userMessage.startsWith("match_")) {
        const matches = {
          "match_101": "Kalyan",
          "match_102": "Rajdjani",
          "match_103": "Matka"
        };

        if (matches[userMessage]) {
          userSelections[userPhone] = { match: matches[userMessage] };
          await sendInteractiveMessage(
            business_phone_number_id,
            userPhone,
            [
              { id: "market_aakda", title: "Aakda" },
              { id: "market_panne", title: "Panne" }
            ],
            "Select a market to play:",
            "Choose between Aakda or Panne."
          );
        } else {
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Invalid match selection.");
        }
        return res.sendStatus(200);
      }

      // Step 4: User selects a market
      if (userMessage.startsWith("market_")) {
        const marketName = userMessage === "market_aakda" ? "Aakda" : "Panne";

        if (!userSelections[userPhone]) {
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Please select a match first.");
          return res.sendStatus(200);
        }

        userSelections[userPhone].market = marketName;
        await sendTextMessage(
          business_phone_number_id,
          userPhone,
          `✅ You selected: ${userSelections[userPhone].match} - ${marketName}\n\nPlease send your Runner number (e.g., 200).`
        );
        return res.sendStatus(200);
      }

      // Step 5: User sends Runner (just a number)
      if (/^\d+$/.test(userMessage)) {
        if (!userSelections[userPhone]?.market) {
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Please select a market first.");
          return res.sendStatus(200);
        }

        if (!userSelections[userPhone]?.runner) {
          userSelections[userPhone].runner = userMessage;
          await sendTextMessage(
            business_phone_number_id,
            userPhone,
            `✅ You selected Runner ${userMessage}\n\nNow send your Amount (e.g., 500).`
          );
          return res.sendStatus(200);
        }

        // Step 6: User sends Amount (just a number)
        if (!userSelections[userPhone]?.amount) {
          userSelections[userPhone].amount = userMessage;

          const finalBet = userSelections[userPhone];
          await insertBet(userPhone, finalBet.match, finalBet.market, finalBet.runner, finalBet.amount);
          await sendTextMessage(
            business_phone_number_id,
            userPhone,
            `🎯 Your selected bet:\n\n🏆 Match: ${finalBet.match}\n🎲 Market: ${finalBet.market}\n🏇 Runner: ${finalBet.runner}\n💰 Amount: ${finalBet.amount}`
          );

          // Clear user selection after bet confirmation
          delete userSelections[userPhone];
          return res.sendStatus(200);
        }
      }

      await sendTextMessage(business_phone_number_id, userPhone, "❌ Invalid input. Please follow the instructions.");
    } catch (error) {
      console.error("Error processing message:", error);
      await sendTextMessage(business_phone_number_id, userPhone, "❌ Something went wrong. Please try again later.");
    }
  }

  res.sendStatus(200);
});




// **Function to send interactive messages dynamically**
async function sendInteractiveMessage(phoneNumberId, userPhone, options, headerText, bodyText) {
  if (options.length === 0) {
    await sendTextMessage(phoneNumberId, userPhone, "❌ No available options.");
    return;
  }

  const buttons = options.slice(0, 3).map((option) => {
    let title = option.title.slice(0, 20);
    return {
      type: "reply",
      reply: {
        id: option.id,
        title: title || "Option",
      },
    };
  });

  const messageData = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: headerText },
      body: { text: bodyText },
      action: { buttons: buttons },
    },
  };

  await sendMessage(phoneNumberId, userPhone, messageData);
}



const insertBet = async (userPhone, match, market, runner, amount) => {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO bets (match, market, runner, amount) VALUES (?, ?, ?, ?)`;

        db.run(query, [match, market, runner, amount], function (err) {
            if (err) {
                console.error("❌ Error inserting bet:", err);
                reject(err);
            } else {
                console.log(`✅ Bet inserted successfully! ID: ${this.lastID}`);
                resolve(this.lastID);
            }
        });
    });
};



// **Function to send interactive game selection message**
// async function sendInteractiveMessage(phoneNumberId, userPhone, games) {
//   // Ensure there are valid games
//   if (games.length === 0) {
//     await sendTextMessage(phoneNumberId, userPhone, "❌ No available games at the moment.");
//     return;
//   }

//   const buttons = games.slice(0, 3).map((game) => {
//     let title = game.title.slice(0, 20); // Ensure title is max 20 characters
//     return {
//       type: "reply",
//       reply: {
//         id: `game_${game.id}`,
//         title: title || "Game", // Ensure title is not empty
//       },
//     };
//   });

//   const messageData = {
//     messaging_product: "whatsapp",
//     to: userPhone,
//     type: "interactive",
//     interactive: {
//       type: "button",
//       header: { type: "text", text: "Select a game:" },
//       body: { text: "Please select a game to play." },
//       action: { buttons: buttons },
//     },
//   };

//   await sendMessage(phoneNumberId, userPhone, messageData);
// }

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
