const compression = require("compression");
require("dotenv").config();

// Environment validation
const requiredEnvVars = [
  'SHOPIFY_API_KEY', 
  'SHOPIFY_API_SECRET',
  'APP_URL', 
  'MONGO_URI',
  'SESSION_SECRET'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    console.error(`Please add ${envVar} to your .env file`);
    process.exit(1);
  }
});

console.log(`Environment validation passed`);
const dbName = (process.env.MONGO_URI.match(/\/([^/?]+)(\?|$)/) || [])[1] || 'unknown';
console.log(`MongoDB URI configured for: ${dbName} database`);

const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const path = require("path");
const ShopModel = require("./models/Shop");
const jsDeferService = require('./services/jsDeferService');

// Initialize express
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;

// ====== Routes that must not be JSON-parsed ======
app.use('/defer-config', require('./routes/deferConfig'));

// ====== Middleware ======
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Webhook raw body must come after parsers
app.use('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }));


// ====== Session Support for OAuth ======
const session = require('express-session');
const MongoStore = require('connect-mongo');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  touchAfter: 24 * 3600 // 24 hours
}),
  cookie: { 
    secure: true, // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ====== Security: Enhanced CSP for Shopify Embedding ======
app.use((req, res, next) => {
  const { embedded } = req.query;
  
  if (embedded === '1') {
    // Embedded app - more restrictive CSP
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.shopify.com https://shopify.rb8.in; " +
      "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
      "connect-src 'self' https://shopify.rb8.in https://*.myshopify.com https://rabbitloader.com https://apiv2.rabbitloader.com; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' https: data:;"
    );
    
    // Allow embedding in Shopify admin
    res.removeHeader("X-Frame-Options");
    
    if (process.env.NODE_ENV !== 'production') {
  console.log(`Setting embedded app CSP headers for ${req.path}`);
}
  } else {
    // Standalone app - standard CSP
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.shopify.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' https://rabbitloader.com https://apiv2.rabbitloader.com;"
    );
    
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  
  next();
});

// ====== MongoDB Connection ======
mongoose.connect(process.env.MONGO_URI);

mongoose.connection.on("connected", () => {
  console.log("MongoDB connected");
  
  // Start RabbitMQ consumer
  jsDeferService.connectRabbitMQ().catch(err => {
    console.error('Failed to start RabbitMQ consumer:', err);
  });
});
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

// ====== Static Files ======
app.use(express.static(path.join(__dirname, "public")));

// ====== Route Imports ======
const shopifyRoutes = require("./routes/shopify");
const deferConfigRoutes = require("./routes/deferConfig");
const { router: dashboardRouter } = require("./routes/dashboard");
const performanceRoutes = require("./routes/performance");

// ====== Mount Routes ======
app.use("/shopify", shopifyRoutes);          // ✅ Mount Shopify router properly
app.use("/defer-config", deferConfigRoutes); // ✅ Defer configuration endpoints
app.use("/rl", dashboardRouter);             // ✅ Dashboard-related routes
app.use("/api/performance", performanceRoutes); // ✅ Performance-related routes

// Helper function to inject Critical CSS into theme - OPTION A (First Position)
async function injectCriticalCSSIntoTheme(shop, did, accessToken) {
  console.log(`[RL] Starting Critical CSS injection for ${shop} with DID: ${did}`);

  try {
    // Step 1: Get active theme
    console.log(`[RL] Fetching themes for ${shop}...`);
    const themesResponse = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!themesResponse.ok) {
      throw new Error(`Failed to fetch themes: ${themesResponse.status} ${themesResponse.statusText}`);
    }

    const themesData = await themesResponse.json();
    const activeTheme = themesData.themes.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    console.log(`[RL] ✅ Found active theme: ${activeTheme.name} (ID: ${activeTheme.id})`);

    // Step 2: Get theme.liquid file
    console.log(`[RL] Fetching theme.liquid...`);
    const assetResponse = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!assetResponse.ok) {
      throw new Error(`Failed to fetch theme.liquid: ${assetResponse.status} ${assetResponse.statusText}`);
    }

    const assetData = await assetResponse.json();
    let themeContent = assetData.asset.value;

    // Step 3: Check if critical CSS already exists
    if (themeContent.includes('rl-critical-css') || 
        themeContent.includes('RabbitLoader Critical CSS')) {
      console.log(`[RL] ⚠️ Critical CSS already exists in theme for ${shop}, skipping injection`);
      return { success: true, message: "Critical CSS already exists in theme", scriptType: "existing" };
    }

    // Step 4: Create Critical CSS injection code - OPTION A (FIRST POSITION)
    const criticalCssScript = `
  <!-- RabbitLoader Critical CSS - FIRST PRIORITY (OPTION A) -->
  <link 
    id="rl-critical-css" 
    rel="stylesheet" 
    href="https://rabbitloader-css.b-cdn.net/{{ shop.permanent_domain }}/{{ template | split: '.' | first }}.css"
  >
  
  <!-- Lazy Fallback: Only loads if CDN fails -->
  <script>
  (function() {
    var template = '{{ template | split: "." | first }}';
    var shop = '{{ shop.permanent_domain }}';
    
    console.log('[RL] Critical CSS loading for template:', template);
    
    // Check if CDN CSS loaded successfully after 2 seconds
    setTimeout(function() {
      var cssLink = document.getElementById('rl-critical-css');
      var cssLoaded = false;
      
      try {
        // Check if stylesheet is accessible and has rules
        if (cssLink && cssLink.sheet && cssLink.sheet.cssRules.length > 0) {
          cssLoaded = true;
          console.log('[RL] ✅ CDN critical CSS loaded successfully:', template, 
                      '(' + cssLink.sheet.cssRules.length + ' rules)');
        }
      } catch (e) {
        // Cross-origin or failed to load
        console.warn('[RL] ⚠️ Cannot access CSS rules (might be cross-origin or failed)');
      }
      
      // If CSS didn't load, inject fallback
      if (!cssLoaded) {
        console.warn('[RL] ❌ CDN CSS failed, loading fallback from app server');
        var fallback = document.createElement('link');
        fallback.rel = 'stylesheet';
        fallback.href = 'https://shopify.rb8.in/defer-config/critical.css?shop=' + shop;
        fallback.id = 'rl-critical-fallback';
        fallback.onload = function() {
          console.log('[RL] ✅ Fallback CSS loaded successfully');
        };
        fallback.onerror = function() {
          console.error('[RL] ❌ Fallback CSS also failed to load');
        };
        document.head.appendChild(fallback);
      }
    }, 2000);
  })();
  </script>
`;

    // Step 5: Find <head> tag and inject IMMEDIATELY AFTER IT (FIRST POSITION)
    const headOpenTag = '<head>';
    
    if (!themeContent.includes(headOpenTag)) {
      throw new Error("Could not find <head> tag in theme.liquid");
    }

    // Count existing CSS files for logging
    const existingCssCount = (themeContent.match(/<link[^>]*rel=["']stylesheet["']/g) || []).length;
    console.log(`[RL] Found ${existingCssCount} existing CSS files in theme`);

    // Inject IMMEDIATELY after <head> opening tag (FIRST POSITION)
    themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${criticalCssScript}`);
    
    console.log(`[RL] ✅ Critical CSS code prepared for injection at FIRST position`);

    // Step 6: Update the theme file
    console.log(`[RL] Updating theme.liquid...`);
    const updateResponse = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes/${activeTheme.id}/assets.json`, {
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
      const errorData = await updateResponse.json();
      console.error(`[RL] ❌ Theme update failed:`, errorData);
      throw new Error(`Theme update failed: ${updateResponse.status} - ${JSON.stringify(errorData)}`);
    }

    console.log(`[RL] ✅✅✅ Critical CSS injected successfully for ${shop}`);
    console.log(`[RL] Theme: ${activeTheme.name}`);
    console.log(`[RL] Position: FIRST (before all other CSS)`);
    console.log(`[RL] CDN URL: https://rabbitloader-css.b-cdn.net/${shop}/[template].css`);
    console.log(`[RL] Fallback URL: https://shopify.rb8.in/defer-config/critical.css?shop=${shop}`);
    
    return { 
      success: true, 
      message: "Critical CSS injected at first position (Option A)", 
      themeId: activeTheme.id,
      themeName: activeTheme.name,
      position: "first",
      cdnUrl: `https://rabbitloader-css.b-cdn.net/${shop}/`,
      fallbackUrl: `https://shopify.rb8.in/defer-config/critical.css?shop=${shop}`
    };

  } catch (error) {
    console.error(`[RL] ❌ Critical CSS injection failed for ${shop}:`, error);
    throw error;
  }
}

// Helper function for Shopify API pagination with rate limiting
async function fetchAllShopifyResources(shop, endpoint, headers, resourceKey) {
  const allItems = [];
  let url = `https://${shop}${endpoint}`;
  let pageCount = 0;
  const maxPages = 20; // Safety limit to prevent infinite loops
  
  while (url && pageCount < maxPages) {
    try {
      const response = await axios.get(url, { headers });
      const items = response.data[resourceKey] || [];
      allItems.push(...items);
      
      console.log(`Fetched page ${pageCount + 1} of ${resourceKey}: ${items.length} items (total so far: ${allItems.length})`);
      
      // Check for next page in Link header
      const linkHeader = response.headers.link;
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : null;
        
        // Rate limiting: wait 100ms between requests
        if (url) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        url = null;
      }
      
      pageCount++;
    } catch (error) {
      console.error(`Error fetching ${resourceKey} page ${pageCount + 1}:`, error.message);
      break;
    }
  }
  
  if (pageCount >= maxPages) {
    console.warn(`Reached maximum page limit (${maxPages}) for ${resourceKey}`);
  }
  
  return allItems;
}

