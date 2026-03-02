import express from "express";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import cors from "cors";

const { Client, LocalAuth } = pkg;

const app = express();

app.use(cors({
  origin: "*",   // allow all origins (for now)
  methods: ["GET", "POST"],
}));

app.use(express.json());

const PORT = process.env.PORT || 10000;

let isReady = false;
let latestQR = null;
let progressData = null;

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
});

waClient.on("ready", () => {
  console.log("WhatsApp Ready");
  isReady = true;
});

waClient.initialize();

app.get("/", (req, res) => {
  res.send("WhatsApp Server Running ✅");
});

app.get("/qr", (req, res) => {
  if (!latestQR) return res.json({ status: "waiting" });
  res.json({ qr: latestQR });
});

app.get("/status", (req, res) => {
  res.json({
    ready: isReady,
    progress: progressData
  });
});

app.post("/send-bulk", async (req, res) => {
  const { numbers, message } = req.body;

  if (!isReady) {
    return res.status(400).json({ error: "WhatsApp not ready" });
  }

  let total = numbers.length;
  let sent = 0;
  let failed = 0;

  progressData = { total, sent, failed, percent: 0 };

  res.json({ started: true });

  for (let num of numbers) {
    try {
      await waClient.sendMessage(num + "@c.us", message);
      sent++;
    } catch {
      failed++;
    }

    progressData = {
      total,
      sent,
      failed,
      percent: Math.floor((sent / total) * 100)
    };

    await new Promise((r) => setTimeout(r, 3000));
  }

  progressData = { ...progressData, completed: true };
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
