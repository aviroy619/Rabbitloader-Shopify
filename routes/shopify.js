const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// Helper function to inject script into theme (UPDATED for defer system)
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

  // Step 3: Check if any RabbitLoader script already exists
  if (themeContent.includes('rabbitloader.xyz') || themeContent.includes(did) || 
      themeContent.includes(`defer-config/loader.js?shop=${shop}`)) {
    console.log(`RabbitLoader script already exists in theme for ${shop}`);
    return { success: true, message: "Script already exists in theme", scriptType: "existing" };
  }

  // Step 4: Inject BOTH scripts - defer loader first, then main RL script
  const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
  const mainScriptUrl = `https://cfw.rabbitloader.xyz/${did}/rl.uj.rd.js?mode=everyone`;
  
  const scriptTags = `  <!-- RabbitLoader Defer Configuration -->
  <script src="${deferLoaderUrl}"></script>
  <!-- RabbitLoader Main Script -->
  <script src="${mainScriptUrl}"></script>`;
  
  const headOpenTag = '<head>';
  
  if (!themeContent.includes(headOpenTag)) {
    throw new Error("Could not find <head> tag in theme.liquid");
  }

  // Insert scripts right after <head> opening tag
  themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTags}`);

  console.log(`Injecting scripts into theme head for ${shop}`);

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

  console.log(`RabbitLoader scripts injected into theme for ${shop}`);
  
  return { 
    success: true, 
    message: "Defer loader and main script injected successfully", 
    deferLoaderUrl,
    mainScriptUrl,
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

  res.redirect(authUrl);
});

// Shopify OAuth Callback
router.get("/auth/callback", async (req, res) => {
  const { code, hmac, shop, state, timestamp } = req.query;
  const { "rl-token": rlToken } = req.query;

  console.log("Callback received:", {
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
            short_id: decoded.did,
            api_token: decoded.api_token,
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
        did: decoded.did,
        hasApiToken: !!decoded.api_token
      });

      // Redirect back to embedded app with proper parameters
      const hostParam = req.query.host ? `&host=${encodeURIComponent(req.query.host)}` : '';
      const redirectUrl = `/?shop=${encodeURIComponent(shop)}${hostParam}&embedded=1&connected=1`;
      
      console.log("Redirecting to embedded app:", redirectUrl);
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
      console.error("HMAC verification failed");
      return res.status(401).send("Invalid HMAC - Security verification failed");
    }

    console.log("HMAC verification passed");

    // Exchange code for access token
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

    if (!tokenData.access_token) {
      throw new Error("Failed to get access token from Shopify");
    }

    // Save shop with access token
    const shopRecord = await ShopModel.findOneAndUpdate(
      { shop },
      {
        shop,
        access_token: tokenData.access_token,
        connected_at: new Date(),
        $push: {
          history: {
            event: "shopify_auth",
            timestamp: new Date(),
            details: { via: "oauth" }
          }
        }
      },
      { upsert: true, new: true }
    );

    console.log(`Shopify OAuth completed for ${shop}`);

    // Redirect to app with shop parameter and host for embedding
    const hostParam = req.query.host ? `&host=${encodeURIComponent(req.query.host)}` : '';
    const redirectUrl = `/?shop=${encodeURIComponent(shop)}${hostParam}&embedded=1&shopify_auth=1`;
    
    res.redirect(redirectUrl);

  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send(`Authentication failed: ${err.message}`);
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
          short_id: decoded.short_id,
          api_token: decoded.api_token,
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

// Status check - SIMPLIFIED (no automatic injection)
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

// Manual theme injection route (UPDATED)
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
      throw new Error("No access token found for shop");
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

// Get RabbitLoader dashboard data
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

    // Mock data - replace with actual RabbitLoader API calls
    const dashboardData = {
      did: shopRecord.short_id,
      psi_scores: {
        before: {
          mobile: 45,
          desktop: 72
        },
        after: {
          mobile: 95,
          desktop: 98
        }
      },
      plan: {
        name: "Bouncy (Trial)",
        pageviews: "50,000",
        price: "$0/month"
      },
      reports_url: `https://rabbitloader.com/dashboard/${shopRecord.short_id}`,
      customize_url: `https://rabbitloader.com/customize/${shopRecord.short_id}`,
      pageviews_this_month: "12,450"
    };

    res.json({ ok: true, data: dashboardData });
  } catch (err) {
    console.error("Dashboard data error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch dashboard data" });
  }
});

// ====== DEFER CONFIGURATION INTERFACE ======

