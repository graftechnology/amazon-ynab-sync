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

(async () => {
  const ynab = new YNAB();
  await ynab.init();

  const imap = new IMAP({
    user: process.env.IMAP_USERNAME,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_INCOMING_HOST,
    port: parseInt(process.env.IMAP_INCOMING_PORT),
    tls: process.env.IMAP_TLS?.toLowerCase() === "true",
  });

  imap.once("ready", () => {
    console.log("✅ Connected to mail server. Opening mailbox...");

    imap.openBox(INBOX_NAME, true, async (err, box) => {
      if (err) throw err;

      await historicalSearch(imap, ynab, box);

      console.log("📬 Listening to mailbox for new emails...");
      watchInbox(imap, ynab, box);

      setInterval(async () => {
        try {
          await ynab.fetchTransactions();
        } catch (e) {
          console.error("🔁 Background sync failed:", e);
        }
      }, 60000);
    });
  });

  imap.once("error", (err) => {
    console.error("❌ IMAP error:", err);
    process.exit(1);
  });

  imap.once("end", () => {
    console.warn("📴 IMAP connection ended");
    process.exit(1);
  });

  console.log("🔌 Connecting to mail server...");
  imap.connect();
})();
