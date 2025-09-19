// routes/deferConfig.js - Optimized with minimal loader
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
// Return current config in JSON
router.get("/", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop, shopRecord } = req;

    if (shopRecord && shopRecord.deferConfig) {
      return res.json({
        ...shopRecord.deferConfig.toObject(),
        ok: true,
        source: "database",
        shop
      });
    }

    // Return default config if no custom config found
    res.json({
      ...DEFAULT_CONFIG,
      ok: true,
      source: "default",
      shop
    });

  } catch (error) {
    console.error("Error fetching defer config:", error);
    res.status(500).json({
      error: "Internal server error",
      ok: false
    });
  }
});

// Bootstrap JS loader
router.get("/loader.js", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop } = req;

    res.set({
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": `https://${shop}`
      // ❌ DO NOT manually set Content-Encoding here
    });

    const loaderJs = `
      (function(){
        console.log("✅ RabbitLoader defer script loaded for shop: ${shop}");
        window.deferConfig = window.deferConfig || {};
        // You can extend with config fetch here if needed
      })();
    `;

    res.send(loaderJs);
  } catch (err) {
    console.error("Error serving loader.js:", err);
    res.status(500).type("application/javascript").send("// Loader failed");
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

// OPTIMIZED: Minimal bootstrap loader
router.get("/loader.js", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop, shopRecord } = req;
    
    // Set proper headers for JavaScript
    res.set({
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600', // 1 hour cache for better performance
      'Access-Control-Allow-Origin': `https://${shop}`,
      'Content-Encoding': 'gzip' // Enable compression
    });

    // Get defer config - compress it
    const deferConfig = shopRecord && shopRecord.deferConfig 
      ? shopRecord.deferConfig.toObject() 
      : DEFAULT_CONFIG;

    // Only send essential config data
    const compressedConfig = {
      t: deferConfig.release_after_ms, // time
      e: deferConfig.enabled,          // enabled
      r: deferConfig.rules.map(rule => ({
        i: rule.id,
        r: rule.src_regex,
        a: rule.action,
        e: rule.enabled !== false
      }))
    };

    // MINIMAL BOOTSTRAP SCRIPT - Under 1KB
    const loaderScript = `(function(){
if(!${compressedConfig.e})return;
var q=[],c=${JSON.stringify(compressedConfig)},o,t;
function m(s,r){try{return new RegExp(r.r,'i').test(s)}catch(e){return false}}
function f(s){for(var i=0;i<c.r.length;i++)if(c.r[i].e&&m(s,c.r[i]))return c.r[i]}
function h(s){var src=s.src;if(!src)return;var r=f(src);if(!r)return;
if(r.a==='defer'){q.push({s:src,e:s});s.type='text/deferred';s.removeAttribute('src')}
else if(r.a==='block')s.remove()}
function rel(){q.forEach(function(item,i){setTimeout(function(){
var ns=document.createElement('script');ns.src=item.s;ns.async=true;
document.head.appendChild(ns)},i*50)})}
function init(){document.querySelectorAll('script').forEach(h);
o=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){
if(n.tagName==='SCRIPT')h(n);else if(n.querySelectorAll)n.querySelectorAll('script').forEach(h)})})});
o.observe(document.documentElement,{childList:true,subtree:true});
t=setTimeout(function(){rel();o&&o.disconnect()},c.t)}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init()})();`;

    res.send(loaderScript);

  } catch (error) {
    console.error('Error generating loader script:', error);
    res.status(500).send('//Error');
  }
});

// NEW: Separate endpoint for full configuration (loaded async)
router.get("/config.json", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop, shopRecord } = req;
    
    res.set({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': `https://${shop}`
    });

    const deferConfig = shopRecord && shopRecord.deferConfig 
      ? shopRecord.deferConfig.toObject() 
      : DEFAULT_CONFIG;

    res.json(deferConfig);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;