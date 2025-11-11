const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const ShopModel = require("../models/Shop");
const { shopifyRequest } = require("../utils/shopifyApi");
const { syncReportData } = require("../utils/rlReportService");

// Helper function to inject defer script
async function injectDeferScript(shop, did, accessToken) {
  console.log(`[RL] Attempting auto defer script injection for ${shop} with DID: ${did}`);

  try {
    // Get active theme
    const themesData = await shopifyRequest(shop, "themes.json");
    if (!themesData.ok) {
      if (themesData.error === "TOKEN_EXPIRED") {
        console.log(`[RL] Token expired for ${shop}, marking for reauth`);
        return {
          success: false,
          error: "TOKEN_EXPIRED",
          message: "Access token expired - shop needs to re-authenticate"
        };
      }
      throw new Error(themesData.error || 'Failed to fetch themes');
    }

    const activeTheme = themesData.themes?.find(theme => theme.role === 'main');
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetData = await shopifyRequest(shop,
      `themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`
    );
    
    if (!assetData.ok) {
      if (assetData.error === "TOKEN_EXPIRED") {
        return {
          success: false,
          error: "TOKEN_EXPIRED",
          message: "Access token expired - shop needs to re-authenticate"
        };
      }
      throw new Error(assetData.error || 'Failed to fetch theme.liquid');
    }

    let themeContent = assetData.asset.value;

    // Check if defer script already exists
    const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;

    if (
      themeContent.includes(`defer-config/loader.js?shop=${shop}`) ||
      themeContent.includes(deferLoaderUrl) ||
      themeContent.includes('RabbitLoader Defer Configuration')
    ) {
      console.log(`[RL] Defer script already exists in theme for ${shop}`);
      return { success: true, message: "Defer script already exists", already_exists: true };
    }

    // Inject script at the top of <head> for optimal PSI performance
    const headOpenTag = '<head>';
    const scriptTag = `
  <!-- RabbitLoader Defer Configuration -->
  <link rel="stylesheet" href="${process.env.APP_URL}/defer-config/critical.css?shop=${encodeURIComponent(shop)}" importance="high" />
  <script src="${deferLoaderUrl}" defer></script>
`;

    if (themeContent.includes(headOpenTag)) {
      themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTag}`);
      console.log(`[RL] Injecting snippet at top of <head>`);
    } else {
      // Fallback: inject at start of file if no <head> tag found
      themeContent = scriptTag + themeContent;
      console.log(`[RL] Injecting snippet at start of file (no <head> tag found)`);
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

    if (!updateResult.ok) {
      if (updateResult.error === "TOKEN_EXPIRED") {
        return {
          success: false,
          error: "TOKEN_EXPIRED",
          message: "Access token expired - shop needs to re-authenticate"
        };
      }
      throw new Error(updateResult.error || 'Failed to update theme');
    }

    console.log(`[RL] ✅ Defer script injected successfully for ${shop}`);
    return { success: true, message: "Defer script injected successfully" };

  } catch (error) {
    console.error(`[RL] ❌ Script injection failed for ${shop}:`, error.message);
    return { success: false, error: error.message };
  }
}

// ====== RL CALLBACK ======
router.get("/rl-callback", async (req, res) => {
  try {
    const { shop, host, 'rl-token': rlToken } = req.query;
    console.log("[RL] Callback received:", { hasRlToken: !!rlToken, shop });

    if (!shop || !rlToken) {
      console.log("[RL] Missing shop or rl-token");
      return res.status(400).send("Invalid callback parameters");
    }

    // Decode token
    const decoded = JSON.parse(Buffer.from(rlToken, 'base64').toString('utf8'));
    console.log("[RL] Decoded token:", { 
      hasDid: !!decoded.did, 
      hasApiToken: !!decoded.api_token 
    });

    // Save tokens to MongoDB
    const shopData = await ShopModel.findOneAndUpdate(
      { shop },
      { 
        $set: {
          api_token: decoded.api_token,      // RL token (JWT)
          short_id: decoded.did,             // RL domain ID
          account_id: decoded.account_id,
          connected_at: new Date()
        }
      },
      { upsert: true, new: true }
    );

    console.log(`[RL] ✅ Tokens saved for ${shop}:`, {
      has_shopify_token: !!shopData.access_token,
      has_rl_token: !!shopData.api_token,
      did: shopData.short_id
    });

    // Sync to RL Core
    try {
      const { syncShopToCore } = require('../utils/rlCoreApi');
      await syncShopToCore({
        shop,
        access_token: shopData.access_token,  // Shopify token
        api_token: decoded.api_token,          // RL token
        short_id: decoded.did,
        account_id: decoded.account_id
      });
      console.log(`[RL] ✅ Synced to RL Core`);
    } catch (syncError) {
      console.error(`[RL] ⚠️ RL Core sync failed:`, syncError.message);
    }

    // Inject scripts if we have BOTH tokens
    if (shopData.access_token) {
      try {
        const injectResult = await injectDeferScript(
          shop, 
          decoded.did, 
          shopData.access_token
        );
        
        if (injectResult.success) {
          await ShopModel.updateOne({ shop }, { 
            $set: { 
              script_injected: true,
              critical_css_injected: true
            }
          });
          console.log(`[RL] ✅ Scripts injected`);
        } else if (injectResult.error === 'TOKEN_EXPIRED') {
          console.log(`[RL] ⚠️ Token expired during injection, skipping`);
        } else {
          console.error(`[RL] ❌ Injection failed:`, injectResult.error);
        }
      } catch (injectErr) {
        console.error(`[RL] ❌ Injection failed:`, injectErr.message);
      }
    } else {
      console.warn(`[RL] ⚠️ No Shopify token yet, skipping injection`);
    }

   // ✅ Redirect back to Shopify Admin
    const shopName = shop.split('.')[0]; // Extract shop name
    const shopifyAdminUrl = `https://admin.shopify.com/store/${shopName}/apps/rabbitloader-dev`;
    console.log(`[RL] Redirecting to Shopify Admin:`, shopifyAdminUrl);
    res.redirect(shopifyAdminUrl);

  } catch (error) {
    console.error("[RL] Callback error:", error);
    res.status(500).send("Callback failed: " + error.message);
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
// Get shop status (for checking RL connection)
router.get("/api/shop-status", async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ error: "Shop parameter required" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord) {
      return res.json({ api_token: null, short_id: null });
    }

    res.json({
      api_token: shopRecord.api_token,
      short_id: shopRecord.short_id,
      connected_at: shopRecord.connected_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const shopDomain = shop.endsWith(".myshopify.com") ? shop : `${shop}.myshopify.com`;
    const shopRecord = await ShopModel.findOne({ shop: shopDomain });
    
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
// ====== SAVE RL TOKEN ======
router.post("/save-token", async (req, res) => {
  const { shop, did, api_token } = req.body;
  
  console.log(`[RL] Save token request for shop: ${shop}`);
  
  if (!shop || !did) {
    return res.status(400).json({ ok: false, error: "Shop and did are required" });
  }

  try {
    const shopRecord = await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          api_token: api_token,
          short_id: did,
          connected_at: new Date(),
          needs_setup: false
        }
      },
      { upsert: true, new: true }
    );

    console.log(`[RL] ✅ Token saved for ${shop}:`, { has_api_token: !!shopRecord.api_token, did: shopRecord.short_id });

    // 🔄 Sync subscription & optimization data in background (don't wait)
    syncReportData(shop).catch(err => {
      console.error(`[RL] ⚠️ Background sync failed:`, err.message);
    });

    res.json({ 
      ok: true, 
      message: "Token saved successfully",
      shop: shopRecord.shop,
      connected: true
    });

  } catch (error) {
    console.error(`[RL] ❌ Error saving token:`, error);
    res.status(500).json({ ok: false, error: error.message });
  }
});
module.exports = router;