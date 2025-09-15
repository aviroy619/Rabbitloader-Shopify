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

  if (!code || !shop) {
    return res.status(400).send("Missing authorization code or shop");
  }

  try {
    // Verify HMAC (important for security)
    const queryString = Object.keys(req.query)
      .filter(key => key !== 'hmac' && key !== 'signature')
      .sort()
      .map(key => `${key}=${req.query[key]}`)
      .join('&');

    const calculatedHmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(queryString)
      .digest('hex');

    if (calculatedHmac !== hmac) {
      return res.status(401).send("Invalid HMAC");
    }

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
      throw new Error("Failed to get access token");
    }

    // Save shop with access token
    await ShopModel.findOneAndUpdate(
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

    console.log(`✅ Shopify OAuth completed for ${shop}`);

    // Redirect to app with shop parameter
    res.redirect(`/?shop=${encodeURIComponent(shop)}&embedded=1`);

  } catch (err) {
    console.error("❌ OAuth callback error:", err);
    res.status(500).send("Authentication failed");
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