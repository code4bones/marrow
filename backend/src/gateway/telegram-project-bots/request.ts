import type { Api } from "grammy";

type TelegramApiSignal = NonNullable<Parameters<Api["getUpdates"]>[1]>;

// grammY retains its listener on a supplied signal until that signal aborts,
// even after a successful request. Use a fresh signal per request and always
// abort/dispose it, rather than accumulating listeners on the poller's lifetime.
export async function telegramRequest<T>(parent: AbortSignal | undefined, call: (signal: TelegramApiSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  try {
    // grammY's Node declarations use abort-controller's older DOM shim;
    // its underlying node-fetch also supports native W3C signals.
    return await call(controller.signal as unknown as TelegramApiSignal);
  } finally {
    parent?.removeEventListener("abort", abort);
    controller.abort();
  }
}
