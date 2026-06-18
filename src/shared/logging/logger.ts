import pino, { type DestinationStream, type Logger } from "pino";

export interface GatewayLoggerOptions {
  level?: string;
  console?: boolean;
  filePath?: string | false;
}

export type AppLogger = Logger;

export function createGatewayLogger(options: GatewayLoggerOptions = {}): AppLogger {
  const level = options.level ?? "info";
  const streams: { level: string; stream: DestinationStream }[] = [];

  if (options.console !== false) {
    streams.push({
      level,
      stream: pino.destination(2)
    });
  }

  if (options.filePath !== false) {
    streams.push({
      level,
      stream: pino.destination({
        dest: options.filePath ?? ".agent/project-memory-gateway.log",
        mkdir: true,
        sync: false
      })
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
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.multistream(streams)
  );
}
