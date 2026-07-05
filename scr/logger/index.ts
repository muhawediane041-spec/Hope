import winston from 'winston';
import path from 'path';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${stack || message}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 10485760,
      maxFiles: 10
    })
  ]
});

const recentLogs: string[] = [];
const MAX_RECENT = 100;

const originalWrite = logger.write.bind(logger);
logger.on('data', (chunk: any) => {
  const line = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
  recentLogs.push(line);
  if (recentLogs.length > MAX_RECENT) recentLogs.shift();
});

export function getRecentLogs(n = 50): string[] {
  return recentLogs.slice(-n);
}

import fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
