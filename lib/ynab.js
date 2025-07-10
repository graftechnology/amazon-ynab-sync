import "dotenv/config";
import ynab from "ynab";
import { dollarFormat } from "../index.js";

// Environment variables are validated in index.js

const ynabAPI = new ynab.API(process.env.YNAB_TOKEN);

const YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE = parseFloat(
  process.env.YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE || "0.5"
);

const YNAB_ACCEPTABLE_DATE_DIFFERENCE = parseFloat(
  process.env.YNAB_ACCEPTABLE_DATE_DIFFERENCE || "4"
);

export default class YNAB {
  budget = null;
  transactionsServerKnowledge = undefined;
  transactions = {};

  static prettyTransaction = (t) => {
    const amount = dollarFormat(t.amount / 1000);
    return `${t.payee_name ?? "(No Payee)"} transaction on ${
      t.date
    } of ${amount}`;
  };

  init = async () => {
    console.log("🔌 Connecting to YNAB...");
    try {
      const budgetsResponse = await ynabAPI.budgets.getBudgets();
      const budget = budgetsResponse.data.budgets.find(
        (b) => b.id === process.env.YNAB_BUDGET_ID
      );

      if (!budget) {
        throw new Error(
          `Invalid YNAB_BUDGET_ID: ${process.env.YNAB_BUDGET_ID}. You can find it in the URL of your YNAB budget.`
        );
      }

      this.budget = budget;
      console.log(`✅ Connected to YNAB budget: ${budget.name}`);
    } catch (error) {
      console.error("❌ Failed to connect to YNAB:", error.message);
      throw error;
    }
  };

  getCachedTransactionCount = () => Object.keys(this.transactions).length;

  fetchTransactions = async (sinceDate = undefined) => {
    try {
      const { transactions, server_knowledge } = (
        await ynabAPI.transactions.getTransactions(
          this.budget.id,
          sinceDate ? sinceDate.toISOString().split("T")[0] : undefined,
          undefined,
          this.transactionsServerKnowledge
        )
      ).data;

      this.transactionsServerKnowledge = server_knowledge;

      let newTransactionsCount = 0;

      transactions
        .filter((t) => {
          const isAmazon =
            t?.payee_name?.toLowerCase?.().includes("amazon") ?? false;
          if (!isAmazon) return false;

          // Allow transactions with no memo
          if (!t.memo || t.memo.length === 0) return true;

          // Allow overwriting of bad memos (navigation text from previous bug)
          const badMemoPatterns = [
            "Your Orders",
            "Your Account",
            "Buy Again",
            "Thanks for your order",
            "Ordered",
            "Shipped",
            "Out for delivery",
            "Delivered",
          ];

          const hasBadMemo = badMemoPatterns.some((pattern) =>
            t.memo.includes(pattern)
          );

          return hasBadMemo;
        })
        .forEach((t) => {
          if (t.deleted && this.transactions[t.id]) {
            delete this.transactions[t.id];
            console.log(`🗑️ Deleted transaction: ${YNAB.prettyTransaction(t)}`);
          } else if (!t.deleted) {
            this.transactions[t.id] = t;
            newTransactionsCount++;
            console.log(`📥 Cached transaction: ${YNAB.prettyTransaction(t)}`);
          }
        });

      console.log(
        `🔄 Fetched ${transactions.length} transactions, ${newTransactionsCount} new Amazon transactions cached`
      );
    } catch (error) {
      console.error("❌ Error fetching YNAB transactions:", error.message);
      throw error;
    }
  };

  matchTransactions = (orders) => {
    if (!Array.isArray(orders) || orders.length === 0) {
      console.warn("⚠️ No orders to match against.");
      return [];
    }

    let nearOrPerfectMatches = [];

    orderLoop: for (const [orderIndex, order] of orders.entries()) {
      for (const [transactionId, transaction] of Object.entries(
        this.transactions
      )) {
        // Skip transactions that have good memos (but allow bad memos to be overwritten)
        if (transaction.memo && transaction.memo.length > 0) {
          const badMemoPatterns = [
            "Your Orders",
            "Your Account",
            "Buy Again",
            "Thanks for your order",
            "Ordered",
            "Shipped",
            "Out for delivery",
            "Delivered",
          ];

          const hasBadMemo = badMemoPatterns.some((pattern) =>
            transaction.memo.includes(pattern)
          );

          if (!hasBadMemo) continue; // Skip if it has a good memo
        }

        const dateDifference = Math.abs(
          order.date - new Date(transaction.date)
        );
        const priceDifference = Math.abs(
          Math.abs(order.amount) - Math.abs(transaction.amount)
        );

        if (
          dateDifference <= YNAB_ACCEPTABLE_DATE_DIFFERENCE * 86400 * 1000 &&
          priceDifference <= YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE * 1000
        ) {
          nearOrPerfectMatches.push({
            dateDifference,
            priceDifference,
            orderIndex,
            transactionId,
          });
        }

        if (dateDifference === 0 && priceDifference === 0) {
          continue orderLoop;
        }
      }
    }

    nearOrPerfectMatches.sort((a, b) =>
      a.dateDifference !== b.dateDifference
        ? a.dateDifference - b.dateDifference
        : a.priceDifference - b.priceDifference
    );

    const finalMatches = [];

    while (nearOrPerfectMatches.length > 0) {
      const match = nearOrPerfectMatches.shift();
      nearOrPerfectMatches = nearOrPerfectMatches.filter(
        (m) =>
          m.transactionId !== match.transactionId &&
          m.orderIndex !== match.orderIndex
      );
      finalMatches.push({
        transactionId: match.transactionId,
        order: orders[match.orderIndex],
      });
    }

    return finalMatches;
  };

  updateTransactions = async (matches) => {
    if (!Array.isArray(matches) || matches.length === 0) {
      console.log("ℹ️ No transactions to update.");
      return;
    }

    try {
      await ynabAPI.transactions.updateTransactions(this.budget.id, {
        transactions: matches.map((m) => {
          const id = m.transactionId;
          const memo = m.order.items.join(", ");
          const transaction = this.transactions[id];
          transaction.memo = memo;
          console.log(
            `📝 Adding memo "${memo}" to ${YNAB.prettyTransaction(transaction)}`
          );
          return {
            id,
            memo,
            approved: false,
          };
        }),
      });
      console.log(`✅ Successfully updated ${matches.length} transaction(s)`);
    } catch (error) {
      console.error("❌ Error updating YNAB transactions:", error.message);
      throw error;
    }
  };

  matchAndUpdate = async (orders) => {
    const matches = this.matchTransactions(orders);
    if (matches.length > 0) {
      await this.updateTransactions(matches);
      console.log(
        `✅ Status: ${this.getCachedTransactionCount()} transactions cached, ${
          orders.length
        } order(s) cached`
      );
    } else {
      console.log("❌ No matches found.");
    }
  };
}
