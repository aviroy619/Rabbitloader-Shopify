const express = require("express");
const router = express.Router();

// Helper function to inject defer script
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

    // Inject defer script
    const scriptTag = `  <!-- RabbitLoader Defer Configuration -->
  <script src="${deferLoaderUrl}"></script>`;
    
    const headOpenTag = '<head>';
    
    if (!themeContent.includes(headOpenTag)) {
      throw new Error("Could not find <head> tag in theme.liquid");
    }

    themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTag}`);

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
      themeId: activeTheme.id
    };

  } catch (error) {
    console.error(`[RL] ❌ Auto-injection failed for ${shop}:`, error);
    throw error;
  }
}

// Handle RabbitLoader callbacks with auto-injection
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
        connected_at: new Date()
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

    const updatedShop = await ShopModel.findOneAndUpdate(
      { shop },
      updateData,
      { upsert: true, new: true }
    );

    console.log(`[RL] Connection saved for shop: ${shop}`, {
      did: decoded.did || decoded.short_id,
      hasApiToken: !!decoded.api_token
    });

    // AUTO-INJECT CRITICAL CSS AFTER SUCCESSFUL CONNECTION
    let cssInjectionResult = null;
    let jsInjectionResult = null;

    if (updatedShop.access_token) {
      // Check if Critical CSS is already injected
      if (!updatedShop.critical_css_injected) {
        try {
          console.log(`[RL] 🚀 Attempting automatic Critical CSS injection for ${shop}`);
          
          // Import the injection function from app.js
          const { injectCriticalCSSIntoTheme } = require("../app");
          
          cssInjectionResult = await injectCriticalCSSIntoTheme(
            shop, 
            updatedShop.short_id, 
            updatedShop.access_token
          );
          
          if (cssInjectionResult.success) {
            console.log(`[RL] ✅ Critical CSS auto-injected successfully for ${shop}`);
            console.log(`[RL] Position: ${cssInjectionResult.position}`);
            console.log(`[RL] Theme: ${cssInjectionResult.themeName}`);
            
            // Update database to mark as injected
            await ShopModel.updateOne(
              { shop }, 
              { 
                $set: { 
                  critical_css_injected: true,
                  critical_css_injection_attempted: true,
                  critical_css_injection_date: new Date()
                },
                $push: {
                  history: {
                    event: "auto_critical_css_inject",
                    timestamp: new Date(),
                    details: { 
                      success: true, 
                      message: cssInjectionResult.message,
                      position: cssInjectionResult.position,
                      theme: cssInjectionResult.themeName,
                      already_exists: cssInjectionResult.scriptType === 'existing'
                    }
                  }
                }
              }
            );
            
            console.log(`[RL] ✅ Database updated - Critical CSS injection recorded`);
          }
        } catch (cssInjectionError) {
          console.error(`[RL] ❌ Automatic Critical CSS injection failed for ${shop}:`, cssInjectionError.message);
          
          // Record failure in database
          await ShopModel.updateOne(
            { shop }, 
            { 
              $set: { 
                critical_css_injection_attempted: true,
                critical_css_injection_error: cssInjectionError.message
              },
              $push: {
                history: {
                  event: "auto_critical_css_inject",
                  timestamp: new Date(),
                  details: { 
                    success: false, 
                    error: cssInjectionError.message 
                  }
                }
              }
            }
          );
        }
      } else {
        console.log(`[RL] ℹ️ Critical CSS already injected for ${shop}, skipping`);
      }
      
      // AUTO-INJECT DEFER SCRIPT (if not already done)
            
      if (!updatedShop.script_injected) {
        try {
          console.log(`[RL] 🚀 Attempting automatic defer script injection for ${shop}`);
          
          jsInjectionResult = await injectDeferScript(
            shop, 
            updatedShop.short_id, 
            updatedShop.access_token
          );
          
          if (jsInjectionResult.success) {
            await ShopModel.updateOne(
              { shop }, 
              { 
                $set: { 
                  script_injected: true,
                  script_injection_attempted: true 
                },
                $push: {
                  history: {
                    event: "auto_script_inject",
                    timestamp: new Date(),
                    details: { 
                      success: true, 
                      message: jsInjectionResult.message,
                      already_exists: jsInjectionResult.already_exists || false
                    }
                  }
                }
              }
            );
            
            console.log(`[RL] ✅ Defer script automatically injected for ${shop}`);
          }
        } catch (jsInjectionError) {
          console.warn(`[RL] ⚠️ Automatic defer script injection failed for ${shop}:`, jsInjectionError.message);
          
          await ShopModel.updateOne(
            { shop }, 
            { 
              $set: { script_injection_attempted: true },
              $push: {
                history: {
                  event: "auto_script_inject",
                  timestamp: new Date(),
                  details: { 
                    success: false, 
                    error: jsInjectionError.message 
                  }
                }
              }
            }
          );
        }
      } else {
        console.log(`[RL] ℹ️ Defer script already injected for ${shop}, skipping`);
      }
    }

    // Redirect back to Shopify admin with success parameters
    const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
    const hostParam = req.query.host || shopBase64;
    
    // Add injection status to redirect URL
    let redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(hostParam)}&embedded=1&connected=1`;
    if (cssInjectionResult && cssInjectionResult.success) {
      redirectUrl += '&critical_css_injected=1';
    }
    if (jsInjectionResult && jsInjectionResult.success) {
      redirectUrl += '&script_injected=1';
    }
    console.log("[RL] Redirecting back to Shopify admin:", redirectUrl);
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

// Health check for RabbitLoader routes
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "rabbitloader-connect",
    timestamp: new Date().toISOString(),
    routes: ["rl-callback"],
    features: ["auto-critical-css-injection", "auto-defer-script-injection"]
  });
});

// Debug route to check connection status
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

// Export both router and helper function
module.exports = {
  router,
  injectDeferScript
};