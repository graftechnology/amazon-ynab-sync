# Amazon YNAB Sync

**Version 1.0.0** by Graf Technology, LLC

_Inspired by the original work of GraysonCAdams_

## Project Description and Purpose

The Amazon YNAB Sync project helps users automatically categorize and detail their Amazon purchases within YNAB (You Need A Budget) by scanning email order confirmations. It addresses the challenge of matching potentially vague bank transactions to specific Amazon orders, providing clear memos and details in YNAB without requiring direct access to your Amazon account or relying on fragile browser automation.

This version is designed for reliability and ease of deployment, particularly in containerized environments. It operates statelessly, processing emails and YNAB transactions based on current data without needing a persistent database.

## Key Features and Benefits

- **Automated Syncing:** Automatically matches Amazon order emails to YNAB transactions.
- **Rich YNAB Memos:** Populates YNAB transaction memos with detailed order information (items, order number, etc.).
- **Stateless Architecture:** Designed for easy deployment and scaling in containerized environments like Docker. No database required.
- **Modern Tech Stack:** Built with ES6+ JavaScript modules for maintainability and performance.
- **Docker Support:** Provided [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](compose/docker-compose.yml) for simple setup and deployment.
- **Enhanced Email Parsing:** Improved logic for extracting order details from various Amazon email formats.
- **Gmail "All Mail" Support:** Recommended configuration to scan all emails, ensuring no order confirmations are missed due to filtering or archiving.
- **Configurable Matching:** Allows tuning of acceptable date and dollar differences for transaction matching.
- **No Amazon Login:** Avoids issues with CAPTCHAs, IP bans, and account security by only interacting with email and YNAB APIs.

## Installation and Setup

### Prerequisites

- Node.js (v14 or higher) and npm/yarn (if running directly)
- Docker and Docker Compose (recommended for deployment)
- Access to your email account via IMAP
- A YNAB Personal Access Token (PAT)
- Your YNAB Budget ID

### Running Directly (for development/testing)

1.  Clone the repository:
    ```bash
    git clone https://github.com/graftechnology/amazon-ynab-sync.git
    cd amazon-ynab-sync
    ```
2.  Install dependencies:
    ```bash
    npm install
    # or
    yarn install
    ```
3.  Create a `.env` file in the project root with your configuration (see Environment Variables section).
4.  Run the script:
    ```bash
    npm start
    # or
    yarn start
    ```

### Running with Docker (Recommended for Deployment)

1.  Clone the repository:
    ```bash
    git clone https://github.com/graftechnology/amazon-ynab-sync.git
    cd amazon-ynab-sync
    ```
2.  Create a `.env` file in the project root with your configuration (see Environment Variables section).
3.  Build the Docker image:
    ```bash
    docker build -t amazon-ynab-sync .
    ```
4.  Run the Docker container:
    ```bash
    docker run --env-file .env amazon-ynab-sync
    ```

### Running with Docker Compose

Using Docker Compose is the easiest way to manage the application as a service.

1.  Clone the repository:
    ```bash
    git clone https://github.com/graftechnology/amazon-ynab-sync.git
    cd amazon-ynab-sync
    ```
2.  Create a `.env` file in the project root with your configuration (see Environment Variables section).
3.  Start the service using the provided [`docker-compose.yml`](compose/docker-compose.yml):
    ```bash
    docker-compose up -d
    ```
    The `-d` flag runs the container in detached mode.

## Configuration Guide

Configuration is managed via environment variables. It is highly recommended to use a `.env` file, especially when using Docker or Docker Compose.

### Environment Variables Reference

