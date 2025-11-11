const axios = require('axios');
const Shop = require('../models/Shop');

/**
 * Extract JWT from base64-encoded api_token
 */
function extractJWT(encodedToken) {
  try {
    // Check if it's already a JWT (starts with "eyJ")
    if (encodedToken.startsWith('eyJ')) {
      console.log('[RL Report] api_token is already a JWT');
      return encodedToken;
    }

    // Otherwise, try to decode as base64
    const decoded = JSON.parse(Buffer.from(encodedToken, 'base64').toString());
    return decoded.api_token;
  } catch (error) {
    console.error('[RL Report] Failed to extract JWT:', error.message);
    return null;
  }
}

/**
 * Fetch RabbitLoader Report Overview
 * Includes: plan info, optimization score, domain details
 */
async function fetchReportOverview(shop, jwtToken) {
  try {
    console.log(`[RL Report] Fetching overview for: ${shop}`);
    
    const response = await axios.get(
      `https://api-v1.rabbitloader.com/api/v1/report/overview`,
      {
        params: {
          domain: shop,
          start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0]
        },
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[RL Report] ✅ Got report for ${shop}`);
    return response.data.data;
  } catch (error) {
    console.error(`[RL Report] ❌ Failed to fetch:`, error.message);
    return null;
  }
}

/**
 * Check if cache is still valid (< 24 hours old)
 */
function isCacheValid(lastFetch) {
  if (!lastFetch) return false;
  const hoursPassed = (Date.now() - new Date(lastFetch).getTime()) / (1000 * 60 * 60);
  return hoursPassed < 24;
}

/**
 * Sync subscription & optimization data from RabbitLoader
 */
async function syncReportData(shop) {
  try {
    console.log(`[RL Report] Syncing data for shop: ${shop}`);
    
    // Get shop from database
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc || !shopDoc.api_token) {
      console.log(`[RL Report] ⚠️ Shop not found or no api_token`);
      return null;
    }

    // Check cache (24-hour validity)
    if (isCacheValid(shopDoc.optimization_status?.fetched_at)) {
      console.log(`[RL Report] 💾 Using cached data (< 24 hours old)`);
      return {
        subscription: shopDoc.subscription,
        optimization_status: shopDoc.optimization_status
      };
    }

    // Extract JWT from api_token
    const jwt = extractJWT(shopDoc.api_token);
    if (!jwt) {
      console.log(`[RL Report] ⚠️ Could not extract JWT`);
      return null;
    }

    // Fetch fresh data
    const reportData = await fetchReportOverview(shop, jwt);
    if (!reportData) {
      console.log(`[RL Report] ⚠️ Failed to fetch report data`);
      return null;
    }

    // Extract subscription info
    const subscription = {
      plan_name: reportData.plan_details?.title,
      pay_type: reportData.plan_details?.pay_type,
      fetched_at: new Date()
    };

    // Extract optimization status
    const optimization_status = {
      avg_score: reportData.speed_score?.avg_score,
      optimized_url_count: reportData.speed_score?.optimized_url_count,
      fetched_at: new Date()
    };

    // Save to database
    shopDoc.subscription = subscription;
    shopDoc.optimization_status = optimization_status;
    await shopDoc.save();

    console.log(`[RL Report] ✅ Synced data for ${shop}`);
    return { subscription, optimization_status };

  } catch (error) {
    console.error(`[RL Report] ❌ Sync error:`, error.message);
    return null;
  }
}

module.exports = {
  syncReportData,
  fetchReportOverview,
  extractJWT,
  isCacheValid
};