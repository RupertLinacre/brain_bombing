import Peer, { type DataConnection } from "peerjs";
import { YEARS, type Action, type Profile, type View } from "../game/types";
import { keyDirections } from "../game/movement";
import {
  DIRECT_CONFIG,
  loadRelay,
  relayConfiguration,
  RelayError,
  RELAY_REFRESH_MS,
  RELAY_MARGIN_MS,
  type RelayLease,
  type RelayStatus,
} from "./relay";

type SessionServices = {
  credentials(signal: AbortSignal): Promise<RelayLease>;
  peer(id: string | undefined, config: RTCConfiguration): Peer;
};
const defaultServices: SessionServices = {
  credentials: (signal) => loadRelay(signal),
  peer: (id, config) =>
    id ? new Peer(id, { debug: 0, config }) : new Peer({ debug: 0, config }),
};

export type NetworkEvent =
  | { kind: "status"; text: string }
  | { kind: "ready"; code: string }
  | { kind: "joined"; profiles: [Profile, Profile] }
  | { kind: "start"; profiles: [Profile, Profile] }
  | { kind: "view"; view: View }
  | { kind: "action"; action: Action }
  | { kind: "rematch" }
  | { kind: "lost"; text: string };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PREFIX = "brain-bombs-2-v8-";
const validProfile = (p: unknown): p is Profile =>
  !!p &&
  typeof p === "object" &&
  typeof (p as Profile).name === "string" &&
  (p as Profile).name.length <= 20 &&
  YEARS.includes((p as Profile).year);
export function validAction(a: unknown): a is Action {
  if (!a || typeof a !== "object") return false;
  const v = a as Record<string, unknown>;
  if (v.type === "bomb") return true;
  if (v.type === "dismiss")
    return v.brain === undefined || Number.isInteger(v.brain);
  if (v.type === "keepalive") return true;
  if (v.type === "input" || v.type === "release")
    return (
      Number.isSafeInteger(v.sequence) &&
      Number(v.sequence) > 0 &&
      (v.type === "release" ||
        (typeof v.code === "string" &&
          Object.hasOwn(keyDirections, v.code) &&
          typeof v.down === "boolean"))
    );
  if (v.type === "move")
    return (
      v.direction === null ||
      ["up", "down", "left", "right"].includes(v.direction as string)
    );
  if (v.type === "typed-answer")
    return (
      Number.isInteger(v.brain) &&
      typeof v.answer === "string" &&
      v.answer.trim().length > 0 &&
      v.answer.length <= 100
    );
  return (
    v.type === "answer" &&
    Number.isInteger(v.brain) &&
    Number.isInteger(v.choice) &&
    Number(v.choice) >= 0 &&
    Number(v.choice) <= 3
  );
}

/** PeerJS invite-code transport; host owns the simulation and sends filtered views. */
export class Session {
  role: "host" | "guest" = "host";
  code = "";
  connected = false;
  profiles?: [Profile, Profile];
  private peer?: Peer;
  private connection?: DataConnection;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private lastSeen = 0;
  private disposed = false;
  private started = false;
  private actionWindow = 0;
  private actionCount = 0;
  private generation = 0;
  private attempt = 0;
  private lifetime?: AbortController;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private refreshPending?: Promise<void>;
  private lease?: RelayLease;
  private retryAfterMs = 30000;
  private nextRefreshAt = 0;
  private relayNotice = "";
  private reconnectUsed = false;
  relayStatus: RelayStatus = "loading";
  private services: SessionServices;
  constructor(
    private emit: (event: NetworkEvent) => void,
    services: Partial<SessionServices> = {},
  ) {
    this.services = { ...defaultServices, ...services };
  }
  private current(attempt: number): boolean {
    return !this.disposed && this.attempt === attempt;
  }
  private status(text: string): void {
    this.emit({
      kind: "status",
      text: this.relayNotice ? `${text} ${this.relayNotice}` : text,
    });
  }

