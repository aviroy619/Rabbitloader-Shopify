// Simple Dashboard for RabbitLoader Shopify App
console.log('[Dashboard] Loading...');

let shop = null;
let host = null;
let embedded = false;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Dashboard] DOM ready');
  
  // Get parameters
  const urlParams = new URLSearchParams(window.location.search);
  shop = urlParams.get('shop') || window.appState?.shop;
  host = urlParams.get('host') || window.appState?.host;
  embedded = (urlParams.get('embedded') === '1') || window.appState?.embedded;
  
  console.log('[Dashboard] Params:', { shop, host, embedded });
  
  // Load env vars
  await loadEnvVars();
  
  // Initialize App Bridge if embedded
  if (embedded && shop && host) {
    initAppBridge();
  }
  
  // Setup buttons
  setupButtons();
  
  // Check status
  await checkStatus();
  
  // Handle trigger_setup
  if (urlParams.get('trigger_setup') === '1') {
    console.log('[Dashboard] Triggering auto-setup...');
    setTimeout(() => triggerAutoSetup(), 2000);
  }
});

// Load environment variables
async function loadEnvVars() {
  try {
    const response = await fetch('/api/env');
    const data = await response.json();
    if (data.ok) {
      window.env = data.env;
      console.log('[Dashboard] Env loaded');
    }
  } catch (error) {
    console.error('[Dashboard] Failed to load env:', error);
    window.env = { APP_URL: window.location.origin, SHOPIFY_API_KEY: '' };
  }
}

// Initialize Shopify App Bridge
function initAppBridge() {
  try {
    if (window.AppBridge && window.env.SHOPIFY_API_KEY) {
      const app = window.AppBridge.createApp({
        apiKey: window.env.SHOPIFY_API_KEY,
        host: host,
        forceRedirect: true
      });
      console.log('[Dashboard] App Bridge initialized');
    }
  } catch (error) {
    console.error('[Dashboard] App Bridge failed:', error);
  }
}

// Setup button listeners
function setupButtons() {
  // Activate button
  const activateBtn = document.getElementById('activateBtn');
  if (activateBtn) {
    activateBtn.onclick = (e) => {
      e.preventDefault();
      connectToRabbitLoader();
    };
  }
  
  // Disconnect button
  const disconnectBtn = document.getElementById('disconnectBtn');
  if (disconnectBtn) {
    disconnectBtn.onclick = (e) => {
      e.preventDefault();
      disconnectFromRabbitLoader();
    };
  }
}

// Check connection status
async function checkStatus() {
  if (!shop) {
    showError('Shop parameter missing');
    return;
  }
  
  try {
    console.log('[Dashboard] Checking status for:', shop);
    
    const response = await fetch(`/api/status?shop=${encodeURIComponent(shop)}`);
    const data = await response.json();
    
    console.log('[Dashboard] Status:', data);
    
    updateUI(data);
  } catch (error) {
    console.error('[Dashboard] Status check failed:', error);
    showError('Failed to check status');
  }
}

// Update UI based on status
function updateUI(statusData) {
  const { connected, did, shop: shopName } = statusData;
  
  // Update store names
  const storeElements = [
    document.getElementById('storeName'),
    document.getElementById('storeNameDisconnected'),
    document.getElementById('storeNameConnected')
  ];
  
  storeElements.forEach(el => {
    if (el) {
      el.textContent = shopName ? shopName.replace('.myshopify.com', '') : 'Your Store';
    }
  });
  
  // Hide loading
  const loadingState = document.getElementById('loadingState');
  if (loadingState) {
    loadingState.style.display = 'none';
  }
  
  // Show correct state
  const disconnectedState = document.getElementById('disconnectedState');
  const connectedState = document.getElementById('connectedState');
  
  if (connected && did) {
    console.log('[Dashboard] Showing connected state');
    if (connectedState) connectedState.style.display = 'block';
    if (disconnectedState) disconnectedState.style.display = 'none';
  } else {
    console.log('[Dashboard] Showing disconnected state');
    if (disconnectedState) disconnectedState.style.display = 'block';
    if (connectedState) connectedState.style.display = 'none';
  }
}

// Connect to RabbitLoader
function connectToRabbitLoader() {
  if (!shop) {
    showError('Shop parameter missing');
    return;
  }
  
  console.log('[Dashboard] Connecting to RabbitLoader...');
  
  const connectUrl = `/rl/rl-connect?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || '')}`;
  
  console.log('[Dashboard] Redirecting to:', connectUrl);
  window.location.href = connectUrl;
}

// Disconnect from RabbitLoader
async function disconnectFromRabbitLoader() {
  if (!confirm('Disconnect RabbitLoader? This will remove optimizations.')) {
    return;
  }
  
  try {
    showInfo('Disconnecting...');
    
    const response = await fetch(`/rl/rl-disconnect?shop=${encodeURIComponent(shop)}`);
    const data = await response.json();
    
    if (data.ok) {
      showSuccess('Disconnected successfully');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showError(data.error || 'Disconnection failed');
    }
  } catch (error) {
    console.error('[Dashboard] Disconnect error:', error);
    showError('Failed to disconnect');
  }
}

// Trigger complete auto-setup
async function triggerAutoSetup() {
  if (!shop) return;
  
  console.log('[Dashboard] Starting auto-setup...');
  showInfo('Running auto-setup... This may take a few minutes.');
  
  try {
    const response = await fetch('/api/complete-auto-setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shop': shop
      },
      body: JSON.stringify({ shop })
    });
    
    const data = await response.json();
    
    console.log('[Dashboard] Auto-setup result:', data);
    
    if (data.ok) {
      const steps = [
        data.site_analysis_completed,
        data.css_generated,
        data.psi_completed,
        data.defer_script_injected,
        data.critical_css_injected
      ];
      const successCount = steps.filter(Boolean).length;
      
      showSuccess(`Setup complete! ${successCount}/5 steps successful`);
      
      if (data.warnings && data.warnings.length > 0) {
        console.warn('[Dashboard] Setup warnings:', data.warnings);
      }
      
      // Reload status
      setTimeout(() => checkStatus(), 2000);
    } else {
      showError(data.error || 'Setup failed');
    }
  } catch (error) {
    console.error('[Dashboard] Auto-setup error:', error);
    showError('Setup failed. Please try manual setup or contact support.');
  }
}

// Button handlers (for onclick in HTML)
function openScriptConfiguration() {
  showInfo('Script configuration coming soon!');
}

function openReports() {
  window.open('https://rabbitloader.com/account/', '_blank');
}

// Flash messages
function showFlashMessage(message, type) {
  let container = document.getElementById('flashMessages');
  
  if (!container) {
    container = document.createElement('div');
    container.id = 'flashMessages';
    document.body.appendChild(container);
  }
  
  const flash = document.createElement('div');
  flash.className = `flash-message ${type}`;
  flash.textContent = message;
  
  container.appendChild(flash);
  
  setTimeout(() => {
    flash.classList.add('fade-out');
    setTimeout(() => flash.remove(), 500);
  }, 5000);
}

function showSuccess(msg) {
  console.log('[Success]', msg);
  showFlashMessage(msg, 'success');
}

function showError(msg) {
  console.error('[Error]', msg);
  showFlashMessage(msg, 'error');
}

function showInfo(msg) {
  console.log('[Info]', msg);
  showFlashMessage(msg, 'info');
}

// Make functions global
window.openScriptConfiguration = openScriptConfiguration;
window.openReports = openReports;

console.log('[Dashboard] Ready');