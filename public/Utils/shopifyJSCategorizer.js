/**
 * Shopify-specific JavaScript file categorization and analysis utilities
 */

/**
 * Categorize JavaScript files based on Shopify store structure
 * @param {string} url - The JavaScript file URL
 * @param {string} shop - The shop domain name
 * @returns {string} Category name
 */
function categorizeShopifyJS(url, shop) {
  const u = url.toLowerCase();
  
  // Shopify Core (checkout/storefront scripts)
  if (u.includes('shopifycloud') || 
      u.includes('.checkout.shopify.com') || 
      u.includes('.myshopify.com') ||
      u.includes('storefront-renderer') ||
      u.includes('web-pixels-manager') ||
      u.includes('checkout-web') ||
      u.includes('shopify-boomerang') ||
      u.includes('trekkie') ||
      u.includes('features') ||
      u.includes('payment-sheet')) {
    return 'Shopify Core';
  }
  
  // Shopify App scripts
  if (u.includes('/apps/') || 
      (u.includes('shop=') && u.includes('.myshopify.com')) ||
      u.includes('shopify-app-bridge') ||
      u.includes('app-bridge') ||
      u.includes('pos-ui-extensions') ||
      u.match(/\/proxy\/.*\.js/)) {
    return 'Shopify App';
  }
  
  // Theme assets
  if (u.includes('/cdn/shop/t/') || 
      /\/assets\/.*\.js(\?|$)/.test(u) ||
      u.includes('theme.js') ||
      u.includes('sections.js') ||
      u.includes('global.js') ||
      u.includes('product-form.js') ||
      u.includes('cart.js') ||
      (u.includes(shop) && u.includes('/assets/'))) {
    return 'Shopify Theme';
  }
  
  // Shopify CDN
  if (u.includes('cdn.shopify.com') ||
      u.includes('cdn.shopifycloud.com')) {
    return 'Shopify CDN';
  }
  
  // Known third-party services (categorized by service)
  if (u.includes('google') || u.includes('gtag') || u.includes('analytics') || u.includes('gtm')) return 'Google Analytics/Tags';
  if (u.includes('facebook') || u.includes('fbevents') || u.includes('connect.facebook')) return 'Facebook/Meta';
  if (u.includes('tiktok') || u.includes('ttq') || u.includes('analytics.tiktok')) return 'TikTok Analytics';
  if (u.includes('intercom') || u.includes('widget.intercom')) return 'Intercom';
  if (u.includes('clarity.ms') || u.includes('microsoft')) return 'Microsoft Clarity';
  if (u.includes('hotjar') || u.includes('static.hotjar')) return 'Hotjar';
  if (u.includes('zendesk') || u.includes('zopim') || u.includes('chat.zendesk')) return 'Zendesk/Chat';
  if (u.includes('klaviyo') || u.includes('klaviyo.com')) return 'Klaviyo';
  if (u.includes('gorgias') || u.includes('gorgias.com')) return 'Gorgias';
  if (u.includes('privy') || u.includes('privy.com')) return 'Privy';
  if (u.includes('yotpo') || u.includes('yotpo.com')) return 'Yotpo';
  if (u.includes('judge.me') || u.includes('judgeme')) return 'Judge.me';
  if (u.includes('loyalty') || u.includes('smile.io')) return 'Loyalty/Rewards';
  if (u.includes('recaptcha') || u.includes('gstatic.com')) return 'Google reCAPTCHA';
  if (u.includes('stripe') || u.includes('stripe.com')) return 'Stripe Payments';
  if (u.includes('paypal') || u.includes('paypalobjects')) return 'PayPal';
  if (u.includes('amazon') || u.includes('amazonpay')) return 'Amazon Pay';
  if (u.includes('afterpay') || u.includes('clearpay')) return 'Afterpay/Clearpay';
  if (u.includes('klarna') || u.includes('klarna.com')) return 'Klarna';
  if (u.includes('affirm') || u.includes('affirm.com')) return 'Affirm';
  if (u.includes('sezzle') || u.includes('sezzle.com')) return 'Sezzle';
  if (u.includes('shopify-pay') || u.includes('shop-pay')) return 'Shop Pay';
  
  // Everything else → third-party
  return 'Third-Party';
}

