// Frontend Dashboard Logic for RabbitLoader Shopify App - FIXED VERSION
class RabbitLoaderDashboard {
  constructor() {
    this.shop = window.appState.shop || new URLSearchParams(window.location.search).get('shop');
    this.host = window.appState.host || new URLSearchParams(window.location.search).get('host');
    this.embedded = window.appState.embedded || (new URLSearchParams(window.location.search).get('embedded') === '1');
    this.isRLConnected = false;
    this.currentDID = null;
    this.history = [];
    this.dashboardData = null;
    
    // Performance data
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

    this.setupEventListeners();
    await this.checkStatus();
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

    // Handle URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === '1') {
      this.showSuccess('Successfully connected to RabbitLoader!');
      setTimeout(() => this.checkStatus(), 1000);
    }

    // Handle trigger_setup flag (disabled - not implemented yet)
    if (urlParams.get('trigger_setup') === '1') {
      console.log('Setup trigger detected - but setup flow not implemented yet');
      this.showInfo('⚠️ Connected successfully! Please configure manually from the dashboard.');
      
      // Remove the trigger_setup flag from URL
      const url = new URL(window.location);
      url.searchParams.delete('trigger_setup');
      window.history.replaceState({}, '', url);
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
      const response = await fetch(`/rl/status?shop=${encodeURIComponent(this.shop)}`);
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
          await this.loadHomepagePerformance();
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
      const response = await fetch(`/rl/dashboard-data?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.dashboardData = data.data;
        console.log('Dashboard data loaded:', this.dashboardData);
      } else {
        console.warn('Failed to load dashboard data:', data.error);
        // Minimal fallback
        this.dashboardData = {
          did: this.currentDID || 'unknown',
          reports_url: `https://rabbitloader.com/account/`,
          customize_url: `https://rabbitloader.com/account/`
        };
      }
    } catch (error) {
      console.error('Dashboard data error:', error);
      this.dashboardData = {
        did: this.currentDID || 'unknown',
        reports_url: `https://rabbitloader.com/account/`,
        customize_url: `https://rabbitloader.com/account/`
      };
    }
  }

  // ============================================================
  // PERFORMANCE DATA WITH BROWSER CACHE
  // ============================================================

  getPerformanceCacheKey(page) {
    return `rl_perf_${this.shop}_${page}`;
  }

  getCachedPerformance(page) {
    const key = this.getPerformanceCacheKey(page);
    const cached = localStorage.getItem(key);

    if (!cached) {
      return null;
    }

    try {
      const data = JSON.parse(cached);
      
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

  clearPerformanceCache(page) {
    if (page) {
      const key = this.getPerformanceCacheKey(page);
      localStorage.removeItem(key);
      console.log(`🗑️ Cleared ${page} cache`);
    } else {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`rl_perf_${this.shop}_`)) {
          localStorage.removeItem(key);
        }
      });
      console.log('🗑️ Cleared all performance caches');
    }
  }

  async loadHomepagePerformance() {
    try {
      const cached = this.getCachedPerformance('homepage');
      
      if (cached) {
        this.performanceData.homepage = cached;
        this.displayHomepagePerformance(cached);
        return;
      }

      console.log('📡 Fetching homepage performance from API...');

      const response = await fetch(`/api/performance/homepage?shop=${encodeURIComponent(this.shop)}`);
      const result = await response.json();

      if (result.ok) {
        this.setCachedPerformance('homepage', result.data);
        this.performanceData.homepage = result.data;
        this.displayHomepagePerformance(result.data);
      } else {
        console.error('Failed to load homepage performance:', result.error);
      }

    } catch (error) {
      console.error('Homepage performance load error:', error);
    }
  }

  async loadTemplatePerformance(templateType) {
    try {
      const cached = this.getCachedPerformance(templateType);
      
      if (cached) {
        this.performanceData[templateType] = cached;
        this.displayTemplatePerformance(templateType, cached);
        return;
      }

      this.showTemplateLoading(templateType);

      console.log(`📡 Fetching ${templateType} performance from API...`);

      const response = await fetch(`/api/performance/template?shop=${encodeURIComponent(this.shop)}&type=${templateType}`);
      const result = await response.json();

      if (result.ok) {
        this.setCachedPerformance(templateType, result.data);
        this.performanceData[templateType] = result.data;
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

  async refreshPerformanceData(page = 'homepage') {
    this.clearPerformanceCache(page);
    
    if (page === 'homepage') {
      await this.loadHomepagePerformance();
    } else {
      await this.loadTemplatePerformance(page);
    }
    
    this.showSuccess(`${page} performance data refreshed!`);
  }

  displayHomepagePerformance(data) {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection) return;

    const existing = document.querySelector('.performance-section');
    if (existing) existing.remove();

    const html = this.buildPerformanceHTML(data, 'homepage');
    connectedSection.insertAdjacentHTML('beforeend', html);
  }

  displayTemplatePerformance(templateType, data) {
    const container = document.getElementById(`${templateType}-performance`);
    if (!container) return;

    const html = this.buildPerformanceHTML(data, templateType);
    container.innerHTML = html;
  }

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

  getPageTitle(pageType) {
    const titles = {
      homepage: 'Homepage',
      product: 'Product Pages',
      collection: 'Collection Pages',
      blog: 'Blog Posts'
    };
    return titles[pageType] || pageType;
  }

  formatTime(ms) {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  formatDateRange(period) {
    if (!period) return 'N/A';
    const first = period.first_date;
    const last = period.last_date;
    if (!first || !last) return 'N/A';
    return `${first.year}-${first.month}-${first.day} to ${last.year}-${last.month}-${last.day}`;
  }

  // ============================================================
  // END: PERFORMANCE DATA
  // ============================================================

  updateUI() {
    console.log('Updating UI, connected:', this.isRLConnected);
    
    // Update store names - remove .myshopify.com
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

    if (this.isRLConnected) {
      this.showConnectedState();
    } else {
      this.showDisconnectedState();
    }
    
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
      
      if (this.dashboardData) {
        this.renderEnhancedDashboard();
        this.loadPagesAndTemplates();
      }
    }
    if (this.disconnectedState) {
      this.disconnectedState.style.display = 'none';
    }
  }

  renderEnhancedDashboard() {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection || !this.dashboardData) return;

    if (document.querySelector('.enhanced-dashboard')) return;

    // Update store stats
    this.updateStoreStats();

    // Simple status indicator
    const dashboardHTML = `
      <div class="enhanced-dashboard">
        <div style="margin: 20px 0; padding: 15px; background: #e8f5e9; border-radius: 8px; border-left: 4px solid #4caf50; text-align: center;">
          <strong>✅ Connected to RabbitLoader</strong>
          <p style="margin: 5px 0 0 0; color: #666;">DID: ${this.currentDID}</p>
        </div>
      </div>
    `;

    connectedSection.insertAdjacentHTML('beforeend', dashboardHTML);
  }

  // ============================================================
  // PAGES MANAGEMENT
  // ============================================================
  
  async loadPagesAndTemplates() {
    try {
      this.showInfo('Loading pages...');
      
      // Load first page
      const response = await fetch(`/rl/pages-list?shop=${encodeURIComponent(this.shop)}&page=1&limit=100`);
      const data = await response.json();
      
      if (data.ok) {
        this.pagesData = data.data;
        this.currentPage = 1;
        this.hasMorePages = data.data.has_more;
        this.renderPagesManagement();
        
        console.log(`Loaded ${data.data.total_pages} of ${data.data.total_pages_count} pages`);
      } else {
        console.error('Failed to load pages:', data.error);
        this.showError('Failed to load pages: ' + data.error);
      }
    } catch (error) {
      console.error('Pages load error:', error);
      this.showError('Failed to load pages');
    }
  }

  renderPagesManagement() {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection) return;
    
    const existing = document.querySelector('.pages-management-section');
    if (existing) existing.remove();
    
    const { templates, all_pages, total_pages_count, page, has_more } = this.pagesData;
    
    const html = `
      <div class="pages-management-section" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">📄 Pages & Performance</h2>
            <p style="margin: 4px 0 0 0; color: #666; font-size: 14px;">Manage ${total_pages_count} pages across ${Object.keys(templates).length} templates</p>
          </div>
        </div>
        
        <!-- Search Bar -->
        <div style="margin-bottom: 20px;">
          <input 
            type="text" 
            id="pageSearch" 
            placeholder="🔍 Search pages by URL or title..." 
            style="width: 100%; padding: 12px 16px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 14px; transition: all 0.2s;"
            onfocus="this.style.borderColor='#4f46e5'; this.style.boxShadow='0 0 0 3px rgba(79, 70, 229, 0.1)'"
            onblur="this.style.borderColor='#e0e0e0'; this.style.boxShadow='none'"
          >
        </div>
        
        <!-- Modern Table -->
        <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                <th style="padding: 16px; text-align: left; font-weight: 600; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">URL</th>
                <th style="padding: 16px; text-align: center; font-weight: 600; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; width: 100px;">Mobile</th>
                <th style="padding: 16px; text-align: center; font-weight: 600; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; width: 100px;">Desktop</th>
                <th style="padding: 16px; text-align: center; font-weight: 600; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; width: 120px;">Critical CSS</th>
                <th style="padding: 16px; text-align: center; font-weight: 600; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; width: 100px;">JS Scripts</th>
                <th style="padding: 16px; text-align: center; font-weight: 600; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; width: 200px;">Actions</th>
              </tr>
            </thead>
            <tbody id="pagesTableBody">
              ${this.renderPagesRows(all_pages)}
            </tbody>
          </table>
        </div>
        
        <!-- Pagination -->
        ${has_more ? `
          <div style="text-align: center; margin-top: 24px;">
            <button class="btn-modern" onclick="dashboard.loadMorePages()" style="padding: 12px 24px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-weight: 500; cursor: pointer; transition: all 0.2s;">
              Load More Pages (${all_pages.length} of ${total_pages_count} loaded)
            </button>
          </div>
        ` : `
          <div style="text-align: center; margin-top: 24px; color: #666; font-size: 14px;">
            ✅ All ${total_pages_count} pages loaded
          </div>
        `}
        
        <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center; font-size: 13px; color: #64748b;">
          Showing ${all_pages.length} of ${total_pages_count} pages
        </div>
      </div>
    `;
    
    connectedSection.insertAdjacentHTML('beforeend', html);
    this.setupPagesEventListeners();
  }

  renderPagesRows(pages) {
    return pages.map((page, index) => {
      const rowId = `page-row-${index}`;
      const expandedId = `page-expanded-${index}`;
      
      return `
        <tr id="${rowId}" style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;" 
            data-template="${page.template}" 
            data-url="${page._doc?.url || ''}"
            data-page-id="${page._doc?.id || index}"
            onmouseenter="this.style.background='#f8fafc'" 
            onmouseleave="this.style.background='white'">
          <td style="padding: 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <button onclick="dashboard.toggleRowExpand('${rowId}', '${expandedId}')" 
                      style="background: none; border: none; cursor: pointer; font-size: 16px; padding: 0; color: #64748b; transition: transform 0.2s;"
                      id="expand-icon-${rowId}">
                ▶
              </button>
              <div>
                <div style="font-weight: 500; color: #1a1a1a; font-size: 14px;">${page._doc?.title || page._doc?.url || 'Untitled'}</div>
                <div style="color: #64748b; font-size: 12px; margin-top: 2px;">${page._doc?.url || 'No URL'}</div>
              </div>
            </div>
          </td>
          <td style="padding: 16px; text-align: center;">
            <span style="display: inline-block; padding: 4px 12px; background: #f1f5f9; color: #475569; border-radius: 6px; font-size: 13px; font-weight: 500;">
              --
            </span>
          </td>
          <td style="padding: 16px; text-align: center;">
            <span style="display: inline-block; padding: 4px 12px; background: #f1f5f9; color: #475569; border-radius: 6px; font-size: 13px; font-weight: 500;">
              --
            </span>
          </td>
          <td style="padding: 16px; text-align: center;">
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: #dcfce7; color: #166534; border-radius: 6px; font-size: 12px; font-weight: 500;">
              <span style="font-size: 10px;">✓</span> Enabled
            </span>
          </td>
          <td style="padding: 16px; text-align: center;">
            <span style="color: #64748b; font-size: 13px;">${page.js_defer_count || 0} deferred</span>
          </td>
          <td style="padding: 16px; text-align: center;">
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button onclick="dashboard.analyzePage('${page._doc?.id || index}', '${page._doc?.url || ''}')"
                      style="padding: 6px 12px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; color: #4f46e5; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px;"
                      onmouseover="this.style.background='#eef2ff'; this.style.borderColor='#4f46e5'"
                      onmouseout="this.style.background='white'; this.style.borderColor='#e2e8f0'">
                🔍 Analyze
              </button>
              <button onclick="dashboard.toggleRowExpand('${rowId}', '${expandedId}')" 
                      style="padding: 6px 12px; background: #4f46e5; border: none; border-radius: 6px; color: white; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px;"
                      onmouseover="this.style.background='#4338ca'"
                      onmouseout="this.style.background='#4f46e5'">
                ⚙️ Customize
              </button>
            </div>
          </td>
        </tr>
        <tr id="${expandedId}" style="display: none; background: #f8fafc;">
          <td colspan="6" style="padding: 0;">
            <div style="padding: 24px; border-top: 1px solid #e2e8f0;">
              ${this.renderExpandedRowContent(page, index)}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  
  renderExpandedRowContent(page, index) {
    // Mock JS files - in production, fetch from API
    const jsFiles = [
      { url: 'cdn.shopify.com/shopifycloud/privacy-banner.js', currentAction: 'defer' },
      { url: 'cdn.shopify.com/s/files/theme.js', currentAction: 'load' },
      { url: 'www.google-analytics.com/analytics.js', currentAction: 'defer' },
    ];
    
    return `
      <div style="display: grid; gap: 24px;">
        <!-- JS Files Section -->
        <div>
          <h4 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #1a1a1a; display: flex; align-items: center; gap: 8px;">
            ⚙️ JavaScript Files
          </h4>
          <div style="display: grid; gap: 12px;">
            ${jsFiles.map((file, fileIndex) => `
              <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <div style="font-size: 13px; color: #475569; margin-bottom: 12px; font-family: 'Courier New', monospace;">
                  📦 ${file.url}
                </div>
                <div style="display: flex; gap: 8px;">
                  ${['defer', 'load', 'async', 'block'].map(action => `
                    <button onclick="dashboard.changeJSAction('${page.id || index}', '${file.url}', '${action}', '${page.template}')"
                            style="flex: 1; padding: 8px 12px; border: 1px solid ${file.currentAction === action ? '#4f46e5' : '#e2e8f0'}; 
                                   background: ${file.currentAction === action ? '#4f46e5' : 'white'}; 
                                   color: ${file.currentAction === action ? 'white' : '#64748b'}; 
                                   border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-transform: capitalize;"
                            onmouseover="if('${file.currentAction}' !== '${action}') { this.style.borderColor='#cbd5e1'; this.style.background='#f8fafc'; }"
                            onmouseout="if('${file.currentAction}' !== '${action}') { this.style.borderColor='#e2e8f0'; this.style.background='white'; }">
                      ${action}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <!-- Critical CSS Section -->
        <div>
          <h4 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #1a1a1a; display: flex; align-items: center; gap: 8px;">
            🎨 Critical CSS
          </h4>
          <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="display: flex; gap: 8px;">
              <button onclick="dashboard.changeCriticalCSS('${page.id || index}', true, '${page.template}')"
                      style="flex: 1; padding: 12px 16px; border: 1px solid #4f46e5; background: #4f46e5; color: white; 
                             border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;">
                Enabled
              </button>
              <button onclick="dashboard.changeCriticalCSS('${page.id || index}', false, '${page.template}')"
                      style="flex: 1; padding: 12px 16px; border: 1px solid #e2e8f0; background: white; color: #64748b; 
                             border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                      onmouseover="this.style.borderColor='#cbd5e1'; this.style.background='#f8fafc'"
                      onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white'">
                Disabled
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  toggleRowExpand(rowId, expandedId) {
    const expandedRow = document.getElementById(expandedId);
    const icon = document.getElementById(`expand-icon-${rowId}`);
    
    if (expandedRow.style.display === 'none') {
      expandedRow.style.display = 'table-row';
      icon.textContent = '▼';
      icon.style.transform = 'rotate(0deg)';
    } else {
      expandedRow.style.display = 'none';
      icon.textContent = '▶';
    }
  }

  async analyzePage(pageId, url) {
  this.showInfo(`🔍 Analyzing ${url}...`);
  
  try {
    // Step 1: Queue the analysis
    const response = await fetch(`/rl/analyze-page?shop=${encodeURIComponent(this.shop)}&url=${encodeURIComponent(url)}`);
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error || 'Analysis failed');
    }
    
    // If cached result, display immediately
    if (data.status === 'completed' || data.scores) {
      this.displayPageScores(url, data.scores);
      this.showSuccess(`✅ Analysis complete! Mobile: ${data.scores.mobile}, Desktop: ${data.scores.desktop}`);
      return;
    }
    
    // If queued or analyzing, start polling
    if (data.status === 'queued' || data.status === 'analyzing') {
      this.showInfo(`⏳ Analysis queued. Checking for results every 5 seconds...`);
      
      // Poll every 5 seconds for up to 2 minutes
      const pollInterval = setInterval(async () => {
        try {
          const pollResponse = await fetch(`/rl/get-page-performance?shop=${encodeURIComponent(this.shop)}&url=${encodeURIComponent(url)}`);
          const pollData = await pollResponse.json();
          
          if (pollData.status === 'completed' && pollData.scores) {
            clearInterval(pollInterval);
            this.displayPageScores(url, pollData.scores);
            this.showSuccess(`✅ Analysis complete! Mobile: ${pollData.scores.mobile}, Desktop: ${pollData.scores.desktop}`);
          } else if (pollData.status === 'failed') {
            clearInterval(pollInterval);
            this.showError(`❌ Analysis failed: ${pollData.error}`);
          } else {
            console.log(`⏳ Still analyzing... Status: ${pollData.status}`);
          }
        } catch (pollError) {
          console.error('Polling error:', pollError);
        }
      }, 5000);
      
      // Stop polling after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        this.showError('⏱️ Analysis timeout. Please try again.');
      }, 120000);
    }
  } catch (error) {
    console.error('Analysis error:', error);
    this.showError(`Failed to analyze ${url}: ${error.message}`);
  }
}

displayPageScores(url, scores) {
  const row = document.querySelector(`tr[data-url="${url}"]`);
  if (!row) return;
  
  const mobileTd = row.children[1];
  const desktopTd = row.children[2];
  
  mobileTd.innerHTML = `
    <span style="display: inline-block; padding: 4px 12px; background: ${this.getScoreColor(scores.mobile)}; color: white; border-radius: 6px; font-size: 13px; font-weight: 500;">
      ${scores.mobile}
    </span>
  `;
  
  desktopTd.innerHTML = `
    <span style="display: inline-block; padding: 4px 12px; background: ${this.getScoreColor(scores.desktop)}; color: white; border-radius: 6px; font-size: 13px; font-weight: 500;">
      ${scores.desktop}
    </span>
  `;
}
  
  getScoreColor(score) {
    if (score >= 90) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  changeJSAction(pageId, scriptUrl, action, template) {
    const templateData = this.pagesData.templates[template];
    const pageCount = templateData ? templateData.count : 1;
    this.showScopeModal('js', action, scriptUrl, pageId, template, pageCount);
  }

  changeCriticalCSS(pageId, enabled, template) {
    const templateData = this.pagesData.templates[template];
    const pageCount = templateData ? templateData.count : 1;
    this.showScopeModal('css', enabled ? 'enabled' : 'disabled', null, pageId, template, pageCount);
  }

  showScopeModal(type, value, scriptUrl, pageId, template, pageCount) {
    const isJS = type === 'js';
    const title = isJS ? '⚙️ Apply JavaScript Rule' : '🎨 Critical CSS Setting';
    const description = isJS 
      ? `You selected: <strong>${value}</strong><br>For script: <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${scriptUrl}</code>`
      : `You selected: <strong>${value === 'enabled' ? 'Enabled' : 'Disabled'}</strong>`;
    
    const templateName = template.charAt(0).toUpperCase() + template.slice(1);
    
    const modalHTML = `
      <div class="modal-overlay-modern" onclick="dashboard.closeModal()" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000; backdrop-filter: blur(4px);">
        <div onclick="event.stopPropagation()" style="background: white; border-radius: 16px; max-width: 500px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); animation: modalSlideIn 0.2s ease-out;">
          <div style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
            <h3 style="margin: 0; font-size: 20px; font-weight: 600; color: #1a1a1a;">${title}</h3>
            <p style="margin: 8px 0 0 0; color: #64748b; font-size: 14px; line-height: 1.5;">${description}</p>
          </div>
          
          <div style="padding: 24px;">
            <div style="margin-bottom: 16px;">
              <p style="margin: 0 0 16px 0; font-weight: 500; color: #475569; font-size: 14px;">Apply this ${isJS ? 'rule' : 'setting'} to:</p>
              
              <label style="display: flex; align-items: center; padding: 16px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; margin-bottom: 12px; transition: all 0.2s;"
                     onmouseover="this.style.borderColor='#4f46e5'; this.style.background='#f8fafc'"
                     onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white'">
                <input type="radio" name="scope" value="page" checked style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                <div>
                  <div style="font-weight: 500; color: #1a1a1a; font-size: 14px;">This page only</div>
                  <div style="color: #64748b; font-size: 12px; margin-top: 2px;">Apply to current page</div>
                </div>
              </label>
              
              <label style="display: flex; align-items: center; padding: 16px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; margin-bottom: 12px; transition: all 0.2s;"
                     onmouseover="this.style.borderColor='#4f46e5'; this.style.background='#f8fafc'"
                     onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white'">
                <input type="radio" name="scope" value="template" style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                <div>
                  <div style="font-weight: 500; color: #1a1a1a; font-size: 14px;">All ${templateName} pages</div>
                  <div style="color: #64748b; font-size: 12px; margin-top: 2px;">Apply to all ${pageCount} pages in this category</div>
                </div>
              </label>
              
              <label style="display: flex; align-items: center; padding: 16px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s;"
                     onmouseover="this.style.borderColor='#4f46e5'; this.style.background='#f8fafc'"
                     onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white'">
                <input type="radio" name="scope" value="global" style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;">
                <div>
                  <div style="font-weight: 500; color: #1a1a1a; font-size: 14px;">Entire website</div>
                  <div style="color: #64748b; font-size: 12px; margin-top: 2px;">Apply to all ${this.pagesData.total_pages_count} pages</div>
                </div>
              </label>
            </div>
          </div>
          
          <div style="padding: 16px 24px 24px 24px; display: flex; gap: 12px; justify-content: flex-end;">
            <button onclick="dashboard.closeModal()" 
                    style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; color: #64748b; border-radius: 8px; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                    onmouseover="this.style.background='#f8fafc'"
                    onmouseout="this.style.background='white'">
              Cancel
            </button>
            <button onclick="dashboard.applyScope('${type}', '${value}', '${scriptUrl}', '${pageId}', '${template}')" 
                    style="padding: 10px 20px; border: none; background: #4f46e5; color: white; border-radius: 8px; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                    onmouseover="this.style.background='#4338ca'"
                    onmouseout="this.style.background='#4f46e5'">
              Apply ✓
            </button>
          </div>
        </div>
      </div>
      
      <style>
        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  closeModal() {
    const modal = document.querySelector('.modal-overlay-modern');
    if (modal) modal.remove();
  }

  async applyScope(type, value, scriptUrl, pageId, template) {
    const scope = document.querySelector('input[name="scope"]:checked').value;
    
    let scopeText = '';
    if (scope === 'page') scopeText = 'this page';
    else if (scope === 'template') scopeText = `all ${template} pages`;
    else scopeText = 'entire website';
    
    this.closeModal();
    this.showInfo(`Applying changes to ${scopeText}...`);
    
    try {
      const endpoint = type === 'js' ? '/rl/apply-js-rule' : '/rl/apply-css-setting';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop: this.shop,
          scope: scope,
          template: template,
          pageId: pageId,
          scriptUrl: scriptUrl,
          action: value,
          enabled: value === 'enabled'
        })
      });
      
      const data = await response.json();
      
      if (data.ok) {
        this.showSuccess(`✅ Successfully applied to ${scopeText}`);
      } else {
        throw new Error(data.error || 'Failed to apply changes');
      }
    } catch (error) {
      console.error('Apply scope error:', error);
      this.showError(`Failed to apply changes: ${error.message}`);
    }
  }

  setupPagesEventListeners() {
    const searchInput = document.getElementById('pageSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterPages(e.target.value);
      });
    }
  }
  
  filterPages(searchTerm) {
    const rows = document.querySelectorAll('#pagesTableBody tr[data-url]');
    let visibleCount = 0;
    
    rows.forEach(row => {
      const url = row.dataset.url.toLowerCase();
      const titleEl = row.querySelector('div[style*="font-weight: 500"]');
      const title = titleEl ? titleEl.textContent.toLowerCase() : '';
      
      const matchesSearch = !searchTerm || 
        url.includes(searchTerm.toLowerCase()) || 
        title.includes(searchTerm.toLowerCase());
      
      if (matchesSearch) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
        const nextRow = row.nextElementSibling;
        if (nextRow && nextRow.id && nextRow.id.startsWith('page-expanded-')) {
          nextRow.style.display = 'none';
        }
      }
    });
    
    console.log(`Filtered: ${visibleCount} pages visible`);
  }

  async loadMorePages() {
    try {
      this.showInfo('Loading more pages...');
      
      const nextPage = this.currentPage + 1;
      const response = await fetch(`/rl/pages-list?shop=${encodeURIComponent(this.shop)}&page=${nextPage}&limit=100`);
      const data = await response.json();
      
      if (data.ok) {
        this.pagesData.all_pages.push(...data.data.all_pages);
        this.pagesData.total_pages = this.pagesData.all_pages.length;
        this.pagesData.has_more = data.data.has_more;
        this.currentPage = nextPage;
        
        const tbody = document.getElementById('pagesTableBody');
        if (tbody) {
          tbody.innerHTML = this.renderPagesRows(this.pagesData.all_pages);
        }
        
        this.showSuccess(`Loaded ${data.data.all_pages.length} more pages`);
      }
    } catch (error) {
      console.error('Load more pages error:', error);
      this.showError('Failed to load more pages');
    }
  }

  getScoreClass(score) {
    if (score >= 90) return 'good';
    if (score >= 50) return 'average';
    return 'poor';
  }

  async updateStoreStats() {
    try {
      const response = await fetch(`/rl/status?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok && !data.site_structure) {
        console.log('Site structure not in status response');
        
        const totalPagesEl = document.getElementById('totalPages');
        const totalTemplatesEl = document.getElementById('totalTemplates');
        
        if (totalPagesEl) totalPagesEl.textContent = '--';
        if (totalTemplatesEl) totalTemplatesEl.textContent = '--';
        
        return;
      }

      if (data.ok && data.site_structure) {
        const { site_structure } = data;
        
        let totalPages = 0;
        let totalTemplates = 0;

        if (site_structure.template_groups) {
          const templates = site_structure.template_groups instanceof Map ?
            Array.from(site_structure.template_groups.entries()) :
            Object.entries(site_structure.template_groups);

          totalTemplates = templates.length;
          templates.forEach(([template, group]) => {
            totalPages += group.count || 0;
          });
        }

        const totalPagesEl = document.getElementById('totalPages');
        const totalTemplatesEl = document.getElementById('totalTemplates');

        if (totalPagesEl) totalPagesEl.textContent = totalPages || '--';
        if (totalTemplatesEl) totalTemplatesEl.textContent = totalTemplates || '--';

        console.log(`Store stats updated: ${totalPages} pages, ${totalTemplates} templates`);
      }
    } catch (error) {
      console.error('Failed to load store stats:', error);
      
      const totalPagesEl = document.getElementById('totalPages');
      const totalTemplatesEl = document.getElementById('totalTemplates');
      
      if (totalPagesEl) totalPagesEl.textContent = '--';
      if (totalTemplatesEl) totalTemplatesEl.textContent = '--';
    }
  }

  showScriptInstructions() {
    this.getManualInstructions();
  }

  async getManualInstructions() {
    try {
      const response = await fetch(`/rl/manual-instructions?shop=${encodeURIComponent(this.shop)}`);
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

      const response = await fetch('/rl/inject-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: this.shop })
      });

      const data = await response.json();

      if (data.ok) {
        this.showSuccess(`Script injection successful! ${data.message}`);
        
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

      const response = await fetch('/rl/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: this.shop })
      });

      const data = await response.json();

      if (data.ok) {
        this.showSuccess('Successfully disconnected from RabbitLoader');
        
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

  initiateRabbitLoaderConnection() {
    if (!this.shop) {
      this.showError('Shop parameter is required for connection');
      return;
    }

    console.log(`Initiating RabbitLoader connection for shop: ${this.shop}`);

    const connectUrl = new URL('https://rabbitloader.com/account/');
    connectUrl.searchParams.set('source', 'shopify');
    connectUrl.searchParams.set('action', 'connect');
    connectUrl.searchParams.set('site_url', `https://${this.shop}`);
    
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

    if (this.embedded || window.top !== window.self) {
      window.top.location.href = finalUrl;
    } else {
      window.location.href = finalUrl;
    }
  }

  async refreshData() {
    this.showInfo('Refreshing dashboard data...');
    await this.loadDashboardData();
    
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