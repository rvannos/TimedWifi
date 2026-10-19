import os
import json
import sqlite3
from pathlib import Path
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "hotspot.db"

DEFAULT_SETTINGS = {
    "mode": "Mode A",  # "Mode A", "Mode B", "Mode C"
    "wan_iface": "enx3c18a0d3d673",
    "lan_iface": "wlp82s0",
    "ssid": "School_Event_Pay",
    "wpa_passphrase": "",  # Empty means Open network (captive portal handles PIN)
    "wifi_channel": 6,
    "session_duration_minutes": 10,
    "pin_rotation_minutes": 10,
    "bandwidth_limit_enabled": False,
    "bandwidth_limit_mbps": 5,
    "admin_password": "admin",
    "gateway_ip": "192.168.4.1",
    "dhcp_start": "192.168.4.10",
    "dhcp_end": "192.168.4.200",
    "school_name": "Event Fast-Pay Wireless",
    "mock_network": os.environ.get("MOCK_NETWORK", "true").lower() in ("true", "1", "yes"),
}


class SettingsModel(BaseModel):
    mode: str = "Mode A"
    wan_iface: str = "eth0"
    lan_iface: str = "wlan0"
    ssid: str = "School_Event_Pay"
    wpa_passphrase: str = ""
    wifi_channel: int = 6
    session_duration_minutes: int = 10
    pin_rotation_minutes: int = 10
    bandwidth_limit_enabled: bool = False
    bandwidth_limit_mbps: int = 5
    admin_password: str = "admin"
    gateway_ip: str = "192.168.4.1"
    dhcp_start: str = "192.168.4.10"
    dhcp_end: str = "192.168.4.200"
    school_name: str = "Event Fast-Pay Wireless"
    mock_network: bool = True


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS clients (
            ip TEXT PRIMARY KEY,
            mac TEXT,
            hostname TEXT,
            first_seen REAL,
            session_start REAL,
            session_expires REAL,
            status TEXT,
            always_on INTEGER DEFAULT 0
        )
    """)
    # Seed default settings if not present
    for k, v in DEFAULT_SETTINGS.items():
        cursor.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (k, json.dumps(v))
        )
    conn.commit()
    conn.close()


def get_settings() -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    result = dict(DEFAULT_SETTINGS)
    for row in rows:
        try:
            result[row["key"]] = json.loads(row["value"])
        except Exception:
            result[row["key"]] = row["value"]
    return result


def update_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    current = get_settings()
    for k, v in new_settings.items():
        if k in DEFAULT_SETTINGS:
            current[k] = v
            cursor.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (k, json.dumps(v))
            )
    conn.commit()
    conn.close()
    return current
