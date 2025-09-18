// routes/deferConfig.js - Integrated with your existing Shopify app
const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");

// Default configuration
const DEFAULT_CONFIG = {
  release_after_ms: 2000,
  rules: [],
  enabled: true,
  version: "1.0.0"
};

// Middleware to validate shop and update usage
async function validateShopAndUpdateUsage(req, res, next) {
  const shop = req.query.shop || req.body.shop;
  
  if (!shop) {
    return res.status(400).json({ 
      error: "shop parameter required",
      ok: false 
    });
  }

  // Validate shop format
  if (!shop.includes('.myshopify.com')) {
    return res.status(400).json({ 
      error: "Invalid shop format",
      ok: false 
    });
  }

  try {
    // Find shop record and update usage
    const shopRecord = await ShopModel.findOne({ shop });
    if (shopRecord) {
      await shopRecord.updateUsage();
      req.shopRecord = shopRecord;
    }
    
    req.shop = shop;
    next();
  } catch (error) {
    console.error('Shop validation error:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
}

// GET configuration for a shop
router.get("/", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop, shopRecord } = req;

    if (shopRecord && shopRecord.deferConfig) {
      return res.json({
        ...shopRecord.deferConfig.toObject(),
        ok: true,
        source: "database",
        shop: shop
      });
    }

    // Return default config if no custom config found
    res.json({
      ...DEFAULT_CONFIG,
      ok: true,
      source: "default",
      shop: shop
    });

  } catch (error) {
    console.error('Error fetching defer config:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
});

// POST/PUT to update configuration
router.post("/", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop } = req;
    const { release_after_ms, rules, enabled } = req.body;

    // Validate configuration
    if (release_after_ms !== undefined && (typeof release_after_ms !== 'number' || release_after_ms < 0)) {
      return res.status(400).json({ 
        error: "release_after_ms must be a positive number",
        ok: false 
      });
    }

    if (rules && !Array.isArray(rules)) {
      return res.status(400).json({ 
        error: "rules must be an array",
        ok: false 
      });
    }

    // Validate rules
    if (rules) {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (!rule.id || !rule.src_regex) {
          return res.status(400).json({ 
            error: `Rule ${i + 1}: id and src_regex are required`,
            ok: false 
          });
        }
        
        // Test regex validity
        try {
          new RegExp(rule.src_regex);
        } catch (regexError) {
          return res.status(400).json({ 
            error: `Rule ${i + 1}: Invalid regex pattern - ${regexError.message}`,
            ok: false 
          });
        }
      }
    }

    const newConfig = {
      release_after_ms: release_after_ms || DEFAULT_CONFIG.release_after_ms,
      rules: rules || [],
      enabled: enabled !== undefined ? enabled : true,
      version: "1.0.0",
      updated_at: new Date()
    };

    // Update in database (create shop record if it doesn't exist)
    const updatedShop = await ShopModel.findOneAndUpdate(
      { shop },
      { 
        $set: { 
          deferConfig: newConfig,
          shop: shop // Ensure shop field is set
        } 
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );

    console.log(`Updated defer config for ${shop}:`, {
      rules: newConfig.rules.length,
      enabled: newConfig.enabled,
      release_after_ms: newConfig.release_after_ms
    });

    res.json({
      ...newConfig,
      ok: true,
      message: "Configuration updated successfully",
      shop: shop
    });

  } catch (error) {
    console.error('Error updating defer config:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
});

// DELETE configuration (reset to defaults)
router.delete("/", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop } = req;

    await ShopModel.updateOne(
      { shop },
      { $unset: { deferConfig: "" } }
    );

    res.json({
      ...DEFAULT_CONFIG,
      ok: true,
      message: "Configuration reset to defaults",
      shop: shop
    });

  } catch (error) {
    console.error('Error resetting defer config:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
});

// GET all configurations (admin/debug endpoint)
router.get("/all", async (req, res) => {
  try {
    // Simple auth check - in production, implement proper admin auth
    const adminKey = req.query.admin_key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ 
        error: "Forbidden - Invalid admin key",
        ok: false 
      });
    }

    const shops = await ShopModel.find(
      { deferConfig: { $exists: true } },
      { shop: 1, deferConfig: 1, usage: 1, connected_at: 1 }
    ).limit(100);

    res.json({
      shops: shops.map(s => ({
        shop: s.shop,
        config: s.deferConfig,
        usage: s.usage,
        connected_at: s.connected_at
      })),
      total: shops.length,
      ok: true
    });
  } catch (error) {
    console.error('Error fetching all configs:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
});

