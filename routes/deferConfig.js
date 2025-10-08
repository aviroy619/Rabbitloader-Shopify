// routes/deferConfig.js - Template-aware defer configuration
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

// TEMPLATE-AWARE LOADER SCRIPT - Generates actual defer functionality
router.get("/loader.js", validateShopAndUpdateUsage, async (req, res) => {
  try {
    const { shop, shopRecord } = req;
    
    // Set proper headers for JavaScript
    res.set({
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': `https://${shop}`
    });

    // Get defer config
    const deferConfig = shopRecord && shopRecord.deferConfig 
      ? shopRecord.deferConfig.toObject() 
      : DEFAULT_CONFIG;

    // Compress config for smaller script size - INCLUDE CONDITIONS
    const compressedConfig = {
      t: deferConfig.release_after_ms, // time
      e: deferConfig.enabled,          // enabled
      r: deferConfig.rules.map(rule => ({
        i: rule.id,
        r: rule.src_regex,
        a: rule.action,
        e: rule.enabled !== false,
        c: rule.conditions || {} // conditions (page_types, device, etc)
      }))
    };

// Generate minified defer script with FIXED TEMPLATE DETECTION
    const loaderScript = `(function(){
if(!${compressedConfig.e})return;
var q=[],c=${JSON.stringify(compressedConfig)},o,t,pt=null;
function gpt(){if(pt)return pt;try{var p=window.location.pathname;if(p==='/'||p==='/index')pt='index';else if(p.startsWith('/products/'))pt='product';else if(p.startsWith('/collections/'))pt='collection';else if(p.startsWith('/pages/'))pt=p==='/pages/contact'?'contact':'page';else if(p.startsWith('/blogs/')||p.match(/\\/\\d{4}\\/\\d{2}\\//))pt='article';else if(p.startsWith('/cart'))pt='cart';else pt='page';console.log('[RL Defer] Detected:',pt,'from:',p)}catch(e){console.error('[RL Defer] Error:',e);pt='page'}return pt}
function m(s,r){try{return new RegExp(r.r,'i').test(s)}catch(e){return false}}
function cm(r){if(!r.c||!r.c.page_types||r.c.page_types.length===0)return true;var p=gpt();return r.c.page_types.indexOf(p)!==-1}
function f(s){for(var i=0;i<c.r.length;i++){var rule=c.r[i];if(rule.e&&cm(rule)&&m(s,rule))return rule}return null}
function h(s){var src=s.src;if(!src)return;var r=f(src);if(!r)return;
console.log('[RL Defer] Processing:',src,'Rule:',r.i,'Action:',r.a,'Template:',gpt());
if(r.a==='defer'){q.push({s:src,e:s});s.type='text/deferred';s.removeAttribute('src')}
else if(r.a==='block'){s.remove();console.log('[RL Defer] Blocked:',src)}}
function rel(){console.log('[RL Defer] Releasing',q.length,'scripts for template:',gpt());
q.forEach(function(item,i){setTimeout(function(){
var ns=document.createElement('script');ns.src=item.s;ns.async=true;if(item.s.includes('portable-wallets')||item.s.includes('.mjs'))ns.type='module';
document.head.appendChild(ns);console.log('[RL Defer] Released:',item.s)},i*50)})}
function init(){console.log('[RL Defer] Init - Template:',gpt(),'Rules:',c.r.length);
document.querySelectorAll('script').forEach(h);
o=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){
if(n.tagName==='SCRIPT')h(n);else if(n.querySelectorAll)n.querySelectorAll('script').forEach(h)})})});
o.observe(document.documentElement,{childList:true,subtree:true});
t=setTimeout(function(){rel();o&&o.disconnect()},c.t);
console.log('[RL Defer] Initialized with',c.r.filter(function(r){return cm(r)}).length,'applicable rules, release in',c.t+'ms')}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init()})();`;

    res.send(loaderScript);

  } catch (error) {
    console.error('Error generating loader script:', error);
    res.status(500).send('//Error generating loader script');
  }
});

// Separate endpoint for full configuration (for debugging)
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
// Serve critical CSS for a shop
router.get("/critical.css", async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    res.setHeader('Content-Type', 'text/css');
    return res.status(400).send('/* Error: Missing shop parameter */');
  }

  try {
    // Verify shop exists
    const shopRecord = await ShopModel.findOne({ shop });
    
    res.setHeader('Content-Type', 'text/css');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Check if Critical CSS service is configured
    const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://localhost:3010';
    
    // Try to fetch from Critical CSS microservice
    try {
      const axios = require('axios');
      
      // Detect template from referrer
      const referrer = req.headers.referer || req.headers.referrer || '';
      let template = 'index';
      
      if (referrer) {
        const url = new URL(referrer);
        const path = url.pathname;
        
        if (path === '/' || path === '/index') template = 'index';
        else if (path.startsWith('/products/')) template = 'product';
        else if (path.startsWith('/collections/')) template = 'collection';
        else if (path.startsWith('/pages/')) template = 'page';
        else if (path.startsWith('/blogs/') || path.match(/\/\d{4}\/\d{2}\//)) template = 'article';
        else if (path.startsWith('/cart')) template = 'cart';
      }
      
      console.log(`Fetching critical CSS for ${shop}, template: ${template}`);
      
      const response = await axios.get(
        `${criticalCssServiceUrl}/api/shopify/${shop}/${template}/css`,
        { timeout: 5000 }
      );
      
      if (response.data && response.status === 200) {
        console.log(`Served generated critical CSS for ${shop}/${template}`);
        return res.send(response.data);
      }
    } catch (fetchError) {
      console.warn(`Failed to fetch from Critical CSS service: ${fetchError.message}`);
    }
    
    // Fallback: return minimal critical CSS
    const criticalCSS = `
/* RabbitLoader Critical CSS for ${shop} */
/* Generated at ${new Date().toISOString()} */
/* Fallback CSS - Critical CSS service not available */

/* Reset & Base Styles */
* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

/* Above-the-fold content */
.shopify-section { display: block; }
.header { display: block; }
.main-content { display: block; }

/* Basic responsive */
img { max-width: 100%; height: auto; }
    `.trim();
    
    console.log(`Served fallback critical CSS for ${shop}`);
    res.send(criticalCSS);
    
  } catch (err) {
    console.error("Critical CSS error:", err);
    res.setHeader('Content-Type', 'text/css');
    res.status(500).send('/* Error generating critical CSS */');
  }
});
module.exports = router;