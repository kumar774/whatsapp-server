import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("WhatsApp Server Running ✅");
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  console.log("Upgrade request received");

  wss.handleUpgrade(request, socket, head, (ws) => {
    console.log("WebSocket upgraded");
    wss.emit("connection", ws, request);
  });
});

const PORT = process.env.PORT || 10000;

let clients = new Set();
let isReady = false;
let latestQR = null;

console.log("Initializing WhatsApp client...");

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

waClient.on("disconnected", (reason) => {
  console.log("WhatsApp Disconnected:", reason);
  isReady = false;
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
    console.log("Received:", message.toString());

    try {
      const data = JSON.parse(message);

      if (data.type === "SEND_BULK") {
        const numbers = data.numbers || [];
        const msg = data.message || "";

        let total = numbers.length;
        let sent = 0;
        let failed = 0;

        for (let num of numbers) {
          try {
            await waClient.sendMessage(num + "@c.us", msg);
            sent++;
          } catch (err) {
            console.error("Send error:", err);
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
    } catch (err) {
      console.error("Message parse error:", err);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket closed");
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
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
