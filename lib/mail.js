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

    // Debug: Log available table IDs to understand email structure
    const tableIds = [];
    $("table[id]").each((i, el) => {
      tableIds.push($(el).attr("id"));
    });
    console.log(`🔍 Debug: Found table IDs: ${tableIds.join(", ")}`);

    // Try multiple selectors for amount parsing
    let amount = 0;
    let amountText = "";

    // Original selector
    amountText = $('table[id$="costBreakdownRight"] td').text().trim();
    if (amountText) {
      console.log(`🔍 Debug: costBreakdownRight text: "${amountText}"`);
      amount = parseFloat(amountText.slice(1));
    }

    // Alternative selectors for amount
    if (isNaN(amount) || amount === 0) {
      // Try looking for "Order Total" or similar patterns
      $("td, span, div").each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes("Order Total") || text.includes("Total:")) {
          const nextText = $(el).next().text().trim();
          console.log(
            `🔍 Debug: Found total label "${text}", next text: "${nextText}"`
          );
          if (nextText.match(/\$[\d,]+\.?\d*/)) {
            const match = nextText.match(/\$([\d,]+\.?\d*)/);
            if (match) {
              amount = parseFloat(match[1].replace(/,/g, ""));
              console.log(`🔍 Debug: Parsed amount from total: ${amount}`);
            }
          }
        }
        // Also check if this element itself contains a dollar amount
        if (text.match(/\$[\d,]+\.?\d*/)) {
          const match = text.match(/\$([\d,]+\.?\d*)/);
          if (match && !amountText) {
            console.log(`🔍 Debug: Found dollar amount in text: "${text}"`);
            amountText = text;
          }
        }
      });
    }

    if (isNaN(amount) || amount === 0) {
      console.warn("⚠️ Could not parse valid amount from email");
      console.log(`🔍 Debug: Email subject: ${subject}`);
      console.log(`🔍 Debug: Available table IDs: ${tableIds.join(", ")}`);
      return null;
    }

    const items = [];

    // Debug: Log available table IDs for item parsing
    console.log(`🔍 Debug: Looking for items in tables...`);

    // Original selector
    const itemRows = $('table[id$="itemDetails"] tr').toArray();
    console.log(`🔍 Debug: Found ${itemRows.length} rows in itemDetails table`);

    for (const itemRow of itemRows) {
      let title = $(itemRow).find("font").text().trim();
      if (title.endsWith("...")) {
        title = title.split(" ").slice(0, -1).join(" ");
        if (title.endsWith(",")) title = title.slice(0, -1);
        title += "..";
      }
      if (title.length > 0) {
        console.log(`🔍 Debug: Found item: "${title}"`);
        items.push(title);
      }
    }

    // Alternative item parsing if original method fails
    if (items.length === 0) {
      console.log(
        `🔍 Debug: No items found with original selector, trying alternatives...`
      );

      // Try finding items in any table with product-like content
      $("table tr").each((i, row) => {
        const rowText = $(row).text().trim();
        // Look for rows that might contain product names (avoid headers, totals, etc.)
        if (
          rowText.length > 10 &&
          !rowText.includes("$") &&
          !rowText.includes("Total") &&
          !rowText.includes("Shipping") &&
          !rowText.includes("Tax") &&
          !rowText.toLowerCase().includes("order") &&
          !rowText.toLowerCase().includes("date")
        ) {
          // Extract the longest text content from the row
          let longestText = "";
          $(row)
            .find("td, th")
            .each((j, cell) => {
              const cellText = $(cell).text().trim();
              if (
                cellText.length > longestText.length &&
                cellText.length > 10
              ) {
                longestText = cellText;
              }
            });

          if (longestText && items.length < 10) {
            // Limit to prevent spam
            console.log(`🔍 Debug: Alternative item found: "${longestText}"`);
            items.push(longestText);
          }
        }
      });
    }

    if (items.length === 0) {
      console.warn("⚠️ No items found in email");
      console.log(`🔍 Debug: Email body preview: ${body.substring(0, 500)}...`);
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
