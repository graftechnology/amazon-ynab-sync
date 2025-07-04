import "dotenv/config";
import IMAP from "node-imap";
import YNAB from "./lib/ynab.js";
import { historicalSearch, watchInbox } from "./lib/mail.js";

const INBOX_NAME = process.env.IMAP_INBOX_NAME || "INBOX";

export const dollarFormat = (amt) =>
  amt.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

export const dateFormat = (date) =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

// Validate required environment variables
const requiredEnvVars = [
  "IMAP_USERNAME",
  "IMAP_PASSWORD",
  "IMAP_INCOMING_HOST",
  "IMAP_INCOMING_PORT",
  "YNAB_TOKEN",
  "YNAB_BUDGET_ID",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Graceful shutdown handling
let isShuttingDown = false;
let backgroundInterval = null;

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  if (backgroundInterval) {
    clearInterval(backgroundInterval);
  }

  setTimeout(() => {
    console.log("✅ Shutdown complete");
    process.exit(0);
  }, 1000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

(async () => {
  try {
    console.log("🚀 Starting Amazon YNAB Sync...");

    const ynab = new YNAB();
    await ynab.init();

    const imap = new IMAP({
      user: process.env.IMAP_USERNAME,
      password: process.env.IMAP_PASSWORD,
      host: process.env.IMAP_INCOMING_HOST,
      port: parseInt(process.env.IMAP_INCOMING_PORT),
      tls: process.env.IMAP_TLS?.toLowerCase() === "true",
      connTimeout: 60000, // 60 seconds
      authTimeout: 30000, // 30 seconds
      keepalive: true,
    });

    imap.once("ready", () => {
      console.log("✅ Connected to mail server. Opening mailbox...");

      imap.openBox(INBOX_NAME, true, async (err, box) => {
        if (err) {
          console.error("❌ Failed to open mailbox:", err.message);
          process.exit(1);
        }

        try {
          await historicalSearch(imap, ynab, box);

          console.log("📬 Listening to mailbox for new emails...");
          watchInbox(imap, ynab, box);

          // Background sync every minute
          backgroundInterval = setInterval(async () => {
            if (isShuttingDown) return;

            try {
              await ynab.fetchTransactions();
            } catch (e) {
              console.error("🔁 Background sync failed:", e.message);
            }
          }, 60000);

          console.log("✅ Amazon YNAB Sync is running. Press Ctrl+C to stop.");
        } catch (error) {
          console.error("❌ Error during initialization:", error.message);
          process.exit(1);
        }
      });
    });

    imap.once("error", (err) => {
      console.error("❌ IMAP error:", err.message);
      if (!isShuttingDown) {
        process.exit(1);
      }
    });

    imap.once("end", () => {
      console.warn("📴 IMAP connection ended");
      if (!isShuttingDown) {
        process.exit(1);
      }
    });

    console.log("🔌 Connecting to mail server...");
    imap.connect();
  } catch (error) {
    console.error("❌ Fatal error during startup:", error.message);
    process.exit(1);
  }
})();
