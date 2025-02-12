import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PORT } = process.env;
const port = PORT || 3000;

//  GET Webhook Verification Route
app.get("/demowhatsappwebhook/demo-whatsapp-webhook/v1.0/webhook", (req, res) => {
  const VERIFY_TOKEN = WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log(`Webhook Verification Request - mode: ${mode}, token: ${token}`);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    res.status(200).send(challenge);
  } else {
    console.log(" Webhook verification failed.");
    res.sendStatus(403);
  }
});

//  POST Webhook (Handles Incoming WhatsApp Messages)
app.post("/demowhatsappwebhook/demo-whatsapp-webhook/v1.0/webhook", async (req, res) => {
  console.log(" Incoming webhook message:", JSON.stringify(req.body, null, 2));

  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

  if (message?.type === "text") {
    const business_phone_number_id = req.body.entry?.[0].changes?.[0].value?.metadata?.phone_number_id;
    
    try {
      //  Send reply message
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`,
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: message.from,
          text: { body: "Echo: " + message.text.body },
          context: { message_id: message.id },
        },
      });

      // Mark message as read
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`,
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: message.id,
        },
      });

      console.log(" Message processed successfully.");
    } catch (error) {
      console.error(" Error sending reply:", error.response?.data || error);
    }
  }

  res.sendStatus(200);
});

//  Start the server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
