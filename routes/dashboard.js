const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");

router.get("/", async (req, res) => {
  const { shop, host } = req.query;

  if (!shop) {
    return res.status(400).send("Shop parameter required");
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });

    if (!shopRecord) {
      return res.status(404).send("Shop not found");
    }

    const dashboardUrl = `https://dashboard.rb8.in?platform=shopify&shop=${encodeURIComponent(shop)}`;

    res.redirect(dashboardUrl);

  } catch (err) {
    console.error("[Dashboard] Error:", err);
    res.status(500).send("Failed to load dashboard");
  }
});

module.exports = router;
