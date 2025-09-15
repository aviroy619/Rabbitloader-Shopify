const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");
const crypto = require("crypto");

// Helper function to inject script into theme
async function injectScriptIntoTheme(shop, did, accessToken) {
  const scriptUrl = `https://cfw.rabbitloader.xyz/${did}/rl.uj.rd.js?mode=everyone`;
  
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

  // Step 3: Check if RabbitLoader script already exists
  if (themeContent.includes('rabbitloader.xyz') || themeContent.includes(did)) {
    console.log(`RabbitLoader script already exists in theme for ${shop}`);
    return { success: true, message: "Script already exists in theme", scriptUrl };
  }

  // Step 4: Inject script at the top of <head>
  const scriptTag = `  <script src="${scriptUrl}"></script>`;
  const headOpenTag = '<head>';
  
  if (!themeContent.includes(headOpenTag)) {
    throw new Error("Could not find <head> tag in theme.liquid");
  }

  // Insert script right after <head> opening tag
  themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTag}`);

  console.log(`Injecting script into theme head: ${scriptTag}`);

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

  console.log(`RabbitLoader script injected into theme for ${shop}`);
  
  return { 
    success: true, 
    message: "Script injected successfully into theme head", 
    scriptUrl,
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

      // Note: Script injection happens automatically on first status check
      
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
    // FIXED: Proper HMAC verification
    // Build query string excluding hmac and signature, sorted alphabetically
    const queryObj = { ...req.query };
    delete queryObj.hmac;
    delete queryObj.signature;

    const queryString = Object.keys(queryObj)
      .sort()
      .map(key => `${key}=${queryObj[key]}`)
      .join('&');

    console.log("HMAC verification:", {
      queryString: queryString.substring(0, 100) + "...",
      receivedHmac: hmac
    });

    const calculatedHmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(queryString)
      .digest('hex');

    console.log("HMAC comparison:", {
      calculated: calculatedHmac.substring(0, 10) + "...",
      received: hmac.substring(0, 10) + "...",
      match: calculatedHmac === hmac
    });

    if (calculatedHmac !== hmac) {
      console.error("HMAC verification failed");
      console.error("Expected:", calculatedHmac);
      console.error("Received:", hmac);
      console.error("Query string used:", queryString);
      return res.status(401).send("Invalid HMAC - Security verification failed");
    }

    console.log("HMAC verification passed");

    // Exchange code for access token
    console.log(`Exchanging code for access token for ${shop}`);
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
    console.log("Token response received:", { hasAccessToken: !!tokenData.access_token });

    if (!tokenData.access_token) {
      console.error("No access token in response:", tokenData);
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

    console.log(`Shopify OAuth completed for ${shop}`, {
      recordId: shopRecord._id,
      hasAccessToken: !!shopRecord.access_token
    });

    // Redirect to app with shop parameter and host for embedding
    const hostParam = req.query.host ? `&host=${encodeURIComponent(req.query.host)}` : '';
    const redirectUrl = `/?shop=${encodeURIComponent(shop)}${hostParam}&embedded=1&shopify_auth=1`;
    
    console.log("Redirecting to:", redirectUrl);
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
    // Decode base64
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

// Status check with semi-automatic injection
router.get("/status", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ ok: false, error: "Missing shop" });

  try {
    const record = await ShopModel.findOne({ shop });

    if (record && record.api_token) {
      // Check if script needs injection (hasn't been attempted yet)
      const needsInjection = !record.script_injected && !record.script_injection_attempted;
      
      if (needsInjection && record.access_token && record.short_id) {
        console.log(`Auto-injection needed for ${shop}`);
        
        // Mark as attempted to prevent loops
        await ShopModel.updateOne({ shop }, { $set: { script_injection_attempted: true } });
        
        // Try auto-injection in background
        setImmediate(async () => {
          try {
            await injectScriptIntoTheme(shop, record.short_id, record.access_token);
            await ShopModel.updateOne({ shop }, { $set: { script_injected: true } });
            console.log(`Auto-injected script for ${shop}`);
          } catch (err) {
            console.log(`Auto-injection failed for ${shop}: ${err.message}`);
          }
        });
      }

      return res.json({
        ok: true,
        connected: true,
        shop: record.shop,
        connected_at: record.connected_at,
        script_injected: record.script_injected || false,
        auto_injection_attempted: record.script_injection_attempted || false
      });
    }

    // No record or missing token → treat as disconnected
    return res.json({ ok: true, connected: false, shop });
  } catch (err) {
    console.error("status error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch status" });
  }
});

// Disconnect - CHANGED FROM GET TO POST
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

// ---------------- RabbitLoader Connect Callback ----------------
router.get("/rl/callback", async (req, res) => {
  const { shop, rl_token } = req.query;
  if (!shop || !rl_token) {
    return res.status(400).send("Missing shop or rl_token");
  }

  try {
    const decoded = JSON.parse(Buffer.from(rl_token, "base64").toString("utf8"));

    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          short_id: decoded.did || decoded.short_id,
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

    console.log(`RL token saved for ${shop}`);
    res.redirect(`/?shop=${encodeURIComponent(shop)}&connected=1`);
  } catch (err) {
    console.error("RL callback error:", err);
    res.status(500).send("Failed to save RL token");
  }
});

// Manual theme injection route - for backup/retry
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

// Debug route to check stored data
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
      history: shopRecord.history
    });
  } catch (err) {
    console.error("Debug shop error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Debug: Check current access token scopes
router.get("/debug-scopes", async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ error: "Missing shop parameter" });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord || !shopRecord.access_token) {
      return res.status(404).json({ error: "No access token found" });
    }

    // Test access to themes API
    const themesResponse = await fetch(`https://${shop}/admin/api/2023-10/themes.json?limit=1`, {
      headers: {
        'X-Shopify-Access-Token': shopRecord.access_token,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      shop,
      themesAccess: {
        status: themesResponse.status,
        statusText: themesResponse.statusText,
        canAccessThemes: themesResponse.ok
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get manual installation instructions
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

    const scriptUrl = `https://cfw.rabbitloader.xyz/${shopRecord.short_id}/rl.uj.rd.js?mode=everyone`;
    
    res.json({
      ok: true,
      shop,
      did: shopRecord.short_id,
      scriptUrl,
      scriptTag: `<script src="${scriptUrl}"></script>`,
      instructions: {
        step1: "Go to your Shopify Admin",
        step2: "Navigate to Online Store > Themes",
        step3: "Click 'Actions' > 'Edit code' on your active theme",
        step4: "Open the 'theme.liquid' file in the Layout folder",
        step5: `Add this script tag in the <head> section, BEFORE any other JavaScript:`,
        step6: "Save the file",
        step7: "The RabbitLoader optimization will now be active on your store"
      }
    });
  } catch (err) {
    console.error("Manual instructions error:", err);
    res.status(500).json({ ok: false, error: "Failed to get instructions" });
  }
});

module.exports = router;