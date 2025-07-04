import IMAP from "node-imap";
import * as cheerio from "cheerio";
import quotedPrintable from "quoted-printable";
import { dateFormat, dollarFormat } from "../index.js";

// Validate required environment variables
const requiredEnvVars = [
  "IMAP_USERNAME",
  "IMAP_PASSWORD",
  "IMAP_INCOMING_HOST",
  "IMAP_INCOMING_PORT",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is required`);
  }
}

// In-memory orders storage with size limit
const MAX_ORDERS = 1000;
let orders = [];

/**
 * Add a new order to in-memory storage with size management
 */
const addOrder = (order) => {
  orders.push(order);

  // Keep only the most recent orders to prevent memory issues
  if (orders.length > MAX_ORDERS) {
    orders = orders.slice(-MAX_ORDERS);
    console.log(`📦 Trimmed orders cache to ${MAX_ORDERS} most recent orders`);
  }
};

/**
 * Return all in-memory orders
 */
const getOrders = () => orders;

const HISTORICAL_SEARCH_NUM_EMAILS = parseInt(
  process.env.HISTORICAL_SEARCH_NUM_EMAILS || "100"
);

const isAmazonEmail = ({ subject }) =>
  subject.includes("Your Amazon.com order") &&
  !subject.includes("has shipped") &&
  !subject.includes("has been canceled");

const scanEmail = (email) => {
  const { subject, body, attributes } = email;

  if (!isAmazonEmail(email)) {
    console.log("Ignoring non-order Amazon email.");
    return null;
  }

  if (!body) {
    console.warn("⚠️ Email body is empty, skipping");
    return null;
  }

  try {
    const $ = cheerio.load(body.replace(/"x_/g, '"'));

    const amount = parseFloat(
      $('table[id$="costBreakdownRight"] td').text().trim().slice(1)
    );

    if (isNaN(amount) || amount === 0) {
      console.warn("⚠️ Could not parse valid amount from email");
      return null;
    }

    const items = [];
    const itemRows = $('table[id$="itemDetails"] tr').toArray();

    for (const itemRow of itemRows) {
      let title = $(itemRow).find("font").text().trim();
      if (title.endsWith("...")) {
        title = title.split(" ").slice(0, -1).join(" ");
        if (title.endsWith(",")) title = title.slice(0, -1);
        title += "..";
      }
      if (title.length > 0) items.push(title);
    }

    if (items.length === 0) {
      console.warn("⚠️ No items found in email");
      return null;
    }

    const date = new Date(attributes.date.setHours(0, 0, 0, 0));
    console.info(
      `📦 ${items.length} item(s) for ${dollarFormat(amount)} on ${dateFormat(
        date
      )}`
    );

    return {
      date,
      amount: -(amount * 1000),
      items,
    };
  } catch (e) {
    console.error(`❌ Failed to parse email: ${subject}`);
    console.error("Error details:", e.message);
    return null;
  }
};

const readEmail = (imapMsg, readBody = true) =>
  new Promise((resolve, reject) => {
    let headers = null;
    let body = null;
    let attributes = null;

    imapMsg.once("attributes", (attrs) => {
      attributes = attrs;
    });

    imapMsg.on("body", (stream, info) => {
      let buffer = "";
      stream.on("data", (chunk) => (buffer += chunk.toString("utf8")));
      stream.once("end", () => {
        if (info.which === "HEADER.FIELDS (FROM SUBJECT)") {
          headers = IMAP.parseHeader(buffer);
        } else if (info.which === "TEXT") {
          body = quotedPrintable.decode(buffer);
        }
      });
    });

    imapMsg.once("end", () => {
      if (attributes && headers?.subject?.[0] && (!readBody || body)) {
        resolve({
          from: headers.from?.[0] ?? "Unknown",
          subject: headers.subject[0],
          attributes,
          body,
        });
      } else {
        reject(new Error("Email parsing failed"));
      }
    });
  });

const fetchOrderEmails = async (seq, startIndex, endIndex) =>
  new Promise((resolve, reject) => {
    const fetch = seq.fetch(`${startIndex}:${endIndex}`, {
      bodies: ["HEADER.FIELDS (FROM SUBJECT)", "TEXT"],
      struct: true,
    });
    const emails = [];
    fetch.on("message", async (imapMsg) => {
      try {
        const email = await readEmail(imapMsg, true);
        emails.push(email);
      } catch (e) {
        console.error(e);
      }
    });
    fetch.once("end", () => resolve(emails));
    fetch.once("error", (err) => reject(err));
  });

export const historicalSearch = async (imap, ynab, box) =>
  new Promise((resolve, reject) => {
    console.log(`🔍 Scanning last ${HISTORICAL_SEARCH_NUM_EMAILS} emails...`);

    if (!box || !box.messages || box.messages.total === 0) {
      console.log("📭 No emails found in mailbox");
      resolve();
      return;
    }

    const endIndex = box.messages.total;
    const startIndex = Math.max(
      1,
      endIndex - (HISTORICAL_SEARCH_NUM_EMAILS - 1)
    );

    console.log(`📧 Scanning emails ${startIndex} to ${endIndex}`);

    const fetch = imap.seq.fetch(`${startIndex}:${endIndex}`, {
      bodies: ["HEADER.FIELDS (FROM SUBJECT)"],
      struct: true,
    });

    const potentialEmails = [];
    const amazonMsgSeqNums = [];

    fetch.on("message", (imapMsg, seqno) => {
      potentialEmails.push(
        readEmail(imapMsg, false)
          .then((email) => {
            if (isAmazonEmail(email)) amazonMsgSeqNums.push(seqno);
          })
          .catch((error) => {
            console.warn(`⚠️ Failed to read email ${seqno}:`, error.message);
          })
      );
    });

    fetch.once("end", async () => {
      try {
        await Promise.allSettled(potentialEmails);

        console.log(`📬 Found ${amazonMsgSeqNums.length} Amazon order emails`);

        for (const seqno of amazonMsgSeqNums) {
          try {
            const [email] = await fetchOrderEmails(imap.seq, seqno, seqno);
            const order = scanEmail(email);
            if (order) addOrder(order);
          } catch (e) {
            console.error(`❌ Error processing email ${seqno}:`, e.message);
          }
        }

        console.log("✅ Historical email scan complete");

        const currentOrders = getOrders();
        if (currentOrders.length > 0) {
          try {
            const sinceDate = currentOrders[0].date;
            await ynab.fetchTransactions(sinceDate);
            const matches = ynab.matchTransactions(currentOrders);
            await ynab.updateTransactions(matches);
          } catch (error) {
            console.error("❌ Error during YNAB sync:", error.message);
          }
        }

        resolve();
      } catch (error) {
        console.error("❌ Error in historical search:", error.message);
        reject(error);
      }
    });

    fetch.on("error", (err) => {
      console.error("❌ IMAP fetch error:", err.message);
      reject(err);
    });
  });

export const watchInbox = (imap, ynab, box) => {
  imap.on("mail", async (newEmailCount) => {
    console.log(`📨 ${newEmailCount} new email(s), scanning...`);

    try {
      // Update box message count
      box.messages.total += newEmailCount;

      const endIndex = box.messages.total;
      const startIndex = Math.max(1, endIndex - (newEmailCount - 1));

      console.log(`📧 Processing emails ${startIndex} to ${endIndex}`);

      const emails = await fetchOrderEmails(imap.seq, startIndex, endIndex);
      let processedOrders = 0;

      for (const email of emails) {
        const order = scanEmail(email);
        if (order) {
          addOrder(order);
          processedOrders++;
        }
      }

      if (processedOrders > 0) {
        console.log(`📦 Found ${processedOrders} new Amazon order(s)`);
        await ynab.matchAndUpdate(getOrders());
      } else {
        console.log("📭 No new Amazon orders found");
      }
    } catch (e) {
      console.error("❌ Failed processing new email(s):", e.message);
    }
  });
};

/**
 * Export getOrders function for use by other modules
 */
export { getOrders };
