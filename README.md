# Timed Hotspot Controller (`TimedWifi`)

A full-stack local web application (**Python FastAPI** backend + **Vanilla JS/HTML/CSS** frontend) for Ubuntu Linux that manages a temporary, timed guest payment Wi-Fi hotspot so event attendees can complete mobile transactions (Venmo, Cash App, Apple Pay, PayPal) with minimal bandwidth abuse.

---

## Core Network Topologies

Configurable live via the `/admin` dashboard without changing code:

| Mode | Description | WAN (Upstream) | LAN / Hotspot | `hostapd` | `dnsmasq` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Mode A** | **All-in-One Internal AP:** Laptop built-in Wi-Fi (`wlp82s0`/`wlan0`) broadcasts the hotspot; wired or USB Ethernet (`enx*`/`eth0`) provides upstream internet. | `enx*` / `eth0` | `wlp*` / `wlan0` | Enabled (`/tmp/hostapd.conf`) | Enabled (`/tmp/dnsmasq_hotspot.conf`) |
| **Mode B** | **Wi-Fi WAN + External Router AP:** Laptop joins venue Wi-Fi for internet; USB Ethernet (`enx*`/`eth0`) connects to an external router in AP bridge mode. | `wlp*` / `wlan0` | `enx*` / `eth0` | Disabled | Enabled on LAN |
| **Mode C** | **Ethernet WAN + External Router AP:** Built-in Ethernet provides internet; USB Ethernet connects to an external router in AP bridge mode. | `eth0` / `enp*` | `enx*` / `eth1` | Disabled | Enabled on LAN |

---

## Complete Laptop Setup Guide (Single or Multi-Laptop Event Deployment)

Follow these steps to provision a fresh Ubuntu 24.04+ laptop from scratch in under 5 minutes.

### Step 1: Install Ubuntu System Packages

```bash
sudo apt update
sudo apt install -y git python3 python3-pip python3-venv dnsmasq-base hostapd iptables iw net-tools qrencode

# Ensure any default system-wide hostapd/dnsmasq services are stopped & disabled
# so the TimedWifi controller can manage them dynamically:
sudo systemctl stop hostapd dnsmasq 2>/dev/null || true
sudo systemctl disable hostapd dnsmasq 2>/dev/null || true
```

### Step 2: Configure Passwordless `sudo` for Network Tools

Create `/etc/sudoers.d/hotspot-manager`:

```bash
sudo visudo -f /etc/sudoers.d/hotspot-manager
```

Add this single line (replace `<username>` with the Ubuntu account username on that laptop, e.g., `ryan`):

```text
<username> ALL=(ALL) NOPASSWD: /usr/sbin/iptables, /sbin/iptables, /usr/sbin/hostapd, /usr/sbin/dnsmasq, /bin/systemctl, /usr/bin/systemctl, /usr/bin/pkill, /usr/sbin/ip, /sbin/ip, /usr/sbin/sysctl, /sbin/sysctl, /usr/sbin/tc
```

### Step 3: Clone the Repository & Launch

```bash
git clone https://github.com/rvannos/TimedWifi.git
cd TimedWifi/hotspot-app
chmod +x run.sh

# Launch the controller (creates .venv and installs requirements automatically):
./run.sh
```

> **Note on Screen Sleep / Power Saving:**
> `run.sh` automatically wraps the server in `systemd-inhibit --what=idle:sleep:handle-lid-switch`, and the `/display` page uses the browser **Screen Wake Lock API** silently in the background so the laptop display will never dim or lock while showing the QR code and PIN.

---

## Running Two Laptops Simultaneously at an Event

If you deploy **2 laptops** at the same event (e.g., **Concessions / Admissions Gate A** and **Merch / Gate B**):

1. **Use Distinct SSIDs per Station (Recommended):**
   - In `/admin` on **Laptop 1**, set SSID to e.g. `Event_FastPay_1` (or `Concessions_Pay_WiFi`).
   - In `/admin` on **Laptop 2**, set SSID to e.g. `Event_FastPay_2` (or `TicketGate_Pay_WiFi`).
   - Because the QR code on `/display` dynamically encodes that laptop's configured SSID, guests simply scan the screen in front of them and enter the 4-digit PIN shown on that same screen.
