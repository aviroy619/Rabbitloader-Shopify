// Frontend Dashboard Logic for RabbitLoader Shopify App - WITH BROWSER CACHE
class RabbitLoaderDashboard {
  constructor() {
    this.shop = window.appState.shop || new URLSearchParams(window.location.search).get('shop');
    this.host = window.appState.host || new URLSearchParams(window.location.search).get('host');
    this.embedded = window.appState.embedded || (new URLSearchParams(window.location.search).get('embedded') === '1');
    this.isRLConnected = false;
    this.currentDID = null;
    this.history = [];
    this.dashboardData = null;
    
    // NEW: Performance data
    this.performanceData = {
      homepage: null,
      product: null,
      collection: null,
      blog: null
    };
    
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

    // Handle trigger_setup flag (for fresh installs and reinstalls)
    if (urlParams.get('trigger_setup') === '1') {
      console.log('Setup trigger detected - starting complete setup flow');
      this.showInfo('Setting up your store optimization... This may take a few minutes.');
      // Trigger setup after a brief delay to ensure page is ready
      setTimeout(() => this.triggerCompleteSetup(), 2000);
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

        // If connected, load dashboard data and performance data
        if (this.isRLConnected) {
          await this.loadDashboardData();
          await this.loadHomepagePerformance(); // NEW: Load performance data
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

  // ============================================================
  // NEW: PERFORMANCE DATA WITH BROWSER CACHE
  // ============================================================

  // Get cache key for localStorage
  getPerformanceCacheKey(page) {
    return `rl_perf_${this.shop}_${page}`;
  }

  // Get cached performance data from browser
  getCachedPerformance(page) {
    const key = this.getPerformanceCacheKey(page);
    const cached = localStorage.getItem(key);

    if (!cached) {
      return null;
    }

    try {
      const data = JSON.parse(cached);
      
      // Check if expired (1 hour TTL)
      const ONE_HOUR = 3600000;
      if (Date.now() > data.expiresAt) {
        localStorage.removeItem(key);
        return null;
      }

      console.log(`✅ Loaded ${page} performance from browser cache`);
      return data.value;
      
    } catch (error) {
      localStorage.removeItem(key);
      return null;
    }
  }

  // Store performance data in browser cache
  setCachedPerformance(page, data) {
    const key = this.getPerformanceCacheKey(page);
    const ONE_HOUR = 3600000;
    
    const cacheData = {
      value: data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ONE_HOUR
    };

    try {
      localStorage.setItem(key, JSON.stringify(cacheData));
      console.log(`💾 Saved ${page} performance to browser cache`);
    } catch (error) {
      console.warn('Cache storage failed:', error);
    }
  }

  // Clear performance cache
  clearPerformanceCache(page) {
    if (page) {
      const key = this.getPerformanceCacheKey(page);
      localStorage.removeItem(key);
      console.log(`🗑️ Cleared ${page} cache`);
    } else {
      // Clear all performance caches
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`rl_perf_${this.shop}_`)) {
          localStorage.removeItem(key);
        }
      });
      console.log('🗑️ Cleared all performance caches');
    }
  }

  // Load homepage performance data (auto-loads)
  async loadHomepagePerformance() {
    try {
      // 1. Try browser cache first
      const cached = this.getCachedPerformance('homepage');
      
      if (cached) {
        this.performanceData.homepage = cached;
        this.displayHomepagePerformance(cached);
        return;
      }

      // 2. No cache - fetch from API
      console.log('📡 Fetching homepage performance from API...');

      const response = await fetch(`/api/performance/homepage?shop=${encodeURIComponent(this.shop)}`);
      const result = await response.json();

      if (result.ok) {
        // 3. Store in browser cache
        this.setCachedPerformance('homepage', result.data);
        
        // 4. Store in memory
        this.performanceData.homepage = result.data;
        
        // 5. Display
        this.displayHomepagePerformance(result.data);
      } else {
        console.error('Failed to load homepage performance:', result.error);
      }

    } catch (error) {
      console.error('Homepage performance load error:', error);
    }
  }

  // Load template performance (on-demand)
  async loadTemplatePerformance(templateType) {
    try {
      // 1. Try browser cache first
      const cached = this.getCachedPerformance(templateType);
      
      if (cached) {
        this.performanceData[templateType] = cached;
        this.displayTemplatePerformance(templateType, cached);
        return;
      }

      // 2. Show loading indicator
      this.showTemplateLoading(templateType);

      // 3. Fetch from API
      console.log(`📡 Fetching ${templateType} performance from API...`);

      const response = await fetch(`/api/performance/template?shop=${encodeURIComponent(this.shop)}&type=${templateType}`);
      const result = await response.json();

      if (result.ok) {
        // 4. Store in browser cache
        this.setCachedPerformance(templateType, result.data);
        
        // 5. Store in memory
        this.performanceData[templateType] = result.data;
        
        // 6. Display
        this.displayTemplatePerformance(templateType, result.data);
      } else {
        console.error(`Failed to load ${templateType} performance:`, result.error);
        this.showTemplateError(templateType, result.error);
      }

    } catch (error) {
      console.error(`${templateType} performance load error:`, error);
      this.showTemplateError(templateType, error.message);
    }
  }

  // Force refresh performance data (bypass cache)
  async refreshPerformanceData(page = 'homepage') {
    // Clear browser cache
    this.clearPerformanceCache(page);
    
    // Reload
    if (page === 'homepage') {
      await this.loadHomepagePerformance();
    } else {
      await this.loadTemplatePerformance(page);
    }
    
    this.showSuccess(`${page} performance data refreshed!`);
  }

  // Display homepage performance
  displayHomepagePerformance(data) {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection) return;

    // Remove existing performance section
    const existing = document.querySelector('.performance-section');
    if (existing) existing.remove();

    const html = this.buildPerformanceHTML(data, 'homepage');
    connectedSection.insertAdjacentHTML('beforeend', html);
  }

  // Display template performance
  displayTemplatePerformance(templateType, data) {
    const container = document.getElementById(`${templateType}-performance`);
    if (!container) return;

    const html = this.buildPerformanceHTML(data, templateType);
    container.innerHTML = html;
  }

  // Show loading indicator for template
  showTemplateLoading(templateType) {
    const container = document.getElementById(`${templateType}-performance`);
    if (!container) return;

    container.innerHTML = `
      <div class="loading-container">
        <div class="spinner"></div>
        <p>Loading ${templateType} performance data...</p>
      </div>
    `;
  }

  // Show error for template
  showTemplateError(templateType, error) {
    const container = document.getElementById(`${templateType}-performance`);
    if (!container) return;

    container.innerHTML = `
      <div class="error-container">
        <p>❌ Failed to load ${templateType} performance: ${error}</p>
        <button class="btn btn-secondary" onclick="dashboard.loadTemplatePerformance('${templateType}')">Retry</button>
      </div>
    `;
  }

  // Build performance HTML
  buildPerformanceHTML(data, pageType) {
    const daysSinceInstall = data.days_since_install || 0;
    const cruxAvailable = data.crux && data.crux.available;

    return `
      <div class="performance-section" data-page="${pageType}">
        <h3>📊 ${this.getPageTitle(pageType)} Performance</h3>
        
        ${data.psi ? this.buildPSISection(data.psi) : ''}
        
        ${cruxAvailable ? this.buildCrUXSection(data.crux) : this.buildCrUXUnavailableSection(data.crux, daysSinceInstall)}
        
        <div class="performance-actions">
          <button class="btn btn-outline" onclick="dashboard.refreshPerformanceData('${pageType}')">
            🔄 Refresh Data
          </button>
          ${data.psi && data.psi.report_url ? `
            <a href="${data.psi.report_url}" target="_blank" class="btn btn-outline">
              📊 View Full PSI Report
            </a>
          ` : ''}
        </div>
        
        <small style="color: #666; display: block; margin-top: 10px;">
          Last updated: ${new Date(data.fetched_at || Date.now()).toLocaleString()}
          ${this.getCachedPerformance(pageType) ? ' | 💾 From cache' : ' | ⚡ Fresh data'}
        </small>
      </div>
    `;
  }

  // Build PSI section
  buildPSISection(psi) {
    return `
      <div class="psi-section">
        <h4>📈 PageSpeed Insights Score</h4>
        <div class="score-grid">
          <div class="score-card">
            <div class="score-value ${this.getScoreClass(psi.mobile_score)}">
              ${psi.mobile_score}
            </div>
            <div class="score-label">Mobile</div>
          </div>
          <div class="score-card">
            <div class="score-value ${this.getScoreClass(psi.desktop_score)}">
              ${psi.desktop_score}
            </div>
            <div class="score-label">Desktop</div>
          </div>
        </div>
        
        ${psi.lab_data ? this.buildLabDataSection(psi.lab_data) : ''}
      </div>
    `;
  }

  // Build lab data section
  buildLabDataSection(labData) {
    return `
      <div class="lab-data">
        <h5>⚡ Lab Metrics</h5>
        <div class="metrics-grid">
          <div class="metric">
            <span class="metric-label">FCP</span>
            <span class="metric-value">${this.formatTime(labData.fcp)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">LCP</span>
            <span class="metric-value">${this.formatTime(labData.lcp)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">CLS</span>
            <span class="metric-value">${labData.cls}</span>
          </div>
          <div class="metric">
            <span class="metric-label">TBT</span>
            <span class="metric-value">${this.formatTime(labData.tbt)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Build CrUX section (when available)
  buildCrUXSection(crux) {
    return `
      <div class="crux-section">
        <h4>📊 Real User Experience (Last 28 Days)</h4>
        <div class="crux-metrics">
          ${crux.lcp ? `
            <div class="crux-metric">
              <span class="metric-name">Largest Contentful Paint (LCP)</span>
              <span class="metric-value ${crux.lcp.p75 <= 2500 ? 'good' : 'poor'}">
                ${this.formatTime(crux.lcp.p75)}
              </span>
              <span class="metric-detail">${crux.lcp.good_pct}% of users have good experience</span>
            </div>
          ` : ''}
          
          ${crux.fcp ? `
            <div class="crux-metric">
              <span class="metric-name">First Contentful Paint (FCP)</span>
              <span class="metric-value ${crux.fcp.p75 <= 1800 ? 'good' : 'poor'}">
                ${this.formatTime(crux.fcp.p75)}
              </span>
              <span class="metric-detail">${crux.fcp.good_pct}% of users have good experience</span>
            </div>
          ` : ''}
          
          ${crux.cls ? `
            <div class="crux-metric">
              <span class="metric-name">Cumulative Layout Shift (CLS)</span>
              <span class="metric-value ${crux.cls.p75 <= 0.1 ? 'good' : 'poor'}">
                ${crux.cls.p75}
              </span>
              <span class="metric-detail">${crux.cls.good_pct}% of users have good experience</span>
            </div>
          ` : ''}
          
          ${crux.fid ? `
            <div class="crux-metric">
              <span class="metric-name">First Input Delay (FID)</span>
              <span class="metric-value ${crux.fid.p75 <= 100 ? 'good' : 'poor'}">
                ${this.formatTime(crux.fid.p75)}
              </span>
              <span class="metric-detail">${crux.fid.good_pct}% of users have good experience</span>
            </div>
          ` : ''}
        </div>
        <small style="color: #666; display: block; margin-top: 10px;">
          📅 Data collected: ${this.formatDateRange(crux.collection_period)}
        </small>
      </div>
    `;
  }

  // Build CrUX unavailable section (< 28 days)
  buildCrUXUnavailableSection(crux, daysSinceInstall) {
    return `
      <div class="crux-unavailable">
        <h4>📊 Real User Experience (Chrome UX Report)</h4>
        <div class="unavailable-message">
          <div class="icon">⏳</div>
          <h5>COLLECTING DATA...</h5>
          <p>${crux.message || 'Chrome UX Report data is not yet available.'}</p>
          
          ${daysSinceInstall < 28 ? `
            <div class="timeline">
              <div class="timeline-item">
                <strong>📅 Installed:</strong> ${daysSinceInstall} days ago
              </div>
              <div class="timeline-item">
                <strong>⏰ Data available in:</strong> ${crux.days_until_available || (28 - daysSinceInstall)} days
              </div>
            </div>
            
            <div class="explanation">
              <h6>Why the wait?</h6>
              <p>Google's Chrome UX Report collects real user data over a 28-day rolling period. Once 28 days have passed since installation, you'll see:</p>
              <ul>
                <li>✅ Real loading times from actual visitors</li>
                <li>✅ Performance breakdown by device type</li>
                <li>✅ Connection speed analysis</li>
                <li>✅ User experience distribution</li>
              </ul>
            </div>
            
            <p class="meanwhile">
              <strong>In the meantime, your PageSpeed Insights score above shows that optimizations are working! 🚀</strong>
            </p>
          ` : `
            <p>CrUX data may not be available if your site doesn't have enough traffic yet.</p>
          `}
        </div>
      </div>
    `;
  }

  // Helper: Get page title
  getPageTitle(pageType) {
    const titles = {
      homepage: 'Homepage',
      product: 'Product Pages',
      collection: 'Collection Pages',
      blog: 'Blog Posts'
    };
    return titles[pageType] || pageType;
  }

  // Helper: Format time (ms to seconds)
  formatTime(ms) {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // Helper: Format date range
  formatDateRange(period) {
    if (!period) return 'N/A';
    const first = period.first_date;
    const last = period.last_date;
    if (!first || !last) return 'N/A';
    return `${first.year}-${first.month}-${first.day} to ${last.year}-${last.month}-${last.day}`;
  }

  // ============================================================
  // END: PERFORMANCE DATA WITH BROWSER CACHE
  // ============================================================

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
          <div class="actions-section">
            <h3>Quick Actions</h3>
            <div class="action-buttons">
              <a href="${this.dashboardData.reports_url}" target="_blank" class="btn btn-primary">View Reports</a>
              <a href="${this.dashboardData.customize_url}" target="_blank" class="btn btn-outline">Customize Settings</a>
              <button class="btn btn-secondary" onclick="dashboard.showScriptInstructions()">Script Setup</button>
            </div>
          </div>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #e3f2fd; border-radius: 6px; text-align: center;">
          <small>
            <strong>DID:</strong> ${this.currentDID} | 
            <strong>Status:</strong> Active
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

  // ... (rest of your existing methods remain the same)
  
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
        
        // Clear all caches
        this.clearPerformanceCache();
        
        this.isRLConnected = false;
        this.currentDID = null;
        this.dashboardData = null;
        this.performanceData = {
          homepage: null,
          product: null,
          collection: null,
          blog: null
        };
        this.updateUI();
      } else {
        this.showError(`Disconnect failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      this.showError('Failed to disconnect');
    }
  }

  async triggerCompleteSetup() {
    if (!this.shop) {
      this.showError('Shop parameter is required for setup');
      return;
    }

    console.log(`Triggering complete setup for shop: ${this.shop}`);

    try {
      // Step 1: Start the setup (returns immediately)
      this.showInfo('Starting store optimization...');
      
      const startResponse = await fetch('/api/start-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: this.shop })
      });

      const startData = await startResponse.json();

      if (!startData.ok) {
        throw new Error(startData.error || 'Failed to start setup');
      }

      console.log('Setup started, now polling for progress...');
      
      // Step 2: Show progress bar
      this.showProgressBar();
      
      // Step 3: Poll for progress
      await this.pollSetupProgress();
      
    } catch (error) {
      console.error('Complete setup error:', error);
      this.showError('Setup failed: ' + error.message);
      this.hideProgressBar();
    }
  }

  showProgressBar() {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection) return;
    
    // Remove existing progress bar if any
    const existing = document.querySelector('.setup-progress');
    if (existing) existing.remove();
    
    const progressHTML = `
      <div class="setup-progress" style="margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 8px;">
        <h3>🔧 Optimizing Your Store...</h3>
        <div style="margin: 15px 0;">
          <div style="background: #e0e0e0; height: 30px; border-radius: 15px; overflow: hidden;">
            <div id="progress-bar" style="background: linear-gradient(90deg, #4CAF50, #8BC34A); height: 100%; width: 0%; transition: width 0.5s;"></div>
          </div>
          <p id="progress-text" style="margin-top: 10px; font-weight: bold;">Starting... 0%</p>
        </div>
        <div id="progress-steps" style="margin-top: 15px; font-size: 14px;"></div>
        <p style="color: #666; margin-top: 10px;">⏱️ This will take 5-10 minutes. Don't close this page.</p>
      </div>
    `;
    
    connectedSection.insertAdjacentHTML('afterbegin', progressHTML);
  }

  hideProgressBar() {
    const progressBar = document.querySelector('.setup-progress');
    if (progressBar) progressBar.remove();
  }

  async pollSetupProgress() {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes (120 * 5 seconds)
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      try {
        const response = await fetch(`/api/setup-status?shop=${encodeURIComponent(this.shop)}`);
        const data = await response.json();
        
        if (!data.ok) {
          throw new Error(data.error || 'Failed to get status');
        }
        
        // Update progress bar
        this.updateProgressBar(data.progress, data.current_step, data.completed_steps);
        
        // Check if complete
        if (data.progress >= 100 || data.status === 'complete') {
          this.showSuccess('✅ Store optimization complete!');
          this.hideProgressBar();
          
          // Show any warnings
          if (data.warnings && data.warnings.length > 0) {
            data.warnings.forEach(w => this.showInfo(w));
          }
          
          // Refresh dashboard and load performance data
          setTimeout(() => {
            this.checkStatus();
            this.updateUI();
          }, 2000);
          
          return; // Done!
        }
        
        // Check if failed
        if (data.status === 'failed') {
          throw new Error('Setup failed: ' + (data.error || 'Unknown error'));
        }
        
      } catch (error) {
        console.error('Poll error:', error);
        this.showError('Progress check failed: ' + error.message);
        this.hideProgressBar();
        return;
      }
      
      attempts++;
    }
    
    // Timeout
    this.showError('Setup is taking longer than expected. Check back in a few minutes.');
    this.hideProgressBar();
  }

  updateProgressBar(progress, currentStep, completedSteps) {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressSteps = document.getElementById('progress-steps');
    
    if (progressBar) {
      progressBar.style.width = progress + '%';
    }
    
    if (progressText) {
      progressText.textContent = `${currentStep || 'Processing'}... ${progress}%`;
    }
    
    if (progressSteps && completedSteps) {
      const stepsHTML = completedSteps.map(step => 
        `<div style="color: #4CAF50;">✅ ${step}</div>`
      ).join('');
      progressSteps.innerHTML = stepsHTML;
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