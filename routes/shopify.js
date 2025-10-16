const fetch = require("node-fetch");

async function shopifyRequest(shop, endpoint, method = "GET", body = null) {
  const ShopModel = require("../models/Shop");
  const shopRecord = await ShopModel.findOne({ shop });
  if (!shopRecord || !shopRecord.access_token) {
    throw new Error(`Missing access token for ${shop}`);
  }

  const url = `https://${shop}/admin/api/2023-07/${endpoint}`;
  const headers = {
    "X-Shopify-Access-Token": shopRecord.access_token,
    "Content-Type": "application/json",
  };

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    console.error(`[ShopifyAPI] Error ${response.status} for ${shop}: ${JSON.stringify(result)}`);
    throw new Error(`Shopify API error: ${result.errors || response.statusText}`);
  }
  return result;
}

async function injectDeferScript(shop, did, accessToken) {
  console.log(`[Inject] Starting defer script injection for ${shop}`);
  const { shopifyRequest } = require("./shopifyApi");

  const themes = await shopifyRequest(shop, "themes.json", "GET", null);
  const mainTheme = themes.themes.find((t) => t.role === "main");
  if (!mainTheme) throw new Error("Main theme not found");

  const assetUrl = `https://${shop}/admin/api/2023-07/themes/${mainTheme.id}/assets.json`;
  const loaderScript = `
    <!-- RabbitLoader Defer Loader -->
    <script src="https://shopify.rb8.in/defer-config/loader.js?shop=${shop}"></script>
  `;

  const payload = {
    asset: {
      key: "snippets/rabbitloader-defer.liquid",
      value: loaderScript,
    },
  };

  await fetch(assetUrl, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(`[Inject] Defer script injected for ${shop}`);
  return { success: true, message: "Defer script injected" };
}

async function injectCriticalCSSIntoTheme(shop, did, accessToken) {
  console.log(`[Inject] Injecting Critical CSS for ${shop}`);
  const { shopifyRequest } = require("./shopifyApi");

  const themes = await shopifyRequest(shop, "themes.json", "GET", null);
  const mainTheme = themes.themes.find((t) => t.role === "main");
  if (!mainTheme) throw new Error("Main theme not found");

  const criticalCssUrl = `https://rabbitloader-css.b-cdn.net/${shop}/index.css`;

  const assetUrl = `https://${shop}/admin/api/2023-07/themes/${mainTheme.id}/assets.json`;
  const cssTag = `<link rel="stylesheet" href="${criticalCssUrl}" />`;

  const payload = {
    asset: {
      key: "snippets/rabbitloader-critical-css.liquid",
      value: cssTag,
    },
  };

  await fetch(assetUrl, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(`[Inject] Critical CSS link added for ${shop}`);
  return { success: true, message: "Critical CSS injected" };
}

router.installApp = installApp;
router.authCallback = authCallback;
module.exports = router;
