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
      
      // Redirect back to embedded app
      const redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(req.query.host || '')}&embedded=1&connected=1`;
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

module.exports = router;