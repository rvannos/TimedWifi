# AGENTS.md — AI Coding Agent Configuration & Project Guidelines

This file defines the architecture, conventions, operational guardrails, and development workflow for AI coding agents (Antigravity, Claude Code, Cursor, GitHub Copilot, etc.) working in the **Timed Hotspot Controller (`TimedWifi`)** repository.

---

## 1. Project Overview

`TimedWifi` is a local Ubuntu Linux web controller that provides temporary, PIN-authorized Wi-Fi internet sessions (default: 10 minutes) for event attendees completing mobile payments (Venmo, Cash App, Apple Pay, PayPal).

- **Backend:** Python 3 + FastAPI + Uvicorn + SQLite (`hotspot-app/backend/`)
- **Frontend:** Vanilla HTML5, CSS3, and ES6 JavaScript (`hotspot-app/frontend/`) — **No Node.js/Webpack/Vite build steps**. Static files and Jinja2 templates are served directly by FastAPI.
- **System Networking:** Managed via `subprocess` in `hotspot-app/backend/network_driver.py` (`dnsmasq`, `hostapd`, `iptables`, `ip`, `sysctl`, `tc`, `nmcli`, `rfkill`).

---

## 2. Core Architectural Invariants

When modifying or extending the codebase, preserve the following invariants:

1. **Three-Mode Hardware Topology Support:**
   - **Mode A (All-in-One):** `wlp*`/`wlan0` (or selected LAN interface) runs `hostapd` in AP mode + `dnsmasq`; WAN is wired or USB Ethernet (`enx*`/`eth0`).
   - **Mode B (Wi-Fi WAN + External Router AP):** Laptop joins venue Wi-Fi (`wlp*`/`wlan0` as WAN); USB Ethernet (`enx*`/`eth0` as LAN) connects to an external AP bridge router. `hostapd` **must remain disabled**; `dnsmasq` serves the LAN interface.
   - **Mode C (Ethernet WAN + External Router AP):** Built-in Ethernet (`eth0`/`enp*` as WAN); USB Ethernet (`enx*`/`eth1` as LAN) connects to an external AP bridge router. `hostapd` **must remain disabled**.
2. **Ubuntu `NetworkManager`, `AppArmor`, and `systemd-resolved` Compatibility:**
   - **NetworkManager Handoff:** `start_hotspot()` must run `/usr/bin/nmcli dev set <LAN_IFACE> managed no` before configuring `<gateway_ip>/24`, and `stop_hotspot()` must restore `/usr/bin/nmcli dev set <LAN_IFACE> managed yes`.
   - **Mode A `nl80211` AP Transition:** Starting `hostapd` resets the IP on the wireless interface; always re-assert `sudo /sbin/ip addr replace <gateway_ip>/24 dev <LAN_IFACE>` after `hostapd -B` starts.
   - **AppArmor Lease Path:** Ubuntu's `/usr/sbin/dnsmasq` AppArmor profile denies writing lease files in `/tmp/`. Always use `DNSMASQ_LEASES_PATH = "/var/lib/misc/dnsmasq.leases"` and `bind-dynamic` + `except-interface=lo` in `/tmp/dnsmasq_hotspot.conf`.
3. **Safe Dry-Run Mode (`mock_network` / `MOCK_NETWORK=true`):**
   - Never run destructive `iptables` or interface flush commands during automated tests or local UI previews when `mock_network` is `True`.
   - Every system command in `NetworkDriver` (`network_driver.py`) must pass through `self._run(..., mock=mock)` and log to `self.last_command_logs` for visibility in the `/admin` audit panel.
   - When `mock_network` is disabled (`False`), `session_manager.purge_mock_clients()` must purge all seeded demo/test clients so only real DHCP/portal clients appear in `/admin`.
4. **Firewall (`iptables`) Enforcement Rules:**
   - Default LAN forwarding policy blocks unauthenticated traffic and DNAT-redirects HTTP port 80 to `<gateway_ip>:8000` (`/portal`).
   - Authorizing a client inserts:
     - `sudo /sbin/iptables -I FORWARD 1 -s <CLIENT_IP> -j ACCEPT`
     - `sudo /sbin/iptables -t nat -I PREROUTING 1 -i <LAN_IFACE> -s <CLIENT_IP> -j ACCEPT`
   - Expiring or revoking a client removes:
     - `sudo /sbin/iptables -D FORWARD -s <CLIENT_IP> -j ACCEPT`
     - `sudo /sbin/iptables -t nat -D PREROUTING -i <LAN_IFACE> -s <CLIENT_IP> -j ACCEPT`
   - Clients marked `always_on = 1` ("Always-On / Staff Whitelist") must never be expired by the background enforcement loop.
5. **Background Enforcement Lifecycle (`session_manager.py`):**
   - `SessionManager.enforcement_loop()` runs every **5 seconds** as an `asyncio` background task started in FastAPI's `lifespan`.
   - It rotates the 4-digit numeric PIN when `now - pin_generated_at >= pin_rotation_minutes * 60` and revokes any active non-whitelisted client where `now > session_expires`.

---

## 3. UI & Design System Guidelines

- **Configurable Two-Color Theme (`primary_color` & `secondary_color`):**
  - Default Primary Deep Maroon: `#580f1a` (`--maroon-deep`)
  - Default Secondary Athletic Warm Gold: `#f2a900` (`--gold-primary`)
  - Lighter/darker card, border, and gradient shades in `frontend/static/css/styles.css` are derived dynamically using CSS `color-mix(in srgb, ...)` from `--maroon-deep` and `--gold-primary`.
  - High-contrast text: Cream/White (`#fdfaf5`)
- **Public Display (`/display` or `/`):**
  - Must remain readable from across a gymnasium or event hall (`6rem` tabular-numeral PIN display inside a `360px` SVG progress ring, high-contrast QR code, and clear 2-step instructions).
  - Keeps the screen awake silently via `navigator.wakeLock.request("screen")` and `systemd-inhibit` in `run.sh`.
- **Mobile Captive Portal (`/portal`):**
  - Must work inside restrictive iOS (`CaptiveNetworkSupport`) and Android (`CaptivePortalLogin`) captive portal webviews without external CDN dependencies.
  - Includes a **Done** button that triggers `/generate_204` / `http://connectivitycheck.gstatic.com/generate_204` (`HTTP 204`) after PIN authorization so Android and iOS immediately mark the Wi-Fi network as connected.

---

## 4. Development & Verification Commands

- **Start the Controller:**
  ```bash
  cd hotspot-app
  ./run.sh
  ```
- **Verify Endpoints via CLI:**
  ```bash
  curl -s http://127.0.0.1:8000/api/display-state
  curl -s http://127.0.0.1:8000/api/admin/overview -H "X-Admin-Password: admin"
  ```
- **Test Guest PIN Authentication:**
  ```bash
  PIN=$(curl -s http://127.0.0.1:8000/api/display-state | python3 -c "import sys,json; print(json.load(sys.stdin)['pin'])")
  curl -s -X POST http://127.0.0.1:8000/api/portal/authenticate \
    -H "Content-Type: application/json" \
    -d "{\"pin\":\"$PIN\",\"client_ip\":\"192.168.4.99\",\"hostname\":\"Test-Guest\"}"
  ```