/**
 * Calculate defer priority based on waste metrics and file characteristics
 * @param {number} wastedPercent - Percentage of unused code
 * @param {number} wastedBytes - Number of wasted bytes
 * @param {string} category - File category
 * @returns {string} Priority level: 'high', 'medium', or 'low'
 */
function calculateDeferPriority(wastedPercent, wastedBytes, category = '') {
  // Critical Shopify Core files should be handled carefully
  if (category === 'Shopify Core') {
    // Only defer if waste is very high
    if (wastedPercent > 70 || wastedBytes > 200000) {
      return 'medium'; // Never high priority for core files
    }
    return 'low';
  }
  
  // High priority: >50% waste OR >100KB wasted
  if (wastedPercent > 50 || wastedBytes > 100000) {
    return 'high';
  }
  // Medium priority: >30% waste OR >50KB wasted  
  else if (wastedPercent > 30 || wastedBytes > 50000) {
    return 'medium';
  }
  // Low priority: everything else
  else {
    return 'low';
  }
}

/**
 * Determine if a script is safe to defer based on its category and characteristics
 * @param {string} url - Script URL
 * @param {string} category - Script category
 * @param {number} wastedPercent - Percentage of unused code
 * @returns {object} Safety analysis
 */
function getDeferSafety(url, category, wastedPercent) {
  const u = url.toLowerCase();
  
  // Never defer critical checkout/payment scripts
  if (u.includes('checkout') || 
      u.includes('payment') || 
      u.includes('trekkie') ||
      u.includes('web-pixels-manager')) {
    return {
      safe: false,
      reason: 'Critical for checkout/payments',
      confidence: 9
    };
  }
  
  // Safe to defer: Third-party analytics/marketing
  if (category.includes('Google') || 
      category.includes('Facebook') || 
      category.includes('TikTok') ||
      u.includes('analytics') ||
      u.includes('gtag')) {
    return {
      safe: true,
      reason: 'Analytics/marketing script',
      confidence: 9
    };
  }
  
  // Safe to defer: High-waste app scripts
  if (category === 'Shopify App' && wastedPercent > 40) {
    return {
      safe: true,
      reason: 'High waste app script',
      confidence: 8
    };
  }
  
  // Moderate safety: Theme scripts with high waste
  if (category === 'Shopify Theme' && wastedPercent > 50) {
    return {
      safe: true,
      reason: 'High waste theme script',
      confidence: 7
    };
  }
  
  // Default: Proceed with caution
  return {
    safe: true,
    reason: 'Standard defer candidate',
    confidence: 6
  };
}

/**
 * Get category-specific defer recommendations
 * @param {string} category - Script category
 * @returns {object} Category-specific guidance
 */
function getCategoryGuidance(category) {
  const guidance = {
    'Shopify Core': {
      defaultAction: 'review',
      confidence: 3,
      notes: 'Core Shopify scripts - defer only if high waste and non-critical'
    },
    'Shopify App': {
      defaultAction: 'defer',
      confidence: 7,
      notes: 'App scripts are usually safe to defer, especially with high waste'
    },
    'Shopify Theme': {
      defaultAction: 'defer',
      confidence: 6,
      notes: 'Theme scripts can often be deferred if they have unused code'
    },
    'Google Analytics/Tags': {
      defaultAction: 'defer',
      confidence: 9,
      notes: 'Analytics scripts are ideal candidates for deferring'
    },
    'Facebook/Meta': {
      defaultAction: 'defer',
      confidence: 9,
      notes: 'Social media tracking can be safely deferred'
    },
    'Third-Party': {
      defaultAction: 'defer',
      confidence: 8,
      notes: 'Most third-party scripts are safe to defer'
    }
  };
  
  return guidance[category] || {
    defaultAction: 'review',
    confidence: 5,
    notes: 'Review manually for defer safety'
  };
}

module.exports = {
  categorizeShopifyJS,
  calculateDeferPriority,
  getDeferSafety,
  getCategoryGuidance
};