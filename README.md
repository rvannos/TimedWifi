# School Event Timed Hotspot Controller (`TimedWifi`)

A full-stack local web application (**Python FastAPI** backend + **Vanilla JS/HTML/CSS** frontend) for Ubuntu Linux that manages a temporary, timed guest payment Wi-Fi hotspot so event attendees can complete mobile transactions (Venmo, Cash App, Apple Pay, PayPal) with minimal bandwidth abuse.

---

## Core Network Topologies

Configurable live via the `/admin` dashboard without changing code:

| Mode | Description | WAN (Upstream) | LAN / Hotspot | `hostapd` | `dnsmasq` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Mode A** | **All-in-One Internal AP:** Laptop built-in Wi-Fi broadcasts the hotspot; wired Ethernet provides upstream internet. | `eth0` | `wlan0` | Enabled (`/tmp/hostapd.conf`) | Enabled (`/tmp/dnsmasq_hotspot.conf`) |
| **Mode B** | **Wi-Fi WAN + External Router AP:** Laptop joins venue Wi-Fi for internet; USB Ethernet connects to an external router in AP bridge mode. | `wlan0` | `eth0` | Disabled | Enabled on `eth0` |
| **Mode C** | **Ethernet WAN + External Router AP:** Built-in Ethernet provides internet; USB Ethernet connects to an external router in AP bridge mode. | `eth0` | `eth1` | Disabled | Enabled on `eth1` |

---

## Project Layout

```text
EventWifi/
├── README.md                  # Project overview, setup, and operations guide
├── AGENTS.md                  # AI Coding Agent instructions & architecture reference
├── .gitignore                 # Excludes .venv, __pycache__, and runtime SQLite DB
└── hotspot-app/
    ├── requirements.txt       # Python dependencies (FastAPI, Uvicorn, Jinja2, qrcode)
    ├── run.sh                 # Startup launcher (supports MOCK_NETWORK=true/false)
    ├── backend/
    │   ├── main.py            # FastAPI routes (/display, /portal, /admin, /api/*)
    │   ├── config.py          # SQLite persistence for settings & client leases
    │   ├── session_manager.py # 4-digit PIN rotation, auth & 5s expiration loop
    │   └── network_driver.py  # Subprocess wrappers for iptables, dnsmasq, hostapd, tc
    └── frontend/
        ├── templates/
        │   ├── display.html   # Maroon & Gold TV/monitor public PIN & QR screen
        │   ├── portal.html    # Mobile-first captive portal splash screen
        │   └── admin.html     # Protected Admin & Operations dashboard
        └── static/
            ├── css/styles.css # Hosting school Deep Maroon & Athletic Warm Gold theme
            └── js/
                ├── display.js # Live PIN sync, SVG progress ring & QR refresh
                ├── portal.js  # Captive portal PIN submission & session countdown
                └── admin.js   # Topology switcher, client controls & daemon status
```

---

## Step 1: Ubuntu 24.04 LTS Prerequisites

Install the required system networking tools and Python packages:

```bash
sudo apt update
sudo apt install -y git python3 python3-pip python3-venv dnsmasq hostapd iptables iw net-tools qrencode

# Disable default system-wide daemons so the controller can spawn them on demand with /tmp configs:
sudo systemctl stop dnsmasq hostapd 2>/dev/null || true
sudo systemctl disable dnsmasq hostapd 2>/dev/null || true
```

Grant your Ubuntu user passwordless `sudo` execution for the networking utilities invoked by [network_driver.py](hotspot-app/backend/network_driver.py):

```bash
sudo visudo -f /etc/sudoers.d/hotspot-manager
```

Add the following line (replace `<username>` with your Ubuntu account name, e.g., `ryan`):

```text
<username> ALL=(ALL) NOPASSWD: /sbin/iptables, /usr/sbin/hostapd, /usr/sbin/dnsmasq, /bin/systemctl, /usr/bin/pkill, /sbin/ip, /sbin/sysctl, /usr/sbin/tc
```

---

## Step 2: Running the Application

### Dry-Run / Mock Preview Mode (Default)
Simulates all `iptables`, `dnsmasq`, `hostapd`, and `tc` commands safely so you can test the UI and session timers on any machine without altering host networking:

```bash
cd hotspot-app
chmod +x run.sh
MOCK_NETWORK=true ./run.sh
```

### Live Production Mode
Executes real `iptables`, `dnsmasq`, `hostapd`, and `ip` commands on the configured interfaces:

```bash
cd hotspot-app
MOCK_NETWORK=false ./run.sh
```
*(You can also toggle **Dry-Run Mock Mode** directly inside the `/admin` web interface.)*

---

## Step 3: Web Interfaces

1. **Public Display Screen (`http://localhost:8000/display` or `/`):**
   - Designed for a projector or monitor facing event attendees.
   - Displays the dynamic Wi-Fi SSID, camera-scannable Wi-Fi QR code (`/api/qr.svg`), and the 72pt+ 4-digit rotating PIN with a live countdown ring.
2. **Mobile Captive Portal (`http://localhost:8000/portal`):**
   - Automatically pops up on iOS and Android devices when joining the Wi-Fi (handles `/hotspot-detect.html`, `/generate_204`, `/ncsi.txt`, etc.).
   - Prompts the guest for the current 4-digit PIN and grants temporary `iptables` forwarding access (`-I FORWARD 1 -s <CLIENT_IP> -j ACCEPT`).
3. **Admin & Operations Dashboard (`http://localhost:8000/admin`):**
   - Default password: `admin`
   - Switch between **Mode A**, **Mode B**, and **Mode C** and select WAN/LAN interfaces.
   - Adjust Guest Session Duration (3–30 minutes) and PIN Rotation Interval.
   - View live connected clients, revoke/disconnect sessions (`-D FORWARD -s <CLIENT_IP> -j ACCEPT`), or toggle **Always-On / Staff Whitelist** for POS terminals.
