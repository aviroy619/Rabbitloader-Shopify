const express = require("express");
const router = express.Router();

// ============================================================
// HELPER FUNCTION: Inject Defer Script
// ============================================================
async function injectDeferScript(shop, did, accessToken) {
  console.log(`[RL] Attempting auto defer script injection for ${shop} with DID: ${did}`);

  try {
    // Get active theme
    const themesResponse = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!themesResponse.ok) {
      throw new Error(`Failed to fetch themes: ${themesResponse.status}`);
    }

    const themesData = await themesResponse.json();
    const activeTheme = themesData.themes.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetResponse = await fetch(`https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!assetResponse.ok) {
      throw new Error(`Failed to fetch theme.liquid: ${assetResponse.status}`);
    }

    const assetData = await assetResponse.json();
    let themeContent = assetData.asset.value;

    // Check if defer script already exists
    const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
    
    if (themeContent.includes(`defer-config/loader.js?shop=${shop}`) || 
        themeContent.includes(deferLoaderUrl) ||
        themeContent.includes('RabbitLoader Defer Configuration')) {
      console.log(`[RL] Defer script already exists in theme for ${shop}`);
      return { success: true, message: "Defer script already exists", already_exists: true };
    }

    // Find first <script> tag to inject BEFORE it
    const firstJSPattern = /(<script[^>]*>)/;
    const jsMatch = themeContent.match(firstJSPattern);
    
    const scriptTag = `  <!-- RabbitLoader Defer Configuration -->
  <script src="${deferLoaderUrl}"></script>
`;
    
    if (jsMatch) {
      // Inject BEFORE first JS script
      themeContent = themeContent.replace(firstJSPattern, scriptTag + '$1');
      console.log(`[RL] Injecting defer script BEFORE first JS`);
    } else {
      // No JS found, inject after <head>
      const headOpenTag = '<head>';
      if (!themeContent.includes(headOpenTag)) {
        throw new Error("Could not find <head> tag in theme.liquid");
      }
      themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTag}`);
      console.log(`[RL] Injecting defer script after <head> (no JS found)`);
    }

    // Update theme file
    const updateResponse = await fetch(`https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json`, {
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
      throw new Error(`Theme update failed: ${updateResponse.status} - ${JSON.stringify(errorData)}`);
    }

    console.log(`[RL] ✅ Defer script auto-injected successfully for ${shop}`);
    return { 
      success: true, 
      message: "Defer script injected successfully",
      deferLoaderUrl,
      themeId: activeTheme.id,
      position: jsMatch ? 'before-first-js' : 'after-head'
    };

  } catch (error) {
    console.error(`[RL] ❌ Auto-injection failed for ${shop}:`, error);
    throw error;
  }
}