// ====== Public Routes (BEFORE auth middleware) ======
// These need to be mounted before the auth middleware to avoid shop parameter requirements

// ====== API Routes for Lighthouse Integration ======

// API Route for Environment Variables
app.get("/api/env", (req, res) => {
  res.json({
    ok: true,
    env: {
      APP_URL: process.env.APP_URL,
      SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01",
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY
    }
  });
});

// NEW: API Route for Lighthouse-generated configurations
app.post("/api/lighthouse-config", async (req, res) => {
  try {
    const { shop, config } = req.body;
    
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

    // Validate configuration structure
    if (!config || !config.rules || !Array.isArray(config.rules)) {
      return res.status(400).json({ 
        error: "Invalid configuration format - missing rules array",
        ok: false 
      });
    }

    // Save Lighthouse-generated configuration
    const updatedShop = await ShopModel.findOneAndUpdate(
      { shop },
      { 
        $set: { 
          deferConfig: {
            ...config,
            source: "lighthouse",
            updated_at: new Date(),
            version: "1.0.0"
          }
        } 
      },
      { upsert: true, new: true }
    );

    console.log(`Lighthouse config saved for ${shop}:`, {
      rules: config.rules.length,
      enabled: config.enabled,
      source: "lighthouse"
    });

    res.json({
      ...config,
      ok: true,
      message: "Lighthouse configuration saved successfully",
      shop: shop,
      source: "lighthouse"
    });

  } catch (error) {
    console.error('Error saving lighthouse config:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
});

// NEW: API Route to trigger Lighthouse analysis
app.post("/api/analyze-performance", async (req, res) => {
  try {
    const { shop, url } = req.body;
    
    if (!shop || !url) {
      return res.status(400).json({ 
        error: "shop and url parameters required",
        ok: false 
      });
    }

    // This would integrate with your Lighthouse API service
    // For now, return a placeholder response
    res.json({
      ok: true,
      message: "Performance analysis queued",
      shop: shop,
      url: url,
      analysis_id: `analysis_${Date.now()}`,
      status: "pending"
    });

    // TODO: Implement actual Lighthouse API integration here
    console.log(`Performance analysis requested for ${shop}: ${url}`);

  } catch (error) {
    console.error('Error triggering performance analysis:', error);
    res.status(500).json({ 
      error: "Failed to trigger analysis",
      ok: false 
    });
  }
});

// ====== Additional Shopify API Proxy Routes ======

// Debug shop - check if app has token saved
app.get("/shopify/debug-shop", async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.json({
        ok: false,
        found: false,
        shop: shop,
        message: "Shop not found in database"
      });
    }

    res.json({
      ok: true,
      found: true,
      shop: shop,
      has_access_token: !!shopData.access_token,
      connected_at: shopData.connected_at,
      script_injected: shopData.script_injected,
      access_token_preview: shopData.access_token ? `${shopData.access_token.substring(0, 15)}...` : null
    });

  } catch (error) {
    console.error('Error in debug-shop:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// List themes
app.get("/api/themes", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      themes: response.data.themes
    });

  } catch (error) {
    console.error('Error fetching themes:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch themes" 
    });
  }
});

// List products
app.get("/api/products", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/products.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      products: response.data.products
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch products" 
    });
  }
});

// List script tags
app.get("/api/script-tags", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/script_tags.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      script_tags: response.data.script_tags
    });

  } catch (error) {
    console.error('Error fetching script tags:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch script tags" 
    });
  }
});

// Add script tag
app.post("/api/script-tags", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    const { src, event = "onload" } = req.body;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    if (!src) {
      return res.status(400).json({ 
        ok: false, 
        error: "Script src parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.post(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/script_tags.json`, {
      script_tag: {
        event: event,
        src: src
      }
    }, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      ok: true,
      script_tag: response.data.script_tag,
      message: "Script tag added successfully"
    });

  } catch (error) {
    console.error('Error adding script tag:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to add script tag" 
    });
  }
});

// List pages
app.get("/api/pages", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/pages.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      pages: response.data.pages
    });

  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch pages" 
    });
  }
});

