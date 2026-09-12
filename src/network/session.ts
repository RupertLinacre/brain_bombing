import Peer, { type DataConnection } from "peerjs";
import { YEARS, type Action, type Profile, type View } from "../game/types";

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
const PREFIX = "brain-bombs-2-v3-";
const validProfile = (p: unknown): p is Profile =>
  !!p &&
  typeof p === "object" &&
  typeof (p as Profile).name === "string" &&
  (p as Profile).name.length <= 20 &&
  YEARS.includes((p as Profile).year);
export function validAction(a: unknown): a is Action {
  if (!a || typeof a !== "object") return false;
  const v = a as Record<string, unknown>;
  if (v.type === "bomb" || v.type === "dismiss") return true;
  if (v.type === "move")
    return (
      v.direction === null ||
      ["up", "down", "left", "right"].includes(v.direction as string)
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
  constructor(private emit: (event: NetworkEvent) => void) {}

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
    this.emit({
      kind: "status",
      text: role === "host" ? "Opening your room…" : "Finding your friend…",
    });
    const turnUrl = import.meta.env.VITE_TURN_URL;
    const config = turnUrl
      ? {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            {
              urls: turnUrl,
              username: import.meta.env.VITE_TURN_USERNAME,
              credential: import.meta.env.VITE_TURN_CREDENTIAL,
            },
          ],
        }
      : undefined;
    const peer =
      role === "host"
        ? new Peer(PREFIX + this.code.toLowerCase(), {
            debug: 0,
            ...(config ? { config } : {}),
          })
        : new Peer({ debug: 0, ...(config ? { config } : {}) });
    this.peer = peer;
    peer.on("open", () => {
      if (this.disposed || this.peer !== peer) return;
      if (role === "host") {
        this.emit({ kind: "ready", code: this.code });
        this.emit({
          kind: "status",
          text: "Room ready. Waiting for your friend…",
        });
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
      if (this.peer === peer && !this.disposed && !this.connected)
        this.fail("The room service disconnected. Please try again.");
    });
    this.timeout = setTimeout(() => {
      if (
        this.peer === peer &&
        !this.connected &&
        (role === "guest" || !peer.id)
      )
        this.fail(
          "Connection timed out. Check the code and network, then try again.",
        );
    }, 18000);
  }

  private attach(conn: DataConnection, profile: Profile): void {
    this.connection = conn;
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
