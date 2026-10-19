(function () {
  const form = document.getElementById("portal-auth-form");
  const pinInput = document.getElementById("pin-input");
  const errorBox = document.getElementById("portal-error-msg");
  const loginView = document.getElementById("portal-login-view");
  const connectedView = document.getElementById("portal-connected-view");
  const timerEl = document.getElementById("portal-remaining-timer");
  const doneBtn = document.getElementById("done-btn");
  const connectBtn = document.getElementById("connect-btn");

  let remainingSeconds = (window.INITIAL_CLIENT_STATUS && window.INITIAL_CLIENT_STATUS.remaining_seconds) || 0;
  let isWhitelisted = Boolean(window.INITIAL_CLIENT_STATUS && window.INITIAL_CLIENT_STATUS.always_on);

  function formatTime(sec) {
    if (isWhitelisted || sec > 90000) return "UNLIMITED";
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function updateTimerDisplay() {
    if (timerEl) {
      timerEl.textContent = formatTime(remainingSeconds);
    }
  }

  function showConnectedView(remSec, alwaysOn) {
    remainingSeconds = remSec;
    isWhitelisted = Boolean(alwaysOn);
    if (loginView) loginView.style.display = "none";
    if (connectedView) connectedView.style.display = "block";
    updateTimerDisplay();
  }

  function showLoginView() {
    if (connectedView) connectedView.style.display = "none";
    if (loginView) loginView.style.display = "block";
    if (pinInput) {
      pinInput.value = "";
      pinInput.focus();
    }
  }

  if (pinInput) {
    pinInput.addEventListener("input", () => {
      pinInput.value = pinInput.value.replace(/[^0-9]/g, "").slice(0, 4);
      if (errorBox) errorBox.style.display = "none";
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pin = pinInput ? pinInput.value.trim() : "";
      if (pin.length !== 4) {
        if (errorBox) {
          errorBox.textContent = "Please enter a 4-digit numeric PIN.";
          errorBox.style.display = "block";
        }
        return;
      }

      if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = "Authorizing...";
      }

      try {
        const resp = await fetch("/api/portal/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
          if (errorBox) {
            errorBox.textContent = data.error || "Invalid Access PIN.";
            errorBox.style.display = "block";
          }
        } else {
          showConnectedView(data.remaining_seconds, false);
        }
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = "Network error communicating with hotspot controller.";
          errorBox.style.display = "block";
        }
      } finally {
        if (connectBtn) {
          connectBtn.disabled = false;
          connectBtn.textContent = "Connect to Pay";
        }
      }
    });
  }

  if (doneBtn) {
    doneBtn.addEventListener("click", () => {
      // Standard captive portal completion behavior
      window.location.href = "https://venmo.com";
    });
  }

  setInterval(() => {
    if (connectedView && connectedView.style.display !== "none") {
      if (!isWhitelisted && remainingSeconds > 0) {
        remainingSeconds -= 1;
        updateTimerDisplay();
        if (remainingSeconds <= 0) {
          showLoginView();
        }
      }
    }
  }, 1000);

  updateTimerDisplay();
})();
