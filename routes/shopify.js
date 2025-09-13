const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");

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
      return res.json({ ok: true, connected: true, shop });
    }
    return res.json({ ok: true, connected: false, shop });
  } catch (err) {
    console.error("❌ status error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch status" });
  }
});

// Disconnect
router.get("/disconnect", async (req, res) => {
  const { shop } = req.query;
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

module.exports = router;
