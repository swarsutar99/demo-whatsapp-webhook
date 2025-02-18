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


// const options = {
//   key: fs.readFileSync("/etc/ssl/private/private.key"), 
//   cert: fs.readFileSync("/etc/ssl/certificate_plus_ca_bundle.crt")
// };

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, HEROIC_API_URL, API_KEY, PORT, RAILS_API_URL } = process.env;
const port = 3002;

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


app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));

  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
  const business_phone_number_id = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;

  if (message) {
    let userMessage = "";
    if (message.text) {
      userMessage = message.text.body;
    } else if (message.interactive?.button_reply) {
      userMessage = message.interactive.button_reply.id; // Game ID or Match ID
    }

    const userPhone = message.from;

    try {
      // Step 1: User sends "hi"
      if (userMessage === "hi") {
        await sendTextMessage(business_phone_number_id, userPhone, "Please send your username and password in this format: \n\n*username|password*");
        return;
      

      }

      // Step 2: User sends credentials
      if (userMessage.includes("|")) {
        const credentials = userMessage.split("|");
        if (credentials.length !== 2) {
          await sendTextMessage(business_phone_number_id, userPhone, "Invalid format. Please send your credentials as: \n\n*username|password*");
          return;
        }


        let csrfResponse = await axios.get(`${HEROIC_API_URL}/users/sign_in`, {
          headers: {
            "Api-Key": "2tnFcmn5Lk-a7xwmazAF",
            "Accept": "application/xhtml+xml"
          },
          withCredentials: true  // Enable cookies
        });
 
        // Extract CSRF token from response headers
        
        const csrfTokenMatch = csrfResponse.data.match(/<meta content="(.*?)" name="csrf-token" \/>/);
  

        const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;
        console.log("CSRF Token:", csrfToken);

        if (!csrfToken) {
          throw new Error("CSRF Token not found!");
        }

       

        const userName = credentials[0].trim();
        const password = credentials[1].trim();
        console.log("userName",userName);
        console.log("password",password);




        const authData = new URLSearchParams();
        authData.append("utf8","✓");
        authData.append("user[user_name]", "SP5");
        authData.append("user[password]", "Swar1234");
        authData.append("captcha", "1");
        authData.append("captcha_key", "123");

        console.log("authData",authData);


        let authResponse = await axios.post(`${HEROIC_API_URL}/users/sign_in`, authData.toString(), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Api-Key": "2tnFcmn5Lk-a7xwmazAF",
            "Accept": "application/json",
            "X-CSRF-Token": csrfToken
          },
           withCredentials: true,
           maxRedirects: 0

        });
      console.log("authResponse.headers",authResponse.headers["set-cookie"])


        global.cookies = authResponse.headers["set-cookie"];
        console.log("data",authResponse.data);

        // global.sessionCookie = "_heroic_session1=ZklvWmY4MTJEUStCMWs3WjFTQ2SllBU3RTTjZoUG1PVTJCbHdyWVBNQlgvQzhwNFpScnNJYmJLcHhWVzFFaTVUQ3ZIc0lXbFZuZXVyQkVKRldGNVc1VlpUM0gwNTl0amFCNk56RkM1dzQ3OGN5S0gxRFhQcVRkL2pxNkhjcHV4K0YrazFYZG1XbWhlemtNUEJYSEdCTnNjVzhrbWJPQ2ZWeWJwcWdjK2VOL3hnSUxBUVFGSDdjVlNxOXFaeGRaeVZReUhEaExuM1pic1crV1RqVHpPQWpwbnJOcXdUVUlDZmpzeWsydjNMU3Mwa2VWclA4R05wdmVMMUF4dUowTHVuWGh3bmNDZEFBUk90N2hsZG9oWEFLd3VXOHZDeGxBQ3IvNVdBaUJvV1FDbk1TNldGOEgrZUJnbk1IRERQNjdzaVJ0ak1waW9KQnFXTzJsOTdlblYvVmtyMm5oYUh3NHJEc1dhU0FyNTBuUU9Fc1FseWNxMGZKOFFjeWo4TFRFNWJxUUVPbm15ekNDUkFtREFXa1E0dm12dForTis3M2pRPT0tLUp3eXZGUHhUSTYwb0dFaWZ1bnJ3Z2c9PQ%3D%3D--afe43f60622cca0e252f8632308334620e21d655; Path=/; HttpOnly;";
           global.sessionCookie = global.cookies[0]
        if (authResponse.status === 200) {
          
          await sendTextMessage(business_phone_number_id, userPhone, "✅ Login successful! Fetching available games...");
          const gamesResponse = await axios.get(`${HEROIC_API_URL}/user/games`, {
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "API_KEY": API_KEY
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
       
      // Step 3: User selects a game
      if (userMessage.startsWith("game_")) {
        console.log("global.sessionCookie",global.sessionCookie);
        const gameId = userMessage.replace("game_", "");
        const headers = {
          "Api-Key": "2tnFcmn5Lk-a7xwmazAF",
          "Accept": "application/json",
          "Cookie": global.sessionCookie                        
            };

        console.log("Headers before API call:", headers); 
     
        // Fetch matches for selected game
        const matchesResponse = await axios.get(`${HEROIC_API_URL}/lottery/casino_tables/${gameId}/matka_games`, { headers });

        const matches = matchesResponse.data.in_play_matches || [];

        if (matches.length === 0) {
          await sendTextMessage(business_phone_number_id, userPhone, "No matches available for this game.");
        } else {
          let matchOptions = matches.map(match => ({
            id: `match_${match.provider_id}`,
            title: `${match.title} - ${new Date(match.start_time).toLocaleString()}`
          }));

          await sendInteractiveMessage(business_phone_number_id, userPhone, matchOptions, "Select a match:");
        }
        return;
      }

      // Step 4: User selects a match
      let matchId="";
      if (userMessage.startsWith("match_")) {
        matchId = userMessage.replace("match_", "");
        await sendTextMessage(business_phone_number_id, userPhone, `✅ You have selected this match. Match ID: ${matchId}\n\n to place bet send message in this fromat\n aakdaOpen/1/500`);
        return;
      }


      // Step 5: User places a bet
      if (userMessage.includes("/")) {
        const betParts = userMessage.split("/");
        
        console.log("betParts",betParts)
        if (betParts.length === 3) {
          const marketId = betParts[1].trim(); 
          const stake = betParts[2].trim(); 
          const matchId = matchId; 
          const runnerId = "751";
          const oddsVal = "10.5";
          const oddsType = "LAGAI";

          try {
            // Step 6: Make the API call to create the bet
            const betResponse = await axios.post(`${HEROIC_API_URL}/api/v1/casino_tables/card_game/new_matka/matches/create_bet`, {
              match_id: matchId,
              market_id: marketId,
              stake: stake,
              runner_id: runnerId,
              odds_val: oddsVal,
              odds_type: oddsType
            }, {
              headers: {
                "Content-Type": "application/json",
                "API_KEY": API_KEY,
                "Cookie": global.sessionCookie

              }
            });
            console.log("betResponse",betResponse)
            if (betResponse.status === 200) {
              await sendTextMessage(business_phone_number_id, userPhone, "✅ Bet placed successfully!");
            } else {
              await sendTextMessage(business_phone_number_id, userPhone, "❌ Failed to place the bet. Please try again.");
            }
          } catch (error) {
            console.error("Error placing the bet:", error.response?.data || error);
            await sendTextMessage(business_phone_number_id, userPhone, "❌ Something went wrong. Please try again later.");
          }
        } else {
          await sendTextMessage(business_phone_number_id, userPhone, "❌ Invalid format. Please use the correct format: \naakdaOpen/{marketId}/{stake}");
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

  try {
    await axios.post(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` },
    });
    console.log("Interactive message sent.");
  } catch (error) {
    console.error("Error sending interactive message:", error.response?.data || error);
  }
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
http.createServer( app).listen(port, () => {
  console.log(` Server is running securely on HTTPS port ${port}`);
});