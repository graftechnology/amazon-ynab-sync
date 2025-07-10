import IMAP from "node-imap";
import * as cheerio from "cheerio";
import quotedPrintable from "quoted-printable";
import { dateFormat, dollarFormat } from "../index.js";

// Environment variables are validated in index.js

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

const isAmazonEmail = ({ subject, from }) =>
  from.includes("auto-confirm@amazon.com") && subject.includes("Ordered:");

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

    // Try multiple selectors for amount parsing
    let amount = 0;
    let amountText = "";

    // Original selector
    amountText = $('table[id$="costBreakdownRight"] td').text().trim();
    if (amountText) {
      amount = parseFloat(amountText.slice(1));
    }

    // Alternative selectors for amount
    if (isNaN(amount) || amount === 0) {
      // Try looking for "Order Total" or similar patterns
      $("td, span, div").each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes("Order Total") || text.includes("Total:")) {
          const nextText = $(el).next().text().trim();
          if (nextText.match(/\$[\d,]+\.?\d*/)) {
            const match = nextText.match(/\$([\d,]+\.?\d*)/);
            if (match) {
              amount = parseFloat(match[1].replace(/,/g, ""));
            }
          }
        }
      });
    }

    // New selector for the updated Amazon email format
    if (isNaN(amount) || amount === 0) {
      // Look for "Total" followed by amount in table cells
      $("td").each((i, el) => {
        const text = $(el).text().trim();
        if (text === "Total") {
          const nextCell = $(el).next();
          if (nextCell.length > 0) {
            const nextText = nextCell.text().trim();
            const match = nextText.match(/\$?([\d,]+\.?\d*)/);
            if (match) {
              amount = parseFloat(match[1].replace(/,/g, ""));
              return false; // Break out of each loop
            }
          }
        }
      });
    }

    // Fallback: search for any dollar amount in the email
    if (isNaN(amount) || amount === 0) {
      const bodyText = $.text();
      const matches = bodyText.match(/\$(\d+\.\d{2})/g);
      if (matches && matches.length > 0) {
        // Take the last dollar amount found (usually the total)
        const lastMatch = matches[matches.length - 1];
        const match = lastMatch.match(/\$(\d+\.\d{2})/);
        if (match) {
          amount = parseFloat(match[1]);
        }
      }
    }

    if (isNaN(amount) || amount === 0) {
      console.warn("⚠️ Could not parse valid amount from email");
      return null;
    }

    const items = [];
    const seenItems = new Set(); // Track similar items to avoid duplicates

    // Helper function to check if an item is similar to existing ones
    const isSimilarItem = (newItem) => {
      const newWords = newItem.toLowerCase().split(/\s+/).slice(0, 5); // First 5 words
      for (const existingItem of seenItems) {
        const existingWords = existingItem
          .toLowerCase()
          .split(/\s+/)
          .slice(0, 5);
        const commonWords = newWords.filter((word) =>
          existingWords.includes(word)
        );
        if (commonWords.length >= 3) {
          // If 3+ words match, consider it similar
          return true;
        }
      }
      return false;
    };

    // Strategy 1: Look for product images with alt text (most reliable)
    $("img").each((i, element) => {
      const alt = $(element).attr("alt");
      const src = $(element).attr("src");

      // Check if this is a product image
      if (
        alt &&
        src &&
        src.includes("amazon.com") &&
        alt.length > 20 &&
        alt.length < 300 &&
        !alt.toLowerCase().includes("amazon") &&
        !alt.toLowerCase().includes("logo")
      ) {
        // Clean up the alt text
        let cleanItem = alt.trim();
        if (
          cleanItem &&
          !items.includes(cleanItem) &&
          !isSimilarItem(cleanItem)
        ) {
          items.push(cleanItem);
          seenItems.add(cleanItem);
        }
      }
    });

    // Strategy 2: Look for product links with meaningful text (if alt text fails)
    if (items.length === 0) {
      $("a").each((i, element) => {
        const href = $(element).attr("href");
        const text = $(element).text().trim();

        // Check if this is a product link
        if (
          href &&
          href.includes("amazon.com") &&
          href.includes("/dp/") &&
          text.length > 15 &&
          text.length < 200
        ) {
          // Skip navigation and generic links
          const skipPatterns = [
            "view",
            "edit",
            "order",
            "account",
            "buy again",
            "your orders",
            "track",
            "return",
            "exchange",
            "help",
            "customer service",
            "thanks for your order",
            "ordered",
            "shipped",
            "delivered",
          ];

          const isGeneric = skipPatterns.some((pattern) =>
            text.toLowerCase().includes(pattern)
          );

          if (!isGeneric && !items.includes(text) && !isSimilarItem(text)) {
            items.push(text);
            seenItems.add(text);
          }
        }
      });
    }

    // Strategy 3: Look for elements near "Quantity:" text (fallback)
    if (items.length === 0) {
      $("*").each((i, element) => {
        const text = $(element).text().trim();

        // Find elements that contain "Quantity:"
        if (text.includes("Quantity:") && text.length < 50) {
          // Look for product name in nearby elements
          const $parent = $(element).closest("tr, div, td");

          $parent.find("a, span, div").each((j, nearby) => {
            const nearbyText = $(nearby).text().trim();
            const nearbyHref = $(nearby).attr("href");

            // Check if this looks like a product name
            if (
              nearbyText.length > 15 &&
              nearbyText.length < 200 &&
              !nearbyText.includes("Quantity:") &&
              !nearbyText.includes("$") &&
              !nearbyText.toLowerCase().includes("total") &&
              !nearbyText.toLowerCase().includes("shipping") &&
              nearbyHref &&
              nearbyHref.includes("/dp/")
            ) {
              if (!items.includes(nearbyText) && !isSimilarItem(nearbyText)) {
                items.push(nearbyText);
                seenItems.add(nearbyText);
              }
            }
          });
        }
      });
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
