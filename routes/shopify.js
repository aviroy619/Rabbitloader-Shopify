const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");
const crypto = require("crypto");

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

  console.log("📥 Callback received:", {
    hasCode: !!code,
    hasRlToken: !!rlToken,
    shop,
    hmac: hmac ? hmac.substring(0, 10) + "..." : "none"
  });

  // Handle RabbitLoader callback (when coming back from RL)
  if (rlToken && shop) {
    console.log(`🔄 Processing RabbitLoader callback for ${shop}`);
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

      console.log(`✅ RabbitLoader token saved for ${shop}`);
      
      // Redirect back to embedded app with proper parameters
      const hostParam = req.query.host ? `&host=${encodeURIComponent(req.query.host)}` : '';
      const redirectUrl = `/?shop=${encodeURIComponent(shop)}${hostParam}&embedded=1&connected=1`;
      
      console.log("🔄 Redirecting to embedded app:", redirectUrl);
      return res.redirect(redirectUrl);
      
    } catch (err) {
      console.error("❌ RL callback error:", err);
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

    console.log("🔍 HMAC verification:", {
      queryString: queryString.substring(0, 100) + "...",
      receivedHmac: hmac
    });

    const calculatedHmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(queryString)
      .digest('hex');

    console.log("🔍 HMAC comparison:", {
      calculated: calculatedHmac.substring(0, 10) + "...",
      received: hmac.substring(0, 10) + "...",
      match: calculatedHmac === hmac
    });

    if (calculatedHmac !== hmac) {
      console.error("❌ HMAC verification failed");
      console.error("Expected:", calculatedHmac);
      console.error("Received:", hmac);
      console.error("Query string used:", queryString);
      return res.status(401).send("Invalid HMAC - Security verification failed");
    }

    console.log("✅ HMAC verification passed");

    // Exchange code for access token
    console.log(`🔄 Exchanging code for access token for ${shop}`);
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
    console.log("🔄 Token response received:", { hasAccessToken: !!tokenData.access_token });

    if (!tokenData.access_token) {
      console.error("❌ No access token in response:", tokenData);
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

    console.log(`✅ Shopify OAuth completed for ${shop}`, {
      recordId: shopRecord._id,
      hasAccessToken: !!shopRecord.access_token
    });

    // Redirect to app with shop parameter and host for embedding
    const hostParam = req.query.host ? `&host=${encodeURIComponent(req.query.host)}` : '';
    const redirectUrl = `/?shop=${encodeURIComponent(shop)}${hostParam}&embedded=1&shopify_auth=1`;
    
    console.log("🔄 Redirecting to:", redirectUrl);
    res.redirect(redirectUrl);

  } catch (err) {
    console.error("❌ OAuth callback error:", err);
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

    console.log(`✅ Stored RL token for ${shop}`);
    res.json({ ok: true, message: "RL token stored" });
  } catch (err) {
    console.error("❌ store-token error:", err);
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
      // ✅ Only "connected" if token exists
      return res.json({
        ok: true,
        connected: true,
        shop: record.shop,
        connected_at: record.connected_at
      });
    }

    // ❌ No record or missing token → treat as disconnected
    return res.json({ ok: true, connected: false, shop });
  } catch (err) {
    console.error("❌ status error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch status" });
  }
});

// Disconnect - CHANGED FROM GET TO POST
router.post("/disconnect", async (req, res) => {
  const { shop } = req.body;  // ← CHANGED: from req.query to req.body
  if (!shop) return res.status(400).json({ ok: false, error: "Missing shop" });

  try {
    await ShopModel.updateOne(
      { shop },
      {
        $unset: { api_token: "", short_id: "" },
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

    console.log(`🔌 Disconnected shop: ${shop}`);
    res.json({ ok: true, message: "Disconnected" });
  } catch (err) {
    console.error("❌ disconnect error:", err);
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

    console.log(`✅ RL token saved for ${shop}`);
    res.redirect(`/?shop=${encodeURIComponent(shop)}&connected=1`);
  } catch (err) {
    console.error("❌ RL callback error:", err);
    res.status(500).send("Failed to save RL token");
  }
});

// Manual script injection route
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

    /// Inline script injection logic
const did = shopRecord.short_id;
const scriptUrl = `https://cfw.rabbitloader.xyz/${did}/rl.uj.rd.js?mode=everyone`;
    
    if (!shopRecord.access_token) {
      throw new Error("No access token found for shop");
    }

    console.log(`🔄 Attempting script injection for ${shop} with DID: ${did}`);

    // Check if script already exists
    const existingScriptsResponse = await fetch(`https://${shop}/admin/api/2023-10/script_tags.json`, {
      headers: {
        'X-Shopify-Access-Token': shopRecord.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (!existingScriptsResponse.ok) {
      throw new Error(`Failed to fetch existing scripts: ${existingScriptsResponse.status} ${existingScriptsResponse.statusText}`);
    }

    const existingScripts = await existingScriptsResponse.json();
    console.log(`📋 Found ${existingScripts.script_tags?.length || 0} existing scripts`);
    
    // Check if RabbitLoader script already exists
    const rlScriptExists = existingScripts.script_tags?.some(script => 
      script.src.includes('rabbitloader.xyz') || script.src.includes(did)
    );

    if (rlScriptExists) {
      console.log(`ℹ️ RabbitLoader script already exists for ${shop}`);
      return res.json({ ok: true, message: "Script already exists", scriptUrl });
    }

    // Create new script tag
    const scriptTag = {
      script_tag: {
        event: scriptUrl,
        src: scriptUrl,
        display_scope: "online_store"
      }
    };

    console.log(`🚀 Creating script tag:`, scriptTag);

    const response = await fetch(`https://${shop}/admin/api/2023-10/script_tags.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopRecord.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(scriptTag)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`❌ Script injection failed:`, errorData);
      throw new Error(`Script injection failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    console.log(`✅ RabbitLoader script injected for ${shop}:`, result.script_tag.id);
    
    res.json({ 
      ok: true, 
      message: "Script injected successfully", 
      scriptId: result.script_tag.id,
      scriptUrl 
    });

  } catch (err) {
    console.error("❌ Manual script injection error:", err);
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
      history: shopRecord.history
    });
  } catch (err) {
    console.error("Debug shop error:", err);
    res.status(500).json({ error: "Database error" });
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
        step5: `Add this script tag in the <head> section, before any other JavaScript:`,
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