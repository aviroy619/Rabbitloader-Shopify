const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// Helper function to inject ONLY defer script into theme
async function injectScriptIntoTheme(shop, did, accessToken) {
  console.log(`Attempting theme injection for ${shop} with DID: ${did}`);

  // Step 1: Get active theme
  const themesResponse = await fetch(`https://${shop}/admin/api/2023-10/themes.json`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (!themesResponse.ok) {
    throw new Error(`Failed to fetch themes: ${themesResponse.status} ${themesResponse.statusText}`);
  }

  const themesData = await themesResponse.json();
  const activeTheme = themesData.themes.find(theme => theme.role === 'main');
  
  if (!activeTheme) {
    throw new Error("No active theme found");
  }

  console.log(`Found active theme: ${activeTheme.name} (ID: ${activeTheme.id})`);

  // Step 2: Get theme.liquid file
  const assetResponse = await fetch(`https://${shop}/admin/api/2023-10/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (!assetResponse.ok) {
    throw new Error(`Failed to fetch theme.liquid: ${assetResponse.status} ${assetResponse.statusText}`);
  }

  const assetData = await assetResponse.json();
  let themeContent = assetData.asset.value;

  // Step 3: Check if defer script already exists
  const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
  
  if (themeContent.includes(`defer-config/loader.js?shop=${shop}`) || 
      themeContent.includes(deferLoaderUrl) ||
      themeContent.includes('RabbitLoader Defer Configuration')) {
    console.log(`RabbitLoader defer script already exists in theme for ${shop}`);
    return { success: true, message: "Defer script already exists in theme", scriptType: "existing" };
  }

  // Step 4: Inject defer loader script as THE FIRST SCRIPT
  const scriptTag = `  <!-- RabbitLoader Defer Configuration -->
  <script src="${deferLoaderUrl}"></script>`;
  
  const headOpenTag = '<head>';
  
  if (!themeContent.includes(headOpenTag)) {
    throw new Error("Could not find <head> tag in theme.liquid");
  }

  // Strategy: Inject as the absolute first script in head
  // Look for existing RabbitLoader scripts or any other scripts and inject BEFORE them
  const existingRLScript = themeContent.match(/<script[^>]*src[^>]*(?:rabbitloader|cfw\.rabbitloader)[^>]*><\/script>/i);
  const firstScript = themeContent.match(/<script[^>]*>/i);
  
  if (existingRLScript) {
    // If RabbitLoader script exists, inject defer script BEFORE it
    themeContent = themeContent.replace(existingRLScript[0], `${scriptTag}\n  ${existingRLScript[0]}`);
    console.log(`Injected defer script BEFORE existing RabbitLoader script for ${shop}`);
  } else if (firstScript) {
    // If any script exists, inject defer script BEFORE the first one
    themeContent = themeContent.replace(firstScript[0], `${scriptTag}\n  ${firstScript[0]}`);
    console.log(`Injected defer script BEFORE first script tag for ${shop}`);
  } else {
    // Fallback: inject immediately after <head> if no scripts found
    themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTag}`);
    console.log(`Injected defer script immediately after <head> tag for ${shop}`);
  }

  console.log(`Injecting defer script with priority loading for ${shop}:`, {
    deferLoader: deferLoaderUrl
  });

  // Step 5: Update the theme file
  const updateResponse = await fetch(`https://${shop}/admin/api/2023-10/themes/${activeTheme.id}/assets.json`, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      asset: {
        key: 'layout/theme.liquid',
        value: themeContent
      }
    })
  });

  if (!updateResponse.ok) {
    const errorData = await updateResponse.json();
    console.error(`Theme update failed:`, errorData);
    throw new Error(`Theme update failed: ${updateResponse.status} - ${JSON.stringify(errorData)}`);
  }

  console.log(`RabbitLoader defer script injected successfully for ${shop}`);
  
  return { 
    success: true, 
    message: "Defer script injected successfully", 
    deferLoaderUrl,
    themeId: activeTheme.id,
    themeName: activeTheme.name
  };
}

// ====== SHOPIFY OAUTH FLOW ======

