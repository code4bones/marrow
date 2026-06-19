import pino, { type DestinationStream, type Logger } from "pino";
import { Writable } from "node:stream";

export interface GatewayLoggerOptions {
  level?: string;
  console?: boolean;
  filePath?: string | false;
  pretty?: boolean;
  includeTime?: boolean;
}

export type AppLogger = Logger;

export function createGatewayLogger(options: GatewayLoggerOptions = {}): AppLogger {
  const level = options.level ?? "info";
  const pretty = options.pretty ?? false;
  const includeTime = options.includeTime ?? true;
  const streams: { level: string; stream: DestinationStream }[] = [];

  if (options.console !== false) {
    streams.push({
      level,
      stream: createLogStream(pino.destination(2), { pretty, includeTime })
    });
  }

  if (options.filePath !== false) {
    streams.push({
      level,
      stream: createLogStream(
        pino.destination({
          dest: options.filePath ?? ".agent/project-memory-gateway.log",
          mkdir: true,
          sync: false
        }),
        { pretty, includeTime }
      )
    });
  }

  if (streams.length === 0) {
    return pino({ enabled: false });
  }

  return pino(
    {
      level,
      base: {
        service: "project-memory-gateway"
      },
      timestamp: includeTime ? pino.stdTimeFunctions.isoTime : false
    },
    pino.multistream(streams)
  );
}

function createLogStream(
  destination: DestinationStream,
  options: { pretty: boolean; includeTime: boolean }
): DestinationStream {
  if (!options.pretty) {
    return destination;
  }

  return new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.length === 0) {
          continue;
        }
        destination.write(`${formatPrettyLine(line, options.includeTime)}\n`);
      }
      callback();
    }
  }) as DestinationStream;
}

function formatPrettyLine(line: string, includeTime: boolean): string {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const level = levelName(record.level);
    const time = includeTime && typeof record.time === "string" ? `${record.time} ` : "";
    const message = typeof record.msg === "string" ? record.msg : "";
    const fields = Object.entries(record)
      .filter(([key]) => !["level", "time", "pid", "hostname", "service", "msg"].includes(key))
      .map(([key, value]) => `${key}=${formatField(value)}`);
    const suffix = fields.length > 0 ? ` ${fields.join(" ")}` : "";
    return `${time}${level} ${message}${suffix}`;
  } catch {
    return line;
  }
}

function levelName(value: unknown): string {
  if (typeof value !== "number") {
    return "INFO";
  }
  if (value >= 60) {
    return "FATAL";
  }
  if (value >= 50) {
    return "ERROR";
  }
  if (value >= 40) {
    return "WARN";
  }
  if (value >= 30) {
    return "INFO";
  }
  if (value >= 20) {
    return "DEBUG";
  }
  return "TRACE";
}

function formatField(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
