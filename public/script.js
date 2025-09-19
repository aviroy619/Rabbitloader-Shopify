// Frontend Dashboard Logic for RabbitLoader Shopify App - COMPLETE FILE
class RabbitLoaderDashboard {
  constructor() {
    this.shop = window.appState.shop || new URLSearchParams(window.location.search).get('shop');
    this.host = window.appState.host || new URLSearchParams(window.location.search).get('host');
    this.embedded = window.appState.embedded || (new URLSearchParams(window.location.search).get('embedded') === '1');
    this.isRLConnected = false;
    this.currentDID = null;
    this.history = [];
    this.dashboardData = null;
    
    // UI element references
    this.loadingState = document.getElementById('loadingState');
    this.disconnectedState = document.getElementById('disconnectedState');
    this.connectedState = document.getElementById('connectedState');
    this.flashMessages = document.getElementById('flashMessages');
    
    this.init();
  }

  async init() {
    console.log('RabbitLoader Dashboard initializing...', {
      shop: this.shop,
      embedded: this.embedded,
      host: this.host ? this.host.substring(0, 20) + '...' : 'none',
      isInFrame: window.top !== window.self
    });

    // Set up event listeners
    this.setupEventListeners();
    
    // Check connection status
    await this.checkStatus();
    
    // Update UI based on status
    this.updateUI();
  }

