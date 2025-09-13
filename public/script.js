document.addEventListener("DOMContentLoaded", async () => {
  const shop = new URLSearchParams(window.location.search).get("shop");
  const rlToken = new URLSearchParams(window.location.search).get("rl-token");
  const activateBtn = document.getElementById("activateBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");

  const loadingState = document.getElementById("loadingState");
  const connectedState = document.getElementById("connectedState");
  const disconnectedState = document.getElementById("disconnectedState");
  const flashContainer = document.getElementById("flashMessages");

  // 🔔 Flash message helper
  function showFlash(message, type = "info") {
    if (!flashContainer) return;

    const flash = document.createElement("div");
    flash.className = `flash-message ${type}`;
    flash.textContent = message;

    flashContainer.appendChild(flash);

    setTimeout(() => {
      flash.classList.add("fade-out");
      setTimeout(() => flash.remove(), 500);
    }, 3000);
  }

  // 🔄 UI state switcher
  function showState(state) {
    loadingState.style.display = "none";
    connectedState.style.display = "none";
    disconnectedState.style.display = "none";

    if (state === "connected") connectedState.style.display = "block";
    if (state === "disconnected") disconnectedState.style.display = "block";
  }

  // ✅ Check shop status from backend
  async function checkStatus() {
    if (!shop) {
      showState("disconnected");
      document.getElementById("storeNameDisconnected").textContent = "Unknown Shop";
      return;
    }

    try {
      const res = await fetch(`/shopify/status?shop=${encodeURIComponent(shop)}`);
      const data = await res.json();

      if (data.ok && data.connected) {
        showState("connected");
        document.getElementById("storeNameConnected").textContent = shop;
      } else {
        showState("disconnected");
        document.getElementById("storeNameDisconnected").textContent = shop;
      }
    } catch (err) {
      console.error("❌ Status check failed:", err);
      showState("disconnected");
      document.getElementById("storeNameDisconnected").textContent = shop || "Unknown Shop";
      showFlash("Failed to check connection status", "error");
    }
  }

  // 🟢 Special case: if RL redirects back with rl-token → save it
  if (rlToken && shop) {
    try {
      const res = await fetch("/shopify/store-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, rlToken })
      });
      const data = await res.json();

      if (data.ok) {
        showFlash("Connected successfully", "success");
        showState("connected");
        document.getElementById("storeNameConnected").textContent = shop;
      } else {
        showFlash("Failed to save connection: " + (data.error || "Unknown error"), "error");
      }
    } catch (err) {
      console.error("❌ RL token store request failed:", err);
      showFlash("Failed to save connection", "error");
    }
  } else {
    await checkStatus();
  }

  // 🚀 Activate button → RabbitLoader console
  if (activateBtn && shop) {
    activateBtn.addEventListener("click", () => {
      const APP_URL = window.env.APP_URL;
      const SHOPIFY_API_VERSION = window.env.SHOPIFY_API_VERSION;
      const redirectUrl = `${APP_URL}/shopify/auth/callback?shop=${encodeURIComponent(shop)}`;
      const siteUrl = `https://${shop}`;

      const connectUrl = `https://rabbitloader.com/account/?source=shopify` +
        `&action=connect` +
        `&site_url=${encodeURIComponent(siteUrl)}` +
        `&redirect_url=${encodeURIComponent(redirectUrl)}` +
        `&cms_v=${SHOPIFY_API_VERSION}` +
        `&plugin_v=1.0.0`;

      showFlash("Redirecting to RabbitLoader for authentication…", "info");
      window.location.href = connectUrl;
    });
  }

  // 🔌 Disconnect button → backend call
  if (disconnectBtn && shop) {
    disconnectBtn.addEventListener("click", async () => {
      try {
        const res = await fetch(`/shopify/disconnect?shop=${encodeURIComponent(shop)}`, {
          method: "POST"
        });
        const data = await res.json();

        if (data.ok) {
          showFlash("Disconnected from RabbitLoader", "success");
          window.location.href = `/?shop=${shop}`; // reload → Disconnected state
        } else {
          showFlash("Failed to disconnect: " + (data.error || "Unknown error"), "error");
        }
      } catch (err) {
        console.error("❌ Disconnect request failed:", err);
        showFlash("Disconnect failed. Check console logs.", "error");
      }
    });
  }
});