2. **Avoid Wi-Fi Channel Overlap (Mode A):**
   - Each laptop runs an independent `192.168.4.1/24` NAT subnet behind its own WAN connection, so IP ranges will **not** conflict between the two laptops.
   - If the two laptops are physically near each other, select different **Wi-Fi Channels** in `/admin` under **Panel 2** (e.g., `Ch 1` on Laptop 1, `Ch 6` or `Ch 11` on Laptop 2) to prevent 2.4 GHz radio interference.

---

## External Router AP Bridge Setup (For Mode B & Mode C)

If you use an external Wi-Fi router connected via USB Ethernet (`enx*`) in **Mode B** or **Mode C**:
1. Set the external router to **Access Point (AP) Bridge Mode** (or disable its built-in DHCP server and plug the laptop's USB Ethernet cable into one of the router's **LAN** ports, *not* its WAN/Internet port).
2. Set the external router's Wi-Fi SSID to match the **Wi-Fi SSID Name** configured in `/admin` (so the QR code on `/display` joins the external router's Wi-Fi).
3. `TimedWifi` will automatically assign `192.168.4.1/24` to the USB Ethernet adapter and serve DHCP (`192.168.4.10–200`) and Captive Portal DNS/HTTP redirection to all wireless clients joining that external router.

---

## Web Interfaces & Operations

1. **Public Display Screen (`http://localhost:8000/display` or `/`):**
   - Faced toward attendees (click **`⛶ Fullscreen`** in the top bar or press `F11` for kiosk view).
   - Displays the 2-step instructions, dynamic Wi-Fi QR code (`/api/qr.svg`), and the 72pt+ 4-digit rotating PIN inside a circular countdown progress ring.
2. **Mobile Captive Portal (`http://localhost:8000/portal`):**
   - Automatically pops up on iOS and Android devices when joining the Wi-Fi (intercepts `/hotspot-detect.html`, `/generate_204`, `/ncsi.txt`, etc.).
   - Prompts the guest for the 4-digit PIN, inserts `sudo /sbin/iptables -I FORWARD 1 -s <CLIENT_IP> -j ACCEPT`, and provides a **Done** button that triggers Android/iOS captive portal `204` completion so the phone immediately marks the Wi-Fi as connected.
3. **Admin & Operations Dashboard (`http://localhost:8000/admin`):**
   - Protected by the Admin Password (default: `admin`; configurable under **Panel 3 -> Admin Dashboard Password**; lockable via **Lock Admin** in the top bar).
   - **Topology & Interfaces (Panel 1):** Switch between **Mode A**, **Mode B**, and **Mode C** and select your detected WAN (`enx*` USB Ethernet, `wlp*` Wi-Fi) and LAN interfaces.
   - **Dry-Run Mock Mode Toggle (Panel 1):** When checked, simulates `iptables`/`hostapd`/`dnsmasq` and seeds sample test devices. Unchecking **Dry-Run Mock Mode** and saving automatically purges all mock/test devices and switches to live hardware enforcement.
   - **Theme Colors & Timers (Panel 2):** Customize the Event Header Title, Wi-Fi SSID, **Primary & Secondary Theme Colors** (defaults to Deep Maroon `#580f1a` & Athletic Warm Gold `#f2a900`), Guest Session Duration (3–30 min), and PIN Rotation Interval.
   - **Live Connected Clients & Whitelist:** Revoke/disconnect active guests or toggle **Always-On / Staff Whitelist** for POS iPads and staff devices.

---

## Troubleshooting & Event Recovery

- **Restoring Normal Laptop Wi-Fi After the Event:**
  Click **⏹ Stop Hotspot** in `/admin` (which flushes `192.168.4.1` and runs `nmcli dev set <LAN_IFACE> managed yes` to hand the Wi-Fi card back to Ubuntu NetworkManager). If the app was closed without stopping, run:
  ```bash
  sudo pkill -f /tmp/hostapd.conf
  sudo pkill -f /tmp/dnsmasq_hotspot.conf
  nmcli dev set wlp82s0 managed yes
  ```
- **Resetting Settings or Forgotten Admin Password:**
  All settings and client sessions are stored in `hotspot-app/data/hotspot.db`. Deleting that file (`rm hotspot-app/data/hotspot.db`) and restarting `./run.sh` resets all settings and the admin password back to `admin`.
