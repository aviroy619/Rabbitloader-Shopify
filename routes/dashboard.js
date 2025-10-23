const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");

// Serve embedded dashboard page
router.get("/", async (req, res) => {
  const { shop, host } = req.query;
  
  if (!shop) {
    return res.status(400).send("Shop parameter required");
  }

  try {
    // Get shop data from database
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.status(404).send("Shop not found. Please authenticate first.");
    }

    // Check if shop is connected to RabbitLoader
    const isConnected = !!shopRecord.api_token;
    const needsAuth = shopRecord.reauth_required || !shopRecord.access_token;

    // Dashboard configuration
    const dashboardConfig = {
      platform: 'shopify',
      shopIdentifier: shop,
      host: host,
      did: shopRecord.short_id || shopRecord.did,
      apiToken: shopRecord.api_token,
      isConnected: isConnected,
      needsAuth: needsAuth,
      
      // Microservice URLs (proxied through this app)
      apiUrl: '/api/rl-core',
      psiUrl: '/api/dashboard/psi',           // Should this be /api/rl-core/psi ?
      criticalCSSUrl: '/api/dashboard/critical-css',  // Should this be /api/rl-core/critical-css ?
      jsDeferUrl: '/api/dashboard/js-defer',   // Should this be /api/rl-core/js-defer ?
      rlCoreUrl: '/api/dashboard/rl-core',     // This looks wrong - probably just /api/rl-core
      
      features: {
        performance: true,
        pages: true,
        jsOptimization: true,
        criticalCSS: true,
        settings: true,
        analytics: true
      }
    };

    // Render embedded dashboard page
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RabbitLoader Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f6f6f7;
      overflow: hidden;
    }
    
    #dashboard-container {
      width: 100%;
      height: 100vh;
      position: relative;
    }
    
    #dashboard-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: ${isConnected ? 'block' : 'none'};
    }
    
    #connection-required {
      display: ${isConnected ? 'none' : 'flex'};
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
      padding: 40px;
    }
    
    #connection-required h1 {
      font-size: 24px;
      margin-bottom: 16px;
      color: #202223;
    }
    
    #connection-required p {
      font-size: 14px;
      color: #6d7175;
      margin-bottom: 24px;
      max-width: 500px;
    }
    
    .btn-primary {
      background: #008060;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    
    .btn-primary:hover {
      background: #006e52;
    }
    
    #loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    
    .spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #008060;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div id="dashboard-container">
    <!-- Connection Required Screen -->
    <div id="connection-required">
      <h1>🐰 Connect to RabbitLoader</h1>
      <p>
        Connect your store to RabbitLoader to start optimizing your site's performance.
        This will enable defer configurations, critical CSS generation, and performance monitoring.
      </p>
      <a href="/rl/rl-connect?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || '')}" class="btn-primary">
        Connect to RabbitLoader
      </a>
    </div>
    
    <!-- Dashboard iFrame -->
    <iframe 
      id="dashboard-iframe"
      src="https://dashboard.rb8.in?platform=shopify&shop=${encodeURIComponent(shop)}&debug=false"
      allow="fullscreen"
    ></iframe>
    
    <!-- Loading Overlay -->
    <div id="loading-overlay">
      <div class="spinner"></div>
    </div>
  </div>

  <script>
    // Dashboard configuration passed from server
    window.DASHBOARD_CONFIG = ${JSON.stringify(dashboardConfig, null, 2)};
    
    const iframe = document.getElementById('dashboard-iframe');
    const loadingOverlay = document.getElementById('loading-overlay');
    
    // Handle iframe load
    iframe.addEventListener('load', function() {
      console.log('Dashboard iframe loaded');
      
      // Send configuration to iframe
      setTimeout(() => {
        iframe.contentWindow.postMessage({
          type: 'RABBITLOADER_CONFIG',
          config: window.DASHBOARD_CONFIG
        }, '*');
        
        // Hide loading overlay
        loadingOverlay.style.display = 'none';
      }, 500);
    });
    
    // Listen for messages from dashboard
    window.addEventListener('message', function(event) {
      // Verify origin (in production, use exact origin)
      if (!event.origin.includes('45.32.212.222')) return;
      
      console.log('Message from dashboard:', event.data);
      
      switch(event.data.type) {
        case 'RABBITLOADER_READY':
          console.log('✅ Dashboard ready');
          loadingOverlay.style.display = 'none';
          break;
          
        case 'RABBITLOADER_REQUEST_CONFIG':
          // Dashboard is requesting config
          iframe.contentWindow.postMessage({
            type: 'RABBITLOADER_CONFIG',
            config: window.DASHBOARD_CONFIG
          }, '*');
          break;
          
        case 'RABBITLOADER_NAVIGATE':
          // Dashboard wants to navigate
          window.location.href = event.data.url;
          break;
          
        case 'RABBITLOADER_RESIZE':
          // Dashboard wants to resize (optional)
          if (event.data.height) {
            iframe.style.height = event.data.height + 'px';
          }
          break;
          
        case 'RABBITLOADER_ERROR':
          console.error('Dashboard error:', event.data.error);
          alert('Dashboard error: ' + event.data.error);
          break;
      }
    });
    
    // Handle connection status changes
    if (${isConnected}) {
      // Poll for connection changes (optional)
      setInterval(async () => {
        try {
          const response = await fetch('/shopify/status?shop=${encodeURIComponent(shop)}');
          const data = await response.json();
          
          if (!data.connected && window.location.href.indexOf('connected=1') === -1) {
            // Lost connection, reload
            window.location.reload();
          }
        } catch (error) {
          console.error('Status check failed:', error);
        }
      }, 30000); // Check every 30 seconds
    }
  </script>
</body>
</html>
    `);
    
  } catch (error) {
    console.error('[Dashboard] Error:', error);
    res.status(500).send("Failed to load dashboard: " + error.message);
  }
});

module.exports = router;