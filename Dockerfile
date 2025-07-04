FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy dependency definitions and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Run as non-root user (node user is built into node:alpine images)
USER node

# Start the application
CMD ["node", "index.js"]
