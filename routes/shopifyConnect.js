const express = require("express");
const router = express.Router();
const { shopifyRequest } = require("../utils/shopifyApi");


// Helper function to inject defer script
async function injectDeferScript(shop, did, accessToken) {
  console.log(`[RL] Attempting auto defer script injection for ${shop} with DID: ${did}`);

  try {
    // Get active theme
    const themesData = await shopifyRequest(shop, "themes.json");
    if (!themesData.ok && themesData.error === "TOKEN_EXPIRED") {
      console.log(`[RL] Token expired for ${shop}, marking for reauth`);
      return {
        success: false,
        error: "TOKEN_EXPIRED",
        message: "Access token expired - shop needs to re-authenticate"
      };
    }

    const activeTheme = themesData.themes?.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetData = await shopifyRequest(shop, 
      `themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`
    );
    if (!assetData.ok && assetData.error === "TOKEN_EXPIRED") {
      return {
        success: false,
        error: "TOKEN_EXPIRED",
        message: "Access token expired - shop needs to re-authenticate"
      };
    }

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
    const updateResult = await shopifyRequest(shop, 
      `themes/${activeTheme.id}/assets.json`, 
      "PUT",
      {
        asset: {
          key: 'layout/theme.liquid',
          value: themeContent
        }
      }
    );
    
    if (!updateResult.ok && updateResult.error === "TOKEN_EXPIRED") {
      return {
        success: false,
        error: "TOKEN_EXPIRED",
        message: "Access token expired - shop needs to re-authenticate"
      };
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
// Handle RabbitLoader callbacks
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
    const decoded = JSON.parse(Buffer.from(rlToken, "base64").toString("utf8"));
    console.log("[RL] Decoded token:", {
      hasDid: !!(decoded.did || decoded.short_id),
      hasApiToken: !!decoded.api_token,
      platform: decoded.platform,
      accountId: decoded.account_id
    });
    
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

    if (decoded.account_id) {
      updateData.$set.account_id = decoded.account_id;
    }

    const updatedShop = await ShopModel.findOneAndUpdate(
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

    const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
    const hostParam = req.query.host || shopBase64;
    
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

// Connect to RabbitLoader
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
    const connectUrl = new URL('https://rabbitloader.com/account/');
    connectUrl.searchParams.set('source', 'shopify');
    connectUrl.searchParams.set('action', 'connect');
    connectUrl.searchParams.set('site_url', `https://${shop}`);
    
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

    res.redirect(finalUrl);
    
  } catch (error) {
    console.error(`[RL] ❌ Connect error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to initiate connection" 
    });
  }
});

// Disconnect from RabbitLoader
router.get("/rl-disconnect", async (req, res) => {
  const { shop } = req.query;
  
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
        $set: { connected_at: null },
        $push: {
          history: {
            event: "disconnect",
            timestamp: new Date(),
            details: { via: "manual-rl-disconnect" }
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

// Health check
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "rabbitloader-connect",
    timestamp: new Date().toISOString(),
    routes: ["rl-callback", "rl-connect", "rl-disconnect", "health", "debug"],
    features: ["connection-only", "setup-via-frontend", "token-expiry-handling"]
  });
});

// Debug route
router.get("/debug/:shop", async (req, res) => {
  const { shop } = req.params;
  
  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop: shop + '.myshopify.com' });
    
    if (!shopRecord) {
      return res.json({ found: false, shop });
    }
    
    res.json({
      found: true,
      shop: shopRecord.shop,
      connected: !!shopRecord.api_token,
      needs_setup: shopRecord.needs_setup || false,
      needs_reauth: shopRecord.needs_reauth || false,
      setup_completed: shopRecord.setup_completed || false,
      script_injected: shopRecord.script_injected || false,
      critical_css_injected: shopRecord.critical_css_injected || false,
      injection_attempted: shopRecord.script_injection_attempted || false,
      connected_at: shopRecord.connected_at,
      did: shopRecord.short_id,
      history: shopRecord.history || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export router as default, attach helper function as property
module.exports = router;
module.exports.injectDeferScript = injectDeferScript;