// ============================================================
// ROUTE: RabbitLoader OAuth Callback
// ============================================================
router.get("/rl-callback", async (req, res) => {
  const { shop, "rl-token": rlToken } = req.query;

  console.log("[RL] Callback received:", {
    hasRlToken: !!rlToken,
    shop,
    allParams: Object.keys(req.query),
    referer: req.headers.referer
  });

  if (!rlToken || !shop) {
    console.error("[RL] Missing rl-token or shop parameter in callback");
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Callback Error</title>
        <style>body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }</style>
      </head>
      <body>
        <h2>RabbitLoader Callback Error</h2>
        <p>Missing required parameters. Please try connecting again.</p>
        <a href="/?shop=${encodeURIComponent(shop || '')}" style="color: #007bff;">Return to App</a>
      </body>
      </html>
    `);
  }

  try {
    // Decode the RabbitLoader token
    const decoded = JSON.parse(Buffer.from(rlToken, "base64").toString("utf8"));
    console.log("[RL] Decoded token:", {
      hasDid: !!(decoded.did || decoded.short_id),
      hasApiToken: !!decoded.api_token,
      platform: decoded.platform,
      accountId: decoded.account_id
    });
    
    // Store the connection data in database
    const ShopModel = require("../models/Shop");
    
    const updateData = {
      $set: {
        short_id: decoded.did || decoded.short_id,
        api_token: decoded.api_token,
        connected_at: new Date(),
        needs_setup: true
      },
      $push: {
        history: {
          event: "connect",
          timestamp: new Date(),
          details: { 
            via: "rl-callback",
            platform: decoded.platform || 'shopify'
          }
        }
      }
    };

    // Add account_id if provided
    if (decoded.account_id) {
      updateData.$set.account_id = decoded.account_id;
    }

    await ShopModel.findOneAndUpdate(
      { shop },
      updateData,
      { upsert: true, new: true }
    );

    console.log(`[RL] Connection saved for shop: ${shop}`, {
      did: decoded.did || decoded.short_id,
      hasApiToken: !!decoded.api_token,
      needsSetup: true
    });

    console.log(`[RL] Skipping auto-injection - will be triggered by complete setup flow`);

    // Redirect back to Shopify admin with trigger_setup flag
    const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
    const hostParam = req.query.host || shopBase64;
    
    // Add trigger_setup flag to start complete setup flow
    let redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(hostParam)}&embedded=1&connected=1&trigger_setup=1`;
    
    console.log("[RL] Redirecting to dashboard with trigger_setup flag:", redirectUrl);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error("[RL] Callback processing error:", error);
    
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Error</title>
        <style>body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }</style>
      </head>
      <body>
        <h2>RabbitLoader Connection Error</h2>
        <p>Failed to process the connection. Please try again.</p>
        <p><strong>Error:</strong> ${error.message}</p>
        <a href="/?shop=${encodeURIComponent(shop || '')}" style="color: #007bff;">Return to App</a>
      </body>
      </html>
    `);
  }
});

// ============================================================
// ROUTE: Initiate RabbitLoader Connection
// ============================================================
router.get("/rl-connect", async (req, res) => {
  const { shop, host } = req.query;
  
  console.log(`[RL] Connect request for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    // Build RabbitLoader connect URL
    const connectUrl = new URL('https://rabbitloader.com/account/');
    connectUrl.searchParams.set('source', 'shopify');
    connectUrl.searchParams.set('action', 'connect');
    connectUrl.searchParams.set('site_url', `https://${shop}`);
    
    // Build redirect URL back to this app
    const redirectUrl = new URL('/rl/rl-callback', process.env.APP_URL);
    redirectUrl.searchParams.set('shop', shop);
    if (host) {
      redirectUrl.searchParams.set('host', host);
    }
    
    connectUrl.searchParams.set('redirect_url', redirectUrl.toString());
    connectUrl.searchParams.set('cms_v', 'shopify');
    connectUrl.searchParams.set('plugin_v', '1.0.0');

    const finalUrl = connectUrl.toString();
    console.log(`[RL] Redirecting to RabbitLoader: ${finalUrl}`);

    // Redirect to RabbitLoader
    res.redirect(finalUrl);
    
  } catch (error) {
    console.error(`[RL] ❌ Connect error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to initiate connection" 
    });
  }
});

// ============================================================
// ROUTE: Get Shop Status (FIXED - was missing!)
// ============================================================
router.get("/status", async (req, res) => {
  const { shop } = req.query;
  
  console.log(`[RL] Status check for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.json({ 
        ok: true, 
        connected: false,
        message: "Shop not found"
      });
    }
    
    res.json({
      ok: true,
      connected: !!shopRecord.api_token,
      did: shopRecord.short_id,
      script_injected: shopRecord.script_injected || false,
      critical_css_injected: shopRecord.critical_css_injected || false,
      needs_setup: shopRecord.needs_setup || false,
      setup_completed: shopRecord.setup_completed || false,
      connected_at: shopRecord.connected_at,
      site_structure: shopRecord.site_structure || null
    });
    
  } catch (error) {
    console.error(`[RL] Status check error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Get Dashboard Data (FIXED - was missing!)
// ============================================================
router.get("/dashboard-data", async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not found" 
      });
    }

    res.json({
      ok: true,
      data: {
        did: shopRecord.short_id,
        reports_url: `https://rabbitloader.com/account/`,
        customize_url: `https://rabbitloader.com/account/`,
        api_token: shopRecord.api_token ? 'present' : 'missing',
        connected_at: shopRecord.connected_at,
        script_injected: shopRecord.script_injected || false,
        critical_css_injected: shopRecord.critical_css_injected || false,
        site_structure: shopRecord.site_structure || null
      }
    });
  } catch (error) {
    console.error('[Dashboard Data] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Get Manual Instructions (FIXED - was missing!)
// ============================================================
router.get("/manual-instructions", async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
  
  res.json({
    ok: true,
    scriptTag: `<script src="${deferLoaderUrl}"></script>`,
    instructions: {
      step1: "In your Shopify admin, go to Online Store > Themes",
      step2: "Click Actions > Edit code on your active theme",
      step3: "In the left sidebar, find and click on theme.liquid under Layout",
      step4: "Locate the opening <head> tag (usually near the top of the file)",
      step5: "Add the script AFTER <head> and BEFORE any other scripts",
      step6: "Click Save in the top right corner",
      step7: "Test your store to ensure everything works correctly",
      step8: "Configure defer rules in the Defer Configuration section below"
    }
  });
});

// ============================================================
// ROUTE: Auto-Inject Script (FIXED - was missing!)
// ============================================================
router.post("/inject-script", async (req, res) => {
  const { shop } = req.body;
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.accessToken) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Shop not found or access token missing' 
      });
    }

    // Call the helper function
    const result = await injectDeferScript(
      shop, 
      shopRecord.short_id, 
      shopRecord.accessToken
    );

    // Update shop record
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          script_injected: true,
          script_injection_attempted: true
        },
        $push: {
          history: {
            event: "script_injection",
            timestamp: new Date(),
            details: {
              success: result.success,
              position: result.position,
              theme_id: result.themeId
            }
          }
        }
      }
    );

    res.json({ 
      ok: true, 
      message: result.message,
      ...result
    });

  } catch (error) {
    console.error('[Inject Script] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Disconnect (FIXED - changed from GET to POST!)
// ============================================================
router.post("/disconnect", async (req, res) => {
  const { shop } = req.body; // Changed from req.query
  
  console.log(`[RL] Disconnect request for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    
    await ShopModel.updateOne(
      { shop },
      {
        $unset: { 
          api_token: "", 
          short_id: "",
          script_injected: "",
          script_injection_attempted: "",
          critical_css_injected: ""
        },
        $set: { 
          connected_at: null,
          needs_setup: false,
          setup_completed: false
        },
        $push: {
          history: {
            event: "disconnect",
            timestamp: new Date(),
            details: { via: "manual-disconnect" }
          }
        }
      }
    );

    console.log(`[RL] ✅ Disconnected shop: ${shop}`);
    
    res.json({ 
      ok: true, 
      message: "Disconnected from RabbitLoader successfully" 
    });
    
  } catch (error) {
    console.error(`[RL] ❌ Disconnect error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to disconnect" 
    });
  }
});

