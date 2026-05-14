# Running LocalRDP Over the Internet (Cloudflare)

This is a **roadmap, not a finished feature.** Today the app only works on a LAN.
Making it work over the internet through your Cloudflare domain needs three things,
in order:

1. A code change (turn the app into a relay hub)
2. Cloudflare Tunnel on the PC that will host the server
3. Authentication so random users can't get in

---

## Why it doesn't work over the internet today

The current design is LAN-only because of three hard blockers:

1. **UDP broadcast discovery (port 7421)** — agents announce themselves by LAN
   broadcast. Broadcasts do not cross the internet, so discovery breaks entirely.
2. **The dashboard connects directly to each agent** at `http://<agent-ip>:7420`.
   Over the internet that IP is a private NAT address — unreachable.
3. **Cloudflare's free plan only proxies HTTP/HTTPS/WebSocket** to a single origin.
   It cannot proxy arbitrary TCP/UDP. So everything must funnel through one
   HTTPS endpoint.

You cannot fix this with Cloudflare settings alone — the app has to change.

---

## The architecture change: "relay hub"

Instead of dashboard → agent direct connections, everything goes through the
Mother System server, which becomes the single public origin:

```
  Agent PCs                 Mother System server              Operator
 (behind NAT)               (one public origin)              (dashboard)
     |                              |                            |
     |  --- dials OUT (wss) --->    |   <--- connects (wss) ---   |
     |                              |                            |
     |   <==== server relays screen frames + control events ===> |
```

Key points:

- **Agents dial OUT** to the server (they become socket.io *clients*, not
  servers). Because the connection is outbound, NAT is no longer a problem.
- **Agents self-register** on connect (name, OS, etc.) — this fully replaces
  UDP broadcast discovery.
- **The server relays**: screen frames agent→server→dashboard, and control /
  file events dashboard→server→agent. Use one socket.io "room" per agent.
- **The dashboard only talks to the hub** — no more direct agent connections.

### Files that change

| File | Change |
|------|--------|
| `client/agent.py` | Remove the socket.io *server* + UDP broadcast. Make it a socket.io *client* that connects to `SERVER_URL`, authenticates, registers itself, and handles relayed events. Needs a configurable server URL + an enrollment token. |
| `server/index.js` | Becomes the relay hub: accept agent connections and dashboard connections, verify auth, keep a room per agent, forward events between them. Add login routes + JWT. |
| `dashboard/src/App.jsx` | Add a login screen. Connect only to the hub. Get the agent list from the hub (not UDP). Send/receive screen + control events via the hub. |
| New: server config | `SERVER_URL`, JWT secret, agent enrollment secret, operator credentials — via environment variables or a config file. |
| `.github/workflows/release.yml` | Let the agent build bake in (or read at install time) the `SERVER_URL` so installed agents know where to dial. |

> Tip: keep LAN mode working too — let the agent fall back to its current
> local server + UDP behavior if no `SERVER_URL` is configured.

---

## Step 2 — Expose the server with Cloudflare Tunnel

Do this on the **PC that will run the Mother System server** (your "other PC").
Cloudflare Tunnel is the right choice on the free plan: **no open ports, no
static IP** — the PC dials out to Cloudflare.

Prerequisites: a domain already added to your Cloudflare account.

1. **Install cloudflared** on that PC
   - Windows: download `cloudflared.exe` from Cloudflare, or `winget install --id Cloudflare.cloudflared`.

2. **Log in** (opens a browser to authorize the domain):
   ```
   cloudflared tunnel login
   ```

3. **Create a tunnel** (pick any name):
   ```
   cloudflared tunnel create localrdp
   ```
   This saves a credentials JSON file and prints a tunnel ID.

4. **Route a hostname to the tunnel** — e.g. `rdp.yourdomain.com`:
   ```
   cloudflared tunnel route dns localrdp rdp.yourdomain.com
   ```

5. **Create the config file** (`%USERPROFILE%\.cloudflared\config.yml` on Windows):
   ```yaml
   tunnel: localrdp
   credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

   ingress:
     - hostname: rdp.yourdomain.com
       service: http://localhost:7420
     - service: http_status:404
   ```

6. **Run it** (and install as a service so it auto-starts):
   ```
   cloudflared tunnel run localrdp
   cloudflared service install        REM run-as-service, survives reboot
   ```

Now `https://rdp.yourdomain.com` reaches your local server on port 7420, with
Cloudflare's HTTPS in front. Point the agents' `SERVER_URL` at
`https://rdp.yourdomain.com`.

---

## Step 3 — Authentication (so it can't be bypassed)

There are **two separate trust boundaries** — secure both.

### A. Agent ↔ server (stop fake agents)
Every agent must prove it's a real, enrolled client. Otherwise a stranger could
register a fake "client" and an operator might end up controlling the wrong PC.
- Give each agent an **enrollment token** (a long random secret).
- The agent sends it in the socket.io connection handshake (`auth` payload).
- The server rejects any agent connection without a valid token.

### B. Operator ↔ server (stop random users)
- **App login**: username + password hashed with **argon2** (or bcrypt), plus
  **TOTP 2FA** (Google Authenticator style). On success, issue a short-lived
  **JWT**; the dashboard's socket handshake must present a valid JWT.
- **Strongly recommended on top — Cloudflare Access** (free for up to 50 users):
  it forces a login (Google / GitHub / email OTP) **at Cloudflare's edge**,
  before any request reaches your server. Combined with Tunnel (your origin is
  never publicly exposed), this is the real "random user can't get in"
  guarantee. Set it up in the Cloudflare Zero Trust dashboard as an
  "Application" covering `rdp.yourdomain.com`.

### Recommended layering
```
Internet user
   │
   ▼  Cloudflare Access  ── must pass edge login first
   │
   ▼  Cloudflare Tunnel  ── origin not publicly reachable any other way
   │
   ▼  App login + TOTP   ── JWT required on the socket connection
   │
   ▼  Mother System server
        ▲
        │  agents must present a valid enrollment token
   Agent PCs
```

---

## Setup checklist (when you're ready)

- [ ] Re-architect to the relay hub (agent dials out, server relays, dashboard via hub)
- [ ] Make `SERVER_URL` + tokens configurable in the agent
- [ ] Add login + JWT + agent-token verification to the server
- [ ] Add the login screen to the dashboard
- [ ] Install `cloudflared` on the host PC and create the tunnel
- [ ] Route `rdp.yourdomain.com` → `http://localhost:7420`
- [ ] Install cloudflared as a service so it survives reboot
- [ ] Turn on Cloudflare Access for the hostname
- [ ] Point agent builds at `https://rdp.yourdomain.com`
- [ ] Keep a LAN fallback so the app still works with no internet

---

## Notes / gotchas

- **WebSockets**: Cloudflare proxies WebSockets on the free plan — socket.io
  works fine through the tunnel. No special setting needed.
- **Frame size**: relaying screen JPEGs through one server uses real bandwidth.
  The dashboard's quality presets (Clear / Balanced / Low Latency) matter even
  more over the internet — default to Balanced or Low Latency for remote links.
- **Don't expose port 7420 directly** to the internet once the tunnel is up;
  let Cloudflare be the only way in.
- **Secrets**: keep JWT secret, agent enrollment secret, and operator passwords
  out of git — use environment variables or an untracked config file.
