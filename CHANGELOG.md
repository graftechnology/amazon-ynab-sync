# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-07-04

### Initial Release

Graf Technology's **amazon-ynab-sync** - the first release of our automated Amazon order synchronization tool for YNAB (You Need A Budget).

### Features

- **IMAP Email Scanning**: Automatically scans your email account for Amazon order confirmation emails
- **YNAB Integration**: Seamlessly syncs Amazon order details to YNAB transaction memos
- **Smart Transaction Matching**: Intelligently matches Amazon orders to YNAB transactions based on date and amount
- **Enhanced Email Parsing**: Robust parsing logic handles various Amazon email formats
- **Gmail "All Mail" Support**: Comprehensive email scanning with explicit Gmail configuration
- **Configurable Matching Parameters**: Customizable date and dollar difference tolerances via environment variables

### Technical Highlights

- **Docker Support**: Complete containerization with [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](compose/docker-compose.yml) for easy deployment
- **Modern ES6+ Architecture**: Built with modern JavaScript using ES6 import/export syntax and async/await patterns
- **Stateless Design**: In-memory processing without database dependencies for simplified deployment and maintenance
- **Container-First Approach**: Designed for Docker deployment with proper multi-stage builds and security practices
- **Production-Ready Configuration**: Comprehensive environment variable documentation and examples
- **Security**: Runs as non-root user in Docker container with security best practices

### Requirements

- Node.js 22+ for modern JavaScript features
- Docker (recommended for deployment)
- IMAP email access
- YNAB Personal Access Token

### Getting Started

Deploy with a single command using Docker Compose:

```bash
docker-compose up -d
```

### Attribution

Inspired by GraysonCAdams' original concept for email-based Amazon order synchronization with YNAB.
