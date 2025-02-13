import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, HEROIC_API_URL, API_KEY, PORT } = process.env;
const port = PORT || 3002;

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
  console.log("GRAPH_API_TOKEN:", process.env.GRAPH_API_TOKEN);
  console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));

  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

  if (message) {
    const business_phone_number_id =
      req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    try {
      // **Store message in Rails API**
      const railsResponse = await axios.post(
        `${HEROIC_API_URL}/api/v1/whatsapp_messages`,
        req.body, // Send the entire payload to Rails
        {
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Api-Key": API_KEY, // Add API key if required
          },
        }
      );

      console.log("Rails API Response:", railsResponse.data);

      // **Send reply message via WhatsApp**
      await axios.post(
        `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          to: message.from,
          text: { body: "Echo: " + message.text.body },
          context: { message_id: message.id },
        },
        { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
      );

      //  **Mark message as read**
      await axios.post(
        `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: message.id,
        },
        { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
      );

      console.log("Message processed successfully.");
    } catch (error) {
      console.error(" Error processing message:", error.response?.data || error);
    }
  }

  res.sendStatus(200);
});

// Start the server
app.listen(port, () => {
  console.log(` Server is running on port ${port}`);
});
