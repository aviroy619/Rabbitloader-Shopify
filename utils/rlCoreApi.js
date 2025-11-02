// utils/rlCoreApi.js
// API client to communicate with RL-Core backend

const RL_CORE_URL = process.env.RL_CORE_URL || 'http://localhost:4000';

/**
 * Make a request to RL-Core API
 * @param {string} endpoint - API endpoint (e.g., '/shops', '/defer-config')
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {object} data - Request body data
 * @param {string} shop - Shop domain for authentication
 * @param {string} apiToken - API token for authentication (RL token, NOT Shopify token)
 * @returns {Promise<object>} API response
 */
async function rlCoreRequest(endpoint, method = 'GET', data = null, shop = null, apiToken = null) {
  const url = `${RL_CORE_URL}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json'
  };
  
  // Add authentication headers if provided
  if (shop) headers['X-Shop'] = shop;
  if (apiToken) headers['X-API-Key'] = apiToken;
  headers['X-Platform'] = 'shopify';
  
  const options = {
    method,
    headers
  };
  
  if (data && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }
  
  try {
    console.log(`[RL-Core] ${method} ${endpoint} for shop: ${shop || 'none'}`);
    
    const response = await fetch(url, options);
    const result = await response.json();
    
    if (!response.ok) {
      console.error(`[RL-Core] API error (${response.status}):`, result);
    }
    
    return result;
  } catch (error) {
    console.error(`[RL-Core] Request failed to ${endpoint}:`, error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Sync shop data to rl-core after OAuth
 * Called after successful Shopify OAuth or RabbitLoader connection
 */
async function syncShopToCore(shopData) {
  console.log(`[RL-Core] Syncing shop to core: ${shopData.shop}`);
  
  return await rlCoreRequest('/shops', 'POST', {
    shop: shopData.shop,
    name: shopData.name || shopData.shop,
    domain: shopData.shop,
    platform: 'shopify',
    api_token: shopData.api_token,           // RL API token (JWT)
    short_id: shopData.short_id,             // RL domain ID
    account_id: shopData.account_id,
    access_token: shopData.access_token,     // Shopify access token
    needs_setup: shopData.needs_setup,
    reauth_required: shopData.reauth_required
  }, shopData.shop, shopData.api_token);
}

/**
 * Get shop details from rl-core
 */
async function getShopFromCore(shop, apiToken) {
  return await rlCoreRequest(`/shops`, 'GET', null, shop, apiToken);
}

/**
 * Update shop in rl-core
 */
async function updateShopInCore(shop, apiToken, updates) {
  return await rlCoreRequest('/shops', 'PUT', updates, shop, apiToken);
}

/**
 * Get defer config from rl-core
 */
async function getDeferConfig(shop, apiToken) {
  return await rlCoreRequest(`/defer-config?shop=${encodeURIComponent(shop)}`, 'GET', null, shop, apiToken);
}

/**
 * Save defer config to rl-core
 */
async function saveDeferConfig(shop, apiToken, config) {
  return await rlCoreRequest('/defer-config', 'POST', { 
    shop, 
    ...config 
  }, shop, apiToken);
}

/**
 * Save site analysis results to rl-core
 */
async function saveSiteAnalysis(shop, apiToken, analysisData) {
  return await rlCoreRequest('/site-analysis', 'POST', {
    shop,
    ...analysisData
  }, shop, apiToken);
}

/**
 * Get site analysis from rl-core
 */
async function getSiteAnalysis(shop, apiToken) {
  return await rlCoreRequest(`/site-analysis?shop=${encodeURIComponent(shop)}`, 'GET', null, shop, apiToken);
}

/**
 * Save template data to rl-core
 */
async function saveTemplate(shop, apiToken, templateData) {
  return await rlCoreRequest('/templates', 'POST', {
    shop,
    ...templateData
  }, shop, apiToken);
}

/**
 * Get templates from rl-core
 */
async function getTemplates(shop, apiToken) {
  return await rlCoreRequest(`/templates?shop=${encodeURIComponent(shop)}`, 'GET', null, shop, apiToken);
}

/**
 * Save performance metrics to rl-core
 */
async function savePerformanceMetrics(shop, apiToken, metricsData) {
  return await rlCoreRequest('/performance', 'POST', {
    shop,
    ...metricsData
  }, shop, apiToken);
}

/**
 * Get performance metrics from rl-core
 */
async function getPerformanceMetrics(shop, apiToken) {
  return await rlCoreRequest(`/performance?shop=${encodeURIComponent(shop)}`, 'GET', null, shop, apiToken);
}

/**
 * Update injection status in rl-core
 */
async function updateInjectionStatus(shop, apiToken, status) {
  return await rlCoreRequest('/shops', 'PUT', {
    script_injected: status.script_injected,
    critical_css_injected: status.critical_css_injected,
    script_injection_attempted: status.script_injection_attempted,
    critical_css_injection_attempted: status.critical_css_injection_attempted,
    last_injection_at: new Date(),
    injection_error: status.error || null
  }, shop, apiToken);
}

/**
 * Health check for rl-core connection
 */
async function healthCheck() {
  try {
    const response = await fetch(`${RL_CORE_URL}/health`);
    const result = await response.json();
    return { ok: true, connected: response.ok, data: result };
  } catch (error) {
    console.error('[RL-Core] Health check failed:', error.message);
    return { ok: false, connected: false, error: error.message };
  }
}

module.exports = {
  rlCoreRequest,
  syncShopToCore,
  getShopFromCore,
  updateShopInCore,
  getDeferConfig,
  saveDeferConfig,
  saveSiteAnalysis,
  getSiteAnalysis,
  saveTemplate,
  getTemplates,
  savePerformanceMetrics,
  getPerformanceMetrics,
  updateInjectionStatus,
  healthCheck
};