  setupEventListeners() {
    // Activate button
    const activateBtn = document.getElementById('activateBtn');
    if (activateBtn) {
      activateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.initiateRabbitLoaderConnection();
      });
    }

    // Disconnect button
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.disconnect();
      });
    }

    // Handle URL changes (for connected parameter)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === '1') {
      this.showSuccess('Successfully connected to RabbitLoader!');
      // Re-check status after connection
      setTimeout(() => this.checkStatus(), 1000);
    }

    if (urlParams.get('shopify_auth') === '1') {
      this.showSuccess('Shopify authentication completed!');
    }
  }

  async checkStatus() {
    if (!this.shop) {
      console.error('No shop parameter available');
      this.showError('Shop parameter is required');
      return;
    }

    try {
      console.log(`Checking status for shop: ${this.shop}`);
      
      const response = await fetch(`/shopify/status?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.isRLConnected = data.connected;
        this.currentDID = data.did;
        
        console.log('Status check result:', {
          connected: this.isRLConnected,
          did: this.currentDID,
          script_injected: data.script_injected
        });

        // If connected, also get dashboard data
        if (this.isRLConnected) {
          await this.loadDashboardData();
        }
      } else {
        console.error('Status check failed:', data.error);
        this.showError(`Failed to check connection status: ${data.error}`);
      }
    } catch (error) {
      console.error('Status check error:', error);
      this.showError('Failed to check connection status');
    }
  }

  async loadDashboardData() {
    try {
      const response = await fetch(`/shopify/dashboard-data?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.dashboardData = data.data;
        console.log('Dashboard data loaded:', this.dashboardData);
      } else {
        console.warn('Failed to load dashboard data:', data.error);
        // Set minimal fallback data so dashboard still shows
        this.dashboardData = {
          did: this.currentDID || 'unknown',
          psi_scores: { before: { mobile: 50, desktop: 70 }, after: { mobile: 90, desktop: 95 } },
          plan: { name: "RabbitLoader", pageviews: "N/A", price: "N/A" },
          reports_url: "https://rabbitloader.com/dashboard/",
          customize_url: "https://rabbitloader.com/customize/",
          pageviews_this_month: "N/A"
        };
      }
    } catch (error) {
      console.error('Dashboard data error:', error);
      // Set minimal fallback data
      this.dashboardData = {
        did: this.currentDID || 'unknown',
        psi_scores: { before: { mobile: 50, desktop: 70 }, after: { mobile: 90, desktop: 95 } },
        plan: { name: "RabbitLoader", pageviews: "N/A", price: "N/A" },
        reports_url: "https://rabbitloader.com/dashboard/",
        customize_url: "https://rabbitloader.com/customize/",
        pageviews_this_month: "N/A"
      };
    }
  }

  updateUI() {
    console.log('Updating UI, connected:', this.isRLConnected);
    
    // Update store names
    const storeNames = [
      document.getElementById('storeName'),
      document.getElementById('storeNameDisconnected'),
      document.getElementById('storeNameConnected')
    ];
    
    storeNames.forEach(el => {
      if (el) {
        el.textContent = this.shop ? this.shop.replace('.myshopify.com', '') : 'Unknown Store';
      }
    });

    // Show appropriate state
    if (this.isRLConnected) {
      this.showConnectedState();
    } else {
      this.showDisconnectedState();
    }
    
    // Hide loading state
    if (this.loadingState) {
      this.loadingState.style.display = 'none';
    }
  }

  showDisconnectedState() {
    console.log('Showing disconnected state');
    if (this.disconnectedState) {
      this.disconnectedState.style.display = 'block';
    }
    if (this.connectedState) {
      this.connectedState.style.display = 'none';
    }
  }

  showConnectedState() {
    console.log('Showing connected state');
    if (this.connectedState) {
      this.connectedState.style.display = 'block';
      
      // Add enhanced dashboard if we have data
      if (this.dashboardData) {
        this.renderEnhancedDashboard();
      }
    }
    if (this.disconnectedState) {
      this.disconnectedState.style.display = 'none';
    }
  }

  renderEnhancedDashboard() {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection || !this.dashboardData) return;

    // Check if dashboard already exists
    if (document.querySelector('.enhanced-dashboard')) return;

    // Show data source indicator
    const dataSourceBadge = this.dashboardData.data_source === 'api' ? 
      '<span style="background: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">Live Data</span>' : 
      '<span style="background: #ffc107; color: black; padding: 2px 6px; border-radius: 3px; font-size: 12px;">Demo Data</span>';

    const dashboardHTML = `
      <div class="enhanced-dashboard">
        <div style="text-align: center; margin-bottom: 15px;">
          ${dataSourceBadge}
          ${this.dashboardData.last_updated ? '<small style="color: #666; margin-left: 10px;">Updated: ' + new Date(this.dashboardData.last_updated).toLocaleTimeString() + '</small>' : ''}
        </div>
        
        <div class="dashboard-grid">
          <div class="psi-scores-section">
            <h3>PageSpeed Improvement</h3>
            <div class="psi-comparison">
              <div>
                <h4>Before RabbitLoader</h4>
                <div class="score-box">
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.before.mobile)}">${this.dashboardData.psi_scores.before.mobile}</span>
                    <span class="score-label">Mobile</span>
                  </div>
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.before.desktop)}">${this.dashboardData.psi_scores.before.desktop}</span>
                    <span class="score-label">Desktop</span>
                  </div>
                </div>
              </div>
              <div class="improvement-arrow">→</div>
              <div>
                <h4>After RabbitLoader</h4>
                <div class="score-box">
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.after.mobile)}">${this.dashboardData.psi_scores.after.mobile}</span>
                    <span class="score-label">Mobile</span>
                  </div>
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.after.desktop)}">${this.dashboardData.psi_scores.after.desktop}</span>
                    <span class="score-label">Desktop</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="plan-section">
            <h3>Current Plan</h3>
            <div class="plan-info">
              <div class="plan-details">
                <h4>${this.dashboardData.plan.name}</h4>
                <p>Up to ${this.dashboardData.plan.pageviews} pageviews</p>
                <p><strong>${this.dashboardData.plan.price}</strong></p>
              </div>
            </div>
          </div>

          <div class="analytics-section">
            <h3>This Month</h3>
            <div class="analytics-stats">
              <div class="stat">
                <span class="stat-value">${this.dashboardData.pageviews_this_month}</span>
                <span class="stat-label">Pageviews</span>
              </div>
            </div>
          </div>

          <div class="actions-section">
            <h3>Quick Actions</h3>
            <div class="action-buttons">
              <a href="${this.dashboardData.reports_url}" target="_blank" class="btn btn-primary">View Reports</a>
              <a href="${this.dashboardData.customize_url}" target="_blank" class="btn btn-outline">Customize Settings</a>
              <button class="btn btn-secondary" onclick="dashboard.showScriptInstructions()">Script Setup</button>
              <a href="/shopify/configure-defer?shop=${encodeURIComponent(this.shop)}" target="_blank" class="btn btn-outline">Configure Defer Rules</a>
            </div>
          </div>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #e3f2fd; border-radius: 6px; text-align: center;">
          <small>
            <strong>DID:</strong> ${this.currentDID} | 
            <strong>Status:</strong> Active |
            <strong>Script:</strong> Defer configuration only
          </small>
        </div>
      </div>
    `;

    connectedSection.insertAdjacentHTML('beforeend', dashboardHTML);
  }

  getScoreClass(score) {
    if (score >= 90) return 'good';
    if (score >= 50) return 'average';
    return 'poor';
  }

  showScriptInstructions() {
    this.getManualInstructions();
  }

  async getManualInstructions() {
    try {
      const response = await fetch(`/shopify/manual-instructions?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.displayScriptInstructions(data);
      } else {
        this.showError(`Failed to get instructions: ${data.error}`);
      }
    } catch (error) {
      console.error('Manual instructions error:', error);
      this.showError('Failed to load installation instructions');
    }
  }

  displayScriptInstructions(data) {
    // Check if instructions already exist
    let existingInstructions = document.querySelector('.script-instructions');
    if (existingInstructions) {
      existingInstructions.remove();
    }

    const instructionsHTML = `
      <div class="script-instructions">
        <h3>Script Installation</h3>
        <p><strong>RabbitLoader Defer Configuration</strong> - Controls when scripts load on your store pages</p>
        
        <div class="script-actions">
          <button class="btn btn-primary" onclick="dashboard.autoInjectScript()">Auto-Inject Defer Script</button>
        </div>
        
        <div class="script-tag-box">
          <h4>Defer Script Tag:</h4>
          <div class="copy-container">
            <code>${this.escapeHtml(data.scriptTag)}</code>
            <button class="copy-btn" onclick="dashboard.copyToClipboard('${this.escapeHtml(data.scriptTag)}')">Copy</button>
          </div>
          <small style="color: #666; display: block; margin-top: 8px;">
            This script manages script loading behavior and improves page speed by deferring non-critical scripts.
          </small>
        </div>
        
        <details class="manual-steps">
          <summary>Manual Installation Steps</summary>
          <ol>
            <li>${data.instructions.step1}</li>
            <li>${data.instructions.step2}</li>
            <li>${data.instructions.step3}</li>
            <li>${data.instructions.step4}</li>
            <li><strong>${data.instructions.step5}</strong></li>
            <li>Copy and paste the defer script tag above</li>
            <li>${data.instructions.step6}</li>
            <li>${data.instructions.step7}</li>
            <li><strong>Configure:</strong> ${data.instructions.step8}</li>
          </ol>
          
          <div style="margin-top: 15px; padding: 12px; background: #e3f2fd; border-radius: 4px;">
            <strong>What this script does:</strong>
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li>Controls when JavaScript files load on your pages</li>
              <li>Defers non-critical scripts to improve initial page load speed</li>
              <li>Can block unwanted scripts entirely</li>
              <li>Configurable through the defer configuration interface</li>
            </ul>
          </div>
        </details>
      </div>
    `;

    // Add to connected state
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (connectedSection) {
      connectedSection.insertAdjacentHTML('beforeend', instructionsHTML);
    }
  }

  async autoInjectScript() {
    if (!this.shop) {
      this.showError('Shop parameter is required');
      return;
    }

    try {
      this.showInfo('Attempting automatic script injection...');

      const response = await fetch('/shopify/inject-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shop: this.shop })
      });

      const data = await response.json();

      if (data.ok) {
        this.showSuccess(`Script injection successful! ${data.message}`);
        
        // Refresh status after injection
        setTimeout(() => {
          this.checkStatus();
        }, 2000);
      } else {
        this.showError(`Script injection failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Auto inject error:', error);
      this.showError('Failed to inject script automatically');
    }
  }

  async disconnect() {
    if (!confirm('Are you sure you want to disconnect RabbitLoader from your store?')) {
      return;
    }

    try {
      this.showInfo('Disconnecting...');

      const response = await fetch('/shopify/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shop: this.shop })
      });

      const data = await response.json();

      if (data.ok) {
        this.showSuccess('Successfully disconnected from RabbitLoader');
        this.isRLConnected = false;
        this.currentDID = null;
        this.dashboardData = null;
        this.updateUI();
      } else {
        this.showError(`Disconnect failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      this.showError('Failed to disconnect');
    }
  }

  initiateRabbitLoaderConnection() {
    if (!this.shop) {
      this.showError('Shop parameter is required for connection');
      return;
    }

    console.log(`Initiating RabbitLoader connection for shop: ${this.shop}`);

    // Build RabbitLoader connect URL
    const connectUrl = new URL('https://rabbitloader.com/account/');
    connectUrl.searchParams.set('source', 'shopify');
    connectUrl.searchParams.set('action', 'connect');
    connectUrl.searchParams.set('site_url', `https://${this.shop}`);
    
    // Build redirect URL back to this app
    const redirectUrl = new URL('/rl/rl-callback', window.env.APP_URL);
    redirectUrl.searchParams.set('shop', this.shop);
    if (this.host) {
      redirectUrl.searchParams.set('host', this.host);
    }
    
    connectUrl.searchParams.set('redirect_url', redirectUrl.toString());
    connectUrl.searchParams.set('cms_v', 'shopify');
    connectUrl.searchParams.set('plugin_v', '1.0.0');

    const finalUrl = connectUrl.toString();
    console.log('Redirecting to RabbitLoader connect:', finalUrl);

    // For embedded apps, use top-level navigation to break out of frame
    if (this.embedded || window.top !== window.self) {
      window.top.location.href = finalUrl;
    } else {
      window.location.href = finalUrl;
    }
  }

  async refreshData() {
    this.showInfo('Refreshing dashboard data...');
    await this.loadDashboardData();
    
    // Remove existing dashboard and re-render
    const existingDashboard = document.querySelector('.enhanced-dashboard');
    if (existingDashboard) {
      existingDashboard.remove();
    }
    this.renderEnhancedDashboard();
    this.showSuccess('Dashboard data refreshed!');
  }

  // Utility methods
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess('Copied to clipboard!');
    } catch (err) {
      console.error('Copy failed:', err);
      this.showError('Failed to copy to clipboard');
    }
  }

  showFlashMessage(message, type = 'info') {
    if (!this.flashMessages) return;

    const flash = document.createElement('div');
    flash.className = `flash-message ${type}`;
    flash.textContent = message;

    this.flashMessages.appendChild(flash);

    // Auto remove after 5 seconds
    setTimeout(() => {
      flash.classList.add('fade-out');
      setTimeout(() => {
        if (flash.parentNode) {
          flash.parentNode.removeChild(flash);
        }
      }, 500);
    }, 5000);
  }

  showSuccess(message) {
    console.log('Success:', message);
    this.showFlashMessage(message, 'success');
  }

  showError(message) {
    console.error('Error:', message);
    this.showFlashMessage(message, 'error');
  }

  showInfo(message) {
    console.log('Info:', message);
    this.showFlashMessage(message, 'info');
  }
}

// Initialize dashboard when DOM is loaded
let dashboard;
document.addEventListener('DOMContentLoaded', function() {
  dashboard = new RabbitLoaderDashboard();
});

// Make dashboard available globally for button callbacks
window.dashboard = dashboard;