// Endpoint to generate the tiny loader script dynamically
router.get("/loader.js", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop, shopRecord } = req;
    
    // Set proper headers for JavaScript
    res.set({
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300', // 5 minute cache
      'Access-Control-Allow-Origin': `https://${shop}`
    });

    // Get defer config
    const deferConfig = shopRecord && shopRecord.deferConfig 
      ? shopRecord.deferConfig.toObject() 
      : DEFAULT_CONFIG;

    // Generate the dynamic loader script
    const loaderScript = `
(function() {
  'use strict';
  
  // Configuration for ${shop}
  var CONFIG = ${JSON.stringify(deferConfig)};
  var SHOP = "${shop}";
  
  if (!CONFIG.enabled) {
    console.log('[RabbitLoader Defer] Disabled for this shop');
    return;
  }
  
  console.log('[RabbitLoader Defer] Initializing with', CONFIG.rules.length, 'rules');
  
  var originalScripts = [];
  var observer;
  var releaseTimer;
  
  function matchesRule(src, rule) {
    if (!rule.enabled) return false;
    try {
      return new RegExp(rule.src_regex, 'i').test(src);
    } catch (e) {
      console.warn('[RabbitLoader Defer] Invalid regex:', rule.src_regex);
      return false;
    }
  }
  
  function findMatchingRule(src) {
    for (var i = 0; i < CONFIG.rules.length; i++) {
      if (matchesRule(src, CONFIG.rules[i])) {
        return CONFIG.rules[i];
      }
    }
    return null;
  }
  
  function handleScript(script) {
    var src = script.src || script.getAttribute('src');
    if (!src) return;
    
    var rule = findMatchingRule(src);
    if (!rule) return;
    
    console.log('[RabbitLoader Defer] Processing script:', src, 'Action:', rule.action);
    
    if (rule.action === 'defer') {
      // Store original script info
      originalScripts.push({
        src: src,
        script: script,
        rule: rule
      });
      
      // Replace with placeholder
      script.type = 'text/deferred';
      script.removeAttribute('src');
    } else if (rule.action === 'block') {
      // Block the script entirely
      script.remove();
      console.log('[RabbitLoader Defer] Blocked script:', src);
    }
  }
  
  function releaseScripts() {
    console.log('[RabbitLoader Defer] Releasing', originalScripts.length, 'deferred scripts');
    
    originalScripts.forEach(function(item, index) {
      setTimeout(function() {
        var newScript = document.createElement('script');
        newScript.src = item.src;
        newScript.async = true;
        
        // Copy attributes
        Array.from(item.script.attributes).forEach(function(attr) {
          if (attr.name !== 'type' && attr.name !== 'src') {
            newScript.setAttribute(attr.name, attr.value);
          }
        });
        
        document.head.appendChild(newScript);
        console.log('[RabbitLoader Defer] Released script:', item.src);
      }, index * 100); // Stagger script loading
    });
    
    originalScripts = [];
  }
  
  function setupObserver() {
    observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.tagName === 'SCRIPT') {
            handleScript(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('script').forEach(handleScript);
          }
        });
      });
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  
  function init() {
    // Handle existing scripts
    document.querySelectorAll('script').forEach(handleScript);
    
    // Setup observer for future scripts
    setupObserver();
    
    // Setup release timer
    releaseTimer = setTimeout(function() {
      releaseScripts();
      if (observer) {
        observer.disconnect();
      }
    }, CONFIG.release_after_ms);
    
    // Emergency release on page load
    window.addEventListener('load', function() {
      setTimeout(function() {
        if (originalScripts.length > 0) {
          console.log('[RabbitLoader Defer] Emergency release triggered');
          releaseScripts();
        }
      }, 1000);
    });
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Debug info
  window.RLDefer = {
    config: CONFIG,
    originalScripts: originalScripts,
    forceRelease: releaseScripts
  };
  
})();
`;

    res.send(loaderScript);

  } catch (error) {
    console.error('Error generating loader script:', error);
    res.status(500).send('// Error generating loader script');
  }
});

module.exports = router;