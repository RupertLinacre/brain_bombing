import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type Peer from "peerjs";
import { Session, type NetworkEvent } from "../src/network/session";
import {
  RELAY_REFRESH_MS,
  RelayError,
  type RelayLease,
} from "../src/network/relay";

class Events {
  private listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, callback: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
    return this;
  }
  emit(event: string, ...args: any[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
}
class FakeConnection extends Events {
  open = false;
  peerConnection = {
    signalingState: "stable",
    getConfiguration: () => ({ iceTransportPolicy: "all" }),
    setConfiguration: vi.fn(),
  };
  send = vi.fn((message: any) => {
    if (message.kind === "ping") this.emit("data", { kind: "pong" });
  });
  close = vi.fn(() => {
    this.open = false;
    this.emit("close");
  });
  ready() {
    this.open = true;
    this.emit("open");
  }
}
class FakePeer extends Events {
  destroyed = false;
  connection = new FakeConnection();
  options: { config: RTCConfiguration };
  reconnect = vi.fn();
  constructor(
    readonly id: string | undefined,
    config: RTCConfiguration,
  ) {
    super();
    this.options = { config };
  }
  connect = vi.fn(() => this.connection);
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.emit("close");
  });
}
const profile = { name: "Player", year: "year1" as const };
const lease = (name = "initial", ttl = 7200000): RelayLease => ({
  expiresAt: Date.now() + ttl,
  iceServers: [
    {
      urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
      username: name,
      credential: `test-${name}`,
    },
  ],
});
function setup(credentials = vi.fn(async (_signal: AbortSignal) => lease())) {
  const peers: FakePeer[] = [],
    events: NetworkEvent[] = [];
  const peer = vi.fn((id: string | undefined, config: RTCConfiguration) => {
    const p = new FakePeer(id, config);
    peers.push(p);
    return p as unknown as Peer;
  });
  const session = new Session((e) => events.push(e), { credentials, peer });
  return { session, peers, events, credentials, peer };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("relay-backed room lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it.each(["host", "guest"] as const)(
    "loads fresh credentials before creating a %s peer and preserves the game namespace",
    async (role) => {
      let resolve!: (lease: RelayLease) => void;
      const credentials = vi.fn(
        (_signal: AbortSignal) =>
          new Promise<RelayLease>((done) => {
            resolve = done;
          }),
      );
      const x = setup(credentials);
      x.session.open(role, profile, "ABCD");
      expect(x.peer).not.toHaveBeenCalled();
      resolve(lease());
      await settle();
      expect(x.peer).toHaveBeenCalledOnce();
      const p = x.peers[0];
      expect(p.options.config).toMatchObject({
        iceTransportPolicy: "all",
        iceServers: lease().iceServers,
      });
      p.emit("open");
      if (role === "host") expect(p.id).toMatch(/^brain-bombs-2-v8-/);
      else
        expect(p.connect).toHaveBeenCalledWith("brain-bombs-2-v8-abcd", {
          reliable: true,
        });
      x.session.close();
    },
  );
  it("aborts cancellation, ignores stale success/failure and cannot create a peer for a closed room", async () => {
    const pending: {
      signal: AbortSignal;
      resolve: (lease: RelayLease) => void;
      reject: (reason: Error) => void;
    }[] = [];
    const credentials = vi.fn(
      (signal: AbortSignal) =>
        new Promise<RelayLease>((resolve, reject) =>
          pending.push({ signal, resolve, reject }),
        ),
    );
    const x = setup(credentials);
    x.session.open("host", profile);
    x.session.close();
    expect(pending[0].signal.aborted).toBe(true);
    x.session.open("guest", profile, "ABCD");
    pending[1].resolve(lease("new"));
    await settle();
    pending[0].resolve(lease("old"));
    await settle();
    expect(x.peers).toHaveLength(1);
    expect(x.peers[0].options.config.iceServers![0].username).toBe("new");
    x.session.open("host", profile);
    x.session.close();
    pending[2].reject(new Error("sensitive underlying error"));
    await settle();
    expect(x.events.some((e) => e.kind === "lost")).toBe(false);
    expect(JSON.stringify(x.events)).not.toContain("sensitive");
  });
  it("does not start setup if a status callback synchronously closes the room", async () => {
    const credentials = vi.fn(async () => lease());
    let session: Session;
    session = new Session(() => session.close(), { credentials });
    session.open("host", profile);
    await settle();
    expect(credentials).not.toHaveBeenCalled();
  });
  it("clearly reports credential failure while retaining direct connectivity and retrying safely", async () => {
    const credentials = vi.fn(
      async (_signal: AbortSignal): Promise<RelayLease> => {
        throw new RelayError("rate-limited", 60000);
      },
    );
    const x = setup(credentials);
    x.session.open("host", profile);
    await settle();
    x.peers[0].emit("open");
    expect(x.session.relayStatus).toBe("unavailable");
    expect(x.peers[0].options.config.iceTransportPolicy).toBe("all");
    expect(x.events.filter((e) => e.kind === "status").at(-1)).toMatchObject({
      text: expect.stringContaining("Trying a direct connection"),
    });
    await vi.advanceTimersByTimeAsync(59000);
    expect(credentials).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(credentials).toHaveBeenCalledTimes(2);
    x.session.close();
  });
  it("refreshes long waiting rooms and future peer connections before expiry", async () => {
    let count = 0;
    const x = setup(
      vi.fn(async (_signal: AbortSignal) => lease(String(++count))),
    );
    x.session.open("host", profile);
    await settle();
    x.peers[0].emit("open");
    await vi.advanceTimersByTimeAsync(RELAY_REFRESH_MS);
    expect(x.peers[0].options.config.iceServers![0].username).toBe("2");
    expect(x.session.relayStatus).toBe("available");
    expect(x.peers[0].destroy).not.toHaveBeenCalled();
    x.session.close();
  });
  it("updates an existing data connection without interrupting gameplay", async () => {
    const credentials = vi.fn(async (_signal: AbortSignal) => lease("fresh"));
    credentials.mockResolvedValueOnce(lease("old", 120000));
    const x = setup(credentials);
    x.session.open("guest", profile, "ABCD");
    await settle();
    const p = x.peers[0];
    p.emit("open");
    p.connection.ready();
    await vi.advanceTimersByTimeAsync(60000);
    expect(p.connection.peerConnection.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        iceServers: lease("fresh").iceServers,
        iceTransportPolicy: "all",
      }),
    );
    expect(x.session.connected).toBe(true);
    expect(p.connection.close).not.toHaveBeenCalled();
    x.session.close();
  });
  it("does not apply an old refresh to a reopened room", async () => {
    let resolve!: (lease: RelayLease) => void;
    const credentials = vi.fn(async (_signal: AbortSignal) => lease("old"));
    credentials.mockImplementationOnce(async () => lease("old"));
    const x = setup(credentials);
    x.session.open("host", profile);
    await settle();
    x.peers[0].emit("open");
    credentials.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(RELAY_REFRESH_MS);
    x.session.close();
    credentials.mockResolvedValueOnce(lease("reopened"));
    x.session.open("host", profile);
    await settle();
    resolve(lease("late"));
    await settle();
    expect(x.peers[1].options.config.iceServers![0].username).toBe("reopened");
    x.session.close();
  });
  it("keeps valid credentials during an outage, then closes clearly if renewal never succeeds", async () => {
    const credentials = vi.fn(
      async (_signal: AbortSignal): Promise<RelayLease> => {
        throw new RelayError("unavailable");
      },
    );
    credentials.mockResolvedValueOnce(lease("old", 65000));
    const x = setup(credentials);
    x.session.open("host", profile);
    await settle();
    x.peers[0].emit("open");
    await vi.advanceTimersByTimeAsync(64000);
    expect(x.peers[0].destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(x.peers[0].destroy).toHaveBeenCalledOnce();
    expect(x.events.filter((e) => e.kind === "lost")).toHaveLength(1);
    expect(JSON.stringify(x.events)).toContain("could not renew");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("renews nearly expired credentials before reconnecting to signalling", async () => {
    const credentials = vi.fn(async (_signal: AbortSignal) => lease("fresh"));
    credentials.mockResolvedValueOnce(lease("old", 65000));
    const x = setup(credentials);
    x.session.open("host", profile);
    await settle();
    const p = x.peers[0];
    p.emit("open");
    vi.setSystemTime(Date.now() + 61000);
    p.emit("disconnected");
    await settle();
    expect(p.options.config.iceServers![0].username).toBe("fresh");
    expect(p.reconnect).toHaveBeenCalledOnce();
    p.emit("open");
    x.session.close();
  });
  it("does not reconnect or time out a data channel that opens during credential renewal", async () => {
    let resolve!: (value: RelayLease) => void;
    const credentials = vi.fn(async (_signal: AbortSignal) =>
      lease("initial", 65000),
    );
    const x = setup(credentials);
    x.session.open("host", profile);
    await settle();
    const p = x.peers[0];
    p.emit("open");
    credentials.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.setSystemTime(Date.now() + 61000);
    p.emit("disconnected");
    p.emit("connection", p.connection);
    p.connection.ready();
    resolve(lease("fresh"));
    await settle();
    expect(p.reconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(19000);
    expect(x.session.connected).toBe(true);
    x.session.close();
  });
  it("times out signalling even when a host has already been assigned an ID", async () => {
    const x = setup();
    x.session.open("host", profile);
    await settle();
    await vi.advanceTimersByTimeAsync(18000);
    expect(x.events.at(-1)).toMatchObject({
      kind: "lost",
      text: expect.stringContaining("room service"),
    });
  });
  it("gives both roles a bounded data-channel handshake after signalling succeeds", async () => {
    const x = setup();
    x.session.open("guest", profile, "ABCD");
    await settle();
    x.peers[0].emit("open");
    await vi.advanceTimersByTimeAsync(30000);
    expect(x.events.at(-1)).toMatchObject({
      kind: "lost",
      text: expect.stringContaining("finish connecting"),
    });
  });
});
