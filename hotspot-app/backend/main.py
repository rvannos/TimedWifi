import io
import logging
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import FastAPI, Request, HTTPException, Header, Depends
from fastapi.responses import HTMLResponse, RedirectResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .config import init_db, get_settings, update_settings
from .network_driver import network_driver
from .session_manager import session_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hotspot.main")

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "frontend" / "templates"
STATIC_DIR = BASE_DIR / "frontend" / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    settings = get_settings()
    session_manager.seed_demo_clients_if_empty()
    # Auto-start mock hotspot in dry-run mode so status pills look ready immediately
    if settings.get("mock_network", True):
        network_driver.start_hotspot(settings, session_manager.get_authorized_ips())
    session_manager.start_background_loop()
    yield


app = FastAPI(
    title="School Event Timed Hotspot Controller",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def get_client_ip(request: Request) -> str:
    # Allow simulated client IP override via query or header for testing
    override_ip = request.query_params.get("client_ip") or request.headers.get("X-Client-IP")
    if override_ip:
        return override_ip
    if request.client and request.client.host:
        host = request.client.host
        if host in ("127.0.0.1", "::1", "localhost"):
            return "192.168.4.55"
        return host
    return "192.168.4.55"


def verify_admin(request: Request, x_admin_password: Optional[str] = Header(default=None)):
    settings = get_settings()
    expected = settings.get("admin_password", "admin")
    provided = x_admin_password or request.cookies.get("admin_token")
    if provided != expected:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid admin password")
    return True


# ---------------------------------------------------------
# HTML Page Routes
# ---------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
@app.get("/display", response_class=HTMLResponse)
async def display_page(request: Request):
    settings = get_settings()
    pin_info = session_manager.get_pin_info()
    return templates.TemplateResponse(
        request,
        "display.html",
        {"settings": settings, "pin_info": pin_info},
    )


@app.get("/portal", response_class=HTMLResponse)
async def portal_page(request: Request):
    settings = get_settings()
    client_ip = get_client_ip(request)
    client_status = session_manager.get_client_status(client_ip)
    return templates.TemplateResponse(
        request,
        "portal.html",
        {
            "settings": settings,
            "client_ip": client_ip,
            "client_status": client_status,
        },
    )


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    settings = get_settings()
    return templates.TemplateResponse(
        request,
        "admin.html",
        {"settings": settings},
    )


# OS Captive Portal Detection Endpoints (iOS, Android, Windows, macOS)
@app.get("/generate_204")
@app.get("/gen_204")
@app.get("/hotspot-detect.html")
@app.get("/library/test/success.html")
@app.get("/ncsi.txt")
@app.get("/connecttest.txt")
@app.get("/redirect")
async def captive_portal_probe(request: Request):
    client_ip = get_client_ip(request)
    status = session_manager.get_client_status(client_ip)
    if status.get("authenticated"):
        if "204" in request.url.path:
            return Response(status_code=204)
        return HTMLResponse("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>")
    return RedirectResponse(url="/portal", status_code=302)


# ---------------------------------------------------------
# Public & Portal API Routes
# ---------------------------------------------------------

@app.get("/api/display-state")
async def api_display_state():
    pin_info = session_manager.get_pin_info()
    settings = get_settings()
    service = network_driver.get_service_status(settings)
    return {
        **pin_info,
        "mode": settings.get("mode", "Mode A"),
        "hotspot_active": service.get("hotspot_active", False),
        "mock_network": settings.get("mock_network", True),
    }


@app.get("/api/qr.svg")
async def api_wifi_qr():
    settings = get_settings()
    ssid = settings.get("ssid", "School_Event_Pay")
    wpa = settings.get("wpa_passphrase", "").strip()
    if wpa:
        wifi_payload = f"WIFI:T:WPA;S:{ssid};P:{wpa};;"
    else:
        wifi_payload = f"WIFI:T:nopass;S:{ssid};;"

    # First try system qrencode if installed, otherwise use python qrcode SVG generator
    try:
        res = subprocess.run(
            ["qrencode", "-t", "SVG", "-m", "1", "-o", "-", wifi_payload],
            capture_output=True,
            timeout=3,
        )
        if res.returncode == 0 and res.stdout:
            return Response(content=res.stdout, media_type="image/svg+xml")
    except Exception:
        pass

    import qrcode
    import qrcode.image.svg
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(wifi_payload)
    qr.make(fit=True)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")


class PortalAuthRequest(BaseModel):
    pin: str
    client_ip: Optional[str] = None
    hostname: Optional[str] = None


@app.post("/api/portal/authenticate")
async def api_portal_authenticate(payload: PortalAuthRequest, request: Request):
    client_ip = payload.client_ip or get_client_ip(request)
    result = session_manager.verify_and_authorize_client(
        client_ip=client_ip,
        pin_submitted=payload.pin,
        hostname=payload.hostname or "",
    )
    if not result["success"]:
        return JSONResponse(status_code=400, content=result)
    return result


@app.get("/api/portal/status")
async def api_portal_status(request: Request):
    client_ip = get_client_ip(request)
    return session_manager.get_client_status(client_ip)


# ---------------------------------------------------------
# Admin API Routes
# ---------------------------------------------------------

class AdminLoginRequest(BaseModel):
    password: str


@app.post("/api/admin/login")
async def api_admin_login(payload: AdminLoginRequest, response: Response):
    settings = get_settings()
    if payload.password != settings.get("admin_password", "admin"):
        raise HTTPException(status_code=401, detail="Invalid admin password")
    response.set_cookie(key="admin_token", value=payload.password, httponly=False, samesite="lax")
    return {"success": True}


@app.get("/api/admin/overview")
async def api_admin_overview(_: bool = Depends(verify_admin)):
    settings = get_settings()
    clients = session_manager.get_all_clients()
    service = network_driver.get_service_status(settings)
    pin_info = session_manager.get_pin_info()
    interfaces = network_driver.detect_interfaces()
    return {
        "settings": settings,
        "clients": clients,
        "service": service,
        "pin_info": pin_info,
        "interfaces": interfaces,
    }


@app.post("/api/admin/settings")
async def api_admin_update_settings(new_settings: Dict[str, Any], _: bool = Depends(verify_admin)):
    updated = update_settings(new_settings)
    # Apply live bandwidth rule or config updates if hotspot is active
    if network_driver.hotspot_active:
        network_driver.generate_dnsmasq_conf(updated)
        if updated.get("mode") == "Mode A":
            network_driver.generate_hostapd_conf(updated)
        network_driver.apply_bandwidth_limit(updated)
    return {"success": True, "settings": updated}


@app.post("/api/admin/rotate-pin")
async def api_admin_rotate_pin(_: bool = Depends(verify_admin)):
    new_pin = session_manager.rotate_pin_now()
    return {"success": True, "pin_info": session_manager.get_pin_info()}


class ClientActionRequest(BaseModel):
    ip: str
    always_on: Optional[bool] = False
    hostname: Optional[str] = ""
    mac: Optional[str] = ""


@app.post("/api/admin/clients/revoke")
async def api_admin_revoke_client(payload: ClientActionRequest, _: bool = Depends(verify_admin)):
    session_manager.revoke_client(payload.ip)
    return {"success": True, "clients": session_manager.get_all_clients()}


@app.post("/api/admin/clients/whitelist")
async def api_admin_whitelist_client(payload: ClientActionRequest, _: bool = Depends(verify_admin)):
    session_manager.set_whitelist(
        client_ip=payload.ip,
        always_on=bool(payload.always_on),
        hostname=payload.hostname or "",
        mac=payload.mac or "",
    )
    return {"success": True, "clients": session_manager.get_all_clients()}


class ServiceControlRequest(BaseModel):
    action: str  # "start", "stop", "restart"


@app.post("/api/admin/service")
async def api_admin_service_control(payload: ServiceControlRequest, _: bool = Depends(verify_admin)):
    settings = get_settings()
    action = payload.action.lower()
    if action == "start":
        status = network_driver.start_hotspot(settings, session_manager.get_authorized_ips())
    elif action == "stop":
        status = network_driver.stop_hotspot(settings)
    elif action == "restart":
        network_driver.stop_hotspot(settings)
        status = network_driver.start_hotspot(settings, session_manager.get_authorized_ips())
    else:
        raise HTTPException(status_code=400, detail="Unknown service action")
    return {"success": True, "service": status}
