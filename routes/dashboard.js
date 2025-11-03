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
      return res.status(404).send("Shop not found. Please authenticate first.");
    }

    const isConnected = !!shopRecord.api_token;
    const needsAuth = shopRecord.reauth_required || !shopRecord.access_token;

    const dashboardConfig = {
      platform: "shopify",
      shopIdentifier: shop,
      host: host,
      did: shopRecord.short_id || shopRecord.did,
      apiToken: shopRecord.api_token,
      isConnected,
      needsAuth,
      apiUrl: "/api/rl-core",
      features: {
        performance: true,
        pages: true,
        jsOptimization: true,
        criticalCSS: true,
        settings: true,
        analytics: true
      }
    };

    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>RabbitLoader Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
body { margin:0; padding:0; background:#f6f6f7; }
#dashboard-container { width:100%; height:100vh; }
#dashboard-iframe { width:100%; height:100%; border:0; display:${isConnected ? "block" : "none"}; }
#connect-screen { display:${isConnected ? "none" : "flex"}; align-items:center; justify-content:center; flex-direction:column; height:100vh; }
</style>
</head>
<body>
<div id="dashboard-container">

  <div id="connect-screen">
    <h2>Connect to RabbitLoader</h2>
    <p>Please connect your store to begin optimization.</p>
    <a href="/rl/rl-connect?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || '')}">Connect Now</a>
  </div>

  <iframe id="dashboard-iframe"
    src="https://dashboard.rb8.in?platform=shopify&shop=${encodeURIComponent(shop)}"
  ></iframe>

</div>

<script>
window.RL_DASHBOARD_CONFIG = ${JSON.stringify(dashboardConfig)};

const iframe = document.getElementById('dashboard-iframe');

iframe.addEventListener("load", () => {
  iframe.contentWindow.postMessage({
    type: "RABBITLOADER_CONFIG",
    config: window.RL_DASHBOARD_CONFIG
  }, "*");
});

window.addEventListener("message", (event) => {
  if (!event.origin.includes("dashboard.rb8.in")) return;

  if (event.data?.type === "RABBITLOADER_REQUEST_CONFIG") {
    iframe.contentWindow.postMessage({
      type: "RABBITLOADER_CONFIG",
      config: window.RL_DASHBOARD_CONFIG
    }, "*");
  }
});
</script>
</body>
</html>
`);
  } catch (err) {
    console.error("[Dashboard] Error:", err);
    res.status(500).send("Failed to load dashboard: " + err.message);
  }
});

module.exports = router;