| Variable                            | Description                                                                                                                                                                                     | Required | Default Value |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :------------ |
| `IMAP_USERNAME`                     | Your email address for IMAP access.                                                                                                                                                             | Yes      |               |
| `IMAP_PASSWORD`                     | Your email password or app-specific password for IMAP access.                                                                                                                                   | Yes      |               |
| `IMAP_INCOMING_HOST`                | Your email provider's IMAP server host.                                                                                                                                                         | Yes      |               |
| `IMAP_INCOMING_PORT`                | Your email provider's IMAP server port (usually 993 for TLS).                                                                                                                                   | Yes      |               |
| `IMAP_TLS`                          | Set to `true` to use TLS/SSL for IMAP connection.                                                                                                                                               | Yes      | `true`        |
| `IMAP_INBOX_NAME`                   | The name of the mailbox folder to scan. **Recommendation:** Use your email provider's "All Mail" equivalent (e.g., `"[Gmail]/All Mail"` for Gmail) to ensure all order confirmations are found. | Yes      | `INBOX`       |
| `HISTORICAL_SEARCH_NUM_EMAILS`      | The number of recent emails to scan on startup. Useful for catching up on missed emails after a restart. Set to `0` to only process new emails received after startup.                          | No       | `500`         |
| `YNAB_TOKEN`                        | Your YNAB Personal Access Token. Generate one in your YNAB Account Settings.                                                                                                                    | Yes      |               |
| `YNAB_BUDGET_ID`                    | The ID of the YNAB budget you want to sync to. Find this in the URL when viewing your budget in YNAB (`https://app.ynab.com/#####/budget`).                                                     | Yes      |               |
| `YNAB_ACCEPTABLE_DATE_DIFFERENCE`   | The maximum number of days difference allowed between the Amazon order date and a YNAB transaction date for a potential match.                                                                  | No       | `6`           |
| `YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE` | The maximum dollar difference allowed between the Amazon order total and a YNAB transaction amount for a potential match. See Troubleshooting for quirks related to this.                       | No       | `0.5`         |

**Example `.env` file:**

```env
IMAP_USERNAME=your.email@example.com
IMAP_PASSWORD=your_app_password
IMAP_INCOMING_HOST=imap.example.com
IMAP_INCOMING_PORT=993
IMAP_TLS=true
IMAP_INBOX_NAME="[Gmail]/All Mail" # Example for Gmail
HISTORICAL_SEARCH_NUM_EMAILS=200
YNAB_TOKEN=your_ynab_token_here
YNAB_BUDGET_ID=your_budget_id_here
YNAB_ACCEPTABLE_DATE_DIFFERENCE=7
YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE=1.0
```

### Gmail "All Mail" Configuration

For Gmail users, setting `IMAP_INBOX_NAME` to `"[Gmail]/All Mail"` is highly recommended. This folder contains all your emails, including those that may have been archived or filtered out of your primary inbox. This ensures the script can find all relevant Amazon order confirmations. You may need to enable IMAP access in your Gmail settings and potentially use an App Password if you have 2-Factor Authentication enabled.

For other email providers, consult their documentation for the equivalent "All Mail" or "All Messages" folder name.

## Technical Details

### Architecture Overview

This refactored version employs a **stateless architecture**. This means the application does not rely on a persistent database or local files to maintain state between runs. All necessary data (recent YNAB transactions, recently processed Amazon orders) is held in memory during the application's runtime and is discarded upon shutdown.

This design choice simplifies deployment, especially in containerized environments, as containers can be easily started, stopped, and replaced without worrying about data migration or state management.

### How Email Scanning Works Without Persistence

On startup, the application connects to the configured IMAP server and fetches a configurable number of recent emails (`HISTORICAL_SEARCH_NUM_EMAILS`). It parses these emails for Amazon order confirmations and stores relevant details (order number, date, total, items) in memory.

Concurrently, it fetches recent transactions from the specified YNAB budget via the YNAB API and stores them in memory.

The application then enters a loop:

1.  It checks for new emails arriving in the configured mailbox.
2.  It periodically fetches new YNAB transactions.
3.  It attempts to match in-memory Amazon orders to in-memory YNAB transactions based on date, amount, and whether the YNAB transaction memo is empty.
4.  Matched YNAB transactions are updated with detailed Amazon order information in their memo field via the YNAB API.
5.  Processed Amazon orders and YNAB transactions are kept in memory for a certain duration to avoid reprocessing, but this cache is reset on application restart.

Because the application is stateless, restarting it will cause it to re-fetch recent emails and YNAB transactions based on the configuration, effectively rebuilding its in-memory state.

### YNAB Integration Details

The application interacts with YNAB exclusively through the official YNAB API using your Personal Access Token. It fetches transactions for the specified budget and updates the `memo` field of matching transactions.

