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
      
      return { ok: false, error: "TOKEN_EXPIRED", needs_reauth: true };
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    return { ok: true, ...result };
    
  } catch (error) {
    console.error(`[Shopify API] Request failed for ${shop}:`, error.message);
    throw error;
  }
}

async function shopifyGraphQL(shop, query, variables = {}) {
  const shopRecord = await ShopModel.findOne({ shop });
  
  if (!shopRecord?.access_token) {
    throw new Error(`No access token for ${shop} - needs re-authentication`);
  }

  try {
    const url = `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/graphql.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        "X-Shopify-Access-Token": shopRecord.access_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    if (response.status === 401) {
      console.error(`[Token] Invalid/expired for ${shop}`);
      
      await ShopModel.updateOne(
        { shop },
        { 
          $set: { needs_reauth: true },
          $unset: { access_token: "" }
        }
      );
      
      return { ok: false, error: "TOKEN_EXPIRED", needs_reauth: true };
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify GraphQL error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      console.error(`[Shopify GraphQL] Errors:`, result.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    
    return result;
    
  } catch (error) {
    console.error(`[Shopify GraphQL] Request failed for ${shop}:`, error.message);
    throw error;
  }
}

module.exports = { shopifyRequest, shopifyGraphQL };