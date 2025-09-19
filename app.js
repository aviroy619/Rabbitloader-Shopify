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
console.log(`MongoDB URI configured for: rabbitloader-shopify database`);

const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const path = require("path");
const ShopModel = require("./models/Shop");

// Initialize express
const app = express();
const PORT = process.env.PORT || 3000;

// ====== Middleware ======
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ====== Session Support for OAuth ======
const session = require('express-session');
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true in production with HTTPS
}));

// ====== Security: Enhanced CSP for Shopify Embedding (UPDATED - Removed RabbitLoader CDN) ======
app.use((req, res, next) => {
  const { embedded } = req.query;
  
  if (embedded === '1') {
    // Embedded app - more restrictive CSP (removed cfw.rabbitloader.xyz since we only use defer script now)
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
    // Standalone app - standard CSP (removed cfw.rabbitloader.xyz)
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

// ====== Views & Static Files (BEFORE auth middleware) ======
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// ====== Route Imports ======
const shopifyRoutes = require("./routes/shopify");
const deferConfigRoutes = require("./routes/deferConfig");
const shopifyConnectRoutes = require("./routes/shopifyConnect");

// ====== Public Routes (BEFORE auth middleware) ======
// These need to be mounted before the auth middleware to avoid shop parameter requirements

// Defer configuration routes - these need shop parameter validation but not OAuth
app.use("/defer-config", deferConfigRoutes);

// RabbitLoader Connect Routes - FIXED: Mount on specific path to avoid conflicts
app.use("/rl", shopifyConnectRoutes);

// ====== Root Route (BEFORE auth middleware) ======
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

  // Check if this is an embedded request from Shopify admin
  if (embedded === '1' && shop) {
    console.log(`Serving embedded app for shop: ${shop}`);
    
    try {
      // Generate host parameter if missing (this is important for Shopify apps)
      let finalHost = host;
      if (!host && shop) {
        finalHost = Buffer.from(`${shop}/admin`).toString('base64');
        console.log(`Generated missing host parameter: ${finalHost}`);
      }
      
      // Render the embedded app interface
      res.render("index", {
        APP_URL: process.env.APP_URL,
        SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01",
        SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
        shop: shop,
        host: finalHost || '',
        embedded: true,
        connected: connected === '1',
        script_injected: script_injected === '1'
      });
    } catch (renderError) {
      console.error('Template render error:', renderError);
      res.status(500).send('Template rendering failed');
    }
  } else {
    // Regular standalone access or testing
    console.log(`Serving standalone app for shop: ${shop || 'unknown'}`);
    
    try {
      res.render("index", {
        APP_URL: process.env.APP_URL,
        SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01",
        SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
        shop: shop || null,
        host: host || null,
        embedded: false,
        connected: false,
        script_injected: false
      });
    } catch (renderError) {
      console.error('Template render error:', renderError);
      res.status(500).send('Template rendering failed');
    }
  }
});

// ====== Embedded App Authentication Middleware ======
app.use((req, res, next) => {
  // Skip auth for public routes and static files
  const publicRoutes = [
    '/shopify/auth', 
    '/shopify/auth/callback', 
    '/',
    '/rl/rl-callback',  // RabbitLoader callback route
    '/health'   // Health check
  ];
  
  const isStaticFile = req.path.startsWith('/assets/') || 
                      req.path.endsWith('.css') || 
                      req.path.endsWith('.js') || 
                      req.path.endsWith('.png') ||
                      req.path.endsWith('.jpg') ||
                      req.path.endsWith('.ico');
  
  // Skip auth for defer-config routes (they have their own validation)
  const isDeferConfigRoute = req.path.startsWith('/defer-config');
  
  // Skip auth for webhooks
  const isWebhook = req.path.startsWith('/webhooks/');
  
  // Skip auth for debug routes
  const isDebugRoute = req.path.startsWith('/debug/');
  
  // Skip auth for RL routes
  const isRlRoute = req.path.startsWith('/rl/');
  
  if (publicRoutes.includes(req.path) || isStaticFile || isDeferConfigRoute || isWebhook || isDebugRoute || isRlRoute) {
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
    features: ['defer-script-only', 'auto-injection'],
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

// NOTE: REMOVED THE PROBLEMATIC WILDCARD ROUTE - IT WAS CAUSING 404 ISSUES
// DO NOT ADD app.get('*', ...) BACK - IT BREAKS EMBEDDED APP ROUTING

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`RL-Shopify app running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`App URL: ${process.env.APP_URL}`);
  console.log(`Shopify API Key: ${process.env.SHOPIFY_API_KEY ? 'Set' : 'Missing'}`);
  console.log(`Features: Defer script only, Auto-injection enabled`);
});