// Replace the existing /api/site-analysis route with this improved version
app.get("/api/site-analysis", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const headers = { 'X-Shopify-Access-Token': shopData.access_token };
    const allPages = [];
    const templateCategories = {};
    
    console.log(`Starting comprehensive site analysis for ${shop}...`);

    // 1. Get active theme first
    const themesResponse = await axios.get(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes.json`, { headers });
    const activeTheme = themesResponse.data.themes.find(theme => theme.role === 'main');
    console.log(`Active theme: ${activeTheme ? activeTheme.name : 'Unknown'}`);

    // 2. EXPLICITLY ADD HOMEPAGE
    const homepageData = {
      id: 'homepage_index',
      title: 'Homepage',
      handle: 'index',
      url: '/',
      type: 'homepage',
      template: 'index'
    };
    allPages.push(homepageData);
    addToCategory(templateCategories, 'index', homepageData);
    console.log(`✅ Added homepage to analysis`);

    // 3. Fetch ALL Pages (with pagination)
    try {
      console.log(`Fetching pages...`);
      const pages = await fetchAllShopifyResources(
        shop,
        `/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/pages.json?limit=250`,
        headers,
        'pages'
      );
      
      pages.forEach(page => {
        const template = page.template_suffix || 'page';
        const pageData = {
          id: `page_${page.id}`,
          title: page.title,
          handle: page.handle,
          url: `/pages/${page.handle}`,
          type: 'content_page',
          template: template
        };
        allPages.push(pageData);
        addToCategory(templateCategories, template, pageData);
      });
      
      console.log(`✅ Fetched ${pages.length} pages`);
    } catch (error) {
      console.error('Pages API failed:', error.response?.status, error.message);
    }

    // 4. Fetch ALL Products (with pagination - THIS IS THE FIX!)
    try {
      console.log(`Fetching products...`);
      const products = await fetchAllShopifyResources(
        shop,
        `/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/products.json?limit=250`,
        headers,
        'products'
      );
      
      products.forEach(product => {
        const template = product.template_suffix || 'product';
        const pageData = {
          id: `product_${product.id}`,
          title: product.title,
          handle: product.handle,
          url: `/products/${product.handle}`,
          type: 'product_page',
          template: template
        };
        allPages.push(pageData);
        addToCategory(templateCategories, template, pageData);
      });
      
      console.log(`✅ Fetched ${products.length} products`);
    } catch (error) {
      console.error('Products API failed:', error.response?.status, error.message);
    }

    // 5. Fetch BOTH Collection Types (Custom + Smart)
    try {
      console.log(`Fetching custom collections...`);
      const customCollections = await fetchAllShopifyResources(
        shop,
        `/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/custom_collections.json?limit=250`,
        headers,
        'custom_collections'
      );
      
      customCollections.forEach(collection => {
        if (collection.handle === 'frontpage') return;
        
        const template = collection.template_suffix || 'collection';
        const pageData = {
          id: `collection_${collection.id}`,
          title: collection.title,
          handle: collection.handle,
          url: `/collections/${collection.handle}`,
          type: 'collection_page',
          template: template,
          collection_type: 'custom'
        };
        allPages.push(pageData);
        addToCategory(templateCategories, template, pageData);
      });
      
      console.log(`✅ Fetched ${customCollections.length} custom collections`);
    } catch (error) {
      console.error('Custom Collections API failed:', error.response?.status, error.message);
    }

    try {
      console.log(`Fetching smart collections...`);
      const smartCollections = await fetchAllShopifyResources(
        shop,
        `/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/smart_collections.json?limit=250`,
        headers,
        'smart_collections'
      );
      
      smartCollections.forEach(collection => {
        if (collection.handle === 'frontpage') return;
        
        const template = collection.template_suffix || 'collection';
        const pageData = {
          id: `collection_smart_${collection.id}`,
          title: collection.title,
          handle: collection.handle,
          url: `/collections/${collection.handle}`,
          type: 'collection_page',
          template: template,
          collection_type: 'smart'
        };
        allPages.push(pageData);
        addToCategory(templateCategories, template, pageData);
      });
      
      console.log(`✅ Fetched ${smartCollections.length} smart collections`);
    } catch (error) {
      console.error('Smart Collections API failed:', error.response?.status, error.message);
    }

    // 6. Fetch Blogs
    try {
      console.log(`Fetching blogs...`);
      const blogs = await fetchAllShopifyResources(
        shop,
        `/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/blogs.json?limit=250`,
        headers,
        'blogs'
      );
      
      for (const blog of blogs) {
        // Add blog index page
        const blogIndexData = {
          id: `blog_${blog.id}`,
          title: `${blog.title} (Blog Index)`,
          handle: blog.handle,
          url: `/blogs/${blog.handle}`,
          type: 'blog_page',
          template: 'blog'
        };
        allPages.push(blogIndexData);
        addToCategory(templateCategories, 'blog', blogIndexData);
        
        // Fetch articles for this blog
        try {
          const articles = await fetchAllShopifyResources(
            shop,
            `/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/blogs/${blog.id}/articles.json?limit=250`,
            headers,
            'articles'
          );
          
          articles.forEach(article => {
            const template = article.template_suffix || 'article';
            const pageData = {
              id: `article_${article.id}`,
              title: article.title,
              handle: article.handle,
              url: `/blogs/${blog.handle}/${article.handle}`,
              type: 'article_page',
              template: template,
              blog_handle: blog.handle
            };
            allPages.push(pageData);
            addToCategory(templateCategories, template, pageData);
          });
          
          console.log(`  ✅ Fetched ${articles.length} articles from blog: ${blog.title}`);
        } catch (error) {
          console.error(`Articles API failed for blog ${blog.handle}:`, error.message);
        }
      }
      
      console.log(`✅ Fetched ${blogs.length} blogs`);
    } catch (error) {
      console.error('Blogs API failed:', error.response?.status, error.message);
    }

    // 7. Fetch Policies
    try {
      console.log(`Fetching policies...`);
      const policiesResponse = await axios.get(
        `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/policies.json`,
        { headers }
      );
      
      const policies = policiesResponse.data.policies || [];
      policies.forEach(policy => {
        if (!policy.url) return; // Skip if no URL
        
        const pageData = {
          id: `policy_${policy.handle || policy.title.toLowerCase().replace(/\s+/g, '-')}`,
          title: policy.title,
          handle: policy.handle || policy.title.toLowerCase().replace(/\s+/g, '-'),
          url: policy.url.replace(`https://${shop}`, ''), // Remove domain
          type: 'policy_page',
          template: 'policy'
        };
        allPages.push(pageData);
        addToCategory(templateCategories, 'policy', pageData);
      });
      
      console.log(`✅ Fetched ${policies.length} policies`);
    } catch (error) {
      console.error('Policies API failed:', error.response?.status, error.message);
    }

    // Generate statistics
    const stats = {
      total_pages: allPages.length,
      by_type: {},
      by_template: {},
      template_count: Object.keys(templateCategories).length
    };

    allPages.forEach(page => {
      stats.by_type[page.type] = (stats.by_type[page.type] || 0) + 1;
    });

    Object.keys(templateCategories).forEach(template => {
      stats.by_template[template] = templateCategories[template].length;
    });

    // Save site structure to database
    const templateGroups = new Map();

    Object.keys(templateCategories).forEach(template => {
      templateGroups.set(template, {
        count: templateCategories[template].length,
        pages: templateCategories[template],
        sample_page: templateCategories[template][0]?.url,
        psi_analyzed: false,
        js_files: [],
        defer_recommendations: [],
        user_defer_config: []
      });
    });

    await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          'site_structure.last_analyzed': new Date(),
          'site_structure.active_theme': activeTheme ? activeTheme.name : 'Unknown',
          'site_structure.template_groups': templateGroups
        }
      },
      { upsert: true }
    );

    console.log(`✅ Site analysis complete for ${shop}:`);
    console.log(`   - Template groups: ${Object.keys(templateCategories).length}`);
    console.log(`   - Total pages: ${allPages.length}`);
    console.log(`   - Products: ${stats.by_type.product_page || 0}`);
    console.log(`   - Collections: ${stats.by_type.collection_page || 0}`);
    console.log(`   - Articles: ${stats.by_type.article_page || 0}`);

    res.json({
      ok: true,
      shop: shop,
      active_theme: activeTheme ? activeTheme.name : 'Unknown',
      statistics: stats,
      templates: {
        categories: templateCategories,
        summary: stats.by_template
      },
      all_pages: allPages
    });

  } catch (error) {
    console.error('Error analyzing complete site:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to analyze site"
    });
  }
});

// ====== Enhanced PSI Analysis Section ======


// API Route: Start PSI Analysis - Updated
app.post("/api/start-psi-analysis", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(400).json({
        ok: false,
        error: "Run site analysis first"
      });
    }

    // Build template list for microservice
    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    const templatesToAnalyze = templates
      .filter(([template, group]) => group.sample_page && !group.psi_analyzed)
      .map(([template, group]) => ({
        template,
        url: group.sample_page,
        count: group.count || 1
      }));

    if (templatesToAnalyze.length === 0) {
      return res.json({
        ok: true,
        message: "All templates already analyzed",
        templates_to_analyze: []
      });
    }

    console.log(`Starting JS Defer analysis for ${shop}: ${templatesToAnalyze.length} templates`);

    // Queue analyses via microservice
    const queueResult = await jsDeferService.queueBulkAnalysis({
      shop,
      templates: templatesToAnalyze
    });

    if (queueResult.success) {
      // Start background polling for results
      setTimeout(async () => {
        console.log(`[Background] Starting result polling for ${shop}`);
        for (let i = 0; i < 30; i++) { // Poll for up to 5 minutes
          await new Promise(resolve => setTimeout(resolve, 10000)); // Every 10 seconds
          const pollResult = await jsDeferService.pollAndSaveResults(1);
          if (pollResult.success) {
            console.log(`[Background] ✅ Results saved for ${shop}`);
          }
        }
      }, 5000);

      res.json({
        ok: true,
        message: `JS defer analysis queued for ${queueResult.successCount} templates`,
        templates_to_analyze: templatesToAnalyze.map(t => t.template),
        queued: queueResult.successCount,
        total: templatesToAnalyze.length,
        estimated_time_minutes: Math.ceil(templatesToAnalyze.length * 2)
      });
    } else {
      throw new Error('Failed to queue analyses');
    }

  } catch (error) {
    console.error('Error starting JS defer analysis:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to start analysis",
      details: error.message 
    });
  }
});
// API Route: Check PSI Analysis Status - Enhanced
app.get("/api/psi-status", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.json({
        ok: true,
        analyzed: false,
        message: "No site structure found"
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    let totalTemplates = 0;
    let analyzedTemplates = 0;
    let totalJSFiles = 0;
    let totalWasteKB = 0;
    const templateStatus = {};
    
    templates.forEach(([template, group]) => {
      if (group.sample_page) {
        totalTemplates++;
        
        templateStatus[template] = {
          analyzed: group.psi_analyzed || false,
          js_files_found: (group.js_files || []).length,
          last_analysis: group.last_psi_analysis,
          has_recommendations: !!(group.defer_recommendations)
        };
        
        if (group.psi_analyzed) {
          analyzedTemplates++;
          totalJSFiles += (group.js_files || []).length;
          
          // Calculate total waste
          if (group.defer_recommendations) {
            const recs = group.defer_recommendations;
            ['async', 'defer', 'delay'].forEach(action => {
              if (recs[action]?.files) {
                recs[action].files.forEach(f => {
                  totalWasteKB += (f.waste_kb || 0);
                });
              }
            });
          }
        }
      }
    });
    
    res.json({
      ok: true,
      total_templates: totalTemplates,
      analyzed_templates: analyzedTemplates,
      progress_percent: totalTemplates > 0 ? Math.round((analyzedTemplates / totalTemplates) * 100) : 0,
      template_status: templateStatus,
      summary_stats: {
        total_js_files: totalJSFiles,
        total_waste_kb: Math.round(totalWasteKB),
        avg_js_per_template: analyzedTemplates > 0 ? Math.round(totalJSFiles / analyzedTemplates) : 0
      },
      last_site_analysis: shopData.site_structure.last_analyzed
    });

  } catch (error) {
    console.error('Error checking PSI status:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to check status" 
    });
  }
});
// NEW: API Route to analyze a single template (for new templates from webhooks)
app.post("/api/analyze-single-template", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    const { template, url } = req.body;
    
    if (!shop || !template || !url) {
      return res.status(400).json({
        ok: false,
        error: "shop, template, and url parameters required"
      });
    }

    console.log(`Single template analysis for ${shop}: ${template}`);

    // Queue analysis
    const queueResult = await jsDeferService.queueAnalysis({
      shop,
      template,
      url
    });

    if (queueResult.success) {
      // Poll for results (wait up to 2 minutes)
      setTimeout(async () => {
        for (let i = 0; i < 12; i++) { // 12 attempts * 10 seconds = 2 minutes
          await new Promise(resolve => setTimeout(resolve, 10000));
          const pollResult = await jsDeferService.pollAndSaveResults(1);
          if (pollResult.success && pollResult.result.template === template) {
            console.log(`✅ Single template analysis complete: ${template}`);
            break;
          }
        }
      }, 5000);

      res.json({ 
        ok: true, 
        message: `Analysis queued for template ${template}`,
        jobId: queueResult.jobId,
        estimated_time_seconds: queueResult.estimatedTime
      });
    } else {
      throw new Error(queueResult.error || 'Failed to queue analysis');
    }

  } catch (error) {
    console.error('Error analyzing single template:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to start analysis",
      details: error.message 
    });
  }
});

