import { getApiBasePath } from "./environment";

const serializeArg = (arg: unknown): string => {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};

const sendToServer = (level: string, messages: string[]) => {
  const url = `${getApiBasePath()}api/log`;
  const body = JSON.stringify({ level, messages });
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
};

export const initConsoleLogForwarder = () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  // console.log = (...args: unknown[]) => {
  //   originalLog.apply(console, args);
  //   sendToServer("log", args.map(serializeArg));
  // };
  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    sendToServer("warn", args.map(serializeArg));
  };
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    sendToServer("error", args.map(serializeArg));
  };
};