// ============================================================
// DEPRECATED: Old GET route for backward compatibility
// ============================================================
router.get("/rl-disconnect", async (req, res) => {
  const { shop } = req.query;
  
  console.warn(`[RL] DEPRECATED: Use POST /disconnect instead`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    
    await ShopModel.updateOne(
      { shop },
      {
        $unset: { 
          api_token: "", 
          short_id: "",
          script_injected: "",
          script_injection_attempted: "",
          critical_css_injected: ""
        },
        $set: { connected_at: null },
        $push: {
          history: {
            event: "disconnect",
            timestamp: new Date(),
            details: { via: "deprecated-rl-disconnect" }
          }
        }
      }
    );

    console.log(`[RL] ✅ Disconnected shop: ${shop}`);
    
    res.json({ 
      ok: true, 
      message: "Disconnected from RabbitLoader successfully" 
    });
    
  } catch (error) {
    console.error(`[RL] ❌ Disconnect error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to disconnect" 
    });
  }
});

// ============================================================
// ROUTE: Health Check
// ============================================================
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "rabbitloader-shopify-integration",
    timestamp: new Date().toISOString(),
    routes: [
      "rl-callback",
      "rl-connect",
      "status",
      "dashboard-data",
      "manual-instructions",
      "inject-script",
      "disconnect",
      "health",
      "debug"
    ],
    features: [
      "oauth-connection",
      "auto-script-injection",
      "manual-instructions",
      "setup-flow",
      "disconnect"
    ]
  });
});

// ============================================================
// ROUTE: Debug (Check Connection Status)
// ============================================================
router.get("/debug/:shop", async (req, res) => {
  const { shop } = req.params;
  
  try {
    const ShopModel = require("../models/Shop");
    
    // Try with and without .myshopify.com suffix
    let shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord && !shop.includes('.myshopify.com')) {
      shopRecord = await ShopModel.findOne({ shop: shop + '.myshopify.com' });
    }
    
    if (!shopRecord) {
      return res.json({ 
        found: false, 
        shop,
        message: "Shop not found in database"
      });
    }
    
    res.json({
      found: true,
      shop: shopRecord.shop,
      connected: !!shopRecord.api_token,
      needs_setup: shopRecord.needs_setup || false,
      setup_completed: shopRecord.setup_completed || false,
      script_injected: shopRecord.script_injected || false,
      critical_css_injected: shopRecord.critical_css_injected || false,
      injection_attempted: shopRecord.script_injection_attempted || false,
      connected_at: shopRecord.connected_at,
      did: shopRecord.short_id,
      account_id: shopRecord.account_id,
      history: shopRecord.history || [],
      site_structure: shopRecord.site_structure || null
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message 
    });
  }
});

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  router,
  injectDeferScript
};