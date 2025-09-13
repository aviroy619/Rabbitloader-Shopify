// Dashboard State Management
class Dashboard {
  constructor() {
    this.shop = this.getQueryParam('shop');
    this.isRLConnected = false;
    this.currentDID = null;
    this.history = [];

    this.init();
  }

  async init() {
    if (!this.shop) {
      this.showError('Missing shop parameter');
      return;
    }

    this.updateStoreName();
    this.handleFlashMessages();
    await this.loadStatus();
    this.updateUI();
  }

  getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
  }

  updateStoreName() {
    const storeNameEls = [
      document.getElementById('storeName'),
      document.getElementById('storeNameDisconnected')
    ];
    storeNameEls.forEach(el => {
      if (el && this.shop) {
        el.textContent = this.shop;
      }
    });
  }

  handleFlashMessages() {
    const connected = this.getQueryParam('connected');
    const disconnected = this.getQueryParam('disconnected');

    if (connected === 'true') {
      this.showFlashMessage('🎉 RabbitLoader successfully connected and activated!', 'success');
    }
    if (disconnected === 'true') {
      this.showFlashMessage('🔌 RabbitLoader has been disconnected from your store.', 'warning');
    }
  }

  showFlashMessage(message, type = 'success') {
    const container = document.getElementById('flashMessages');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `flash-message ${type}`;
    el.innerHTML = `<span>${message}</span>`;
    container.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'slideOut 0.3s ease-out forwards';
      setTimeout(() => el.remove(), 300);
    }, 5000);
  }

  async loadStatus() {
    try {
      const res = await fetch(`/api/status?shop=${encodeURIComponent(this.shop)}`);
      if (res.ok) {
        const data = await res.json();
        this.isRLConnected = data.rabbitloader_connected;
        this.currentDID = data.did;
        this.history = data.history || [];
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch status:', err);
    }
  }

  updateUI() {
    // Hide loading state if present
    const loading = document.getElementById('loadingState');
    if (loading) loading.style.display = 'none';

    // Handle disconnected page (index.html)
    const disconnected = document.getElementById('disconnectedState');
    if (disconnected) {
      if (!this.isRLConnected) {
        disconnected.style.display = 'block';
        this.setupActivateBtn();
      }
      return; // Stop here — no dashboard elements on index.html
    }

    // Handle connected page (dashboard.html)
    const connected = document.getElementById('connectedState');
    if (connected) {
      if (this.isRLConnected) {
        connected.style.display = 'block';
        this.updateDashboardElements();
      }
    }
  }

  setupActivateBtn() {
    const btn = document.getElementById('activateBtn');
    if (!btn) return;

    btn.onclick = async () => {
      try {
        const res = await fetch(`/connect-rabbitloader?shop=${encodeURIComponent(this.shop)}`);
        const data = await res.json();
        if (data.url) {
          window.top.location.href = data.url;
        } else {
          this.showFlashMessage("⚠️ Failed to get RabbitLoader connect URL", "error");
        }
      } catch (err) {
        console.error("❌ Error activating RabbitLoader:", err);
        this.showFlashMessage("⚠️ Failed to activate RabbitLoader", "error");
      }
    };
  }

  updateDashboardElements() {
    // Update DID
    const didVal = document.getElementById('didValue');
    if (didVal && this.currentDID) didVal.textContent = this.currentDID;

    // Hook up buttons
    const injectBtn = document.getElementById('injectBtn');
    if (injectBtn) injectBtn.href = `/inject-script?shop=${encodeURIComponent(this.shop)}`;

    const revertBtn = document.getElementById('revertBtn');
    if (revertBtn) revertBtn.href = `/revert-script?shop=${encodeURIComponent(this.shop)}`;

    const disconnectBtn = document.getElementById('disconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.href = `/disconnect-rabbitloader?shop=${encodeURIComponent(this.shop)}`;
      disconnectBtn.onclick = (e) => {
        if (!confirm('Are you sure you want to disconnect RabbitLoader?')) {
          e.preventDefault();
        }
      };
    }

    // Fetch RabbitLoader data
    this.fetchRLData();
  }

  async fetchRLData() {
    try {
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 30 * 864e5).toISOString().split("T")[0];

      const [billingRes, usageRes, perfRes] = await Promise.all([
        fetch(`/api/rl-billing-subscription?shop=${encodeURIComponent(this.shop)}`),
        fetch(`/api/rl-pageview-usage?shop=${encodeURIComponent(this.shop)}&start_date=${startDate}&end_date=${endDate}`),
        fetch(`/api/rl-performance-overview?shop=${encodeURIComponent(this.shop)}&start_date=${startDate}&end_date=${endDate}`)
      ]);

      if (billingRes.ok) {
        const billing = await billingRes.json();
        this.safeUpdate("plan-name", billing?.plan_name || "Unknown Plan");
        this.safeUpdate("plan-domains", billing?.domains || "-");
        this.safeUpdate("plan-pageviews", billing?.pageviews || "-");
      }

      if (usageRes.ok) {
        const usage = await usageRes.json();
        this.safeUpdate("plan-usage", usage?.total || "0");
      }

      if (perfRes.ok) {
        const perf = await perfRes.json();
        this.updatePerformance(perf);
      }
    } catch (err) {
      console.error("⚠️ Error fetching RL data:", err);
      this.safeUpdate("rl-status", "⚠️ Error fetching data");
    }
  }

  safeUpdate(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  updatePerformance(data) {
    const metrics = { score: "--", lcp: "--", cls: "--", fid: "--" };
    Object.assign(metrics, data);

    this.safeUpdate("score", metrics.score);
    this.safeUpdate("lcp", metrics.lcp);
    this.safeUpdate("cls", metrics.cls);
    this.safeUpdate("fid", metrics.fid);
  }

  showError(msg) {
    this.showFlashMessage(`⚠️ ${msg}`, "error");
  }
}

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
  window.dashboard = new Dashboard();
});
