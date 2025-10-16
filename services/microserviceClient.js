const axios = require('axios');

// ✅ CORRECT URLs - Use IP addresses directly
const CRITICAL_CSS_URL = 'http://45.32.212.222:3000';
const PSI_URL = 'http://45.32.212.222:3002';

// Analyze performance using PSI microservice
async function analyzePerformance(did, url, template) {
  try {
    console.log(`[Microservice] Analyzing performance for ${url} (template: ${template})`);
    
    const response = await axios.post(
      `${PSI_URL}/api/analyze`,
      {
        shop: did,
        url: url,
        template: template,
        strategy: 'mobile'
      },
      { 
        timeout: 120000, // 2 minute timeout
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[Microservice] Performance analysis complete for ${template}`);
    return {
      ok: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Microservice] Performance analysis failed:', error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

// Get defer rules
async function getDeferConfig(did, template) {
  try {
    console.log(`[Microservice] Getting defer config for ${did}/${template}`);
    
    const response = await axios.get(
      `${PSI_URL}/api/defer-rules/${did}/${template}`,
      { timeout: 10000 }
    );
    
    return {
      ok: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Microservice] Get defer config failed:', error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

// Get critical CSS
async function getCSSConfig(did, template) {
  try {
    console.log(`[Microservice] Getting CSS config for ${did}/${template}`);
    
    const response = await axios.get(
      `${CRITICAL_CSS_URL}/api/critical-css/${did}/${template}`,
      { timeout: 10000 }
    );
    
    return {
      ok: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Microservice] Get CSS config failed:', error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

// Generate critical CSS
async function generateCriticalCSS(shop, template, url) {
  const ShopModel = require("../models/Shop");
  try {
    console.log(`[CriticalCSS] Generating critical CSS for ${shop}/${template}`);

    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.api_token) {
      throw new Error(`[CriticalCSS] Missing API token for ${shop}`);
    }

    const response = await axios.post(
      `${CRITICAL_CSS_URL}/api/critical-css/generate`,
      {
        shop,
        did: shopRecord.short_id,
        api_token: shopRecord.api_token,
        template,
        url,
      },
      {
        timeout: 90000,
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log(`[CriticalCSS] Response:`, response.data);

    if (response.data.success) {
      await ShopModel.updateOne(
        { shop },
        {
          $set: {
            critical_css_injected: true,
            last_critical_css_at: new Date(),
          },
        }
      );
      console.log(`[CriticalCSS] ✅ Injected Critical CSS for ${shop}/${template}`);
    } else {
      console.warn(`[CriticalCSS] ⚠️ Failed: ${response.data.message}`);
    }

    return { ok: true, data: response.data };
  } catch (error) {
    console.error(`[CriticalCSS] ❌ Error:`, error.message);
    return { ok: false, error: error.message };
  }
}

// Update defer config
async function updateDeferConfig(did, scriptUrl, action, scope, pageUrl) {
  try {
    console.log(`[Microservice] Updating defer config for ${did}`);
    
    const response = await axios.post(
      `${PSI_URL}/api/defer/update`,
      {
        did: did,
        script_url: scriptUrl,
        action: action,
        scope: scope,
        page_url: pageUrl
      },
      { 
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      ok: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Microservice] Defer config update failed:', error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

// Toggle CSS
async function toggleCSS(did, action, scope, pageUrl, reason) {
  try {
    console.log(`[Microservice] Toggling CSS for ${did}`);
    
    const response = await axios.post(
      `${CRITICAL_CSS_URL}/api/css/toggle`,
      {
        did: did,
        action: action,
        scope: scope,
        page_url: pageUrl,
        reason: reason
      },
      { 
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      ok: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Microservice] CSS toggle failed:', error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

// Get active optimizations
async function getActiveOptimizations(did) {
  try {
    console.log(`[Microservice] Getting active optimizations for ${did}`);
    
    const response = await axios.get(
      `${PSI_URL}/api/optimizations/active?did=${did}`,
      { timeout: 10000 }
    );
    
    return {
      ok: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Microservice] Get optimizations failed:', error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

module.exports = {
  analyzePerformance,
  getDeferConfig,
  getCSSConfig,
  generateCriticalCSS,
  updateDeferConfig,
  toggleCSS,
  getActiveOptimizations
};