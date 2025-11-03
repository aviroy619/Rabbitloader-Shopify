const express = require("express");
const router = express.Router();
const axios = require("axios");

// Microservice URLs
const SERVICES = {
  psi: process.env.PSI_SERVICE_URL || 'http://45.32.212.222:3008',
  rlDash: process.env.RL_DASH_URL || 'http://45.32.212.222:3006',
  rlCore: process.env.RL_CORE_URL || 'http://45.32.212.222:4000'
};

// Helper function to proxy requests
async function proxyRequest(serviceUrl, req, res) {
  try {
    const url = `${serviceUrl}${req.path}`;

    console.log(`[Proxy] ${req.method} ${url}`);
    
    const response = await axios({
      method: req.method,
      url,
      params: req.query,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'X-Shop': req.query.shop || req.body?.shop,
        'X-API-Key': process.env.RL_API_KEY,
        'X-Platform': 'shopify'
      },
      timeout: 30000
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('[Proxy Error]', error.message);
    res.status(error.response?.status || 500).json(
      error.response?.data || { ok: false, error: error.message }
    );
  }
}

/* ========= PSI SERVICE ========= */

router.get('/psi/analyze', async (req, res) => {
  const { url, strategy } = req.query;
  const shop = req.query.shop || req.headers['x-shop'];

  if (!shop || !url) {
    return res.status(400).json({ ok: false, error: 'Missing shop or url' });
  }

  try {
    console.log(`[PSI Proxy] ${url} for ${shop}`);

    let urlPath = url.startsWith('http') ? new URL(url).pathname : url;

    const response = await axios.post(
      `${SERVICES.psi}/api/analyze`,
      { shop, url: urlPath, strategy },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
    );

    res.json(response.data);
  } catch (error) {
    console.error('[PSI Proxy Error]', error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: error.response?.data?.error || error.message
    });
  }
});

router.all('/psi/*', async (req, res) => {
  req.path = req.path.replace('/psi', '');
  await proxyRequest(SERVICES.psi, req, res);
});

/* ========= RL-DASH UI ROUTES ========= */

router.all('/dashboard*', async (req, res) => {
  console.log(`[→ rl-dash UI] ${req.method} ${req.url}`);
  await proxyRequest(SERVICES.rlDash, req, res);
});

/* ========= RL-CORE API ROUTES ========= */

// Dashboard internal API calls
router.all('/api/rl-core/*', async (req, res) => {
  req.path = req.path.replace('/api/rl-core', '/api');
  console.log(`[→ rl-core] ${req.method} ${req.path}`);
  await proxyRequest(SERVICES.rlCore, req, res);
});

// Loader for Shopify theme
router.all('/defer-config/loader.js', async (req, res) => {
  req.path = `/api/defer-config/loader.js`;
  await proxyRequest(SERVICES.rlCore, req, res);
});

// Defer rules
router.all('/defer-config*', async (req, res) => {
  req.path = req.path.replace('/defer-config', '/api/defer-config');
  await proxyRequest(SERVICES.rlCore, req, res);
});

// Critical CSS routes
router.all('/critical-css*', async (req, res) => {
  req.path = req.path.replace('/critical-css', '/api/criticalcss');
  await proxyRequest(SERVICES.rlCore, req, res);
});

// JS file analysis & defer rules
router.all('/js-defer*', async (req, res) => {
  req.path = req.path.replace('/js-defer', '/api/jsfiles');
  await proxyRequest(SERVICES.rlCore, req, res);
});

/* ========= HEALTH ========= */

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'shopify-dashboard-proxy',
    services: SERVICES,
    time: new Date().toISOString()
  });
});

module.exports = router;