// Start Shopify OAuth
router.get("/auth", (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  // Validate shop domain
  if (!shop.includes('.myshopify.com')) {
    return res.status(400).send("Invalid shop domain");
  }

  const shopifyApiKey = process.env.SHOPIFY_API_KEY;
  const scopes = process.env.SHOPIFY_SCOPES || "read_themes,write_themes,read_script_tags,write_script_tags";
  const redirectUri = `${process.env.APP_URL}/shopify/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  // Store state for validation (in production, use session or database)
  req.session = req.session || {};
  req.session.state = state;

  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${shopifyApiKey}&` +
    `scope=${scopes}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`;

  console.log(`Starting OAuth for ${shop}, redirecting to Shopify`);
  res.redirect(authUrl);
});

// Shopify OAuth Callback
router.get("/auth/callback", async (req, res) => {
  const { code, hmac, shop, state, timestamp } = req.query;
  const { "rl-token": rlToken } = req.query;

  console.log("OAuth Callback received:", {
    hasCode: !!code,
    hasRlToken: !!rlToken,
    shop,
    hmac: hmac ? hmac.substring(0, 10) + "..." : "none"
  });

  // Handle RabbitLoader callback (when coming back from RL)
  if (rlToken && shop) {
    console.log(`Processing RabbitLoader callback for ${shop}`);
    try {
      const decoded = JSON.parse(Buffer.from(rlToken, "base64").toString("utf8"));
      
      await ShopModel.findOneAndUpdate(
        { shop },
        {
          $set: {
            short_id: decoded.did || decoded.short_id,
            api_token: decoded.api_token,
            account_id: decoded.account_id,
            connected_at: new Date()
          },
          $push: {
            history: {
              event: "connect",
              timestamp: new Date(),
              details: { via: "rl-callback" }
            }
          }
        },
        { upsert: true }
      );

      console.log(`RabbitLoader token saved for ${shop}`, {
        did: decoded.did || decoded.short_id,
        hasApiToken: !!decoded.api_token
      });

      // Generate proper host parameter for Shopify embedded app
      const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
      const hostParam = req.query.host || shopBase64;
      
      // Redirect back to embedded app with proper host parameter
      const redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(hostParam)}&embedded=1&connected=1`;
      
      console.log("Redirecting to embedded app:", redirectUrl);
      console.log("Generated host parameter:", hostParam);
      return res.redirect(redirectUrl);
      
    } catch (err) {
      console.error("RL callback error:", err);
      return res.status(400).send("Failed to process RabbitLoader token");
    }
  }

  // Handle Shopify OAuth callback (when coming back from Shopify)
  if (!code || !shop) {
    return res.status(400).send("Missing authorization code or shop");
  }

  try {
    // HMAC verification
    const queryObj = { ...req.query };
    delete queryObj.hmac;
    delete queryObj.signature;

    const queryString = Object.keys(queryObj)
      .sort()
      .map(key => `${key}=${queryObj[key]}`)
      .join('&');

    const calculatedHmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(queryString)
      .digest('hex');

    if (calculatedHmac !== hmac) {
      console.error("HMAC verification failed for shop:", shop);
      return res.status(401).send("Invalid HMAC - Security verification failed");
    }

    console.log("HMAC verification passed for shop:", shop);

    // Exchange code for access token
    console.log(`Exchanging OAuth code for access token for ${shop}`);
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code: code
      })
    });

    const tokenData = await tokenResponse.json();
    console.log("Token exchange response:", {
      hasAccessToken: !!tokenData.access_token,
      tokenLength: tokenData.access_token?.length || 0,
      startsWithShpat: tokenData.access_token?.startsWith('shpat_') || false,
      scope: tokenData.scope
    });

    if (!tokenData.access_token) {
      console.error("No access token received from Shopify for shop:", shop);
      console.error("Full token response:", tokenData);
      throw new Error("Failed to get access token from Shopify");
    }

    // ENHANCED: Save or update shop with new access token
    console.log(`Saving access token to database for ${shop}`);
    const shopRecord = await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          shop,
          access_token: tokenData.access_token,
          connected_at: new Date(),
          scope: tokenData.scope
        },
        $push: {
          history: {
            event: "shopify_auth",
            timestamp: new Date(),
            details: { 
              via: "oauth",
              token_length: tokenData.access_token.length,
              scope: tokenData.scope
            }
          }
        }
      },
      { upsert: true, new: true }
    );
    
    console.log(`✅ Successfully saved Shopify access token for ${shop}`, {
      tokenSaved: !!shopRecord.access_token,
      tokenLength: shopRecord.access_token?.length || 0,
      startsWithShpat: shopRecord.access_token?.startsWith('shpat_') || false,
      shopRecordId: shopRecord._id
    });

    // Generate proper host parameter for Shopify OAuth redirect
    const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
    const hostParam = req.query.host || shopBase64;
    
    // Redirect to app with proper host parameter
    const redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(hostParam)}&embedded=1&shopify_auth=1`;
    
    console.log("Shopify OAuth successful, redirecting:", redirectUrl);
    res.redirect(redirectUrl);

  } catch (err) {
    console.error("OAuth callback error for shop:", shop, err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// ====== DEBUG ROUTES FOR TOKEN CHECKING ======

// Debug route to check if access tokens are being saved
router.get("/debug/check-token/:shop", async (req, res) => {
  const shop = req.params.shop;
  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    res.json({
      found: !!shopRecord,
      shop: shop,
      has_access_token: !!(shopRecord?.access_token),
      token_length: shopRecord?.access_token?.length || 0,
      token_starts_with: shopRecord?.access_token?.substring(0, 8) || 'none',
      token_preview: shopRecord?.access_token ? `${shopRecord.access_token.substring(0, 12)}...` : 'none',
      connected_at: shopRecord?.connected_at,
      has_shopify_auth_in_history: shopRecord?.history?.some(h => h.event === 'shopify_auth') || false,
      latest_history: shopRecord?.history?.slice(-3) || []
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Debug route to list all shops and their token status
router.get("/debug/list-shops", async (req, res) => {
  try {
    const shops = await ShopModel.find({}, { 
      shop: 1, 
      access_token: 1, 
      connected_at: 1,
      short_id: 1,
      api_token: 1
    });
    
    const shopSummary = shops.map(shop => ({
      shop: shop.shop,
      has_shopify_token: !!shop.access_token,
      shopify_token_length: shop.access_token?.length || 0,
      has_rl_connection: !!shop.short_id,
      connected_at: shop.connected_at
    }));
    
    res.json({
      total_shops: shops.length,
      shops_with_shopify_tokens: shopSummary.filter(s => s.has_shopify_token).length,
      shops_with_rl_connection: shopSummary.filter(s => s.has_rl_connection).length,
      shops: shopSummary
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Test route to verify database connection and model
router.get("/debug/test-db", async (req, res) => {
  try {
    // Test creating a dummy shop record
    const testShop = new ShopModel({
      shop: 'test-' + Date.now() + '.myshopify.com',
      access_token: 'shpat_test_token_12345'
    });
    
    const saved = await testShop.save();
    await ShopModel.deleteOne({ _id: saved._id }); // Clean up
    
    res.json({
      database_connection: 'OK',
      model_working: 'OK',
      test_save_successful: 'OK',
      message: 'Database and model are functioning correctly'
    });
  } catch (error) {
    res.json({
      database_connection: 'ERROR',
      error: error.message,
      stack: error.stack
    });
  }
});

// ====== RABBITLOADER INTEGRATION ======

// Save RabbitLoader token after RL auth
router.post("/store-token", async (req, res) => {
  const { shop, rlToken } = req.body;

  if (!shop || !rlToken) {
    return res.status(400).json({ ok: false, error: "Missing shop or rl-token" });
  }

  try {
    const decoded = JSON.parse(Buffer.from(rlToken, "base64").toString("utf8"));

    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          short_id: decoded.did || decoded.short_id,
          api_token: decoded.api_token,
          account_id: decoded.account_id,
          connected_at: new Date(decoded.connected_at || Date.now())
        },
        $push: {
          history: {
            event: "connect",
            timestamp: new Date(),
            details: { via: "rl-token" }
          }
        }
      },
      { upsert: true }
    );

    console.log(`Stored RL token for ${shop}`);
    res.json({ ok: true, message: "RL token stored" });
  } catch (err) {
    console.error("store-token error:", err);
    res.status(500).json({ ok: false, error: "Failed to store RL token" });
  }
});

// Status check
router.get("/status", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ ok: false, error: "Missing shop" });

  try {
    const record = await ShopModel.findOne({ shop });

    if (record && record.api_token) {
      return res.json({
        ok: true,
        connected: true,
        shop: record.shop,
        connected_at: record.connected_at,
        script_injected: record.script_injected || false,
        did: record.short_id
      });
    }

    return res.json({ ok: true, connected: false, shop });
  } catch (err) {
    console.error("status error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch status" });
  }
});

// Enhanced status check with token info
router.get("/status/:shop", async (req, res) => {
  const shop = req.params.shop;
  
  try {
    const record = await ShopModel.findOne({ shop });

    if (!record) {
      return res.json({
        ok: true,
        found: false,
        shop,
        message: "Shop not found in database"
      });
    }

    res.json({
      ok: true,
      found: true,
      shop: record.shop,
      has_shopify_access: !!record.access_token,
      has_rabbitloader_connection: !!record.api_token,
      script_injected: record.script_injected || false,
      connected_at: record.connected_at,
      did: record.short_id,
      last_activity: record.history?.slice(-1)[0] || null
    });
    
  } catch (err) {
    console.error("Enhanced status error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch status" });
  }
});

// Disconnect
router.post("/disconnect", async (req, res) => {
  const { shop } = req.body;
  if (!shop) return res.status(400).json({ ok: false, error: "Missing shop" });

  try {
    await ShopModel.updateOne(
      { shop },
      {
        $unset: { 
          api_token: "", 
          short_id: "",
          script_injected: "",
          script_injection_attempted: ""
        },
        $set: { connected_at: null },
        $push: {
          history: {
            event: "disconnect",
            timestamp: new Date(),
            details: { via: "manual" }
          }
        }
      }
    );

    console.log(`Disconnected shop: ${shop}`);
    res.json({ ok: true, message: "Disconnected" });
  } catch (err) {
    console.error("disconnect error:", err);
    res.status(500).json({ ok: false, error: "Failed to disconnect" });
  }
});

// Manual theme injection route
router.post("/inject-script", async (req, res) => {
  const { shop } = req.body;
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not connected to RabbitLoader" 
      });
    }

    if (!shopRecord.access_token) {
      return res.status(404).json({
        ok: false,
        error: "No Shopify access token found for shop. Please reinstall the app.",
        debug: {
          shop_found: !!shopRecord,
          has_rl_connection: !!shopRecord.short_id,
          has_shopify_access: !!shopRecord.access_token
        }
      });
    }

    const result = await injectScriptIntoTheme(shop, shopRecord.short_id, shopRecord.access_token);
    
    // Update database to mark as injected
    await ShopModel.updateOne(
      { shop }, 
      { 
        $set: { 
          script_injected: true,
          script_injection_attempted: true 
        } 
      }
    );
    
    res.json({ ok: true, ...result });

  } catch (err) {
    console.error("Manual script injection error:", err);
    res.status(500).json({ 
      ok: false, 
      error: err.message,
      details: "Check server logs for more information" 
    });
  }
});

// Get RabbitLoader dashboard data - NO MOCK DATA
router.get("/dashboard-data", async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.api_token) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not connected to RabbitLoader" 
      });
    }

    // Return only actual data, no dummy values
    const dashboardData = {
      did: shopRecord.short_id || "",
      reports_url: shopRecord.short_id ? `https://rabbitloader.com/dashboard/${shopRecord.short_id}` : "",
      customize_url: shopRecord.short_id ? `https://rabbitloader.com/customize/${shopRecord.short_id}` : ""
    };

    // Only add fields if we have real data
    if (shopRecord.plan_data) {
      dashboardData.plan = shopRecord.plan_data;
    }
    
    if (shopRecord.psi_scores) {
      dashboardData.psi_scores = shopRecord.psi_scores;
    }
    
    if (shopRecord.pageviews_data) {
      dashboardData.pageviews_this_month = shopRecord.pageviews_data;
    }

    console.log(`Dashboard data served for ${shop}:`, {
      did: shopRecord.short_id || "none",
      has_plan_data: !!shopRecord.plan_data,
      has_psi_scores: !!shopRecord.psi_scores
    });

    res.json({ ok: true, data: dashboardData });
    
  } catch (err) {
    console.error("Dashboard data error:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to fetch dashboard data"
    });
  }
});