// Configuration interface route (NEW)
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

    // Read the configuration interface HTML file
    const configHtmlPath = path.join(__dirname, '../views/defer-config.html');
    
    // Check if the file exists, if not create a basic interface
    let configHtml;
    if (fs.existsSync(configHtmlPath)) {
      configHtml = fs.readFileSync(configHtmlPath, 'utf8');
    } else {
      // Create basic interface inline
      configHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Script Defer Configuration - ${shop}</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; margin-bottom: 40px; }
            .config-section { background: white; border-radius: 8px; margin-bottom: 20px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .btn { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
            .btn-primary { background: #007bff; color: white; }
            .btn-success { background: #28a745; color: white; }
            .form-group { margin-bottom: 15px; }
            .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
            .form-group input, .form-group select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
            #statusBanner { padding: 15px; margin-bottom: 20px; border-radius: 4px; display: none; }
            .status-banner.success { background: #d4edda; color: #155724; }
            .status-banner.error { background: #f8d7da; color: #721c24; }
            .rule-item { border: 1px solid #ddd; margin-bottom: 15px; border-radius: 4px; }
            .rule-header { background: #f8f9fa; padding: 15px; display: flex; justify-content: space-between; align-items: center; }
            .rule-content { padding: 15px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Script Defer Configuration</h1>
            <p>Shop: <strong>${shop}</strong></p>
          </div>

          <div id="statusBanner"></div>

          <div class="config-section">
            <h2>Global Settings</h2>
            <div class="form-group">
              <label for="releaseTime">Script Release Time (ms):</label>
              <input type="number" id="releaseTime" min="0" max="30000" step="100" value="2000">
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="enableDefer" checked> Enable Defer System
              </label>
            </div>
          </div>

          <div class="config-section">
            <h2>Defer Rules</h2>
            <div id="rulesContainer">
              <p style="text-align: center; color: #666;">No rules configured. Click "Add Rule" to get started.</p>
            </div>
            <button class="btn btn-primary" onclick="addNewRule()">Add Rule</button>
            <button class="btn btn-success" onclick="saveConfiguration()">Save Configuration</button>
            <button class="btn" onclick="loadConfiguration()">Reload</button>
          </div>

          <script>
            let currentConfig = { release_after_ms: 2000, rules: [], enabled: true };
            const shop = "${shop}";
            let ruleCounter = 1;

            async function loadConfiguration() {
              try {
                showStatus('info', 'Loading configuration...');
                const response = await fetch('/defer-config?shop=' + encodeURIComponent(shop));
                const data = await response.json();
                
                if (data.ok !== false) {
                  currentConfig = data;
                  updateUI();
                  showStatus('success', 'Configuration loaded');
                }
              } catch (error) {
                showStatus('error', 'Failed to load: ' + error.message);
              }
            }

            async function saveConfiguration() {
              try {
                collectFormData();
                showStatus('info', 'Saving...');
                
                const response = await fetch('/defer-config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ shop: shop, ...currentConfig })
                });
                
                const result = await response.json();
                if (result.ok) {
                  showStatus('success', 'Saved successfully!');
                } else {
                  throw new Error(result.error);
                }
              } catch (error) {
                showStatus('error', 'Save failed: ' + error.message);
              }
            }

            function collectFormData() {
              currentConfig.release_after_ms = parseInt(document.getElementById('releaseTime').value) || 2000;
              currentConfig.enabled = document.getElementById('enableDefer').checked;
              
              currentConfig.rules = [];
              document.querySelectorAll('.rule-item').forEach(ruleEl => {
                const rule = {
                  id: ruleEl.querySelector('.rule-id').value,
                  src_regex: ruleEl.querySelector('.rule-regex').value,
                  action: ruleEl.querySelector('.rule-action').value,
                  priority: parseInt(ruleEl.querySelector('.rule-priority').value) || 0,
                  enabled: ruleEl.querySelector('.rule-enabled').checked
                };
                if (rule.src_regex) currentConfig.rules.push(rule);
              });
            }

            function updateUI() {
              document.getElementById('releaseTime').value = currentConfig.release_after_ms || 2000;
              document.getElementById('enableDefer').checked = currentConfig.enabled !== false;
              renderRules();
            }

            function renderRules() {
              const container = document.getElementById('rulesContainer');
              container.innerHTML = '';
              
              if (currentConfig.rules.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: #666;">No rules configured.</p>';
                return;
              }
              
              currentConfig.rules.forEach(rule => {
                const ruleEl = document.createElement('div');
                ruleEl.className = 'rule-item';
                ruleEl.innerHTML = \`
                  <div class="rule-header">
                    <h3>\${rule.id || 'New Rule'}</h3>
                    <button class="btn" onclick="deleteRule(this)" style="background: #dc3545; color: white;">Delete</button>
                  </div>
                  <div class="rule-content">
                    <div class="form-group">
                      <label>Rule ID:</label>
                      <input type="text" class="rule-id" value="\${rule.id || ''}" placeholder="e.g., google-analytics">
                    </div>
                    <div class="form-group">
                      <label>Script URL Pattern (Regex):</label>
                      <input type="text" class="rule-regex" value="\${rule.src_regex || ''}" placeholder="e.g., googletagmanager\\\\.com">
                    </div>
                    <div class="form-group">
                      <label>Action:</label>
                      <select class="rule-action">
                        <option value="defer" \${rule.action === 'defer' ? 'selected' : ''}>Defer</option>
                        <option value="delay" \${rule.action === 'delay' ? 'selected' : ''}>Delay</option>
                        <option value="block" \${rule.action === 'block' ? 'selected' : ''}>Block</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Priority:</label>
                      <input type="number" class="rule-priority" value="\${rule.priority || 0}" min="0">
                    </div>
                    <div class="form-group">
                      <label><input type="checkbox" class="rule-enabled" \${rule.enabled !== false ? 'checked' : ''}> Enabled</label>
                    </div>
                  </div>
                \`;
                container.appendChild(ruleEl);
              });
            }

            function addNewRule() {
              currentConfig.rules.push({
                id: 'rule-' + ruleCounter++,
                src_regex: '',
                action: 'defer',
                priority: 0,
                enabled: true
              });
              renderRules();
            }

            function deleteRule(btn) {
              if (confirm('Delete this rule?')) {
                btn.closest('.rule-item').remove();
              }
            }

            function showStatus(type, message) {
              const banner = document.getElementById('statusBanner');
              banner.className = 'status-banner ' + type;
              banner.textContent = message;
              banner.style.display = 'block';
              
              if (type === 'success') {
                setTimeout(() => banner.style.display = 'none', 3000);
              }
            }

            // Load initial configuration
            document.addEventListener('DOMContentLoaded', loadConfiguration);
          </script>
        </body>
        </html>
      `;
    }

    res.send(configHtml);

  } catch (err) {
    console.error("Configure defer error:", err);
    res.status(500).send("Failed to load configuration interface");
  }
});

// Debug routes
router.get("/debug-shop", async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord) {
      return res.json({ found: false, shop });
    }

    res.json({
      found: true,
      shop: shopRecord.shop,
      has_access_token: !!shopRecord.access_token,
      has_api_token: !!shopRecord.api_token,
      short_id: shopRecord.short_id,
      connected_at: shopRecord.connected_at,
      script_injected: shopRecord.script_injected || false,
      script_injection_attempted: shopRecord.script_injection_attempted || false,
      history: shopRecord.history,
      defer_config: shopRecord.deferConfig || null
    });
  } catch (err) {
    console.error("Debug shop error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get manual installation instructions (UPDATED)
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
    const mainScriptUrl = `https://cfw.rabbitloader.xyz/${shopRecord.short_id}/rl.uj.rd.js?mode=everyone`;
    
    const combinedScriptTag = `  <!-- RabbitLoader Defer Configuration -->
  <script src="${deferLoaderUrl}"></script>
  <!-- RabbitLoader Main Script -->
  <script src="${mainScriptUrl}"></script>`;
    
    res.json({
      ok: true,
      shop,
      did: shopRecord.short_id,
      deferLoaderUrl,
      mainScriptUrl,
      scriptTag: combinedScriptTag,
      instructions: {
        step1: "Go to your Shopify Admin",
        step2: "Navigate to Online Store > Themes",
        step3: "Click 'Actions' > 'Edit code' on your active theme",
        step4: "Open the 'theme.liquid' file in the Layout folder",
        step5: `Add these script tags in the <head> section, BEFORE any other JavaScript:`,
        step6: "Save the file",
        step7: "The RabbitLoader optimization with script deferring will now be active",
        step8: `Configure script deferring rules at: ${process.env.APP_URL}/shopify/configure-defer?shop=${encodeURIComponent(shop)}`
      }
    });
  } catch (err) {
    console.error("Manual instructions error:", err);
    res.status(500).json({ ok: false, error: "Failed to get instructions" });
  }
});

module.exports = router;