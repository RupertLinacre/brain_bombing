# TURN fallback

Brain Bombs 2 reuses the existing `keep-it-going-relay` Worker. It requests fresh temporary credentials before creating either a host or guest PeerJS peer. ICE uses `iceTransportPolicy: "all"`, so a direct connection remains available and TURN is considered during the same connection attempt. The `brain-bombs-2-v8-` room namespace and gameplay protocol are unchanged.

The shared Worker is maintained in Keep it going's `tiny_tracks` repository (`infra/turn/worker.ts` and `infra/turn/wrangler.jsonc`). This project does not deploy or modify it. Its source was inspected before choosing the request contract, and the production endpoint was checked on 23 October 2026.

## Verified credential contract

- `POST https://keep-it-going-relay.robinlinacre.workers.dev/ice`, with no request body, cookies or Authorization header.
- Response: `{ iceServers: RTCIceServer[], expiresAt: number }`, where `expiresAt` is Unix time in milliseconds. The live response gave a 7,200-second lifetime and authenticated TURN servers.
- The Worker supports TURN over UDP, TCP and TLS, including TLS on port 443, and filters browser-blocked port 53.
- CORS permits `https://rupertlinacre.com`, `https://rupertlinacre.github.io`, `http://localhost:5198` and `http://127.0.0.1:5198`. The production game is served from `https://rupertlinacre.com/brain_bombing/`; its path does not require another origin entry. A live request with the production Origin returned HTTP 200 and the matching CORS header. Port 5182 was verified to return HTTP 403.
- The inspected Worker configuration limits credential requests to 120 per minute per IP using `CREDENTIAL_LIMIT`. HTTP 429 includes a 60-second retry window. The client waits at least that long even when CORS hides `Retry-After`.
- Responses use `Cache-Control: no-store`. The long-lived API token is an encrypted Worker secret and never reaches this app. No API token, Worker secret or real temporary credentials are committed or logged.

The origin allowlist is not authentication: non-browser clients can forge Origin. Its existing protections and the Realtime usage allowance are shared with Keep it going. The request limiter limits credential issuance, not relay bandwidth or spending. No shared Worker, plan, allowlist, quota or budget settings were changed for this integration.

## Lifecycle and failures

`src/network/relay.ts` validates bounded server lists, authenticated TURN entries, URLs and expiry. Its five-second deadline includes reading the response body. Cancellation and timeout abort the request; late results cannot create a peer for a cancelled or replaced room. Errors shown to players are fixed messages, never raw provider responses.

If initial credential loading fails, the lobby explains that it is trying a direct connection. The game retains STUN-based direct connectivity, but that degraded mode cannot promise a connection through a restrictive router. The client retries with backoff and respects the existing rate-limit window. A working TURN service does not replace PeerJS signalling; signalling outages, incompatible game releases and some firewall policies still need separate diagnosis.

Credentials refresh every thirty minutes, or sooner if necessary to leave a one-minute expiry margin. Renewal updates both future PeerJS connections and the existing RTCPeerConnection using `setConfiguration`, without restarting the game. Valid credentials remain available during a temporary renewal failure. If renewal never succeeds before expiry, the room closes with an explicit message instead of continuing with expired credentials. Returning to a visible tab also checks an overdue refresh. Closing/reopening a room aborts its credential request and clears all renewal/expiry timers; the next room always obtains fresh credentials.

An unconnected room gets one bounded signalling reconnect attempt, refreshing nearly expired credentials first. A data channel that opens while renewal is pending is kept alive. Initial signalling and the data-channel handshake have separate deadlines. Established data channels and rematches do not depend on a continuously working signalling socket.

## Local development

`npm run dev` now defaults to port **5198**, which is already allowed by the Worker. Use `http://localhost:5198/` or `http://127.0.0.1:5198/` for relay tests. A LAN-IP origin or a different port is not on the allowlist and will use the clearly reported direct-only fallback. For two physical networks, use the published HTTPS origin after deploying the change.

The only optional build setting is the public `VITE_TURN_ENDPOINT`; see `.env.example`. The old `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` settings are replaced by temporary credential fetching. Do not add a Cloudflare API token to a Vite environment file. Computer play never fetches relay credentials.

## Validation — 23 October 2026

`npm test` passes 104 tests. Network coverage includes host and guest configuration, cancellation and stale success/failure, response validation, body-read timeouts, backoff, long-room renewal, existing-PC updates, old refresh results after reopening, renewal failure through expiry, signalling reconnect races, signalling deadlines and handshake deadlines. The existing gameplay suite remains applicable.

Four real two-browser game sessions passed through PeerJS signalling on this Mac:

| Test | Broker responses | Selected path on both peers | Gameplay |
| --- | --- | --- | --- |
| Default automatic | 200 / 200 | Direct UDP, policy `all` | Answer rewarded, bomb synchronized |
| Forced TURN | 200 / 200 | Relay, relay transport UDP | Answer rewarded, bomb synchronized |
| TURN restricted to TLS-443 | 200 / 200 | Relay, `relayProtocol: tls` | Answer rewarded, bomb synchronized |
| Simulated broker outage | 503 / 503 | Direct UDP, policy `all`; lobby warning present | Answer rewarded, bomb synchronized |

Selected paths were verified using the connected RTCPeerConnection's nominated candidate pair, not just the existence of relay candidates. Every session used a desktop host and a touch-enabled guest; questions remained private and neither browser reported uncaught errors. Reports contain no addresses, invite codes or credentials. Forced policies were injected only into those temporary test contexts; production always uses `all` and has no relay-only query mode.

These are same-machine browser-context tests, not evidence from two physical networks. A Wi-Fi-to-cellular check is still needed to verify the original reported failure; absence of managed TURN was a plausible diagnosis, not a reproduced cause.

To repeat the browser checks with Vite running on port 5198, use Playwright CLI with the expression in `scripts/check-turn-browser.js`. For example, after opening a named CLI session:

```sh
playwright-cli --session=relay-check open http://localhost:5198/
playwright-cli --session=relay-check run-code "$(cat scripts/check-turn-browser.js)"
```

The script uses actual temporary credentials and a small amount of actual relay traffic, then closes both test contexts in each case. It is excluded from the production entry point.

Sources: [Cloudflare temporary credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [PeerJS RTC configuration](https://peerjs.com/client/api/peer).
