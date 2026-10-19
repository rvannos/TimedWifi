(function () {
  const pinCodeEl = document.getElementById("pin-code-text");
  const countdownTextEl = document.getElementById("pin-countdown-text");
  const countdownBarEl = document.getElementById("pin-countdown-bar");
  const ringCircleEl = document.getElementById("pin-ring-circle");
  const ssidEl = document.getElementById("display-ssid");
  const qrSsidEl = document.getElementById("qr-ssid-label");
  const qrImgEl = document.getElementById("wifi-qr-img");
  const sessionMinsEl = document.getElementById("display-session-mins");
  const rotationMinsEl = document.getElementById("pin-rotation-mins");
  const schoolNameEl = document.getElementById("header-school-name");
  const badgeModeEl = document.getElementById("badge-mode");
  const badgeEnvEl = document.getElementById("badge-env");

  const CIRCUMFERENCE = 2 * Math.PI * 116; // r=116 => ~728.85

  let remainingSeconds = 600;
  let totalSeconds = 600;
  let currentSsid = ssidEl ? ssidEl.textContent.trim() : "";

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function renderCountdown() {
    if (countdownTextEl) {
      countdownTextEl.textContent = formatTime(remainingSeconds);
    }
    const pct = totalSeconds > 0 ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds)) : 1;
    if (countdownBarEl) {
      countdownBarEl.style.width = `${(pct * 100).toFixed(1)}%`;
    }
    if (ringCircleEl) {
      const offset = CIRCUMFERENCE * (1 - pct);
      ringCircleEl.style.strokeDashoffset = `${offset.toFixed(2)}`;
    }
  }

  async function syncDisplayState() {
    try {
      const resp = await fetch("/api/display-state", { cache: "no-store" });
      if (!resp.ok) return;
      const data = await resp.json();

      if (pinCodeEl && data.pin) {
        pinCodeEl.textContent = data.pin;
      }
      remainingSeconds = data.remaining_seconds ?? remainingSeconds;
      totalSeconds = data.total_seconds ?? totalSeconds;

      if (data.ssid && data.ssid !== currentSsid) {
        currentSsid = data.ssid;
        if (ssidEl) ssidEl.textContent = data.ssid;
        if (qrSsidEl) qrSsidEl.textContent = data.ssid;
        if (qrImgEl) qrImgEl.src = `/api/qr.svg?t=${Date.now()}`;
      }
      if (sessionMinsEl && data.session_duration_minutes) {
        sessionMinsEl.textContent = `${data.session_duration_minutes} minutes`;
      }
      if (rotationMinsEl && data.rotation_minutes) {
        rotationMinsEl.textContent = data.rotation_minutes;
      }
      if (schoolNameEl && data.school_name) {
        schoolNameEl.textContent = data.school_name;
      }
      if (badgeModeEl && data.mode) {
        badgeModeEl.textContent = data.mode;
      }
      if (badgeEnvEl) {
        badgeEnvEl.textContent = data.mock_network ? "DRY-RUN MOCK MODE" : "LIVE NETWORK";
        badgeEnvEl.className = `pill-badge ${data.mock_network ? "gold" : "green"}`;
      }

      renderCountdown();
    } catch (err) {
      console.warn("Display sync error:", err);
    }
  }

  // Smooth 1-second local countdown + 3-second server poll
  setInterval(() => {
    if (remainingSeconds > 0) {
      remainingSeconds -= 1;
      renderCountdown();
    } else {
      syncDisplayState();
    }
  }, 1000);

  setInterval(syncDisplayState, 3000);
  syncDisplayState();

  // ---------------------------------------------------------
  // Screen Wake Lock (Keep Display On) & Fullscreen Toggle
  // ---------------------------------------------------------
  const wakeBadgeEl = document.getElementById("badge-wakelock");
  const fullscreenBtn = document.getElementById("fullscreen-btn");
  let wakeLockSentinel = null;

  async function requestScreenWakeLock() {
    if (!("wakeLock" in navigator)) {
      if (wakeBadgeEl) {
        wakeBadgeEl.textContent = "☀️ OS Inhibit Active";
      }
      return;
    }
    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      if (wakeBadgeEl) {
        wakeBadgeEl.textContent = "☀️ Screen Awake";
        wakeBadgeEl.className = "pill-badge green";
      }
      wakeLockSentinel.addEventListener("release", () => {
        if (wakeBadgeEl && document.visibilityState === "visible") {
          wakeBadgeEl.textContent = "☀️ Click to Keep Awake";
          wakeBadgeEl.className = "pill-badge gold";
        }
      });
    } catch (err) {
      console.warn("WakeLock request deferred until interaction:", err);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestScreenWakeLock();
    }
  });

  document.addEventListener("click", () => {
    if (!wakeLockSentinel || wakeLockSentinel.released) {
      requestScreenWakeLock();
    }
  });

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          fullscreenBtn.textContent = "⛶ Exit Fullscreen";
        } else {
          await document.exitFullscreen();
          fullscreenBtn.textContent = "⛶ Fullscreen";
        }
      } catch (e) {
        console.warn("Fullscreen error:", e);
      }
      requestScreenWakeLock();
    });
  }

  requestScreenWakeLock();
})();