**Important Considerations:**

- **Pending Transactions:** The YNAB API does not provide details for pending transactions. The script can only match against transactions that have cleared or have been manually entered as scheduled transactions that have occurred.
- **Memo Overwriting:** The script will only attempt to update YNAB transactions that have an empty memo field. If you manually add a memo to a transaction, the script will ignore it, allowing you to prevent automatic updates for specific transactions.

### Performance Characteristics

The application's performance is primarily dependent on:

- **Number of Historical Emails:** Scanning a large number of historical emails on startup can take time and consume memory.
- **Number of YNAB Transactions:** Fetching a large number of recent YNAB transactions impacts startup time.
- **Email Server Responsiveness:** The speed of IMAP operations depends on your email provider.
- **YNAB API Responsiveness:** The speed of YNAB API calls depends on the YNAB service.

In a typical deployment scanning a few hundred historical emails and monitoring new ones, the application should run efficiently with minimal resource usage. The stateless design prevents unbounded growth of persistent storage.

## Usage Examples

### Basic Docker Compose Deployment

Deploying with Docker Compose is the recommended approach for continuous operation.

1.  Save your configuration in a `.env` file.
2.  Run:
    ```bash
    docker-compose up -d
    ```
    This will build the image (if not already built) and start the container in the background.

### Running Once to Process Historical Emails

If you only want to process historical emails up to a certain limit and then stop, you can run the Docker container without `-d` and with a specific `HISTORICAL_SEARCH_NUM_EMAILS`.

1.  Save your configuration in a `.env` file, ensuring `HISTORICAL_SEARCH_NUM_EMAILS` is set to your desired value (e.g., `1000`).
2.  Run:
    ```bash
    docker run --env-file .env amazon-ynab-sync
    ```
    The script will process the historical emails and then continue to monitor for new ones until you stop the container (e.g., by pressing Ctrl+C if not running in detached mode). If you want it to stop after processing historical emails, you would need to modify the script's main loop logic. The current implementation is designed for continuous monitoring.

### Running Directly for Debugging

For debugging or development, running directly with Node.js is useful.

1.  Ensure Node.js and dependencies are installed.
2.  Create a `.env` file.
3.  Run:
    ```bash
    npm start
    ```
    This will run the script in your terminal, showing logs directly.

## Troubleshooting

- **Incorrect Matches:** If transactions are being matched incorrectly, adjust the `YNAB_ACCEPTABLE_DATE_DIFFERENCE` and `YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE` environment variables. Start with smaller values and increase them if necessary.
- **Missing Matches:**
  - Ensure `IMAP_INBOX_NAME` is set correctly, preferably to an "All Mail" equivalent.
  - Verify your IMAP credentials and server settings are correct.
  - Check if the Amazon order confirmation emails are actually present in the scanned mailbox folder.
  - Confirm that the corresponding YNAB transactions exist and have empty memo fields.
  - Remember that pending YNAB transactions cannot be matched.
- **Dollar Amount Discrepancies:** Amazon email totals can sometimes differ slightly from the final transaction amount due to taxes, fees, or how items are grouped. The `YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE` variable helps accommodate this.
- **iCloud Email:** If using iCloud, you may need to generate an app-specific password for IMAP access instead of using your main Apple ID password. Ensure you use your primary iCloud email address, not an alias.
- **High CPU/Memory Usage:** If scanning a very large number of historical emails (`HISTORICAL_SEARCH_NUM_EMAILS`), initial startup might consume more resources. For continuous operation, a lower value for this variable is recommended.
- **YNAB API Rate Limits:** While unlikely for typical personal use, be aware of YNAB API rate limits. The stateless design means restarts will re-fetch data, which could potentially hit limits if restarting frequently with a high `HISTORICAL_SEARCH_NUM_EMAILS`. Consider implementing a restart delay or limit if running as a service prone to frequent crashes.

## Contributing

Contributions are welcome! If you find a bug or have an idea for an improvement, please open an issue or submit a pull request.

1.  Fork the repository.
2.  Create a new branch for your feature or bugfix.
3.  Make your changes, following the existing code style.
4.  Write tests for your changes.
5.  Submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
