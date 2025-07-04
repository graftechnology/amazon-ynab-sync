const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levels[LOG_LEVEL] || levels.info;

const formatMessage = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const formattedArgs =
    args.length > 0
      ? " " +
        args
          .map((arg) =>
            typeof arg === "object" ? JSON.stringify(arg) : String(arg)
          )
          .join(" ")
      : "";

  return `[${timestamp}] ${level.toUpperCase()}: ${message}${formattedArgs}`;
};

export const logger = {
  error: (message, ...args) => {
    if (currentLevel >= levels.error) {
      console.error(formatMessage("error", message, ...args));
    }
  },

  warn: (message, ...args) => {
    if (currentLevel >= levels.warn) {
      console.warn(formatMessage("warn", message, ...args));
    }
  },

  info: (message, ...args) => {
    if (currentLevel >= levels.info) {
      console.log(formatMessage("info", message, ...args));
    }
  },

  debug: (message, ...args) => {
    if (currentLevel >= levels.debug) {
      console.log(formatMessage("debug", message, ...args));
    }
  },
};

export default logger;