  open(role: "host" | "guest", profile: Profile, code?: string): void {
    this.close();
    this.disposed = false;
    this.role = role;
    this.code =
      role === "host"
        ? Array.from(
            { length: 4 },
            () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
          ).join("")
        : code!.trim().toUpperCase();
    this.lifetime = new AbortController();
    this.relayStatus = "loading";
    this.relayNotice = "";
    this.reconnectUsed = false;
    this.retryAfterMs = 30000;
    const attempt = this.attempt;
    this.status("Preparing the connection…");
    if (this.current(attempt)) void this.prepare(attempt, role, profile);
  }

  private async prepare(
    attempt: number,
    role: "host" | "guest",
    profile: Profile,
  ): Promise<void> {
    let config = DIRECT_CONFIG;
    try {
      const lease = await this.services.credentials(this.lifetime!.signal);
      if (!this.current(attempt)) return;
      this.lease = lease;
      config = relayConfiguration(lease);
      this.relayStatus = "available";
    } catch (error) {
      if (!this.current(attempt)) return;
      this.relayUnavailable(error);
    }
    if (!this.current(attempt)) return;
    let peer: Peer;
    try {
      peer = this.services.peer(
        role === "host" ? PREFIX + this.code.toLowerCase() : undefined,
        config,
      );
    } catch {
      this.fail("Could not start multiplayer. Refresh and try again.");
      return;
    }
    this.peer = peer;
    this.scheduleRefresh(attempt);
    if (!this.current(attempt)) return;
    this.status(
      role === "host" ? "Opening your room…" : "Finding your friend…",
    );
    if (!this.current(attempt)) return;
    this.deadline(
      peer,
      18000,
      "Could not reach the room service. Check your internet connection and try again.",
    );
    peer.on("open", () => {
      if (this.disposed || this.peer !== peer) return;
      clearTimeout(this.timeout);
      if (role === "host") {
        this.emit({ kind: "ready", code: this.code });
        if (this.current(attempt))
          this.status("Room ready. Waiting for your friend…");
      } else
        this.attach(
          peer.connect(PREFIX + this.code.toLowerCase(), { reliable: true }),
          profile,
        );
    });
    peer.on("connection", (conn) => {
      if (this.peer !== peer) {
        conn.close();
        return;
      }
      if (role !== "host" || this.connection) {
        conn.on("open", () => {
          conn.send({
            kind: "error",
            text: "This room already has two players.",
          });
          setTimeout(() => conn.close(), 250);
        });
        return;
      }
      if (this.lease && this.lease.expiresAt <= Date.now()) {
        conn.close();
        this.fail("The room's relay credentials expired. Create a new room.");
        return;
      }
      this.attach(conn, profile);
    });
    peer.on("error", (error) => {
      if (this.peer !== peer) return;
      const text =
        error.type === "unavailable-id"
          ? "That room code is busy. Create another room."
          : error.type === "peer-unavailable"
            ? "Room not found. Check the code and try again."
            : "Could not connect. Try another network or play the computer.";
      if (!this.connected) this.fail(text);
    });
    peer.on("disconnected", () => {
      if (!this.current(attempt) || this.peer !== peer || this.connected)
        return;
      if (this.reconnectUsed || peer.destroyed) {
        this.fail("The room service disconnected. Please try again.");
        return;
      }
      this.reconnectUsed = true;
      void this.reconnect(peer, attempt);
    });
    if (typeof document !== "undefined")
      document.addEventListener(
        "visibilitychange",
        () => {
          if (
            !document.hidden &&
            this.current(attempt) &&
            Date.now() >= this.nextRefreshAt
          )
            void this.refreshRelay(attempt);
        },
        { signal: this.lifetime!.signal },
      );
  }