// ====== Template Defer Configuration Routes ======

// API Route: Get defer configuration for a specific template
app.get("/api/defer-config/:template", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    const { template } = req.params;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(404).json({
        ok: false,
        error: "No site structure found. Run site analysis first."
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templateData = templateGroups instanceof Map ? 
      templateGroups.get(template) : 
      templateGroups[template];
    
    if (!templateData) {
      return res.status(404).json({
        ok: false,
        error: `Template '${template}' not found`
      });
    }

    res.json({
      ok: true,
      template: template,
      page_count: templateData.count || 0,
      sample_page: templateData.sample_page,
      psi_analyzed: templateData.psi_analyzed || false,
      js_files: templateData.js_files || [],
      auto_recommendations: templateData.defer_recommendations || [],
      user_config: templateData.user_defer_config || [],
      last_analysis: templateData.last_psi_analysis,
      analysis_status: templateData.psi_analyzed ? 'completed' : 'pending',
      // Enhanced data
      js_analysis: templateData.js_analysis || null,
      psi_metrics: templateData.psi_metrics || null
    });

  } catch (error) {
    console.error('Error fetching template defer config:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// API Route: Update user's defer preferences for a template
app.post("/api/defer-config/:template", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    const { template } = req.params;
    const { defer_settings } = req.body; // Array of {file, defer, reason}
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    if (!defer_settings || !Array.isArray(defer_settings)) {
      return res.status(400).json({ 
        ok: false, 
        error: "defer_settings must be an array" 
      });
    }

    // Validate defer_settings structure
    for (const setting of defer_settings) {
      if (!setting.file || typeof setting.defer !== 'boolean') {
        return res.status(400).json({ 
          ok: false, 
          error: "Each defer setting must have 'file' and 'defer' properties" 
        });
      }
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(404).json({
        ok: false,
        error: "No site structure found. Run site analysis first."
      });
    }

    // Update user defer configuration for the specific template
    await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          [`site_structure.template_groups.${template}.user_defer_config`]: defer_settings,
          [`site_structure.template_groups.${template}.user_config_updated`]: new Date()
        }
      }
    );

    console.log(`Defer settings updated for ${shop} template ${template}:`, {
      settings_count: defer_settings.length,
      deferred_files: defer_settings.filter(s => s.defer).length
    });
    
    res.json({ 
      ok: true, 
      message: "Defer settings updated successfully",
      template: template,
      settings_applied: defer_settings.length,
      deferred_count: defer_settings.filter(s => s.defer).length
    });

  } catch (error) {
    console.error('Error updating template defer config:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// API Route: Get all templates and their defer status (overview)
app.get("/api/defer-overview", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.json({
        ok: true,
        templates: [],
        message: "No site structure found. Run site analysis first."
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    const overview = templates.map(([template, group]) => ({
      template: template,
      page_count: group.count || 0,
      sample_page: group.sample_page,
      psi_analyzed: group.psi_analyzed || false,
      js_files_count: (group.js_files || []).length,
      auto_recommendations_count: (group.defer_recommendations || []).length,
      user_config_count: (group.user_defer_config || []).length,
      user_deferred_count: (group.user_defer_config || []).filter(c => c.defer).length,
      last_analysis: group.last_psi_analysis,
      has_user_config: (group.user_defer_config || []).length > 0,
      // Enhanced data
      total_waste_kb: group.js_analysis?.total_waste_kb || 0,
      performance_score: group.psi_metrics?.performance_score || 0
    }));

    res.json({
      ok: true,
      shop: shop,
      total_templates: templates.length,
      analyzed_templates: overview.filter(t => t.psi_analyzed).length,
      configured_templates: overview.filter(t => t.has_user_config).length,
      templates: overview,
      last_site_analysis: shopData.site_structure.last_analyzed
    });

  } catch (error) {
    console.error('Error fetching defer overview:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// API Route: Generate defer rules from user configurations
app.get("/api/generate-defer-rules", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.json({
        ok: true,
        rules: [],
        message: "No site structure found."
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    const generatedRules = [];
    let ruleId = 1;

    templates.forEach(([template, group]) => {
      if (group.user_defer_config && group.user_defer_config.length > 0) {
        group.user_defer_config.forEach(config => {
          if (config.defer) {
            // Generate regex pattern from file URL - FIXED
const urlPattern = config.file
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
  .replace(/https?:\/\/[^\/]+/, '.*'); // Make domain flexible
            
            generatedRules.push({
              id: `auto-rule-${ruleId++}`,
              src_regex: urlPattern,
              action: 'defer',
              priority: 5,
              enabled: true,
              conditions: {
                page_types: [template]
              },
              generated_from: {
                template: template,
                original_file: config.file,
                user_reason: config.reason || 'User selected for deferring'
              }
            });
          }
        });
      }
    });

    res.json({
      ok: true,
      rules_generated: generatedRules.length,
      rules: generatedRules,
      message: `Generated ${generatedRules.length} defer rules from user configurations`
    });

  } catch (error) {
    console.error('Error generating defer rules:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});
// ====== Critical CSS Integration ======
//
// API Route: Get Critical CSS status for templates
app.get("/api/css-status", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://localhost:3010';
    
    const response = await axios.get(
      `${criticalCssServiceUrl}/api/shopify/${shop}/templates`
    );

    res.json(response.data);

  } catch (error) {
    console.error('Error fetching CSS status:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to fetch CSS status"
    });
  }
});
// ====== Critical CSS Integration ======

// API Route: Trigger Critical CSS generation for all templates
app.post("/api/trigger-css-generation", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(400).json({
        ok: false,
        error: "Run site analysis first"
      });
    }

    // Call Critical CSS microservice
    const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://localhost:3010';
    
    console.log(`Triggering Critical CSS generation for ${shop}`);
    
    const response = await axios.post(
      `${criticalCssServiceUrl}/api/shopify/generate-all-css`,
      { shop },
      {
        timeout: 300000 // 5 minute timeout
      }
    );

    if (!response.data.ok) {
      throw new Error(response.data.error || 'CSS generation failed');
    }

    console.log(`Critical CSS generation completed for ${shop}:`, response.data.summary);

    // AUTO-INJECT: If CSS generation was successful, inject into theme
    if (response.data.summary.successful > 0) {
      console.log(`Auto-injecting Critical CSS script into theme for ${shop}`);
      
      try {
        // Get active theme
        const themesResponse = await axios.get(
          `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes.json`,
          {
            headers: {
              'X-Shopify-Access-Token': shopData.access_token
            }
          }
        );

        const activeTheme = themesResponse.data.themes.find(t => t.role === 'main');
        
        if (activeTheme) {
          // Get theme.liquid asset
          const assetResponse = await axios.get(
            `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`,
            {
              headers: {
                'X-Shopify-Access-Token': shopData.access_token
              }
            }
          );

          let themeContent = assetResponse.data.asset.value;

          // Check if already injected
          if (!themeContent.includes('rabbitloader-css.b-cdn.net')) {
            // Inject script before </head>
            const criticalCssScript = `
<!-- Critical CSS Injection by RabbitLoader -->
<script>
(function() {
  const template = '{{ template | split: "." | first }}';
  const shop = '{{ shop.permanent_domain }}';
  const cssUrl = \`https://rabbitloader-css.b-cdn.net/\${shop}/\${template}.css\`;
  
  // Fetch and inline CSS immediately (blocking)
  var xhr = new XMLHttpRequest();
  xhr.open('GET', cssUrl, false); // Synchronous request
  xhr.setRequestHeader('Accept', 'text/css');
  
  try {
    xhr.send(null);
    if (xhr.status === 200 && xhr.responseText) {
      // SUCCESS: Inline the CSS immediately
      var style = document.createElement('style');
      style.id = 'rl-critical-css';
      style.setAttribute('data-template', template);
      style.innerHTML = xhr.responseText;
      
      // Insert as FIRST child of <head>
      var head = document.head || document.getElementsByTagName('head')[0];
      if (head.firstChild) {
        head.insertBefore(style, head.firstChild);
      } else {
        head.appendChild(style);
      }
      
      console.log('[RL Critical CSS] Inlined:', template, xhr.responseText.length, 'bytes');
    } else {
      throw new Error('HTTP ' + xhr.status);
    }
  } catch(e) {
    // FALLBACK: Load async if sync fails
    console.warn('[RL Critical CSS] Inline failed, loading async:', e.message);
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    link.onload = function() { console.log('[RL Critical CSS] Loaded async:', template); };
    document.head.insertBefore(link, document.head.firstChild);
  }
})();
</script>
`;

            themeContent = themeContent.replace('</head>', criticalCssScript + '\n</head>');

            // Update theme.liquid
            await axios.put(
              `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes/${activeTheme.id}/assets.json`,
              {
                asset: {
                  key: 'layout/theme.liquid',
                  value: themeContent
                }
              },
              {
                headers: {
                  'X-Shopify-Access-Token': shopData.access_token,
                  'Content-Type': 'application/json'
                }
              }
            );

            console.log(`✅ Critical CSS script auto-injected into theme for ${shop}`);
            
            res.json({
              ok: true,
              message: 'Critical CSS generated and injected into theme',
              results: response.data.results,
              summary: response.data.summary,
              theme_injection: {
                success: true,
                theme_name: activeTheme.name,
                message: 'Script automatically injected into theme.liquid'
              }
            });
            return;
          } else {
            console.log(`Critical CSS script already exists in theme for ${shop}`);
          }
        }
      } catch (injectionError) {
        console.error('Auto-injection failed (non-fatal):', injectionError.message);
        // Continue anyway - CSS was still generated
      }
    }

    res.json({
      ok: true,
      message: 'Critical CSS generation completed',
      results: response.data.results,
      summary: response.data.summary,
      theme_injection: {
        success: false,
        message: 'CSS generated but theme injection skipped (already exists or failed)'
      }
    });

  } catch (error) {
    console.error('Error triggering CSS generation:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to trigger CSS generation"
    });
  }
});
// Background setup function
// Background setup function
async function runSetupInBackground(shop) {
  const shopData = await ShopModel.findOne({ shop });
  const completedSteps = [];
  const warnings = [];
  let progress = 0;

  try {
    // STEP 1: Site Analysis (20%)
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_current_step: 'Analyzing site', setup_progress: 10 }
    });
    
    if (!shopData.site_structure?.template_groups) {
      const response = await axios.get(
        `${process.env.APP_URL}/api/site-analysis`,
        { headers: { 'x-shop': shop }, timeout: 60000 }
      );
      
      if (response.data.ok) {
        completedSteps.push('Site analyzed: ' + Object.keys(response.data.templates.categories).length + ' templates');
        progress = 20;
      }
    } else {
      completedSteps.push('Site structure already exists');
      progress = 20;
    }
    
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_progress: progress, setup_completed_steps: completedSteps }
    });

    // STEP 2: Critical CSS (40%)
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_current_step: 'Generating Critical CSS', setup_progress: 30 }
    });
    
    try {
      const cssResponse = await axios.post(
        `${process.env.CRITICAL_CSS_SERVICE_URL || 'http://45.32.212.222:3000'}/api/shopify/generate-all-css`,
        { shop },
        { timeout: 300000 }
      );
      
      if (cssResponse.data.ok && cssResponse.data.summary.successful > 0) {
        completedSteps.push('Critical CSS generated');
      } else {
        warnings.push('CSS generation returned no results');
      }
    } catch (error) {
      warnings.push('CSS generation failed - using fallback');
    }
    
    progress = 40;
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_progress: progress, setup_completed_steps: completedSteps, setup_warnings: warnings }
    });

    // STEP 3: CSS Injection (60%)
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_current_step: 'Injecting CSS script', setup_progress: 50 }
    });
    
    const updatedShopData = await ShopModel.findOne({ shop });
    
    if (!updatedShopData.critical_css_injected) {
      const cssResult = await injectCriticalCSSIntoTheme(
        shop,
        updatedShopData.short_id,
        updatedShopData.access_token
      );
      
      if (cssResult.success) {
        completedSteps.push('CSS script injected');
        await ShopModel.updateOne({ shop }, {
          $set: { critical_css_injected: true }
        });
      } else {
        warnings.push('CSS injection skipped - already exists');
      }
    } else {
      completedSteps.push('CSS script already injected');
    }
    
    progress = 60;
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_progress: progress, setup_completed_steps: completedSteps, setup_warnings: warnings }
    });

    // STEP 4: PSI Analysis (80%)
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_current_step: 'Analyzing performance', setup_progress: 70 }
    });
    
    const psiResponse = await axios.post(
      `${process.env.APP_URL}/api/start-psi-analysis`,
      { shop },
      { headers: { 'x-shop': shop }, timeout: 60000 }
    );
    
    if (psiResponse.data.ok) {
      completedSteps.push('Performance analysis queued: ' + psiResponse.data.queued + ' templates');
      
      // Wait for PSI to complete (max 5 minutes)
      let psiComplete = false;
      let attempts = 0;
      
      while (!psiComplete && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const statusResponse = await axios.get(
          `${process.env.APP_URL}/api/psi-status?shop=${shop}`
        );
        
        psiComplete = statusResponse.data.progress_percent === 100;
        attempts++;
      }
      
      if (psiComplete) {
        completedSteps.push('Performance analysis complete');
      } else {
        warnings.push('Performance analysis continuing in background');
      }
    }
    
    progress = 80;
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_progress: progress, setup_completed_steps: completedSteps, setup_warnings: warnings }
    });

    // STEP 5: Defer Script (100%)
    await ShopModel.updateOne({ shop }, { 
      $set: { setup_current_step: 'Injecting defer script', setup_progress: 90 }
    });
    
    const finalShopData = await ShopModel.findOne({ shop });
    
    if (!finalShopData.script_injected) {
      const { injectDeferScript } = require('./routes/shopifyConnect');
      
      const deferResult = await injectDeferScript(
        shop,
        finalShopData.short_id,
        finalShopData.access_token
      );
      
      if (deferResult.success) {
        completedSteps.push('Defer script injected');
        await ShopModel.updateOne({ shop }, {
          $set: { script_injected: true }
        });
      }
    } else {
      completedSteps.push('Defer script already injected');
    }
    
    progress = 100;

    // Mark as complete
    await ShopModel.updateOne({ shop }, {
      $set: {
        setup_status: 'complete',
        setup_progress: 100,
        setup_completed_steps: completedSteps,
        setup_current_step: 'Complete',
        setup_in_progress: false,
        setup_completed_at: new Date(),
        setup_warnings: warnings
      }
    });

    console.log(`✅ Background setup complete for ${shop}`);

  } catch (error) {
    console.error(`❌ Background setup failed for ${shop}:`, error);
    
    await ShopModel.updateOne({ shop }, {
      $set: {
        setup_status: 'failed',
        setup_in_progress: false,
        setup_error: error.message,
        setup_warnings: warnings
      }
    });
  }
}
// NEW: Start setup (async, returns immediately)
app.post("/api/start-setup", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    console.log(`🚀 Starting async setup for ${shop}`);
    
    // Mark setup as starting
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          setup_in_progress: true,
          setup_status: 'starting',
          setup_progress: 0,
          setup_completed_steps: [],
          setup_current_step: 'Initializing',
          setup_started_at: new Date()
        }
      }
    );

    // Return immediately
    res.json({
      ok: true,
      message: 'Setup started',
      shop: shop
    });

    // Run setup in background (don't await)
    runSetupInBackground(shop).catch(err => {
      console.error(`Background setup failed for ${shop}:`, err);
    });

  } catch (error) {
    console.error('Error starting setup:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});
// NEW: Get setup status (for polling)
app.get("/api/setup-status", async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.status(404).json({
        ok: false,
        error: "Shop not found"
      });
    }

    res.json({
      ok: true,
      status: shopData.setup_status || 'pending',
      progress: shopData.setup_progress || 0,
      current_step: shopData.setup_current_step || 'Waiting',
      completed_steps: shopData.setup_completed_steps || [],
      warnings: shopData.setup_warnings || []
    });

  } catch (error) {
    console.error('Error getting setup status:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});
// FIXED: Complete Auto-Setup Endpoint with proper waits and error handling
app.post("/api/complete-auto-setup", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    if (!shopData?.short_id) {
      return res.status(400).json({
        ok: false,
        error: "RabbitLoader not connected"
      });
    }

    console.log(`🚀 Starting complete auto-setup for ${shop}`);
    
    // Mark setup as in progress
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          setup_in_progress: true,
          setup_failed: false,
          last_setup_attempt: new Date()
        }
      }
    );

    const results = {
      site_analysis_completed: false,
      css_generated: false,
      psi_completed: false,
      defer_script_injected: false,
      critical_css_injected: false,
      warnings: []
    };

    // STEP 1: Site Analysis
    try {
      console.log(`Step 1/4: Running site analysis...`);
      
      if (!shopData.site_structure?.template_groups) {
        const siteAnalysisResponse = await axios.get(
          `${process.env.APP_URL}/api/site-analysis`,
          { 
            headers: { 'x-shop': shop },
            timeout: 60000 // 1 minute timeout
          }
        );
        
        if (siteAnalysisResponse.data.ok) {
          results.site_analysis_completed = true;
          console.log(`✅ Site analysis complete: ${Object.keys(siteAnalysisResponse.data.templates.categories).length} templates`);
        }
      } else {
        results.site_analysis_completed = true;
        console.log(`✅ Site structure already exists, skipping analysis`);
      }
    } catch (error) {
      console.error('❌ Site analysis failed:', error.message);
      results.warnings.push('Site analysis failed: ' + error.message);
    }

    // STEP 2: Critical CSS Generation (run first - faster than PSI)
    try {
      console.log(`Step 2/4: Generating Critical CSS...`);
      
      const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://45.32.212.222:3000';
      
      const cssResponse = await axios.post(
        `${criticalCssServiceUrl}/api/shopify/generate-all-css`,
        { shop },
        { timeout: 300000 } // 5 minute timeout
      );
      
      if (cssResponse.data.ok && cssResponse.data.summary.successful > 0) {
        results.css_generated = true;
        console.log(`✅ Critical CSS generated for ${cssResponse.data.summary.successful} templates`);
      } else {
        results.warnings.push('Critical CSS generation failed or returned no results');
      }
    } catch (error) {
      console.error('❌ Critical CSS generation failed:', error.message);
      results.warnings.push('Critical CSS generation failed - will use fallback');
      // Continue anyway - we have fallback CSS
    }

    // STEP 3: Inject Critical CSS Script into theme
    try {
      console.log(`Step 3/4: Injecting Critical CSS script...`);
      
      if (!shopData.critical_css_injected) {
        const cssInjectionResult = await injectCriticalCSSIntoTheme(
          shop,
          shopData.short_id,
          shopData.access_token
        );
        
        if (cssInjectionResult.success) {
          results.critical_css_injected = true;
          console.log(`✅ Critical CSS script injected`);
          
          await ShopModel.updateOne(
            { shop },
            {
              $set: {
                critical_css_injected: true,
                critical_css_injection_date: new Date()
              }
            }
          );
        }
      } else {
        results.critical_css_injected = true;
        console.log(`✅ Critical CSS script already injected`);
      }
    } catch (error) {
      console.error('❌ CSS script injection failed:', error.message);
      results.warnings.push('Critical CSS injection failed: ' + error.message);
    }

    // STEP 4: PSI Analysis (slowest - do last)
    try {
      console.log(`Step 4/4: Starting PSI analysis...`);
      
      const psiResponse = await axios.post(
        `${process.env.APP_URL}/api/start-psi-analysis`,
        { shop },
        { 
          headers: { 'x-shop': shop },
          timeout: 60000
        }
      );
      
      if (psiResponse.data.ok) {
        console.log(`PSI analysis queued: ${psiResponse.data.templates_to_analyze.length} templates`);
        
        // Poll for completion (max 10 minutes)
        let psiComplete = false;
        let attempts = 0;
        const maxAttempts = 60; // 10 minutes (60 * 10 seconds)
        
        while (!psiComplete && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          
          const statusResponse = await axios.get(
            `${process.env.APP_URL}/api/psi-status?shop=${shop}`
          );
          
          psiComplete = statusResponse.data.progress_percent === 100;
          attempts++;
          
          if (attempts % 6 === 0) { // Log every minute
            console.log(`PSI Progress: ${statusResponse.data.progress_percent}% (${statusResponse.data.analyzed_templates}/${statusResponse.data.total_templates})`);
          }
        }
        
        if (psiComplete) {
          results.psi_completed = true;
          console.log(`✅ PSI analysis complete`);
        } else {
          results.warnings.push('PSI analysis timed out - continuing in background');
          console.log(`⚠️ PSI analysis timeout - continuing in background`);
        }
      }
    } catch (error) {
      console.error('❌ PSI analysis failed:', error.message);
      results.warnings.push('PSI analysis failed: ' + error.message);
    }

    // STEP 5: Inject Defer Script
    try {
      console.log(`Step 5/5: Injecting defer script...`);
      
      if (!shopData.script_injected) {
        const { injectDeferScript } = require('./routes/shopifyConnect');
        
        const deferResult = await injectDeferScript(
          shop,
          shopData.short_id,
          shopData.access_token
        );
        
        if (deferResult.success) {
          results.defer_script_injected = true;
          console.log(`✅ Defer script injected`);
          
          await ShopModel.updateOne(
            { shop },
            {
              $set: {
                script_injected: true,
                script_injection_attempted: true
              }
            }
          );
        }
      } else {
        results.defer_script_injected = true;
        console.log(`✅ Defer script already injected`);
      }
    } catch (error) {
      console.error('❌ Defer script injection failed:', error.message);
      results.warnings.push('Defer script injection failed: ' + error.message);
    }

    // Mark setup as complete
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          setup_in_progress: false,
          setup_completed: true,
          setup_failed: false
        }
      }
    );

    // Build response
    const successCount = Object.values(results).filter(v => v === true).length;
    const totalSteps = 5;
    
    console.log(`✅ Setup complete: ${successCount}/${totalSteps} steps successful`);

    res.json({
      ok: true,
      message: `Setup complete: ${successCount}/${totalSteps} steps successful`,
      ...results,
      retry_possible: successCount < totalSteps
    });

  } catch (error) {
    console.error('❌ Complete auto-setup failed:', error);
    
    // Mark setup as failed
    await ShopModel.updateOne(
      { shop: req.body.shop || req.headers['x-shop'] },
      {
        $set: {
          setup_in_progress: false,
          setup_failed: true,
          setup_error: error.message
        }
      }
    );
    
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Auto-setup failed",
      retry_possible: true
    });
  }
});

