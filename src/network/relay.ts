// Public credential broker only. The long-lived TURN key stays in Cloudflare.
export const TURN_ENDPOINT =
  "https://keep-it-going-relay.robinlinacre.workers.dev/ice";
export const RELAY_TIMEOUT_MS = 5000;
export const RELAY_REFRESH_MS = 30 * 60 * 1000;
export const RELAY_MARGIN_MS = 60 * 1000;
export const DIRECT_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  iceTransportPolicy: "all",
};
export type RelayLease = { iceServers: RTCIceServer[]; expiresAt: number };
export type RelayStatus = "loading" | "available" | "unavailable";
export class RelayError extends Error {
  constructor(
    readonly kind:
      | "cancelled"
      | "timeout"
      | "unavailable"
      | "forbidden"
      | "rate-limited"
      | "invalid",
    readonly retryAfterMs = kind === "rate-limited" ? 60000 : 30000,
  ) {
    super(
      kind === "timeout"
        ? "Relay service timed out."
        : kind === "rate-limited"
          ? "Relay service is busy. Please wait a minute."
          : kind === "forbidden"
            ? "Relay service does not allow this website origin."
            : kind === "cancelled"
              ? "Connection cancelled."
              : "Relay service is unavailable.",
    );
  }
}

/** Accept only the credential contract, never arbitrary RTC configuration. */
export function readRelayLease(value: unknown, now = Date.now()): RelayLease {
  const invalid = () => new RelayError("invalid");
  if (!value || typeof value !== "object") throw invalid();
  const data = value as Record<string, unknown>;
  if (
    typeof data.expiresAt !== "number" ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt <= now + RELAY_MARGIN_MS ||
    data.expiresAt > now + 86400000 ||
    !Array.isArray(data.iceServers) ||
    !data.iceServers.length ||
    data.iceServers.length > 12
  )
    throw invalid();
  const iceServers: RTCIceServer[] = data.iceServers.map((server) => {
    if (!server || typeof server !== "object") throw invalid();
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (
      !Array.isArray(urls) ||
      !urls.length ||
      urls.length > 12 ||
      urls.some(
        (url) =>
          typeof url !== "string" ||
          url.length > 300 ||
          !/^(stun|stuns|turn|turns):[a-zA-Z0-9.\-\[\]:]+(?:\?transport=(udp|tcp))?$/.test(
            url,
          ),
      )
    )
      throw invalid();
    const authenticated = urls.some((url) => /^turns?:/.test(url));
    if (
      authenticated &&
      (typeof server.username !== "string" ||
        !server.username.length ||
        server.username.length > 1024 ||
        typeof server.credential !== "string" ||
        !server.credential.length ||
        server.credential.length > 1024)
    )
      throw invalid();
    return authenticated
      ? {
          urls: [...urls],
          username: server.username,
          credential: server.credential,
        }
      : { urls: [...urls] };
  });
  if (
    !iceServers.some((server) =>
      (server.urls as string[]).some((url) => /^turns?:/.test(url)),
    )
  )
    throw invalid();
  return { iceServers, expiresAt: data.expiresAt };
}

export function relayConfiguration(lease: RelayLease): RTCConfiguration {
  // Let ICE choose direct routes; TURN is available when those cannot connect.
  return { iceServers: lease.iceServers, iceTransportPolicy: "all" };
}

export async function loadRelay(
  signal: AbortSignal,
  endpoint = import.meta.env.VITE_TURN_ENDPOINT || TURN_ENDPOINT,
  fetcher: typeof fetch = fetch,
): Promise<RelayLease> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, RELAY_TIMEOUT_MS);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new RelayError(timedOut ? "timeout" : "cancelled"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  if (signal.aborted) cancel();
  try {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw new RelayError("invalid");
    const request = async () => {
      const response = await fetcher(url, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const retry = Number(response.headers.get("Retry-After"));
        throw new RelayError(
          response.status === 429
            ? "rate-limited"
            : response.status === 403
              ? "forbidden"
              : "unavailable",
          Number.isFinite(retry) && retry > 0
            ? Math.max(30000, Math.min(retry * 1000, 5 * 60 * 1000))
            : response.status === 429
              ? 60000
              : 30000,
        );
      }
      const text = await response.text();
      if (text.length > 24000) throw new RelayError("invalid");
      return readRelayLease(JSON.parse(text));
    };
    return await Promise.race([request(), aborted]);
  } catch (error) {
    if (signal.aborted) throw new RelayError("cancelled");
    if (timedOut) throw new RelayError("timeout");
    throw error instanceof RelayError ? error : new RelayError("unavailable");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
