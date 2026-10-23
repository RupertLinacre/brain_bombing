import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRelay,
  readRelayLease,
  relayConfiguration,
  RelayError,
  RELAY_TIMEOUT_MS,
  TURN_ENDPOINT,
} from "../src/network/relay";

const lease = () => ({
  expiresAt: Date.now() + 7200000,
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "temporary-user",
      credential: "temporary-test-password",
    },
  ],
});
describe("temporary relay credentials", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it("posts to the verified broker without cookies, redirects or browser secrets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(lease())));
    const signal = new AbortController().signal;
    const result = await loadRelay(signal, TURN_ENDPOINT, fetcher);
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe(TURN_ENDPOINT);
    expect(options).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeUndefined();
    expect(relayConfiguration(result).iceTransportPolicy).toBe("all");
    expect(result.iceServers[1].credential).toBe("temporary-test-password");
  });
  it("bounds and sanitizes the response instead of accepting arbitrary RTC options", () => {
    const result = readRelayLease({
      ...lease(),
      iceTransportPolicy: "relay",
      extra: "ignored",
    });
    expect(result).not.toHaveProperty("iceTransportPolicy");
    const invalid: unknown[] = [
      null,
      {},
      { ...lease(), expiresAt: NaN },
      { ...lease(), expiresAt: Date.now() + 60000 },
      { ...lease(), expiresAt: Date.now() + 86400001 },
      { ...lease(), iceServers: [] },
      { ...lease(), iceServers: [{ urls: "https://example.com" }] },
      {
        ...lease(),
        iceServers: [{ urls: "turn:relay.example.com", username: "a" }],
      },
      { ...lease(), iceServers: [{ urls: "stun:example.com" }] },
      {
        ...lease(),
        iceServers: [
          {
            urls: "turn:user:password@example.com",
            username: "a",
            credential: "b",
          },
        ],
      },
      { ...lease(), iceServers: Array(13).fill(lease().iceServers[1]) },
    ];
    for (const value of invalid)
      expect(() => readRelayLease(value)).toThrow(RelayError);
  });
  it("rejects insecure endpoints and URL credentials without a network request", async () => {
    const fetcher = vi.fn();
    for (const endpoint of [
      "http://example.com/ice",
      "https://user:secret@example.com/ice",
      "https://example.com/ice?token=secret",
    ])
      await expect(
        loadRelay(new AbortController().signal, endpoint, fetcher),
      ).rejects.toMatchObject({ kind: "invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([403, 429, 502])(
    "reports HTTP %s safely, without copying service error text",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response("DO_NOT_LOG_PROVIDER_SECRET", {
          status,
          headers: { "Retry-After": "60" },
        }),
      );
      const error = await loadRelay(
        new AbortController().signal,
        TURN_ENDPOINT,
        fetcher,
      ).catch((e) => e);
      expect(error).toBeInstanceOf(RelayError);
      expect(error.message).not.toContain("DO_NOT_LOG");
      expect(error.retryAfterMs).toBe(60000);
      expect(error.kind).toBe(
        status === 403
          ? "forbidden"
          : status === 429
            ? "rate-limited"
            : "unavailable",
      );
    },
  );
  it("waits a full rate-limit window when CORS hides Retry-After", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 429 }));
    await expect(
      loadRelay(new AbortController().signal, TURN_ENDPOINT, fetcher),
    ).rejects.toMatchObject({ kind: "rate-limited", retryAfterMs: 60000 });
  });
  it("times out even a stalled fetch that ignores its abort signal", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const result = loadRelay(
      new AbortController().signal,
      TURN_ENDPOINT,
      fetcher,
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(RELAY_TIMEOUT_MS);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("cancels pending fetches and body reads without returning late credentials", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const result = loadRelay(controller.signal, TURN_ENDPOINT, fetcher).catch(
      (e) => e,
    );
    controller.abort();
    expect(await result).toMatchObject({ kind: "cancelled" });
    finish(new Response(JSON.stringify(lease())));
    const bodyController = new AbortController();
    const bodyFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: () => new Promise(() => {}) });
    const body = loadRelay(
      bodyController.signal,
      TURN_ENDPOINT,
      bodyFetch,
    ).catch((e) => e);
    await Promise.resolve();
    bodyController.abort();
    expect(await body).toMatchObject({ kind: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects oversized, malformed and expired responses", async () => {
    for (const body of [
      "x".repeat(24001),
      "not json",
      JSON.stringify({ ...lease(), expiresAt: Date.now() }),
    ]) {
      const fetcher = vi.fn().mockResolvedValue(new Response(body));
      await expect(
        loadRelay(new AbortController().signal, TURN_ENDPOINT, fetcher),
      ).rejects.toBeInstanceOf(RelayError);
    }
  });
});
