import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";
import quotedPrintable from "quoted-printable";
import { dollarFormat, dateFormat } from "../index.js";

const HISTORICAL_SEARCH_NUM_EMAILS =
  parseInt(process.env.HISTORICAL_SEARCH_NUM_EMAILS) || 500;

export async function historicalSearch(imap, ynab, box) {
  console.log(
    `🔍 Searching for Amazon order confirmations in last ${HISTORICAL_SEARCH_NUM_EMAILS} emails...`
  );

  return new Promise((resolve, reject) => {
    imap.search(["FROM", "auto-confirm@amazon.com"], (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      if (!results || results.length === 0) {
        console.log("📭 No Amazon order confirmation emails found");
        resolve();
        return;
      }

      // Limit to recent emails
      const recentResults = results.slice(-HISTORICAL_SEARCH_NUM_EMAILS);
      console.log(
        `📧 Found ${recentResults.length} Amazon order confirmation emails`
      );

      processEmails(imap, ynab, recentResults, resolve, reject);
    });
  });
}

export function watchInbox(imap, ynab, box) {
  imap.on("mail", (numNewMsgs) => {
    console.log(`📬 ${numNewMsgs} new email(s) received`);

    // Search for new Amazon emails
    imap.search(
      ["FROM", "auto-confirm@amazon.com", "UNSEEN"],
      (err, results) => {
        if (err) {
          console.error("❌ Error searching for new emails:", err);
          return;
        }

        if (results && results.length > 0) {
          console.log(
            `🆕 Found ${results.length} new Amazon order confirmation(s)`
          );
          processEmails(imap, ynab, results);
        }
      }
    );
  });
}

function processEmails(imap, ynab, emailIds, resolve, reject) {
  if (!emailIds || emailIds.length === 0) {
    if (resolve) resolve();
    return;
  }

  const fetch = imap.fetch(emailIds, { bodies: "" });
  let processedCount = 0;

  fetch.on("message", (msg, seqno) => {
    msg.on("body", (stream, info) => {
      let buffer = "";

      stream.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
      });

      stream.once("end", async () => {
        try {
          const parsed = await simpleParser(buffer);
          await processAmazonEmail(ynab, parsed);
          processedCount++;

          if (processedCount === emailIds.length && resolve) {
            resolve();
          }
        } catch (error) {
          console.error("❌ Error processing email:", error);
          if (reject && processedCount === 0) {
            reject(error);
          }
        }
      });
    });
  });

  fetch.once("error", (err) => {
    console.error("❌ Fetch error:", err);
    if (reject) reject(err);
  });

  fetch.once("end", () => {
    console.log(`✅ Finished processing ${processedCount} emails`);
  });
}

async function processAmazonEmail(ynab, email) {
  try {
    const orderData = extractOrderData(email);
    if (!orderData) {
      console.log("⚠️ Could not extract order data from email");
      return;
    }

    console.log(`🛒 Processing Amazon order: ${orderData.orderNumber}`);
    console.log(`💰 Total: ${dollarFormat(orderData.total)}`);
    console.log(`📅 Date: ${dateFormat(orderData.date)}`);

    // Check if we already have a matching transaction
    const existingTransaction = ynab.findMatchingTransaction(
      "Amazon",
      orderData.total,
      orderData.date
    );

    if (existingTransaction) {
      console.log(
        `✅ Found matching YNAB transaction: ${existingTransaction.payee_name}`
      );
      return;
    }

    // Create new transaction
    await ynab.createTransaction(
      "Amazon",
      orderData.total,
      orderData.date,
      `Order #${orderData.orderNumber}`
    );
  } catch (error) {
    console.error("❌ Error processing Amazon email:", error);
  }
}

function extractOrderData(email) {
  try {
    const html = email.html || email.textAsHtml;
    if (!html) {
      console.log("⚠️ No HTML content found in email");
      return null;
    }

    const $ = cheerio.load(html);

    // Extract order number
    let orderNumber = null;
    const orderNumberRegex = /Order #?(\d{3}-\d{7}-\d{7})/i;
    const orderMatch =
      email.subject?.match(orderNumberRegex) ||
      email.text?.match(orderNumberRegex) ||
      html.match(orderNumberRegex);

    if (orderMatch) {
      orderNumber = orderMatch[1];
    }

    // Extract total amount
    let total = null;
    const totalRegex =
      /(?:Total|Order total|Grand total)[\s\S]*?\$(\d+\.?\d*)/i;
    const totalMatch = email.text?.match(totalRegex) || html.match(totalRegex);

    if (totalMatch) {
      total = parseFloat(totalMatch[1]);
    }

    // Extract date (use email date as fallback)
    const orderDate = email.date || new Date();

    if (!orderNumber || !total) {
      console.log("⚠️ Missing required order data (number or total)");
      return null;
    }

    return {
      orderNumber,
      total,
      date: orderDate,
    };
  } catch (error) {
    console.error("❌ Error extracting order data:", error);
    return null;
  }
}