// Helper function to add pages to template categories
function addToCategory(categories, template, pageData) {
  if (!categories[template]) {
    categories[template] = [];
  }
  categories[template].push(pageData);
}

// ====== Root Route (BEFORE auth middleware) - UPDATED FOR STATIC HTML ======
app.get("/", (req, res) => {
  const { shop, host, embedded, connected, script_injected, hmac, timestamp } = req.query;
  
  console.log(`Root route accessed:`, {
    shop: shop || 'none',
    host: host ? `${host.substring(0, 20)}...` : 'none',
    embedded: embedded || 'none',
    connected: connected || 'none',
    script_injected: script_injected || 'none',
    hmac: hmac ? 'present' : 'none',
    timestamp: timestamp || 'none',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 50) + '...' : 'none',
    referer: req.headers.referer || 'none'
  });

  // AUTO-DETECT: If we have shop + host + (hmac OR timestamp), this is from Shopify OAuth
  const isFromShopifyOAuth = shop && host && (hmac || timestamp);
  
  if (isFromShopifyOAuth && embedded !== '1') {
    console.log(`⚠️ Detected Shopify OAuth callback WITHOUT embedded=1 - auto-fixing`);
    
    // Redirect to same URL but with embedded=1
    const params = new URLSearchParams(req.query);
    params.set('embedded', '1');
    
    const redirectUrl = `/?${params.toString()}`;
    console.log(`Redirecting to: ${redirectUrl}`);
    
    return res.redirect(redirectUrl);
  }

  // For embedded apps, shop parameter is REQUIRED
  if (embedded === '1' && !shop) {
    console.log(`Embedded app request missing shop parameter`);
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Shop Parameter Required</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f6f6f7;
          }
          .error-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 500px;
            margin: 0 auto;
          }
          h1 { color: #dc3545; margin-bottom: 20px; }
          p { color: #6c757d; margin-bottom: 15px; }
          .code { 
            background: #f8f9fa; 
            padding: 8px 12px; 
            border-radius: 4px; 
            font-family: monospace; 
            color: #495057;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>Missing Shop Parameter</h1>
          <p>This embedded app requires a shop parameter to function.</p>
          <p>Expected URL format:</p>
          <p class="code">/?shop=your-shop.myshopify.com&embedded=1</p>
        </div>
      </body>
      </html>
    `);
  }

  // Serve static HTML file instead of rendering EJS template
  try {
    console.log(`Serving static HTML for shop: ${shop || 'unknown'}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) {
    console.error('Error serving static HTML:', error);
    res.status(500).send('Failed to load page');
  }
});

