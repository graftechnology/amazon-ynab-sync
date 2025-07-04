import * as ynab from "ynab";

export default class YNAB {
  constructor() {
    this.api = new ynab.API(process.env.YNAB_TOKEN);
    this.budgetId = process.env.YNAB_BUDGET_ID;
    this.transactions = [];
    this.acceptableDateDifference =
      parseInt(process.env.YNAB_ACCEPTABLE_DATE_DIFFERENCE) || 6;
    this.acceptableDollarDifference =
      parseFloat(process.env.YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE) || 0.5;
  }

  async init() {
    console.log("🏦 Initializing YNAB connection...");
    try {
      await this.fetchTransactions();
      console.log(
        `✅ YNAB initialized with ${this.transactions.length} transactions`
      );
    } catch (error) {
      console.error("❌ Failed to initialize YNAB:", error);
      throw error;
    }
  }

  async fetchTransactions() {
    try {
      const response = await this.api.transactions.getTransactions(
        this.budgetId
      );
      this.transactions = response.data.transactions;
      console.log(`🔄 Fetched ${this.transactions.length} YNAB transactions`);
    } catch (error) {
      console.error("❌ Error fetching YNAB transactions:", error);
      throw error;
    }
  }

  async createTransaction(payee, amount, date, memo = "") {
    try {
      const transaction = {
        account_id: null, // Will need to be set based on your account
        payee_name: payee,
        amount: Math.round(amount * 1000), // YNAB uses milliunits
        date: date.toISOString().split("T")[0],
        memo: memo,
        cleared: "uncleared",
      };

      const response = await this.api.transactions.createTransaction(
        this.budgetId,
        {
          transaction: transaction,
        }
      );

      console.log(`✅ Created YNAB transaction: ${payee} - $${amount}`);
      return response.data.transaction;
    } catch (error) {
      console.error("❌ Error creating YNAB transaction:", error);
      throw error;
    }
  }

  findMatchingTransaction(payee, amount, date) {
    const targetDate = new Date(date);

    return this.transactions.find((transaction) => {
      if (transaction.deleted) return false;

      const transactionDate = new Date(transaction.date);
      const daysDifference = Math.abs(
        (targetDate - transactionDate) / (1000 * 60 * 60 * 24)
      );
      const amountDifference = Math.abs(
        Math.abs(transaction.amount) / 1000 - amount
      );

      const dateMatch = daysDifference <= this.acceptableDateDifference;
      const amountMatch = amountDifference <= this.acceptableDollarDifference;
      const payeeMatch =
        transaction.payee_name &&
        (transaction.payee_name.toLowerCase().includes(payee.toLowerCase()) ||
          payee.toLowerCase().includes(transaction.payee_name.toLowerCase()));

      return dateMatch && amountMatch && payeeMatch;
    });
  }
}