// ====== DEFER CONFIGURATION INTERFACE ======

// Configuration interface route (HTML)
router.get("/configure-defer", async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  try {
    // Verify shop exists and is connected
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.api_token) {
      return res.status(404).send(`
        <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
          <h2>Shop Not Connected</h2>
          <p>Please connect your shop to RabbitLoader first.</p>
          <a href="/?shop=${encodeURIComponent(shop)}" style="color: #007bff;">Go back to main app</a>
        </div>
      `);
    }

    // Create configuration interface HTML
    const configHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Script Defer Configuration - ${shop}</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
          .header { text-align: center; margin-bottom: 40px; background: white; padding: 20px; border-radius: 8px; }
          .config-section { background: white; border-radius: 8px; margin-bottom: 20px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .btn { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; }
          .btn-primary { background: #007bff; color: white; }
          .btn-success { background: #28a745; color: white; }
          .btn:hover { opacity: 0.9; }
          .form-group { margin-bottom: 15px; }
          .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
          .form-group input, .form-group select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
          #statusBanner { padding: 15px; margin-bottom: 20px; border-radius: 4px; display: none; }
          .status-banner.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .status-banner.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
          .status-banner.info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
          .rule-item { border: 1px solid #ddd; margin-bottom: 15px; border-radius: 4px; background: #fafafa; }
          .rule-header { background: #f8f9fa; padding: 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; }
          .rule-content { padding: 15px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
          .delete-btn { background: #dc3545; color: white; padding: 5px 10px; border: none; border-radius: 3px; cursor: pointer; }
          .api-section { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin-top: 20px; }
          .api-endpoints { background: white; border-radius: 4px; padding: 15px; margin-top: 15px; }
          .endpoint { margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; font-family: monospace; }
          .endpoint .method { font-weight: bold; color: #007bff; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>RabbitLoader Script Defer Configuration</h1>
          <p>Shop: <strong>${shop}</strong></p>
          <p>Manage which scripts to defer, delay, or block on your store</p>
        </div>

        <div id="statusBanner" class="status-banner"></div>

        <div class="config-section">
          <h2>Global Settings</h2>
          <div class="form-group">
            <label for="releaseTime">Script Release Time (milliseconds):</label>
            <input type="number" id="releaseTime" min="0" max="30000" step="100" value="2000">
            <small>Scripts will be released after this delay (default: 2000ms = 2 seconds)</small>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="enableDefer" checked> Enable Defer System
            </label>
          </div>
        </div>

        <div class="config-section">
          <h2>Defer Rules</h2>
          <p>Create rules to control specific scripts. Scripts matching these patterns will be deferred, delayed, or blocked.</p>
          <div id="rulesContainer">
            <p style="text-align: center; color: #666; padding: 40px;">No rules configured. Click "Add Rule" to get started.</p>
          </div>
          <div style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="addNewRule()">+ Add Rule</button>
            <button class="btn btn-success" onclick="saveConfiguration()">Save Configuration</button>
            <button class="btn" onclick="loadConfiguration()" style="background: #6c757d; color: white;">Reload</button>
          </div>
        </div>

        <div class="api-section">
          <h2>JSON API Access</h2>
          <p>Use these endpoints to programmatically manage defer configurations:</p>
          <div class="api-endpoints">
            <div class="endpoint">
              <span class="method">POST</span> /shopify/configure-defer - Save configuration via JSON
            </div>
            <div class="endpoint">
              <span class="method">GET</span> /shopify/configure-defer/api?shop=${encodeURIComponent(shop)} - Get current configuration
            </div>
            <div class="endpoint">
              <span class="method">POST</span> /shopify/configure-defer/validate - Validate configuration without saving
            </div>
          </div>
          <button class="btn btn-primary" onclick="exportConfiguration()">Export as JSON</button>
          <button class="btn btn-primary" onclick="showImportDialog()">Import JSON</button>
        </div>

        <script>
          var currentConfig = { release_after_ms: 2000, rules: [], enabled: true };
          var shop = "${shop}";
          var ruleCounter = 1;

          function loadConfiguration() {
            showStatus('info', 'Loading configuration...');
            fetch('/shopify/configure-defer/api?shop=' + encodeURIComponent(shop))
              .then(function(response) { return response.json(); })
              .then(function(data) {
                if (data.ok && data.config) {
                  currentConfig = data.config;
                  updateUI();
                  showStatus('success', 'Configuration loaded successfully');
                } else {
                  updateUI();
                  showStatus('info', 'Using default configuration');
                }
              })
              .catch(function(error) {
                showStatus('error', 'Failed to load configuration: ' + error.message);
              });
          }

          function saveConfiguration() {
            collectFormData();
            showStatus('info', 'Saving configuration...');
            
            fetch('/shopify/configure-defer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                shop: shop, 
                release_after_ms: currentConfig.release_after_ms, 
                rules: currentConfig.rules, 
                enabled: currentConfig.enabled 
              })
            })
            .then(function(response) { return response.json(); })
            .then(function(result) {
              if (result.ok) {
                showStatus('success', 'Configuration saved successfully!');
              } else {
                throw new Error(result.error || 'Save failed');
              }
            })
            .catch(function(error) {
              showStatus('error', 'Save failed: ' + error.message);
            });
          }

          function exportConfiguration() {
            collectFormData();
            const configJson = JSON.stringify(currentConfig, null, 2);
            const blob = new Blob([configJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'defer-config-' + shop.replace('.myshopify.com', '') + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showStatus('success', 'Configuration exported successfully!');
          }

          function showImportDialog() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = function(e) {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                  try {
                    const importedConfig = JSON.parse(e.target.result);
                    if (validateConfig(importedConfig)) {
                      currentConfig = importedConfig;
                      updateUI();
                      showStatus('success', 'Configuration imported successfully!');
                    } else {
                      showStatus('error', 'Invalid configuration format');
                    }
                  } catch (error) {
                    showStatus('error', 'Failed to parse JSON: ' + error.message);
                  }
                };
                reader.readAsText(file);
              }
            };
            input.click();
          }

          function validateConfig(config) {
            return config && 
                   typeof config.release_after_ms === 'number' &&
                   typeof config.enabled === 'boolean' &&
                   Array.isArray(config.rules);
          }

          function collectFormData() {
            currentConfig.release_after_ms = parseInt(document.getElementById('releaseTime').value) || 2000;
            currentConfig.enabled = document.getElementById('enableDefer').checked;
            
            currentConfig.rules = [];
            var ruleItems = document.querySelectorAll('.rule-item');
            for (var i = 0; i < ruleItems.length; i++) {
              var ruleEl = ruleItems[i];
              var rule = {
                id: ruleEl.querySelector('.rule-id').value,
                src_regex: ruleEl.querySelector('.rule-regex').value,
                action: ruleEl.querySelector('.rule-action').value,
                priority: parseInt(ruleEl.querySelector('.rule-priority').value) || 0,
                enabled: ruleEl.querySelector('.rule-enabled').checked
              };
              if (rule.src_regex && rule.id) currentConfig.rules.push(rule);
            }
          }

          function updateUI() {
            document.getElementById('releaseTime').value = currentConfig.release_after_ms || 2000;
            document.getElementById('enableDefer').checked = currentConfig.enabled !== false;
            renderRules();
          }

          function renderRules() {
            var container = document.getElementById('rulesContainer');
            container.innerHTML = '';
            
            if (currentConfig.rules.length === 0) {
              container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No rules configured yet.</p>';
              return;
            }
            
            for (var i = 0; i < currentConfig.rules.length; i++) {
              var rule = currentConfig.rules[i];
              var ruleEl = document.createElement('div');
              ruleEl.className = 'rule-item';
              ruleEl.innerHTML = 
                '<div class="rule-header">' +
                  '<h3>Rule: ' + (rule.id || 'New Rule') + '</h3>' +
                  '<button class="delete-btn" onclick="deleteRule(this)">Delete</button>' +
                '</div>' +
                '<div class="rule-content">' +
                  '<div class="form-group">' +
                    '<label>Rule ID:</label>' +
                    '<input type="text" class="rule-id" value="' + (rule.id || '').replace(/"/g, '&quot;') + '" placeholder="e.g., google-analytics">' +
                  '</div>' +
                  '<div class="form-group">' +
                    '<label>Script URL Pattern (Regex):</label>' +
                    '<input type="text" class="rule-regex" value="' + (rule.src_regex || '').replace(/"/g, '&quot;') + '" placeholder="e.g., googletagmanager\\\\.com">' +
                  '</div>' +
                  '<div class="form-group">' +
                    '<label>Action:</label>' +
                    '<select class="rule-action">' +
                      '<option value="defer"' + (rule.action === 'defer' ? ' selected' : '') + '>Defer (load after delay)</option>' +
                      '<option value="delay"' + (rule.action === 'delay' ? ' selected' : '') + '>Delay (extended defer)</option>' +
                      '<option value="block"' + (rule.action === 'block' ? ' selected' : '') + '>Block (do not load)</option>' +
                    '</select>' +
                  '</div>' +
                  '<div class="form-group">' +
                    '<label>Priority (higher = processed first):</label>' +
                    '<input type="number" class="rule-priority" value="' + (rule.priority || 0) + '" min="0">' +
                  '</div>' +
                  '<div class="form-group">' +
                    '<label><input type="checkbox" class="rule-enabled"' + (rule.enabled !== false ? ' checked' : '') + '> Rule Enabled</label>' +
                  '</div>' +
                '</div>';
              container.appendChild(ruleEl);
            }
          }

          function addNewRule() {
            currentConfig.rules.push({
              id: 'rule-' + ruleCounter,
              src_regex: '',
              action: 'defer',
              priority: 0,
              enabled: true
            });
            ruleCounter++;
            renderRules();
          }

          function deleteRule(btn) {
            if (confirm('Are you sure you want to delete this rule?')) {
              btn.closest('.rule-item').remove();
            }
          }

          function showStatus(type, message) {
            var banner = document.getElementById('statusBanner');
            banner.className = 'status-banner ' + type;
            banner.textContent = message;
            banner.style.display = 'block';
            
            if (type === 'success') {
              setTimeout(function() { 
                banner.style.display = 'none'; 
              }, 4000);
            }
          }

          document.addEventListener('DOMContentLoaded', loadConfiguration);
        </script>
      </body>
      </html>
    `;

    res.send(configHtml);

  } catch (err) {
    console.error("Configure defer error:", err);
    res.status(500).send("Failed to load configuration interface");
  }
});

// API endpoint to save defer configuration (accepts JSON)
router.post("/configure-defer", async (req, res) => {
  const { shop, release_after_ms, rules, enabled } = req.body;
  
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.api_token) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not connected to RabbitLoader" 
      });
    }

    const config = {
      release_after_ms: parseInt(release_after_ms) || 2000,
      enabled: enabled !== false,
      rules: Array.isArray(rules) ? rules : [],
      updated_at: new Date(),
      version: "1.0.0"
    };

    const validatedRules = config.rules.map((rule, index) => {
      if (!rule.id || !rule.src_regex) {
        throw new Error(`Rule ${index + 1} missing required fields (id, src_regex)`);
      }
      
      if (!['defer', 'delay', 'block'].includes(rule.action)) {
        throw new Error(`Rule ${index + 1} has invalid action: ${rule.action}`);
      }

      try {
        new RegExp(rule.src_regex);
      } catch (e) {
        throw new Error(`Rule ${index + 1} has invalid regex pattern: ${rule.src_regex}`);
      }

      return {
        id: String(rule.id).trim(),
        src_regex: String(rule.src_regex).trim(),
        action: rule.action,
        priority: parseInt(rule.priority) || 0,
        enabled: rule.enabled !== false
      };
    });

    config.rules = validatedRules;

    await ShopModel.updateOne(
      { shop },
      { 
        $set: { 
          deferConfig: config
        },
        $push: {
          history: {
            event: "defer_config_updated",
            timestamp: new Date(),
            details: { 
              rules_count: config.rules.length,
              enabled: config.enabled,
              via: "json_api"
            }
          }
        }
      }
    );

    console.log(`Defer configuration saved for ${shop}:`, {
      rules: config.rules.length,
      enabled: config.enabled,
      release_after_ms: config.release_after_ms
    });

    res.json({
      ok: true,
      message: "Configuration saved successfully",
      config: config,
      shop: shop
    });

  } catch (err) {
    console.error("Configure defer POST error:", err);
    res.status(500).json({ 
      ok: false, 
      error: err.message || "Failed to save configuration"
    });
  }
});

// API endpoint to get defer configuration (returns JSON)
router.get("/configure-defer/api", async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.api_token) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not connected to RabbitLoader" 
      });
    }

    const config = shopRecord.deferConfig || {
      release_after_ms: 2000,
      enabled: true,
      rules: [],
      updated_at: new Date(),
      version: "1.0.0"
    };

    res.json({
      ok: true,
      config: config,
      shop: shop
    });

  } catch (err) {
    console.error("Get defer config error:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to load configuration"
    });
  }
});

// API endpoint to validate defer configuration without saving
router.post("/configure-defer/validate", async (req, res) => {
  const { shop, release_after_ms, rules, enabled } = req.body;
  
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const errors = [];
    
    const releaseTime = parseInt(release_after_ms);
    if (isNaN(releaseTime) || releaseTime < 0 || releaseTime > 30000) {
      errors.push("Release time must be between 0 and 30000 milliseconds");
    }

    if (Array.isArray(rules)) {
      rules.forEach((rule, index) => {
        if (!rule.id || typeof rule.id !== 'string' || !rule.id.trim()) {
          errors.push(`Rule ${index + 1}: ID is required`);
        }
        
        if (!rule.src_regex || typeof rule.src_regex !== 'string' || !rule.src_regex.trim()) {
          errors.push(`Rule ${index + 1}: Source regex is required`);
        } else {
          try {
            new RegExp(rule.src_regex);
          } catch (e) {
            errors.push(`Rule ${index + 1}: Invalid regex pattern`);
          }
        }
        
        if (!['defer', 'delay', 'block'].includes(rule.action)) {
          errors.push(`Rule ${index + 1}: Action must be 'defer', 'delay', or 'block'`);
        }
        
        const priority = parseInt(rule.priority);
        if (isNaN(priority) || priority < 0) {
          errors.push(`Rule ${index + 1}: Priority must be a non-negative number`);
        }
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Validation failed",
        errors: errors
      });
    }

    res.json({
      ok: true,
      message: "Configuration is valid",
      validated_config: {
        release_after_ms: releaseTime,
        enabled: enabled !== false,
        rules: rules || []
      }
    });

  } catch (err) {
    console.error("Validate defer config error:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Validation failed"
    });
  }
});

// Get manual installation instructions - DEFER SCRIPT ONLY
router.get("/manual-instructions", async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not connected to RabbitLoader" 
      });
    }

    const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
    
    const scriptTag = `  <!-- RabbitLoader Defer Configuration -->
  <script src="${deferLoaderUrl}"></script>`;
    
    res.json({
      ok: true,
      shop,
      did: shopRecord.short_id,
      deferLoaderUrl,
      scriptTag: scriptTag,
      instructions: {
        step1: "Go to your Shopify Admin",
        step2: "Navigate to Online Store > Themes", 
        step3: "Click 'Actions' > 'Edit code' on your active theme",
        step4: "Open the 'theme.liquid' file in the Layout folder",
        step5: "Add this script tag in the <head> section, BEFORE any other JavaScript:",
        step6: "Save the file",
        step7: "The RabbitLoader defer system is now active on your store",
        step8: `Configure script deferring rules at: ${process.env.APP_URL}/shopify/configure-defer?shop=${encodeURIComponent(shop)}`
      },
      notes: {
        purpose: "This script manages and controls when other scripts load on your store pages",
        benefits: "Improves page load speed by deferring non-critical scripts",
        configuration: "You can configure which scripts to defer, delay, or block through the configuration interface"
      }
    });
  } catch (err) {
    console.error("Manual instructions error:", err);
    res.status(500).json({ ok: false, error: "Failed to get instructions" });
  }
});

module.exports = router;