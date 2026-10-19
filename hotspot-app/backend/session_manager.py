import asyncio
import random
import time
import logging
from typing import Dict, Any, List, Optional
from .config import get_db_connection, get_settings
from .network_driver import network_driver

logger = logging.getLogger("hotspot.session")


class SessionManager:
    def __init__(self):
        self.current_pin: str = self._generate_pin()
        self.pin_generated_at: float = time.time()
        self._task: Optional[asyncio.Task] = None

    def _generate_pin(self) -> str:
        return f"{random.randint(1000, 9999)}"

    def rotate_pin_now(self) -> str:
        self.current_pin = self._generate_pin()
        self.pin_generated_at = time.time()
        logger.info("Rotated access PIN to: %s", self.current_pin)
        return self.current_pin

    def get_pin_info(self) -> Dict[str, Any]:
        settings = get_settings()
        interval_sec = max(60, int(settings.get("pin_rotation_minutes", 10)) * 60)
        now = time.time()
        elapsed = now - self.pin_generated_at
        if elapsed >= interval_sec:
            self.rotate_pin_now()
            elapsed = 0
        remaining = max(0, int(interval_sec - elapsed))
        return {
            "pin": self.current_pin,
            "remaining_seconds": remaining,
            "total_seconds": interval_sec,
            "rotation_minutes": int(settings.get("pin_rotation_minutes", 10)),
            "ssid": settings.get("ssid", "School_Event_Pay"),
            "wpa_passphrase": settings.get("wpa_passphrase", ""),
            "school_name": settings.get("school_name", "Event Fast-Pay Wireless"),
            "session_duration_minutes": int(settings.get("session_duration_minutes", 10)),
        }

    def seed_demo_clients_if_empty(self):
        settings = get_settings()
        if not settings.get("mock_network", True):
            return
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as cnt FROM clients")
        cnt = cursor.fetchone()["cnt"]
        if cnt == 0:
            now = time.time()
            dur = int(settings.get("session_duration_minutes", 10)) * 60
            demo_clients = [
                ("192.168.4.14", "A4:83:E7:2B:91:04", "Sarahs-iPhone", now - 240, now - 180, now - 180 + dur, "active", 0),
                ("192.168.4.22", "DC:A6:32:8F:11:C2", "Concession-POS-iPad", now - 1800, now - 1800, now + 86400, "whitelisted", 1),
                ("192.168.4.35", "70:85:C2:51:44:9A", "Pixel-8-Pro", now - 900, now - 850, now - 250, "expired", 0),
            ]
            for c in demo_clients:
                cursor.execute("""
                    INSERT OR IGNORE INTO clients
                    (ip, mac, hostname, first_seen, session_start, session_expires, status, always_on)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, c)
                if c[6] in ("active", "whitelisted"):
                    network_driver.authorize_client(c[0], settings)
            conn.commit()
        conn.close()

    def sync_dhcp_leases(self):
        settings = get_settings()
        leases = network_driver.read_dhcp_leases(settings)
        if not leases:
            return
        now = time.time()
        conn = get_db_connection()
        cursor = conn.cursor()
        for lease in leases:
            ip = lease["ip"]
            mac = lease["mac"]
            hostname = lease["hostname"]
            cursor.execute("SELECT ip, mac, hostname FROM clients WHERE ip = ?", (ip,))
            row = cursor.fetchone()
            if not row:
                cursor.execute("""
                    INSERT INTO clients (ip, mac, hostname, first_seen, session_start, session_expires, status, always_on)
                    VALUES (?, ?, ?, ?, 0, 0, 'unauthenticated', 0)
                """, (ip, mac, hostname, now))
            else:
                cursor.execute("""
                    UPDATE clients SET mac = ?, hostname = ? WHERE ip = ?
                """, (mac, hostname, ip))
        conn.commit()
        conn.close()

    def verify_and_authorize_client(self, client_ip: str, pin_submitted: str, hostname: str = "", mac: str = "") -> Dict[str, Any]:
        pin_info = self.get_pin_info()
        if pin_submitted.strip() != self.current_pin:
            return {"success": False, "error": "Invalid Access PIN. Please check the display screen for the current 4-digit code."}

        settings = get_settings()
        duration_sec = int(settings.get("session_duration_minutes", 10)) * 60
        now = time.time()
        expires = now + duration_sec

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clients WHERE ip = ?", (client_ip,))
        existing = cursor.fetchone()

        if existing:
            mac_val = mac or existing["mac"] or "02:42:AC:11:00:02"
            host_val = hostname or existing["hostname"] or f"Guest-{client_ip.split('.')[-1]}"
            always_on = existing["always_on"]
            status = "whitelisted" if always_on else "active"
            cursor.execute("""
                UPDATE clients
                SET mac = ?, hostname = ?, session_start = ?, session_expires = ?, status = ?
                WHERE ip = ?
            """, (mac_val, host_val, now, expires, status, client_ip))
        else:
            mac_val = mac or self._pseudo_mac_for_ip(client_ip)
            host_val = hostname or f"Guest-{client_ip.split('.')[-1]}"
            cursor.execute("""
                INSERT INTO clients (ip, mac, hostname, first_seen, session_start, session_expires, status, always_on)
                VALUES (?, ?, ?, ?, ?, ?, 'active', 0)
            """, (client_ip, mac_val, host_val, now, now, expires))

        conn.commit()
        conn.close()

        # Apply iptables FORWARD rule
        network_driver.authorize_client(client_ip, settings)

        return {
            "success": True,
            "ip": client_ip,
            "duration_minutes": int(settings.get("session_duration_minutes", 10)),
            "remaining_seconds": duration_sec,
            "expires_at": expires,
        }

    def _pseudo_mac_for_ip(self, ip: str) -> str:
        parts = ip.split(".")
        last = int(parts[-1]) if parts and parts[-1].isdigit() else 99
        return f"02:1A:2B:3C:4D:{last:02X}"

    def get_client_status(self, client_ip: str) -> Dict[str, Any]:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clients WHERE ip = ?", (client_ip,))
        row = cursor.fetchone()
        conn.close()
        now = time.time()
        settings = get_settings()

        if not row:
            return {
                "ip": client_ip,
                "authenticated": False,
                "status": "unauthenticated",
                "remaining_seconds": 0,
                "session_duration_minutes": int(settings.get("session_duration_minutes", 10)),
            }

        always_on = bool(row["always_on"])
        status = row["status"]
        rem = max(0, int(row["session_expires"] - now)) if status == "active" else 0
        if always_on:
            status = "whitelisted"
            rem = 999999

        return {
            "ip": row["ip"],
            "mac": row["mac"],
            "hostname": row["hostname"],
            "authenticated": status in ("active", "whitelisted") and (rem > 0 or always_on),
            "status": status,
            "always_on": always_on,
            "remaining_seconds": rem,
            "session_duration_minutes": int(settings.get("session_duration_minutes", 10)),
        }

    def get_all_clients(self) -> List[Dict[str, Any]]:
        self.sync_dhcp_leases()
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clients ORDER BY always_on DESC, session_expires DESC, first_seen DESC")
        rows = cursor.fetchall()
        conn.close()

        now = time.time()
        clients = []
        for r in rows:
            always_on = bool(r["always_on"])
            status = r["status"]
            if always_on:
                rem = -1  # Indicates Unlimited / Always-On
                status = "whitelisted"
            elif status == "active":
                rem = max(0, int(r["session_expires"] - now))
            else:
                rem = 0

            clients.append({
                "ip": r["ip"],
                "mac": r["mac"] or "UNKNOWN",
                "hostname": r["hostname"] or "Guest-Device",
                "first_seen": r["first_seen"],
                "session_start": r["session_start"],
                "session_expires": r["session_expires"],
                "remaining_seconds": rem,
                "status": status,
                "always_on": always_on,
            })
        return clients

    def get_authorized_ips(self) -> List[str]:
        conn = get_db_connection()
        cursor = conn.cursor()
        now = time.time()
        cursor.execute("""
            SELECT ip FROM clients
            WHERE always_on = 1 OR (status = 'active' AND session_expires > ?)
        """, (now,))
        ips = [r["ip"] for r in cursor.fetchall()]
        conn.close()
        return ips

    def revoke_client(self, client_ip: str) -> bool:
        settings = get_settings()
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE clients
            SET status = 'expired', always_on = 0, session_expires = 0
            WHERE ip = ?
        """, (client_ip,))
        conn.commit()
        conn.close()
        network_driver.revoke_client(client_ip, settings)
        return True

    def set_whitelist(self, client_ip: str, always_on: bool, hostname: str = "", mac: str = "") -> Dict[str, Any]:
        settings = get_settings()
        now = time.time()
        dur = int(settings.get("session_duration_minutes", 10)) * 60
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clients WHERE ip = ?", (client_ip,))
        row = cursor.fetchone()

        if always_on:
            if row:
                cursor.execute("""
                    UPDATE clients
                    SET always_on = 1, status = 'whitelisted'
                    WHERE ip = ?
                """, (client_ip,))
            else:
                cursor.execute("""
                    INSERT INTO clients (ip, mac, hostname, first_seen, session_start, session_expires, status, always_on)
                    VALUES (?, ?, ?, ?, ?, ?, 'whitelisted', 1)
                """, (client_ip, mac or self._pseudo_mac_for_ip(client_ip), hostname or "Staff-Device", now, now, now + dur))
            conn.commit()
            conn.close()
            network_driver.authorize_client(client_ip, settings)
        else:
            # Remove always_on and set to active for standard session window or expired
            if row:
                cursor.execute("""
                    UPDATE clients
                    SET always_on = 0, status = 'expired', session_expires = 0
                    WHERE ip = ?
                """, (client_ip,))
            conn.commit()
            conn.close()
            network_driver.revoke_client(client_ip, settings)

        return self.get_client_status(client_ip)

    async def enforcement_loop(self):
        logger.info("Started 5-second background session & PIN enforcement loop")
        while True:
            try:
                settings = get_settings()
                now = time.time()

                # 1. Check PIN rotation
                interval_sec = max(60, int(settings.get("pin_rotation_minutes", 10)) * 60)
                if now - self.pin_generated_at >= interval_sec:
                    self.rotate_pin_now()

                # 2. Check active sessions for expiration
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT ip, session_expires FROM clients
                    WHERE status = 'active' AND always_on = 0
                """)
                active_rows = cursor.fetchall()
                for row in active_rows:
                    if now > row["session_expires"]:
                        client_ip = row["ip"]
                        logger.info("Session expired for client %s; removing iptables FORWARD rule", client_ip)
                        network_driver.revoke_client(client_ip, settings)
                        cursor.execute("""
                            UPDATE clients SET status = 'expired' WHERE ip = ?
                        """, (client_ip,))
                conn.commit()
                conn.close()
            except Exception as exc:
                logger.exception("Error in enforcement_loop: %s", exc)

            await asyncio.sleep(5)

    def start_background_loop(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.enforcement_loop())


session_manager = SessionManager()
