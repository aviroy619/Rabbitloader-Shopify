const express = require("express");
const router = express.Router();

router.get("/account", async (req, res) => {
  const { source, action, site_url, redirect_url, cms_v, plugin_v } = req.query;

  if (source !== "shopify" || action !== "connect") {
    return res.status(400).send("Invalid parameters");
  }

  // Step 1: Authenticate merchant (this happens via your login system)
  // Assume user is logged in and we have their RL account ID

  // Step 2: Register site (if not already registered)
  const shortId = "rl_" + Math.random().toString(36).substring(2, 8); // example
  const apiToken = "rl_api_" + Math.random().toString(36).substring(2, 12);

  // Step 3: Build payload
  const payload = {
    short_id: shortId,
    api_token: apiToken,
    connected_at: new Date().toISOString()
  };

  // Step 4: Base64 encode
  const rlToken = Buffer.from(JSON.stringify(payload)).toString("base64");

  // Step 5: Redirect back to Shopify app
  const redirectWithToken = `${redirect_url}&rl-token=${encodeURIComponent(rlToken)}`;
  return res.redirect(redirectWithToken);
});

module.exports = router;