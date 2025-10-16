// routes/deferConfig.js - Template-aware defer configuration
const express = require("express");
const router = express.Router();
const ShopModel = require("../models/Shop");
const axios = require("axios"); // Add this if axios is not imported

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

  // Validate shop format - extra safety check for type and format
  if (typeof shop !== 'string' || !shop.includes('.myshopify.com')) {
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

    // --- Security & Caching headers ---
    res.set({
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": `https://${shop}`,
      "X-RabbitLoader": "loader-v2"
    });

    // --- ?norl detection ---
    if (req.query.norl !== undefined) {
      console.log(`[RL Loader] ?norl detected for ${shop} → serving bypass script`);
      return res
        .type("application/javascript")
        .send(`console.warn("RabbitLoader bypassed via ?norl for ${shop}");`);
    }

    // --- Load defer config from DB or default ---
    const deferConfig =
      shopRecord && shopRecord.deferConfig
        ? shopRecord.deferConfig.toObject()
        : DEFAULT_CONFIG;

    // --- Compress config for smaller inline script ---
    const compressedConfig = {
      t: deferConfig.release_after_ms, // release time (ms)
      e: deferConfig.enabled,          // global enable flag
      r: (deferConfig.rules || []).map(rule => ({
        i: rule.id,
        r: rule.src_regex,
        a: rule.action,
        e: rule.enabled !== false,
        c: rule.conditions || {}       // optional conditions
      }))
    };

    // --- Main Defer Loader Script (minified functional core) ---
    const loaderScript = `(function(){
if(!${compressedConfig.e}){console.log('[RL Defer] Disabled globally');return;}
var q=[],c=${JSON.stringify(compressedConfig)},o,t,pt=null;
function gpt(){if(pt)return pt;try{var p=location.pathname;
if(p==='/'||p==='/index')pt='index';
else if(p.startsWith('/products/'))pt='product';
else if(p.startsWith('/collections/'))pt='collection';
else if(p.startsWith('/pages/'))pt=p==='/pages/contact'?'contact':'page';
else if(p.startsWith('/blogs/')||p.match(/\\/\\d{4}\\/\\d{2}\\//))pt='article';
else if(p.startsWith('/cart'))pt='cart';else pt='page';
console.log('[RL Defer] Template:',pt,'from',p);}catch(e){pt='page';}
return pt;}
function m(s,r){try{return new RegExp(r.r,'i').test(s)}catch(e){return false}}
function cm(r){if(!r.c||!r.c.page_types||!r.c.page_types.length)return true;
return r.c.page_types.indexOf(gpt())!==-1;}
function f(s){for(var i=0;i<c.r.length;i++){var r=c.r[i];
if(r.e&&cm(r)&&m(s,r))return r;}return null;}
function h(s){var src=s.src;if(!src)return;
var r=f(src);if(!r)return;
if(r.a==='defer'){q.push({s:src,e:s});s.type='text/deferred';s.removeAttribute('src');}
else if(r.a==='block'){s.remove();console.log('[RL Defer] Blocked:',src);}}
function rel(){console.log('[RL Defer] Releasing',q.length,'scripts for',gpt());
q.forEach(function(item,i){setTimeout(function(){
var ns=document.createElement('script');ns.src=item.s;ns.async=true;
if(item.s.includes('portable-wallets')||item.s.includes('.mjs'))ns.type='module';
document.head.appendChild(ns);console.log('[RL Defer] Released:',item.s);
},i*50);});}
function init(){console.log('[RL Defer] Init for',gpt(),'Rules:',c.r.length);
document.querySelectorAll('script').forEach(h);
o=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){
if(n.tagName==='SCRIPT')h(n);
else if(n.querySelectorAll)n.querySelectorAll('script').forEach(h);});});});
o.observe(document.documentElement,{childList:true,subtree:true});
t=setTimeout(function(){rel();o&&o.disconnect();},c.t);
console.log('[RL Defer] Ready; will release in',c.t+'ms');}
if(location.search.includes('norl')){console.log('[RL Defer] Disabled via ?norl');return;}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();`;

    // --- Send final script ---
    res.send(loaderScript);
    console.log(`[RL Loader] Served loader.js for ${shop}`);

  } catch (error) {
    console.error(`[RL Loader] Error generating loader.js:`, error);
    res
      .status(500)
      .type("application/javascript")
      .send(`console.error("RabbitLoader loader generation failed: ${error.message}");`);
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
  const referer = req.headers.referer || req.headers.referrer || "";

  // --- Basic validation ---
  if (!shop) {
    res.setHeader("Content-Type", "text/css");
    return res.status(400).send("/* Error: Missing shop parameter */");
  }

  // --- Direct ?norl detection in URL ---
  if (req.query.norl !== undefined) {
    console.log(`[RL CriticalCSS] Disabled via ?norl for ${shop} (query param)`);
    res.set({
      "Content-Type": "text/css",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "X-RabbitLoader": "critical-v2"
    });
    return res.send("/* RabbitLoader Critical CSS disabled via ?norl parameter */");
  }

  // --- Fallback ?norl detection via referer ---
  if (referer && referer.includes("norl")) {
    console.log(`[RL CriticalCSS] Disabled via ?norl for ${shop} (referer: ${referer})`);
    res.set({
      "Content-Type": "text/css",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "X-RabbitLoader": "critical-v2"
    });
    return res.send("/* RabbitLoader Critical CSS disabled via ?norl parameter */");
  }

  try {
    // --- Verify shop record ---
    const shopRecord = await ShopModel.findOne({ shop });

    res.set({
      "Content-Type": "text/css",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "X-RabbitLoader": "critical-v2"
    });

    const criticalCssServiceUrl =
      process.env.CRITICAL_CSS_SERVICE_URL || "http://localhost:3010";

    // --- Detect template based on referer path ---
    let template = "index";
    if (referer) {
      try {
        const url = new URL(referer);
        const path = url.pathname;
        if (path === "/" || path === "/index") template = "index";
        else if (path.startsWith("/products/")) template = "product";
        else if (path.startsWith("/collections/")) template = "collection";
        else if (path.startsWith("/pages/")) template = "page";
        else if (path.startsWith("/blogs/") || path.match(/\/\d{4}\/\d{2}\//))
          template = "article";
        else if (path.startsWith("/cart")) template = "cart";
      } catch (parseErr) {
        console.warn(`[RL CriticalCSS] Failed to parse referer: ${referer}`);
      }
    }

    console.log(`[RL CriticalCSS] Fetching critical CSS for ${shop}, template: ${template}`);

    // --- Fetch CSS data from Critical CSS microservice ---
    const axios = require("axios");
    try {
      const response = await axios.get(
        `${criticalCssServiceUrl}/api/critical-css/${shop}/${template}`,
        { timeout: 5000 }
      );

      if (response.data?.ok && response.data.enabled && response.data.data) {
        const cssData = response.data.data;

        // --- Prefer CDN URL for performance ---
        if (cssData.cdn_url) {
          console.log(`[RL CriticalCSS] Redirecting to CDN URL for ${shop}/${template}`);
          return res.redirect(302, cssData.cdn_url);
        }

        // --- Serve inline CSS if present ---
        if (cssData.css) {
          console.log(
            `[RL CriticalCSS] Served inline CSS for ${shop}/${template} (${cssData.metadata?.size || 0} bytes)`
          );
          return res.send(cssData.css);
        }
      }

      if (response.data && !response.data.enabled) {
        console.log(`[RL CriticalCSS] CSS disabled for ${shop}/${template}`);
      }
    } catch (fetchError) {
      console.warn(`[RL CriticalCSS] Failed to fetch from service: ${fetchError.message}`);
    }

    // --- Fallback CSS (if microservice or CDN unavailable) ---
    const criticalCSS = `
/* RabbitLoader Fallback Critical CSS for ${shop} */
/* Generated at ${new Date().toISOString()} */

* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.shopify-section, .header, .main-content { display: block; }
img { max-width: 100%; height: auto; }
`.trim();

    console.log(`[RL CriticalCSS] Served fallback critical CSS for ${shop}`);
    res.send(criticalCSS);
  } catch (err) {
    console.error("[RL CriticalCSS] Error generating critical CSS:", err);
    res.setHeader("Content-Type", "text/css");
    res.status(500).send("/* Error generating critical CSS */");
  }
});


module.exports = router;