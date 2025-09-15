document.addEventListener("DOMContentLoaded", async () => {
  const shop = new URLSearchParams(window.location.search).get("shop");
  const rlToken = new URLSearchParams(window.location.search).get("rl-token");
  const activateBtn = document.getElementById("activateBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");

  const loadingState = document.getElementById("loadingState");
  const connectedState = document.getElementById("connectedState");
  const disconnectedState = document.getElementById("disconnectedState");
  const flashContainer = document.getElementById("flashMessages");

  // Flash message helper
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

  // UI state switcher
  function showState(state) {
    loadingState.style.display = "none";
    connectedState.style.display = "none";
    disconnectedState.style.display = "none";

    if (state === "connected") connectedState.style.display = "block";
    if (state === "disconnected") disconnectedState.style.display = "block";
  }

  // Check shop status from backend
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
        
        // Load manual instructions for connected stores
        loadManualInstructions();
      } else {
        showState("disconnected");
        document.getElementById("storeNameDisconnected").textContent = shop;
      }
    } catch (err) {
      console.error("Status check failed:", err);
      showState("disconnected");
      document.getElementById("storeNameDisconnected").textContent = shop || "Unknown Shop";
      showFlash("Failed to check connection status", "error");
    }
  }

  // Load manual instructions for script installation
  async function loadManualInstructions() {
    try {
      const res = await fetch(`/shopify/manual-instructions?shop=${encodeURIComponent(shop)}`);
      const data = await res.json();
      
      if (data.ok) {
        // Display script information in connected state
        displayScriptInstructions(data);
      }
    } catch (err) {
      console.error("Failed to load manual instructions:", err);
    }
  }

  // Display script installation instructions
  function displayScriptInstructions(data) {
    const connectedSection = document.querySelector("#connectedState .connected-section");
    if (!connectedSection) return;

    // Create instructions container if it doesn't exist
    let instructionsContainer = document.getElementById("scriptInstructions");
    if (!instructionsContainer) {
      instructionsContainer = document.createElement("div");
      instructionsContainer.id = "scriptInstructions";
      instructionsContainer.className = "script-instructions";
      connectedSection.appendChild(instructionsContainer);
    }

    instructionsContainer.innerHTML = `
      <div class="script-info">
        <h3>RabbitLoader Script Installation</h3>
        <p><strong>DID:</strong> ${data.did}</p>
        <p><strong>Script URL:</strong> <code>${data.scriptUrl}</code></p>
        
        <div class="script-actions">
          <button class="btn btn-primary" onclick="tryAutoInject()">Try Auto-Inject</button>
        </div>
        
        <div class="script-tag-box">
          <label>Or copy this script tag for manual installation:</label>
          <div class="copy-container">
            <code id="scriptTagCode">${data.scriptTag}</code>
            <button class="copy-btn" onclick="copyScriptTag()">Copy</button>
          </div>
        </div>

        <div class="manual-steps">
          <h4>Manual Installation Steps:</h4>
          <ol>
            <li>${data.instructions.step1}</li>
            <li>${data.instructions.step2}</li>
            <li>${data.instructions.step3}</li>
            <li>${data.instructions.step4}</li>
            <li>${data.instructions.step5}<br><code>${data.scriptTag}</code></li>
            <li>${data.instructions.step6}</li>
            <li>${data.instructions.step7}</li>
          </ol>
        </div>
      </div>
    `;
  }

  // Try automatic script injection
  window.tryAutoInject = async function() {
    if (!shop) return;
    
    showFlash("Attempting automatic script injection...", "info");
    
    try {
      const res = await fetch("/shopify/inject-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop })
      });
      const data = await res.json();
      
      if (data.ok) {
        showFlash("Script injection successful! Check your store's source code.", "success");
      } else {
        showFlash("Auto-injection failed: " + data.error, "error");
      }
    } catch (err) {
      console.error("Auto-inject failed:", err);
      showFlash("Auto-injection failed. Use manual installation.", "error");
    }
  };

  // Copy script tag to clipboard
  window.copyScriptTag = function() {
    const scriptTagCode = document.getElementById("scriptTagCode");
    if (scriptTagCode) {
      navigator.clipboard.writeText(scriptTagCode.textContent).then(() => {
        showFlash("Script tag copied to clipboard!", "success");
      }).catch(err => {
        console.error("Failed to copy:", err);
        showFlash("Failed to copy script tag", "error");
      });
    }
  };

  // Special case: if RL redirects back with rl-token - save it
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
      console.error("RL token store request failed:", err);
      showFlash("Failed to save connection", "error");
    }
  } else {
    await checkStatus();
  }

  // Activate button - RabbitLoader console (with iframe breakout)
  if (activateBtn && shop) {
    activateBtn.addEventListener("click", () => {
      const APP_URL = window.env.APP_URL;
      const SHOPIFY_API_VERSION = window.env.SHOPIFY_API_VERSION;
      
      // Get current URL parameters for embedding context
      const urlParams = new URLSearchParams(window.location.search);
      const host = urlParams.get('host');
      
      // Build callback URL with host parameter for proper embedding
      let callbackUrl = `${APP_URL}/shopify/auth/callback?shop=${encodeURIComponent(shop)}`;
      if (host) {
        callbackUrl += `&host=${encodeURIComponent(host)}`;
      }
      
      // SITE_HOME_PAGE - Shopify store's home page
      const siteUrl = `https://${shop}`;
      
      // Build RabbitLoader console URL with all required parameters
      const connectUrl = `https://rabbitloader.com/account/?source=shopify` +
        `&action=connect` +
        `&site_url=${encodeURIComponent(siteUrl)}` +
        `&redirect_url=${encodeURIComponent(callbackUrl)}` +
        `&cms_v=${SHOPIFY_API_VERSION}` +
        `&plugin_v=1.0.0`;

      showFlash("Redirecting to RabbitLoader for authentication...", "info");
      
      // Check if we're in an embedded context (iframe)
      const isEmbedded = window.top !== window.self;
      
      if (isEmbedded) {
        // Break out of iframe and redirect in parent window
        console.log("Breaking out of iframe for RabbitLoader auth");
        window.top.location.href = connectUrl;
      } else {
        // Direct redirect if not embedded
        console.log("Direct redirect to RabbitLoader");
        window.location.href = connectUrl;
      }
    });
  }

  // Disconnect button - backend call (uses POST with body)
  if (disconnectBtn && shop) {
    disconnectBtn.addEventListener("click", async () => {
      try {
        const res = await fetch(`/shopify/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop })
        });
        const data = await res.json();

        if (data.ok) {
          showFlash("Disconnected from RabbitLoader", "success");
          window.location.href = `/?shop=${shop}`; // reload to show disconnected state
        } else {
          showFlash("Failed to disconnect: " + (data.error || "Unknown error"), "error");
        }
      } catch (err) {
        console.error("Disconnect request failed:", err);
        showFlash("Disconnect failed. Check console logs.", "error");
      }
    });
  }
});