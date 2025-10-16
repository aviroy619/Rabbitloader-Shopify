const ShopModel = require("../models/Shop");

async function shopifyRequest(shop, endpoint, method = "GET", data = null) {
  const shopRecord = await ShopModel.findOne({ shop });
  
  if (!shopRecord?.access_token) {
    throw new Error(`No access token for ${shop} - needs re-authentication`);
  }

  try {
    const url = `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        "X-Shopify-Access-Token": shopRecord.access_token,
        "Content-Type": "application/json"
      },
      body: data ? JSON.stringify(data) : null
    });

    if (response.status === 401) {
      // Token is invalid/expired
      console.error(`[Token] Invalid/expired for ${shop}`);
      
      // Mark shop as needing re-auth
      await ShopModel.updateOne(
        { shop },
        { 
          $set: { needs_reauth: true },
          $unset: { access_token: "" }
        }
      );
      
      return { error: "TOKEN_EXPIRED", needs_reauth: true };
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API error: ${response.status} - ${error}`);
    }

    return await response.json();
    
  } catch (error) {
    console.error(`[Shopify API] Request failed for ${shop}:`, error.message);
    throw error;
  }
}

module.exports = { shopifyRequest };