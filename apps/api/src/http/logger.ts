export type Severity = 'INFO' | 'WARNING' | 'ERROR';

/** One structured log entry; `severity` and `message` are the fields Cloud Logging understands. */
export type LogEntry = { severity: Severity; message: string } & Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;

/** One JSON object per line on stdout, which Cloud Run ships to Cloud Logging. */
export const jsonLogger: Logger = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};