  private deadline(peer: Peer, ms: number, text: string): void {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (this.peer === peer && !this.disposed) this.fail(text);
    }, ms);
  }

  private relayUnavailable(error: unknown): void {
    this.relayStatus = "unavailable";
    const failure =
      error instanceof RelayError ? error : new RelayError("unavailable");
    this.retryAfterMs = failure.retryAfterMs;
    this.relayNotice = `${failure.message} Trying a direct connection; some networks may not connect.`;
  }

  private scheduleRefresh(attempt: number, delay?: number): void {
    clearTimeout(this.refreshTimer);
    if (!this.current(attempt)) return;
    const remaining = this.lease ? this.lease.expiresAt - Date.now() : Infinity;
    if (remaining <= 0) {
      this.fail(
        "The relay could not renew this room's connection. Create a new room and try again.",
      );
      return;
    }
    const wait =
      delay ??
      (this.lease
        ? Math.max(
            1000,
            Math.min(RELAY_REFRESH_MS, remaining - RELAY_MARGIN_MS),
          )
        : this.retryAfterMs);
    this.nextRefreshAt = Date.now() + wait;
    this.refreshTimer = setTimeout(() => {
      void this.refreshRelay(attempt);
    }, wait);
    clearTimeout(this.expiryTimer);
    const lease = this.lease;
    if (lease)
      this.expiryTimer = setTimeout(
        () => {
          if (!this.current(attempt) || this.lease !== lease) return;
          if (lease.expiresAt > Date.now()) {
            this.scheduleRefresh(attempt);
            return;
          }
          this.fail(
            "The relay could not renew this room's connection. Create a new room and try again.",
          );
        },
        Math.max(0, remaining),
      );
  }

  private refreshRelay(attempt: number): Promise<void> {
    if (!this.current(attempt)) return Promise.resolve();
    if (this.lease && this.lease.expiresAt <= Date.now()) {
      this.fail(
        "The relay could not renew this room's connection. Create a new room and try again.",
      );
      return Promise.resolve();
    }
    if (this.refreshPending) return this.refreshPending;
    this.refreshPending = (async () => {
      try {
        const lease = await this.services.credentials(this.lifetime!.signal);
        if (!this.current(attempt) || !this.peer) return;
        const config = relayConfiguration(lease),
          pc = this.connection?.peerConnection;
        if (pc && pc.signalingState !== "closed")
          pc.setConfiguration({ ...pc.getConfiguration(), ...config });
        this.peer.options.config = { ...this.peer.options.config, ...config };
        this.lease = lease;
        this.relayStatus = "available";
        this.relayNotice = "";
        this.scheduleRefresh(attempt);
        if (!this.connected)
          this.status("Room ready. Waiting for your friend…");
      } catch (error) {
        if (!this.current(attempt)) return;
        const failure =
          error instanceof RelayError ? error : new RelayError("unavailable");
        this.retryAfterMs = failure.retryAfterMs;
        if (!this.lease) this.relayUnavailable(failure);
        else
          this.relayNotice =
            "Relay renewal is delayed; retrying before this room's credentials expire.";
        if (!this.connected) this.status("Waiting for your friend…");
        this.scheduleRefresh(attempt, this.retryAfterMs);
      } finally {
        if (this.current(attempt)) this.refreshPending = undefined;
      }
    })();
    return this.refreshPending;
  }

  private async reconnect(peer: Peer, attempt: number): Promise<void> {
    if (this.lease && this.lease.expiresAt - Date.now() < RELAY_MARGIN_MS)
      await this.refreshRelay(attempt);
    if (!this.current(attempt) || this.peer !== peer || this.connected) return;
    if (this.lease && this.lease.expiresAt <= Date.now()) {
      this.fail("This room's relay credentials expired. Create a new room.");
      return;
    }
    this.status("Reconnecting to the room service…");
    if (!this.current(attempt)) return;
    try {
      peer.reconnect();
      this.deadline(
        peer,
        18000,
        "The room service could not reconnect. Create a new room.",
      );
    } catch {
      this.fail("The room service could not reconnect. Create a new room.");
    }
  }

  private attach(conn: DataConnection, profile: Profile): void {
    this.connection = conn;
    if (this.peer)
      this.deadline(
        this.peer,
        30000,
        "Your friend could not finish connecting. Try a new room or another network.",
      );
    conn.on("open", () => {
      if (this.disposed || this.connection !== conn) return;
      this.connected = true;
      this.lastSeen = Date.now();
      clearTimeout(this.timeout);
      if (this.role === "guest") this.send({ kind: "join", profile });
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastSeen > 10000) {
          this.fail("Connection lost. Return to the menu to make a new room.");
          return;
        }
        this.send({ kind: "ping" });
      }, 1000);
    });
    conn.on("data", (raw) => {
      if (
        this.disposed ||
        this.connection !== conn ||
        !raw ||
        typeof raw !== "object"
      )
        return;
      this.lastSeen = Date.now();
      const m = raw as Record<string, unknown>;
      if (m.kind === "ping") {
        this.send({ kind: "pong" });
        return;
      }
      if (this.role === "host") {
        if (m.kind === "join" && !this.profiles && validProfile(m.profile)) {
          this.profiles = [
            profile,
            { name: m.profile.name.trim() || "Player 2", year: m.profile.year },
          ];
          this.send({ kind: "lobby", profiles: this.profiles });
          this.emit({ kind: "joined", profiles: this.profiles });
        } else if (
          m.kind === "action" &&
          this.started &&
          m.generation === this.generation &&
          validAction(m.action)
        ) {
          if (Date.now() - this.actionWindow > 1000) {
            this.actionWindow = Date.now();
            this.actionCount = 0;
          }
          if (++this.actionCount <= 80)
            this.emit({ kind: "action", action: m.action });
        } else if (m.kind === "rematch" && this.started)
          this.emit({ kind: "rematch" });
      } else {
        if (
          (m.kind === "lobby" || m.kind === "start") &&
          Array.isArray(m.profiles) &&
          m.profiles.length === 2 &&
          m.profiles.every(validProfile)
        ) {
          this.profiles = m.profiles as [Profile, Profile];
          if (m.kind === "start") {
            this.started = true;
            this.generation = Number(m.generation);
          }
          this.emit({
            kind: m.kind === "lobby" ? "joined" : "start",
            profiles: this.profiles,
          });
        } else if (
          m.kind === "view" &&
          this.started &&
          m.generation === this.generation &&
          m.view &&
          typeof m.view === "object"
        ) {
          this.emit({ kind: "view", view: m.view as View });
        } else if (m.kind === "error")
          this.fail(
            typeof m.text === "string" ? m.text : "Unable to join this room.",
          );
      }
    });
    conn.on("close", () => {
      if (this.connection === conn)
        this.fail(
          "Your friend disconnected. Return to the menu to play again.",
        );
    });
    conn.on("error", () => {
      if (this.connection === conn)
        this.fail("Connection lost. Return to the menu to try again.");
    });
  }

  start(): void {
    if (this.role !== "host" || !this.profiles || !this.connected) return;
    this.started = true;
    this.generation++;
    this.send({
      kind: "start",
      profiles: this.profiles,
      generation: this.generation,
    });
    this.emit({ kind: "start", profiles: this.profiles });
  }
  sendView(view: View): void {
    this.send({ kind: "view", view, generation: this.generation });
  }
  sendAction(action: Action): void {
    this.send({ kind: "action", action, generation: this.generation });
  }
  rematch(): void {
    this.send({ kind: "rematch" });
  }
  private send(data: unknown): void {
    if (this.connection?.open) this.connection.send(data);
  }
  private fail(text: string): void {
    if (this.disposed) return;
    this.close();
    this.emit({ kind: "lost", text });
  }
  close(): void {
    this.disposed = true;
    this.attempt++;
    this.lifetime?.abort();
    this.lifetime = undefined;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.expiryTimer);
    this.refreshPending = undefined;
    this.lease = undefined;
    this.connected = false;
    this.started = false;
    clearInterval(this.heartbeat);
    clearTimeout(this.timeout);
    this.connection?.close();
    this.peer?.destroy();
    this.connection = undefined;
    this.peer = undefined;
    this.profiles = undefined;
  }
}
