(function () {
  let adminToken = sessionStorage.getItem("hotspot_admin_token") || "admin";
  let formInitialized = false;

  const loginGate = document.getElementById("admin-login-gate");
  const dashboard = document.getElementById("admin-dashboard");
  const loginForm = document.getElementById("admin-login-form");
  const passInput = document.getElementById("admin-password-input");
  const loginError = document.getElementById("admin-login-error");
  const logoutBtn = document.getElementById("logout-btn");

  const cfgMode = document.getElementById("cfg-mode");
  const cfgWan = document.getElementById("cfg-wan-iface");
  const cfgLan = document.getElementById("cfg-lan-iface");
  const cfgMock = document.getElementById("cfg-mock-network");
  const cfgSchoolName = document.getElementById("cfg-school-name");
  const cfgSsid = document.getElementById("cfg-ssid");
  const cfgSessionDur = document.getElementById("cfg-session-duration");
  const lblSessionDur = document.getElementById("lbl-session-duration");
  const cfgPinRot = document.getElementById("cfg-pin-rotation");
  const lblPinRot = document.getElementById("lbl-pin-rotation");
  const cfgBwEnabled = document.getElementById("cfg-bw-enabled");
  const cfgBwMbps = document.getElementById("cfg-bw-mbps");
  const cfgWpaPass = document.getElementById("cfg-wpa-pass");
  const cfgAdminPass = document.getElementById("cfg-admin-pass");
  const cfgPrimaryColor = document.getElementById("cfg-primary-color");
  const lblPrimaryColor = document.getElementById("lbl-primary-color");
  const cfgSecondaryColor = document.getElementById("cfg-secondary-color");
  const lblSecondaryColor = document.getElementById("lbl-secondary-color");
  const resetColorsBtn = document.getElementById("reset-colors-btn");
  const topologyHelper = document.getElementById("topology-helper-text");

  function applyThemeColors(primary, secondary) {
    if (primary) {
      document.documentElement.style.setProperty("--maroon-deep", primary);
      if (lblPrimaryColor) lblPrimaryColor.textContent = primary;
      if (cfgPrimaryColor) cfgPrimaryColor.value = primary;
    }
    if (secondary) {
      document.documentElement.style.setProperty("--gold-primary", secondary);
      if (lblSecondaryColor) lblSecondaryColor.textContent = secondary;
      if (cfgSecondaryColor) cfgSecondaryColor.value = secondary;
    }
  }

  if (cfgPrimaryColor) {
    cfgPrimaryColor.addEventListener("input", () => {
      applyThemeColors(cfgPrimaryColor.value, null);
    });
  }

  if (cfgSecondaryColor) {
    cfgSecondaryColor.addEventListener("input", () => {
      applyThemeColors(null, cfgSecondaryColor.value);
    });
  }

  if (resetColorsBtn) {
    resetColorsBtn.addEventListener("click", () => {
      applyThemeColors("#580f1a", "#f2a900");
    });
  }

  const TOPOLOGY_DESCRIPTIONS = {
    "Mode A": "Mode A (All-in-One): Laptop built-in Wi-Fi (wlan0) runs hostapd in AP mode; WAN is wired Ethernet (eth0).",
    "Mode B": "Mode B (Wi-Fi WAN + External AP): Laptop joins venue Wi-Fi (wlan0 as WAN); USB Ethernet (eth0 as LAN) serves external AP router. hostapd is disabled.",
    "Mode C": "Mode C (Ethernet WAN + External AP): Laptop gets WAN on built-in Ethernet (eth0); USB Ethernet (eth1 as LAN) serves external AP router.",
  };

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      "X-Admin-Password": adminToken,
    };
  }

  function pickOption(selectEl, prefixes) {
    if (!selectEl) return;
    const opts = Array.from(selectEl.options).map((o) => o.value);
    for (const p of prefixes) {
      const exact = opts.find((o) => o === p);
      if (exact) {
        selectEl.value = exact;
        return;
      }
      const prefixMatch = opts.find((o) => o.startsWith(p));
      if (prefixMatch) {
        selectEl.value = prefixMatch;
        return;
      }
    }
  }

  function updateTopologyHelper(mode, applyDefaultIfaces = false) {
    if (topologyHelper && TOPOLOGY_DESCRIPTIONS[mode]) {
      topologyHelper.textContent = TOPOLOGY_DESCRIPTIONS[mode];
    }
    if (applyDefaultIfaces && cfgWan && cfgLan) {
      if (mode === "Mode A") {
        pickOption(cfgWan, ["enx", "enp", "eth0"]);
        pickOption(cfgLan, ["wlp", "wlan0"]);
      } else if (mode === "Mode B") {
        pickOption(cfgWan, ["wlp", "wlan0"]);
        pickOption(cfgLan, ["enx", "enp", "eth0"]);
      } else if (mode === "Mode C") {
        pickOption(cfgWan, ["enx", "enp", "eth0"]);
        pickOption(cfgLan, ["eth1", "enx", "enp"]);
      }
    }
  }

  if (cfgMode) {
    cfgMode.addEventListener("change", () => {
      updateTopologyHelper(cfgMode.value, true);
    });
  }

  if (cfgSessionDur && lblSessionDur) {
    cfgSessionDur.addEventListener("input", () => {
      lblSessionDur.textContent = cfgSessionDur.value;
    });
  }

  if (cfgPinRot && lblPinRot) {
    cfgPinRot.addEventListener("input", () => {
      lblPinRot.textContent = cfgPinRot.value;
    });
  }

  function populateInterfaceDropdown(selectEl, interfaces, selectedVal) {
    if (!selectEl) return;
    const all = Array.from(new Set([...interfaces, selectedVal].filter(Boolean)));
    selectEl.innerHTML = all
      .map((iface) => `<option value="${iface}" ${iface === selectedVal ? "selected" : ""}>${iface}</option>`)
      .join("");
  }

  function formatRemaining(sec, status, alwaysOn) {
    if (alwaysOn || status === "whitelisted") {
      return `<span class="pill-badge gold">∞ Always-On</span>`;
    }
    if (status === "active" && sec > 0) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `<span class="pill-badge green">${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}</span>`;
    }
    if (status === "expired") {
      return `<span class="pill-badge red">Expired</span>`;
    }
    return `<span class="pill-badge">Unauthenticated</span>`;
  }

  function formatTimestamp(epoch) {
    if (!epoch) return "—";
    const d = new Date(epoch * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderClientsTable(clients) {
    const tbody = document.getElementById("clients-tbody");
    if (!tbody) return;
    if (!clients || clients.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No clients detected yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = clients
      .map((c) => {
        const checked = c.always_on ? "checked" : "";
        return `
        <tr>
          <td style="font-weight: 700;">${c.hostname || "Guest-Device"}</td>
          <td><code>${c.ip}</code></td>
          <td><code style="font-size:0.84rem; color:var(--text-muted);">${c.mac}</code></td>
          <td>${formatTimestamp(c.first_seen)}</td>
          <td>${formatRemaining(c.remaining_seconds, c.status, c.always_on)}</td>
          <td>
            <label class="toggle-switch">
              <input type="checkbox" class="whitelist-toggle" data-ip="${c.ip}" data-hostname="${c.hostname}" data-mac="${c.mac}" ${checked} />
              <span style="font-size: 0.84rem;">${c.always_on ? "Whitelisted" : "Standard"}</span>
            </label>
          </td>
          <td>
            <button type="button" class="btn-sm danger revoke-btn" data-ip="${c.ip}">Revoke / Disconnect</button>
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll(".revoke-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ip = btn.getAttribute("data-ip");
        await fetch("/api/admin/clients/revoke", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ ip }),
        });
        fetchOverview();
      });
    });

    tbody.querySelectorAll(".whitelist-toggle").forEach((chk) => {
      chk.addEventListener("change", async () => {
        const ip = chk.getAttribute("data-ip");
        const hostname = chk.getAttribute("data-hostname");
        const mac = chk.getAttribute("data-mac");
        await fetch("/api/admin/clients/whitelist", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ ip, always_on: chk.checked, hostname, mac }),
        });
        fetchOverview();
      });
    });
  }

  function renderServiceStatus(service, pinInfo) {
    const dnsEl = document.getElementById("pill-dnsmasq");
    const hapEl = document.getElementById("pill-hostapd");
    const natEl = document.getElementById("pill-nat");
    const mockEl = document.getElementById("pill-mock-mode");
    const pinPill = document.getElementById("admin-pin-pill");
    const logBox = document.getElementById("cmd-log-box");

    if (pinPill && pinInfo) {
      pinPill.textContent = `Current PIN: ${pinInfo.pin}`;
    }
    if (dnsEl) {
      const ok = String(service.dnsmasq).includes("running");
      dnsEl.textContent = `DNS/DHCP: ${service.dnsmasq}`;
      dnsEl.className = `pill-badge ${ok ? "green" : "red"}`;
    }
    if (hapEl) {
      const ok = String(service.hostapd).includes("running") || String(service.hostapd).includes("disabled");
      hapEl.textContent = `Hostapd: ${service.hostapd}`;
      hapEl.className = `pill-badge ${ok ? "green" : "red"}`;
    }
    if (natEl) {
      const ok = String(service.nat).includes("active");
      natEl.textContent = `NAT: ${service.nat}`;
      natEl.className = `pill-badge ${ok ? "green" : "red"}`;
    }
    if (mockEl) {
      mockEl.textContent = service.mock_network ? "DRY-RUN MOCK" : "LIVE IPTABLES";
    }
    if (logBox && service.recent_commands) {
      if (service.recent_commands.length === 0) {
        logBox.textContent = "No commands executed yet.";
      } else {
        logBox.innerHTML = service.recent_commands
          .map((item) => {
            const tag = item.mock ? "[MOCK]" : "[LIVE]";
            const t = new Date(item.timestamp * 1000).toLocaleTimeString();
            return `<div style="margin-bottom:4px;"><span style="color:#a78b90;">${t}</span> <strong>${tag}</strong> <code>${item.cmd}</code></div>`;
          })
          .join("");
      }
    }
  }

  async function fetchOverview() {
    try {
      const resp = await fetch("/api/admin/overview", { headers: apiHeaders(), cache: "no-store" });
      if (resp.status === 401) {
        if (loginGate) loginGate.style.display = "flex";
        if (dashboard) dashboard.style.display = "none";
        if (logoutBtn) logoutBtn.style.display = "none";
        return false;
      }
      const data = await resp.json();
      if (loginGate) loginGate.style.display = "none";
      if (dashboard) dashboard.style.display = "flex";
      if (logoutBtn) logoutBtn.style.display = "inline-block";

      const s = data.settings;
      if (s && document.activeElement !== cfgWan && document.activeElement !== cfgLan) {
        populateInterfaceDropdown(cfgWan, data.interfaces || [], formInitialized ? cfgWan.value : s.wan_iface);
        populateInterfaceDropdown(cfgLan, data.interfaces || [], formInitialized ? cfgLan.value : s.lan_iface);
      }
      if (!formInitialized && s) {
        formInitialized = true;
        if (cfgMode) cfgMode.value = s.mode || "Mode A";
        populateInterfaceDropdown(cfgWan, data.interfaces || [], s.wan_iface);
        populateInterfaceDropdown(cfgLan, data.interfaces || [], s.lan_iface);
        if (cfgMock) cfgMock.checked = Boolean(s.mock_network);
        if (cfgSchoolName) cfgSchoolName.value = s.school_name || "";
        if (cfgSsid) cfgSsid.value = s.ssid || "";
        if (cfgSessionDur) cfgSessionDur.value = s.session_duration_minutes || 10;
        if (lblSessionDur) lblSessionDur.textContent = s.session_duration_minutes || 10;
        if (cfgPinRot) cfgPinRot.value = s.pin_rotation_minutes || 10;
        if (lblPinRot) lblPinRot.textContent = s.pin_rotation_minutes || 10;
        if (cfgBwEnabled) cfgBwEnabled.checked = Boolean(s.bandwidth_limit_enabled);
        if (cfgBwMbps) cfgBwMbps.value = s.bandwidth_limit_mbps || 5;
        if (cfgWpaPass) cfgWpaPass.value = s.wpa_passphrase || "";
        if (cfgAdminPass) cfgAdminPass.value = s.admin_password || "admin";
        applyThemeColors(s.primary_color || "#580f1a", s.secondary_color || "#f2a900");
        updateTopologyHelper(s.mode || "Mode A", false);
      }

      renderClientsTable(data.clients || []);
      renderServiceStatus(data.service || {}, data.pin_info || {});
      return true;
    } catch (err) {
      console.error("Failed loading admin overview:", err);
      return false;
    }
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = passInput ? passInput.value : "";
      const resp = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!resp.ok) {
        if (loginError) {
          loginError.textContent = "Invalid admin password.";
          loginError.style.display = "block";
        }
        return;
      }
      adminToken = password;
      sessionStorage.setItem("hotspot_admin_token", adminToken);
      if (loginError) loginError.style.display = "none";
      formInitialized = false;
      fetchOverview();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      adminToken = "";
      sessionStorage.removeItem("hotspot_admin_token");
      if (loginGate) loginGate.style.display = "flex";
      if (dashboard) dashboard.style.display = "none";
      logoutBtn.style.display = "none";
    });
  }

  const saveBtn = document.getElementById("save-settings-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const payload = {
        mode: cfgMode ? cfgMode.value : "Mode A",
        wan_iface: cfgWan ? cfgWan.value : "eth0",
        lan_iface: cfgLan ? cfgLan.value : "wlan0",
        mock_network: cfgMock ? cfgMock.checked : true,
        school_name: cfgSchoolName ? cfgSchoolName.value.trim() : "Event Fast-Pay Wireless",
        ssid: cfgSsid ? cfgSsid.value.trim() : "School_Event_Pay",
        primary_color: cfgPrimaryColor ? cfgPrimaryColor.value : "#580f1a",
        secondary_color: cfgSecondaryColor ? cfgSecondaryColor.value : "#f2a900",
        session_duration_minutes: cfgSessionDur ? parseInt(cfgSessionDur.value, 10) : 10,
        pin_rotation_minutes: cfgPinRot ? parseInt(cfgPinRot.value, 10) : 10,
        bandwidth_limit_enabled: cfgBwEnabled ? cfgBwEnabled.checked : false,
        bandwidth_limit_mbps: cfgBwMbps ? parseInt(cfgBwMbps.value, 10) : 5,
        wpa_passphrase: cfgWpaPass ? cfgWpaPass.value.trim() : "",
        admin_password: cfgAdminPass && cfgAdminPass.value ? cfgAdminPass.value : "admin",
      };

      const resp = await fetch("/api/admin/settings", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        adminToken = payload.admin_password;
        sessionStorage.setItem("hotspot_admin_token", adminToken);
        const toast = document.getElementById("save-toast");
        if (toast) {
          toast.style.display = "block";
          setTimeout(() => {
            toast.style.display = "none";
          }, 2800);
        }
        fetchOverview();
      }
    });
  }

  document.querySelectorAll("[data-service-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-service-action");
      await fetch("/api/admin/service", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action }),
      });
      fetchOverview();
    });
  });

  const rotateBtn = document.getElementById("force-rotate-pin-btn");
  if (rotateBtn) {
    rotateBtn.addEventListener("click", async () => {
      await fetch("/api/admin/rotate-pin", {
        method: "POST",
        headers: apiHeaders(),
      });
      fetchOverview();
    });
  }

  const refreshBtn = document.getElementById("refresh-clients-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => fetchOverview());
  }

  const addWhitelistBtn = document.getElementById("add-whitelist-btn");
  if (addWhitelistBtn) {
    addWhitelistBtn.addEventListener("click", async () => {
      const ip = prompt("Enter Staff / POS Device IP Address (e.g. 192.168.4.50):", "192.168.4.50");
      if (!ip) return;
      const hostname = prompt("Enter Device Label / Hostname:", "Athletics-POS-Terminal") || "Staff-Device";
      await fetch("/api/admin/clients/whitelist", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ ip: ip.trim(), always_on: true, hostname: hostname.trim() }),
      });
      fetchOverview();
    });
  }

  setInterval(() => {
    if (dashboard && dashboard.style.display !== "none") {
      fetchOverview();
    }
  }, 4000);

  fetchOverview();
})();
