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

// Initialize express
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;

// ====== Middleware ======
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ====== Session Support for OAuth ======
const session = require('express-session');
const MongoStore = require('connect-mongo');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    touchAfter: 24 * 3600, // 24 hours
    dbName: 'RLPlatforms'
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
    
    console.log(`Setting embedded app CSP headers for ${req.path}`);
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
});
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

// ====== Static Files ======
app.use(express.static(path.join(__dirname, "public")));

// ====== Route Imports ======
const shopifyRoutes = require("./routes/shopify");
const deferConfigRoutes = require("./routes/deferConfig");
const shopifyConnectRoutes = require("./routes/shopifyConnect");

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
// API Route for shop status check
app.get("/api/status", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required in x-shop header or query" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.json({
        ok: true,
        connected: false,
        shop: shop
      });
    }

    res.json({
      ok: true,
      connected: !!shopData.short_id,
      did: shopData.short_id,
      script_injected: shopData.script_injected || false,
      shop: shop,
      connected_at: shopData.connected_at
    });

  } catch (error) {
    console.error('Error checking shop status:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
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

    const response = await axios.get(`https://${shop}/admin/api/2025-01/themes.json`, {
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

    const response = await axios.get(`https://${shop}/admin/api/2025-01/products.json`, {
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

    const response = await axios.get(`https://${shop}/admin/api/2025-01/script_tags.json`, {
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

    const response = await axios.post(`https://${shop}/admin/api/2025-01/script_tags.json`, {
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

    const response = await axios.get(`https://${shop}/admin/api/2025-01/pages.json`, {
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

// Defer config API route
app.get("/defer-config/api", async (req, res) => {
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
        ok: true,
        has_config: false,
        shop: shop,
        message: "Shop not found - no defer config"
      });
    }

    res.json({
      ok: true,
      has_config: !!shopData.deferConfig,
      shop: shop,
      deferConfig: shopData.deferConfig || null
    });

  } catch (error) {
    console.error('Error fetching defer config:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// Defer configuration routes - these need shop parameter validation but not OAuth
app.use("/defer-config", deferConfigRoutes);

// RabbitLoader Connect Routes - FIXED: Mount on specific path to avoid conflicts
app.use("/rl", shopifyConnectRoutes);

// ====== Root Route (BEFORE auth middleware) - UPDATED FOR STATIC HTML ======
app.get("/", (req, res) => {
  const { shop, host, embedded, connected, script_injected } = req.query;
  
  console.log(`Root route accessed:`, {
    shop: shop || 'none',
    host: host ? `${host.substring(0, 20)}...` : 'none',
    embedded: embedded || 'none',
    connected: connected || 'none',
    script_injected: script_injected || 'none',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 50) + '...' : 'none',
    referer: req.headers.referer || 'none'
  });

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
    '/api/env',  // NEW: Allow API env route
    '/rl/rl-callback',  // RabbitLoader callback route
    '/health'   // Health check
  ];
  
  const isStaticFile = req.path.startsWith('/assets/') || 
                      req.path.endsWith('.css') || 
                      req.path.endsWith('.js') || 
                      req.path.endsWith('.png') ||
                      req.path.endsWith('.jpg') ||
                      req.path.endsWith('.ico') ||
                      req.path.endsWith('.html');
  
  // Skip auth for defer-config routes (they have their own validation)
  const isDeferConfigRoute = req.path.startsWith('/defer-config');
  
  // Skip auth for webhooks
  const isWebhook = req.path.startsWith('/webhooks/');
  
  // Skip auth for debug routes
  const isDebugRoute = req.path.startsWith('/debug/');
  
  // Skip auth for RL routes
  const isRlRoute = req.path.startsWith('/rl/');
  
  // Skip auth for API routes
  const isApiRoute = req.path.startsWith('/api/');
  
  if (publicRoutes.includes(req.path) || isStaticFile || isDeferConfigRoute || isWebhook || isDebugRoute || isRlRoute || isApiRoute) {
    return next();
  }
  
  // For shopify routes, ensure shop parameter exists
  const shop = (req.query && req.query.shop) || (req.body && req.body.shop);
  if (!shop && req.path.startsWith('/shopify/')) {
    console.log(`Blocking shopify route ${req.path} - missing shop parameter`);
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }
  
  next();
});

// ====== Shopify Routes (AFTER auth middleware) ======
app.use("/shopify", shopifyRoutes);

// ====== Webhook Handler ======
app.post("/webhooks/app/uninstalled", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    console.log(`App uninstalled for shop: ${shop}`);
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        { 
          $unset: { 
            access_token: "", 
            api_token: "", 
            short_id: "",
            script_injected: "",
            script_injection_attempted: ""
          },
          $set: { connected_at: null },
          $push: {
            history: {
              event: "uninstalled",
              timestamp: new Date(),
              details: { via: "webhook" }
            }
          }
        }
      );
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
});

// ====== Health Check ======
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    app: 'rl-shopify',
    version: '2.0.0',
    features: ['defer-script-only', 'auto-injection', 'static-html'],
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

// ====== Enhanced 404 Handler for Embedded Apps ======
app.use((req, res) => {
  console.log(`404 - Route not found:`, {
    method: req.method,
    path: req.path,
    query: req.query,
    embedded: req.query.embedded === '1',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 50) + '...' : 'none'
  });
  
  // For embedded requests, return proper HTML with shop context
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
          <p><strong>Method:</strong> ${req.method}</p>
          ${shop ? `<a href="/?shop=${encodeURIComponent(shop)}&embedded=1" class="btn">Go to App Home</a>` : ''}
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(404).json({ 
      ok: false, 
      error: 'Route not found',
      path: req.path,
      method: req.method
    });
  }
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`RL-Shopify app running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`App URL: ${process.env.APP_URL}`);
  console.log(`Shopify API Key: ${process.env.SHOPIFY_API_KEY ? 'Set' : 'Missing'}`);
  console.log(`Features: Static HTML, Defer script only, Auto-injection enabled`);
});