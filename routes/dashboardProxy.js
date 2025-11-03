const express = require("express");
const router = express.Router();
const axios = require("axios");

// Microservice URLs
const SERVICES = {
  psi: process.env.PSI_SERVICE_URL || 'http://45.32.212.222:3008',
  criticalCSS: process.env.CRITICAL_CSS_URL || 'http://45.32.212.222:3000',
  jsDefer: process.env.JS_DEFER_URL || 'http://45.32.212.222:3002',
  rlCore: process.env.RL_CORE_URL || 'http://45.32.212.222:4000'
};

// Helper function to proxy requests
async function proxyRequest(serviceUrl, req, res) {
  try {
    const targetPath = req.path;
    const url = `${serviceUrl}${targetPath}`;
    
    console.log(`[Dashboard Proxy] ${req.method} ${url}`);
    
    const response = await axios({
      method: req.method,
      url: url,
      params: req.query,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'X-Shop': req.query.shop || req.body?.shop,
        'X-API-Key': process.env.RL_API_KEY,
        'X-Platform': 'shopify'
      },
      timeout: 30000 // 30 second timeout
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('[Dashboard Proxy Error]', error.message);
    
    const status = error.response?.status || 500;
    const errorData = error.response?.data || { 
      ok: false, 
      error: error.message 
    };
    
    res.status(status).json(errorData);
  }
}
// Proxy to PSI Service - Special handling for analyze endpoint
router.get('/psi/analyze', async (req, res) => {
  const { url, strategy } = req.query;
  const shop = req.query.shop || req.headers['x-shop'];
  
  if (!shop || !url) {
    return res.status(400).json({
      ok: false,
      error: 'Missing shop or url parameter'
    });
  }

  try {
    console.log(`[PSI Proxy] Analyzing ${url} for ${shop}`);
    
    // Extract path from full URL
    let urlPath = url;
    if (url.startsWith('http')) {
      urlPath = new URL(url).pathname;
    }
    
    // Convert GET to POST for PSI service
    const response = await axios.post(
      `${SERVICES.psi}/api/analyze`,
      {
        shop,
        url: urlPath,
        strategy
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('[PSI Proxy Error]', error.message);
    res.status(error.response?.status || 500).json({
      ok: false,
      error: error.response?.data?.error || error.message
    });
  }
});

// Other PSI endpoints
router.all('/psi/*', async (req, res) => {
  const path = req.path.replace('/psi', '');
  req.path = path;
  await proxyRequest(SERVICES.psi, req, res);
});

// Proxy to Critical CSS Service
router.all('/critical-css/*', async (req, res) => {
  const path = req.path.replace('/critical-css', '');
  req.path = path;
  await proxyRequest(SERVICES.criticalCSS, req, res);
});

// Proxy to JS Defer Service
router.all('/js-defer/*', async (req, res) => {
  const path = req.path.replace('/js-defer', '');
  req.path = path;
  await proxyRequest(SERVICES.jsDefer, req, res);
});

// Proxy to RL Core
// Proxy Dashboard Requests to RL-Core
router.all('/dashboard/*', async (req, res) => {
  const path = req.path.replace('/dashboard', '');
  req.path = path;

  console.log(`[Dashboard Proxy → RL-Core] ${req.method} ${path}`, {
    shop: req.query.shop || req.body?.shop
  });

  await proxyRequest(SERVICES.rlCore, req, res);
});


// Health check for proxy
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'dashboard-proxy',
    microservices: SERVICES,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;