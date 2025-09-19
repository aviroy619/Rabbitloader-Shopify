const express = require("express");
const router = express.Router();

// Handle RabbitLoader callbacks ONLY - frontend redirects directly to rabbitloader.com
// This route processes the callback when RabbitLoader redirects back to our app

router.get("/rl-callback", async (req, res) => {
  const { shop, "rl-token": rlToken } = req.query;

  console.log("RabbitLoader callback received:", {
    hasRlToken: !!rlToken,
    shop,
    allParams: Object.keys(req.query),
    referer: req.headers.referer
  });

  if (!rlToken || !shop) {
    console.error("Missing rl-token or shop parameter in callback");
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
    console.log("Decoded RL token:", {
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

    await ShopModel.findOneAndUpdate(
      { shop },
      updateData,
      { upsert: true }
    );

    console.log(`RabbitLoader connection saved for shop: ${shop}`, {
      did: decoded.did || decoded.short_id,
      hasApiToken: !!decoded.api_token
    });

    // Redirect back to Shopify admin with success parameters
    const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
    const hostParam = req.query.host || shopBase64;
    
    const redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(hostParam)}&embedded=1&connected=1`;
    
    console.log("Redirecting back to Shopify admin:", redirectUrl);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error("RabbitLoader callback processing error:", error);
    
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
    routes: ["rl-callback"]
  });
});

// NOTE: Removed the /account route that was causing conflicts
// Frontend now redirects directly to https://rabbitloader.com/account/
// This eliminates the 500 error and routing conflicts

module.exports = router;