import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";

const { Client, LocalAuth } = pkg;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;

let clients = new Set();
let isReady = false;
let latestQR = null;

const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
});

waClient.on("qr", async (qr) => {
  console.log("QR Generated");
  latestQR = await qrcode.toDataURL(qr);
  broadcast({ type: "QR", qr: latestQR });
});

waClient.on("ready", () => {
  console.log("WhatsApp Ready");
  isReady = true;
  broadcast({ type: "READY" });
});

waClient.on("authenticated", () => {
  console.log("Authenticated");
});

waClient.on("auth_failure", (msg) => {
  console.error("Auth failure:", msg);
});

waClient.initialize();

wss.on("connection", (ws) => {
  console.log("New WebSocket connected");
  clients.add(ws);

  if (latestQR && !isReady) {
    ws.send(JSON.stringify({ type: "QR", qr: latestQR }));
  }

  if (isReady) {
    ws.send(JSON.stringify({ type: "READY" }));
  }

  ws.on("message", async (message) => {
    const data = JSON.parse(message);

    if (data.type === "SEND_BULK") {
      const numbers = data.numbers;
      const msg = data.message;

      let total = numbers.length;
      let sent = 0;
      let failed = 0;

      for (let num of numbers) {
        try {
          await waClient.sendMessage(num + "@c.us", msg);
          sent++;
        } catch (err) {
          failed++;
        }

        broadcast({
          type: "PROGRESS",
          total,
          sent,
          failed,
          percent: Math.floor((sent / total) * 100)
        });

        await new Promise((res) => setTimeout(res, 3000));
      }

      broadcast({ type: "COMPLETED" });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

function broadcast(data) {
  for (let client of clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }
}

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
