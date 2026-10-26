import { getEventListeners } from "node:events";
import { Api, type ApiClientOptions } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { telegramRequest } from "../src/gateway/telegram-project-bots/request.js";

function api() {
  const httpFetch = vi.fn().mockImplementation(async () => Response.json({ ok: true, result: [] }));
  return new Api("123456789:fake-test-token", { fetch: httpFetch as NonNullable<ApiClientOptions["fetch"]> });
}

describe("Telegram per-request cancellation", () => {
  it("reproduces grammY's retained listener and cleans up across many real API calls", async () => {
    const client = api(), parent = new AbortController();
    await client.getUpdates({}, parent.signal as unknown as NonNullable<Parameters<Api["getUpdates"]>[1]>);
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(1);
    parent.abort(); expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
    const polling = new AbortController();
    for (let i = 0; i < 50; i++) {
      await telegramRequest(polling.signal, (signal) => client.getUpdates({}, signal));
      await telegramRequest(polling.signal, (signal) => client.sendRichMessage(1, { blocks: [{ type: "paragraph", text: "test" }] }, {}, signal));
      expect(getEventListeners(polling.signal, "abort")).toHaveLength(0);
    }
  });

  it("cleans up when the request rejects and propagates cancellation", async () => {
    const parent = new AbortController();
    await expect(telegramRequest(parent.signal, async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
    const promise = telegramRequest(parent.signal, (signal) => new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }));
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(1);
    parent.abort(); await promise;
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
    await telegramRequest(parent.signal, async (signal) => { expect(signal.aborted).toBe(true); });
  });
});
