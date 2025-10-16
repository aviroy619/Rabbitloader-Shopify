const express = require("express");
const router = express.Router();
const crypto = require('crypto');

// Middleware to verify Shopify webhook
function verifyShopifyWebhook(req, res, next) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = req.rawBody; // Need raw body for verification
  
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  
  if (hash === hmac) {
    next();
  } else {
    console.error('Webhook verification failed');
    res.status(401).send('Unauthorized');
  }
}

// App uninstalled webhook
router.post("/app/uninstalled", verifyShopifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  
  console.log(`[Webhook] App uninstalled for ${shop}`);
  
  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (shopRecord && shopRecord.accessToken) {
      // Remove RabbitLoader code from theme
      await removeRabbitLoaderCode(shop, shopRecord.accessToken);
    }
    
    // Remove shop from database
    await ShopModel.deleteOne({ shop });
    
    console.log(`[Webhook] ✅ Cleaned up ${shop}`);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('[Webhook] Uninstall cleanup error:', error);
    res.status(500).send('Error');
  }
});

// Function to remove RabbitLoader code from theme
async function removeRabbitLoaderCode(shop, accessToken) {
  console.log(`[Cleanup] Removing RabbitLoader code from ${shop}`);
  
  try {
    const { shopifyRequest } = require("../utils/shopifyApi");
    
    // Get active theme
    const themesData = await shopifyRequest(shop, "themes.json");
    
    if (!themesData.ok && themesData.error === "TOKEN_EXPIRED") {
      console.log(`[Cleanup] Token expired for ${shop}, skipping cleanup`);
      return { success: false, error: "TOKEN_EXPIRED" };
    }

    const activeTheme = themesData.themes?.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetData = await shopifyRequest(shop,
      `themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`
    );
    
    if (!assetData.ok && assetData.error === "TOKEN_EXPIRED") {
      return { success: false, error: "TOKEN_EXPIRED" };
    }

    let themeContent = assetData.asset.value;

    // Remove ALL RabbitLoader code blocks
    const patterns = [
      /<!-- RabbitLoader Defer Configuration -->[\s\S]*?<\/script>\s*/g,
      /<!-- RabbitLoader Configuration -->[\s\S]*?<\/script>\s*/g,
      /<!-- RabbitLoader Critical CSS -->[\s\S]*?<link[^>]*>\s*/g,
      /<!-- Critical CSS Injection by RabbitLoader -->[\s\S]*?<\/script>\s*/g
    ];

    let wasModified = false;
    patterns.forEach(pattern => {
      if (pattern.test(themeContent)) {
        themeContent = themeContent.replace(pattern, '');
        wasModified = true;
      }
    });

    if (!wasModified) {
      console.log(`[Cleanup] No RabbitLoader code found in theme for ${shop}`);
      return { success: true, message: "No code to remove" };
    }

    // Update theme file
    const updateResult = await shopifyRequest(shop,
      `themes/${activeTheme.id}/assets.json`,
      "PUT",
      {
        asset: {
          key: 'layout/theme.liquid',
          value: themeContent
        }
      }
    );
    
    if (!updateResult.ok && updateResult.error === "TOKEN_EXPIRED") {
      return { success: false, error: "TOKEN_EXPIRED" };
    }

    console.log(`[Cleanup] ✅ RabbitLoader code removed from ${shop}`);
    return { success: true, message: "Code removed successfully" };

  } catch (error) {
    console.error(`[Cleanup] Failed to remove code from ${shop}:`, error);
    return { success: false, error: error.message };
  }
}
module.exports = router;