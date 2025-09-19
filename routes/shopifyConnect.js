const express = require("express");
const router = express.Router();

router.get("/account", async (req, res) => {
  const { source, action, site_url, redirect_url, cms_v, plugin_v } = req.query;

  if (source !== "shopify" || action !== "connect") {
    return res.status(400).send("Invalid parameters");
  }

  console.log("RabbitLoader connect request:", {
    site_url,
    redirect_url,
    cms_v,
    plugin_v
  });

  // Validate required parameters
  if (!site_url || !redirect_url) {
    return res.status(400).send("Missing required parameters: site_url or redirect_url");
  }

  try {
    // Step 1: Call real RabbitLoader API to register/connect site
    const rlApiUrl = process.env.RABBITLOADER_API_V1 || process.env.RABBITLOADER_API_V2;
    if (!rlApiUrl) {
      console.error("No RabbitLoader API URL configured");
      return res.status(500).send("RabbitLoader API not configured");
    }

    const rlResponse = await fetch(`${rlApiUrl}/sites/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RABBITLOADER_PARTNER_TOKEN}`,
        'User-Agent': 'Shopify-RabbitLoader-App/1.0.0'
      },
      body: JSON.stringify({
        site_url: site_url,
        platform: 'shopify',
        cms_version: cms_v || 'unknown',
        plugin_version: plugin_v || '1.0.0',
        callback_url: redirect_url
      })
    });

    if (!rlResponse.ok) {
      const errorText = await rlResponse.text();
      console.error(`RabbitLoader API error: ${rlResponse.status}`, errorText);
      
      // For development/testing, fall back to mock data if API fails
      if (process.env.NODE_ENV === 'development') {
        console.log("Development mode: Using mock RabbitLoader data due to API failure");
        
        const mockPayload = {
          did: "rl_dev_" + Math.random().toString(36).substring(2, 8),
          short_id: "rl_dev_" + Math.random().toString(36).substring(2, 8),
          api_token: "rl_dev_token_" + Math.random().toString(36).substring(2, 12),
          connected_at: new Date().toISOString(),
          platform: 'shopify'
        };

        const rlToken = Buffer.from(JSON.stringify(mockPayload)).toString("base64");
        const redirectWithToken = `${redirect_url}&rl-token=${encodeURIComponent(rlToken)}`;
        
        return res.redirect(redirectWithToken);
      }
      
      return res.status(500).send("Failed to connect with RabbitLoader service. Please try again later.");
    }

    const rlData = await rlResponse.json();
    
    // Step 2: Extract real connection data
    const { short_id, api_token, account_id, did } = rlData;
    
    // RabbitLoader might return either short_id or did
    const finalDid = short_id || did;
    
    if (!finalDid || !api_token) {
      console.error("Invalid response from RabbitLoader API:", rlData);
      return res.status(500).send("Invalid response from RabbitLoader service");
    }

    console.log(`Site connected to RabbitLoader:`, {
      site_url,
      did: finalDid,
      account_id,
      hasApiToken: !!api_token
    });

    // Step 3: Build real payload
    const payload = {
      did: finalDid,           // Use 'did' as the primary identifier
      short_id: finalDid,      // Also set short_id for backward compatibility
      api_token: api_token,
      account_id: account_id,
      connected_at: new Date().toISOString(),
      platform: 'shopify'
    };

    // Step 4: Base64 encode
    const rlToken = Buffer.from(JSON.stringify(payload)).toString("base64");

    // Step 5: Redirect back to Shopify app with real token
    const redirectWithToken = `${redirect_url}&rl-token=${encodeURIComponent(rlToken)}`;
    
    console.log("Redirecting back to Shopify with real RabbitLoader token");
    return res.redirect(redirectWithToken);

  } catch (error) {
    console.error("RabbitLoader connection error:", error);
    
    // For development/testing, fall back to mock data
    if (process.env.NODE_ENV === 'development') {
      console.log("Development mode: Using mock RabbitLoader data due to network error");
      
      const mockPayload = {
        did: "rl_dev_" + Math.random().toString(36).substring(2, 8),
        short_id: "rl_dev_" + Math.random().toString(36).substring(2, 8),
        api_token: "rl_dev_token_" + Math.random().toString(36).substring(2, 12),
        connected_at: new Date().toISOString(),
        platform: 'shopify'
      };

      const rlToken = Buffer.from(JSON.stringify(mockPayload)).toString("base64");
      const redirectWithToken = `${redirect_url}&rl-token=${encodeURIComponent(rlToken)}`;
      
      return res.redirect(redirectWithToken);
    }
    
    return res.status(500).send(`Connection failed: ${error.message}`);
  }
});

module.exports = router;