// ====== Embedded App Authentication Middleware ======
app.use((req, res, next) => {
  // Skip auth for public routes and static files
  const publicRoutes = [
    '/shopify/auth', 
    '/shopify/auth/callback', 
    '/',
    '/api/env',
    '/rl/rl-callback',
    '/health'
  ];
  
  const isStaticFile = req.path.startsWith('/assets/') || 
                      req.path.endsWith('.css') || 
                      req.path.endsWith('.js') || 
                      req.path.endsWith('.png') ||
                      req.path.endsWith('.jpg') ||
                      req.path.endsWith('.ico') ||
                      req.path.endsWith('.html');
  
  const isDeferConfigRoute = req.path.startsWith('/defer-config');
  const isWebhook = req.path.startsWith('/webhooks/');
  const isDebugRoute = req.path.startsWith('/debug/');
  const isRlRoute = req.path.startsWith('/rl/');
  const isApiRoute = req.path.startsWith('/api/');
  
  if (publicRoutes.includes(req.path) || isStaticFile || isDeferConfigRoute || isWebhook || isDebugRoute || isRlRoute || isApiRoute) {
    return next();
  }
  
  const shop = (req.query && req.query.shop) || (req.body && req.body.shop);
  if (!shop && req.path.startsWith('/shopify/')) {
    console.log(`Blocking shopify route ${req.path} - missing shop parameter`);
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }
  
  next();
});

