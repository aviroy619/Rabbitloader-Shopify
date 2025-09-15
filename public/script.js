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
        
        // Load enhanced dashboard features
        await loadDashboardData();
        await loadManualInstructions();
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

  // Load enhanced dashboard data
  async function loadDashboardData() {
    try {
      const res = await fetch(`/shopify/dashboard-data?shop=${encodeURIComponent(shop)}`);
      const data = await res.json();
      
      if (data.ok) {
        displayEnhancedDashboard(data.data);
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    }
  }

  // Display enhanced dashboard with PSI scores and features
  function displayEnhancedDashboard(data) {
    const connectedSection = document.querySelector("#connectedState .connected-section");
    if (!connectedSection) return;

    // Create enhanced dashboard container
    let dashboardContainer = document.getElementById("enhancedDashboard");
    if (!dashboardContainer) {
      dashboardContainer = document.createElement("div");
      dashboardContainer.id = "enhancedDashboard";
      dashboardContainer.className = "enhanced-dashboard";
      connectedSection.appendChild(dashboardContainer);
    }

    dashboardContainer.innerHTML = `
      <div class="dashboard-grid">
        <!-- PSI Scores Before/After -->
        <div class="psi-scores-section">
          <h3>PageSpeed Insights Score</h3>
          <div class="psi-comparison">
            <div class="psi-before">
              <h4>Before RabbitLoader</h4>
              <div class="score-box">
                <div class="score mobile">
                  <span class="score-value ${data.psi_scores.before.mobile < 50 ? 'poor' : data.psi_scores.before.mobile < 90 ? 'average' : 'good'}">${data.psi_scores.before.mobile}</span>
                  <span class="score-label">Mobile</span>
                </div>
                <div class="score desktop">
                  <span class="score-value ${data.psi_scores.before.desktop < 50 ? 'poor' : data.psi_scores.before.desktop < 90 ? 'average' : 'good'}">${data.psi_scores.before.desktop}</span>
                  <span class="score-label">Desktop</span>
                </div>
              </div>
            </div>
            
            <div class="improvement-arrow">→</div>
            
            <div class="psi-after">
              <h4>After RabbitLoader</h4>
              <div class="score-box">
                <div class="score mobile">
                  <span class="score-value ${data.psi_scores.after.mobile < 50 ? 'poor' : data.psi_scores.after.mobile < 90 ? 'average' : 'good'}">${data.psi_scores.after.mobile}</span>
                  <span class="score-label">Mobile</span>
                </div>
                <div class="score desktop">
                  <span class="score-value ${data.psi_scores.after.desktop < 50 ? 'poor' : data.psi_scores.after.desktop < 90 ? 'average' : 'good'}">${data.psi_scores.after.desktop}</span>
                  <span class="score-label">Desktop</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Plan Information -->
        <div class="plan-section">
          <h3>Current Plan</h3>
          <div class="plan-info">
            <div class="plan-details">
              <h4>${data.plan.name}</h4>
              <p>PageViews: ${data.plan.pageviews}</p>
              <p>Price: ${data.plan.price}</p>
            </div>
            <button class="btn btn-secondary" onclick="openPlanUpdate()">Update Plan</button>
          </div>
        </div>

        <!-- Analytics -->
        <div class="analytics-section">
          <h3>This Month</h3>
          <div class="analytics-stats">
            <div class="stat">
              <span class="stat-value">${data.pageviews_this_month}</span>
              <span class="stat-label">PageViews</span>
            </div>
          </div>
          <button class="btn btn-primary" onclick="openReports('${data.reports_url}')">View Detailed Reports</button>
        </div>

        <!-- Quick Actions -->
        <div class="actions-section">
          <h3>Quick Actions</h3>
          <div class="action-buttons">
            <button class="btn btn-outline" onclick="openCustomize('${data.customize_url}')">Customize Settings</button>
            <button class="btn btn-outline" onclick="runPageSpeedTest()">Run PageSpeed Test</button>
          </div>
        </div>
      </div>
    `;
  }

  // Load manual instructions for script installation
  async function loadManualInstructions() {
    try {
      const res = await fetch(`/shopify/manual-instructions?shop=${encodeURIComponent(shop)}`);
      const data = await res.json();
      
      if (data.ok) {
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
          <button class="btn btn-primary" onclick="tryManualInject()">Install Script to Theme</button>
        </div>
        
        <div class="script-tag-box">
          <label>Or copy this script tag for manual installation:</label>
          <div class="copy-container">
            <code id="scriptTagCode">${data.scriptTag}</code>
            <button class="copy-btn" onclick="copyScriptTag()">Copy</button>
          </div>
        </div>

        <details class="manual-steps">
          <summary>Manual Installation Steps</summary>
          <ol>
            <li>${data.instructions.step1}</li>
            <li>${data.instructions.step2}</li>
            <li>${data.instructions.step3}</li>
            <li>${data.instructions.step4}</li>
            <li>${data.instructions.step5}<br><code>${data.scriptTag}</code></li>
            <li>${data.instructions.step6}</li>
            <li>${data.instructions.step7}</li>
          </ol>
        </details>
      </div>
    `;
  }

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
        await loadDashboardData();
        await loadManualInstructions();
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
      
      const urlParams = new URLSearchParams(window.location.search);
      const host = urlParams.get('host');
      
      let callbackUrl = `${APP_URL}/shopify/auth/callback?shop=${encodeURIComponent(shop)}`;
      if (host) {
        callbackUrl += `&host=${encodeURIComponent(host)}`;
      }
      
      const siteUrl = `https://${shop}`;
      
      const connectUrl = `https://rabbitloader.com/account/?source=shopify` +
        `&action=connect` +
        `&site_url=${encodeURIComponent(siteUrl)}` +
        `&redirect_url=${encodeURIComponent(callbackUrl)}` +
        `&cms_v=${SHOPIFY_API_VERSION}` +
        `&plugin_v=1.0.0`;

      showFlash("Redirecting to RabbitLoader for authentication...", "info");
      
      const isEmbedded = window.top !== window.self;
      
      if (isEmbedded) {
        console.log("Breaking out of iframe for RabbitLoader auth");
        window.top.location.href = connectUrl;
      } else {
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
          window.location.href = `/?shop=${shop}`;
        } else {
          showFlash("Failed to disconnect: " + (data.error || "Unknown error"), "error");
        }
      } catch (err) {
        console.error("Disconnect request failed:", err);
        showFlash("Disconnect failed. Check console logs.", "error");
      }
    });
  }

  // Global functions for dashboard actions
  window.tryManualInject = async function() {
    if (!shop) return;
    
    showFlash("Installing script to theme...", "info");
    
    try {
      const res = await fetch("/shopify/inject-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop })
      });
      const data = await res.json();
      
      if (data.ok) {
        showFlash("Script installed successfully! Check your store's source code.", "success");
      } else {
        showFlash("Installation failed: " + data.error, "error");
      }
    } catch (err) {
      console.error("Script injection failed:", err);
      showFlash("Installation failed. Use manual method below.", "error");
    }
  };

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

  window.openReports = function(reportsUrl) {
    window.open(reportsUrl, '_blank');
  };

  window.openCustomize = function(customizeUrl) {
    window.open(customizeUrl, '_blank');
  };

  window.openPlanUpdate = function() {
    showFlash("Redirecting to plan management...", "info");
    window.open('https://rabbitloader.com/pricing', '_blank');
  };

  window.runPageSpeedTest = function() {
    const storeUrl = `https://${shop}`;
    const pagespeedUrl = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(storeUrl)}`;
    showFlash("Opening PageSpeed Insights...", "info");
    window.open(pagespeedUrl, '_blank');
  };
});