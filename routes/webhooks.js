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
    // Get active theme
    const themesResponse = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    const themesData = await themesResponse.json();
    const activeTheme = themesData.themes.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetResponse = await fetch(`https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    const assetData = await assetResponse.json();
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
    const updateResponse = await fetch(`https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        asset: {
          key: 'layout/theme.liquid',
          value: themeContent
        }
      })
    });

    if (!updateResponse.ok) {
      throw new Error(`Theme update failed: ${updateResponse.status}`);
    }

    console.log(`[Cleanup] ✅ RabbitLoader code removed from ${shop}`);
    return { success: true, message: "Code removed successfully" };

  } catch (error) {
    console.error(`[Cleanup] Failed to remove code from ${shop}:`, error);
    throw error;
  }
}

module.exports = router;