import winston from 'winston';
import path from 'path';

// Define Log Directory
const logDir = path.join(process.cwd(), 'logs');

// Custom Format
const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message} `;
    if (Object.keys(metadata).length > 0) {
        msg += JSON.stringify(metadata);
    }
    return msg;
});

// Create Logger
export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        // 1. Write all logs to `logs/app.log`
        new winston.transports.File({ filename: path.join(logDir, 'app.log') }),
        // 2. Write all stats/trades to `logs/trades.log` (Separate persistent record)
        new winston.transports.File({ filename: path.join(logDir, 'trades.log'), level: 'crit', format: winston.format.json() }),
        // 3. Write errors to `logs/error.log`
        new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    ],
});

// If we're not in production, log to the `console` as well
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            logFormat
        ),
    }));
}

// Ensure the logs directory exists (Winston might create file but not dir?)
// Winston `File` transport creates directory automatically if not exists? 
// Usually yes, but let's be safe or just let it fail/work. Winston handles it.