// ====== Enhanced Webhook Handler with Code Cleanup ======
app.post("/webhooks/app/uninstalled", async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    console.log(`[Webhook] App uninstalled for ${shop}`);
    
    // Verify webhook (optional but recommended)
    const crypto = require('crypto');
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(req.body, 'utf8')
      .digest('base64');
    
    if (hash !== hmac) {
      console.error('[Webhook] Verification failed');
      return res.status(401).send('Unauthorized');
    }
    
    if (shop) {
      const shopData = await ShopModel.findOne({ shop });
      
      if (shopData?.access_token) {
        // Remove RabbitLoader code from theme
        try {
          await removeRabbitLoaderCode(shop, shopData.access_token);
          console.log(`[Webhook] ✅ Code removed from ${shop}`);
        } catch (cleanupError) {
          console.error(`[Webhook] Code cleanup failed: ${cleanupError.message}`);
          // Continue anyway - still mark as uninstalled
        }
      }
      
      // Remove shop from database
      await ShopModel.deleteOne({ shop });
      console.log(`[Webhook] ✅ Shop data deleted for ${shop}`);
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook] Error:', err);
    res.status(500).send('Error');
  }
});

// Helper function to remove RabbitLoader code from theme
async function removeRabbitLoaderCode(shop, accessToken) {
  console.log(`[Cleanup] Removing RabbitLoader code from ${shop}`);
  
  try {
    // Get active theme
    const themesResponse = await axios.get(
      `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const activeTheme = themesResponse.data.themes.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetResponse = await axios.get(
      `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    let themeContent = assetResponse.data.asset.value;

    // Remove ALL RabbitLoader code blocks
    const patterns = [
      /<!-- RabbitLoader Defer Configuration -->[\s\S]*?<\/script>\s*/g,
      /<!-- RabbitLoader Configuration -->[\s\S]*?<\/script>\s*/g,
      /<!-- RabbitLoader Critical CSS -->[\s\S]*?(?:<link[^>]*>|<\/script>)\s*/g,
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
      console.log(`[Cleanup] No RabbitLoader code found in theme`);
      return { success: true, message: "No code to remove" };
    }

    // Update theme file
    await axios.put(
      `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/themes/${activeTheme.id}/assets.json`,
      {
        asset: {
          key: 'layout/theme.liquid',
          value: themeContent
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[Cleanup] ✅ RabbitLoader code removed successfully`);
    return { success: true, message: "Code removed successfully" };

  } catch (error) {
    console.error(`[Cleanup] Failed:`, error.message);
    throw error;
  }
}


// NEW: Webhook handler for app installation/reinstallation
app.post("/webhooks/app/installed", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    console.log(`App installed/reinstalled for shop: ${shop}`);
    
    if (shop) {
      // Check if this is a reinstallation
      const existingShop = await ShopModel.findOne({ shop });
      
      if (existingShop) {
        // This is a REINSTALLATION
        console.log(`Reinstallation detected for ${shop} - marking for setup`);
        
        await ShopModel.updateOne(
          { shop },
          {
            $set: {
              needs_setup: true,
              setup_completed: false,
              setup_in_progress: false
            },
            $push: {
              history: {
                event: "reinstalled",
                timestamp: new Date(),
                details: { via: "webhook" }
              }
            }
          }
        );
      } else {
        // First time installation
        console.log(`First installation for ${shop}`);
        
        await ShopModel.create({
          shop,
          needs_setup: false, // Will be set after OAuth
          history: [{
            event: "installed",
            timestamp: new Date(),
            details: { via: "webhook" }
          }]
        });
      }
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('App installed webhook error:', err);
    res.status(500).send('Error');
  }
});
// NEW: Webhook handlers for content changes (products, pages, collections, articles)

// Products created webhook
app.post("/webhooks/products/create", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Product created webhook for ${shop}:`, {
      id: webhookData.id,
      title: webhookData.title,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      // Queue webhook for batch processing
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `product_create_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      // Process webhook (check for new template)
      const template = webhookData.template_suffix ? 
        `product.${webhookData.template_suffix}` : 
        'product';
      
      await processNewTemplate(shop, template, {
        id: `product_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/products/${webhookData.handle}`,
        type: 'product_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Products create webhook error:', err);
    res.status(500).send('Error');
  }
});

// Products updated webhook
app.post("/webhooks/products/update", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Product updated webhook for ${shop}:`, {
      id: webhookData.id,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `product_update_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      const template = webhookData.template_suffix ? 
        `product.${webhookData.template_suffix}` : 
        'product';
      
      await processNewTemplate(shop, template, {
        id: `product_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/products/${webhookData.handle}`,
        type: 'product_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Products update webhook error:', err);
    res.status(500).send('Error');
  }
});

// Pages created webhook
app.post("/webhooks/pages/create", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Page created webhook for ${shop}:`, {
      id: webhookData.id,
      title: webhookData.title,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `page_create_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      const template = webhookData.template_suffix ? 
        `page.${webhookData.template_suffix}` : 
        'page';
      
      await processNewTemplate(shop, template, {
        id: `page_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/pages/${webhookData.handle}`,
        type: 'content_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Pages create webhook error:', err);
    res.status(500).send('Error');
  }
});

// Pages updated webhook
app.post("/webhooks/pages/update", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Page updated webhook for ${shop}:`, {
      id: webhookData.id,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `page_update_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      const template = webhookData.template_suffix ? 
        `page.${webhookData.template_suffix}` : 
        'page';
      
      await processNewTemplate(shop, template, {
        id: `page_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/pages/${webhookData.handle}`,
        type: 'content_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Pages update webhook error:', err);
    res.status(500).send('Error');
  }
});

// Collections created webhook
app.post("/webhooks/collections/create", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Collection created webhook for ${shop}:`, {
      id: webhookData.id,
      title: webhookData.title,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `collection_create_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      const template = webhookData.template_suffix ? 
        `collection.${webhookData.template_suffix}` : 
        'collection';
      
      await processNewTemplate(shop, template, {
        id: `collection_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/collections/${webhookData.handle}`,
        type: 'collection_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Collections create webhook error:', err);
    res.status(500).send('Error');
  }
});

// Collections updated webhook
app.post("/webhooks/collections/update", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Collection updated webhook for ${shop}:`, {
      id: webhookData.id,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `collection_update_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      const template = webhookData.template_suffix ? 
        `collection.${webhookData.template_suffix}` : 
        'collection';
      
      await processNewTemplate(shop, template, {
        id: `collection_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/collections/${webhookData.handle}`,
        type: 'collection_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Collections update webhook error:', err);
    res.status(500).send('Error');
  }
});

// Articles created webhook
app.post("/webhooks/articles/create", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    const webhookData = JSON.parse(req.body.toString());
    
    console.log(`Article created webhook for ${shop}:`, {
      id: webhookData.id,
      title: webhookData.title,
      template_suffix: webhookData.template_suffix
    });
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        {
          $push: {
            pending_webhooks: `article_create_${webhookData.id}_${Date.now()}`
          },
          $set: {
            last_webhook_processed: new Date()
          }
        },
        { upsert: true }
      );
      
      const template = webhookData.template_suffix ? 
        `article.${webhookData.template_suffix}` : 
        'article';
      
      await processNewTemplate(shop, template, {
        id: `article_${webhookData.id}`,
        title: webhookData.title,
        handle: webhookData.handle,
        url: `/blogs/${webhookData.blog_handle || 'news'}/${webhookData.handle}`,
        type: 'article_page',
        template: template
      });
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Articles create webhook error:', err);
    res.status(500).send('Error');
  }
});
// Helper function to process new templates from webhooks
async function processNewTemplate(shop, template, pageData) {
  try {
    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData?.site_structure?.template_groups) {
      console.log(`No site structure for ${shop}, skipping`);
      return;
    }
    
    const templateGroups = shopData.site_structure.template_groups;
    const existingTemplate = templateGroups instanceof Map ? 
      templateGroups.get(template) : 
      templateGroups[template];
    
    if (existingTemplate) {
      // Template exists - add page
      const pages = existingTemplate.pages || [];
      const pageExists = pages.some(p => p.id === pageData.id);
      
      if (!pageExists) {
        await ShopModel.updateOne(
          { shop },
          {
            $push: {
              [`site_structure.template_groups.${template}.pages`]: pageData
            },
            $inc: {
              [`site_structure.template_groups.${template}.count`]: 1
            }
          }
        );
        console.log(`Added page to template ${template}`);
      }
    } else {
      // NEW TEMPLATE - create and analyze
      console.log(`🆕 New template: ${template}`);
      
      await ShopModel.updateOne(
        { shop },
        {
          $set: {
            [`site_structure.template_groups.${template}`]: {
              count: 1,
              pages: [pageData],
              sample_page: pageData.url,
              psi_analyzed: false,
              js_files: [],
              defer_recommendations: {}
            }
          }
        }
      );
      
      const updatedShop = await ShopModel.findOne({ shop });
      const newTemplateData = updatedShop.site_structure.template_groups instanceof Map ?
        updatedShop.site_structure.template_groups.get(template) :
        updatedShop.site_structure.template_groups[template];
      
      const pageCount = newTemplateData?.count || 1;
      
      // Trigger JS Defer analysis if >5 pages
      if (pageCount > 5) {
        console.log(`Template ${template} has ${pageCount} pages - analyzing`);
        
        jsDeferService.queueAnalysis({
          shop,
          template,
          url: pageData.url
        }).then(result => {
          if (result.success) {
            console.log(`✅ Analysis queued for ${template}`);
            // Poll for results
            setTimeout(() => jsDeferService.pollAndSaveResults(5), 10000);
          }
        }).catch(err => {
          console.error(`Failed to queue analysis for ${template}:`, err.message);
        });
      }
      
      // Generate Critical CSS (existing service)
      try {
        const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://localhost:3010';
        
        await axios.post(
          `${criticalCssServiceUrl}/api/shopify/generate-css`,
          { shop, template, url: pageData.url },
          { timeout: 60000 }
        );
        
        console.log(`✅ Critical CSS generated for ${template}`);
      } catch (cssError) {
        console.error(`CSS generation failed for ${template}:`, cssError.message);
      }
    }
  } catch (error) {
    console.error(`Error processing template ${template}:`, error);
  }
}
// ====== Health Check ======
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    app: 'rl-shopify',
    version: '2.0.0',
    features: ['defer-script-only', 'auto-injection', 'static-html', 'enhanced-psi-analysis', 'auto-apply-defer-rules'],
    environment: process.env.NODE_ENV || 'development'
  });
});

// ====== Debug Route ======
app.get('/debug/headers', (req, res) => {
  res.json({
    headers: req.headers,
    query: req.query,
    path: req.path,
    method: req.method,
    embedded: req.query.embedded === '1'
  });
});

// NEW: API to manually trigger result polling
// ============================================
app.post("/api/poll-defer-results", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    console.log(`Manual polling for ${shop}`);

    const pollResult = await jsDeferService.pollAndSaveResults(3);

    if (pollResult.success) {
      res.json({
        ok: true,
        message: "Results retrieved and saved",
        result: {
          shop: pollResult.result.shop,
          template: pollResult.result.template,
          total_js_files: pollResult.result.total_js_files,
          total_waste_kb: pollResult.result.total_waste_kb
        }
      });
    } else {
      res.json({
        ok: false,
        message: "No new results available",
        error: pollResult.error
      });
    }

  } catch (error) {
    console.error('Poll results error:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to poll results"
    });
  }
});
// ====== Error Handling ======
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  console.error('Request details:', {
    method: req.method,
    path: req.path,
    query: req.query,
    embedded: req.query.embedded === '1'
  });
  
  res.status(500).json({ 
    ok: false, 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ====== 404 Handler ======
app.use((req, res) => {
  console.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  
  if (req.query.embedded === '1') {
    const shop = req.query.shop;
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Page Not Found</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f6f6f7;
          }
          .error-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 500px;
            margin: 0 auto;
          }
          h1 { color: #dc3545; }
          .btn {
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            text-decoration: none;
            display: inline-block;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>404 - Page Not Found</h1>
          <p>The requested page could not be found.</p>
          <p><strong>Path:</strong> ${req.path}</p>
          ${shop ? `<a href="/?shop=${encodeURIComponent(shop)}&embedded=1" class="btn">Go to App Home</a>` : ''}
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(404).json({ 
      ok: false, 
      error: 'Route not found',
      path: req.originalUrl,
      method: req.method
    });
  }
});
// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await jsDeferService.closeRabbitMQ();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await jsDeferService.closeRabbitMQ();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`✅ RL-Shopify app running on port ${PORT}`);
  console.log(`🌐 App URL: ${process.env.APP_URL}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Shopify API Key: ${process.env.SHOPIFY_API_KEY ? 'Configured' : 'MISSING'}`);
  console.log(`📦 Features: defer-js, auto-injection, psi-analysis, critical-css`);
});

// Export for use in other modules
module.exports = {
  app,
  injectCriticalCSSIntoTheme
};