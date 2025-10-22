const express = require("express");
const cors = require('cors');
const compression = require("compression");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const path = require("path");
const session = require('express-session');
const MongoStore = require('connect-mongo');

require("dotenv").config();

// ====== Environment Validation ======
const requiredEnvVars = [
  'SHOPIFY_API_KEY', 
  'SHOPIFY_API_SECRET',
  'APP_URL', 
  'MONGO_URI',
  'SESSION_SECRET',
  'RL_CORE_URL'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
});

console.log(`✅ Environment validation passed`);
const dbName = (process.env.MONGO_URI.match(/\/([^/?]+)(\?|$)/) || [])[1] || 'unknown';
console.log(`📦 MongoDB configured for: ${dbName}`);
console.log(`🔗 RL Core URL: ${process.env.RL_CORE_URL}`);

// ====== Initialize Express ======
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;

// ====== Middleware ======
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Webhook raw body (MUST come BEFORE other body parsers)
app.use('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }));

// ====== Session Support ======
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    touchAfter: 24 * 3600
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ====== Security Headers for Shopify Embedding ======
app.use((req, res, next) => {
  const { embedded } = req.query;
  
  if (embedded === '1') {
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' https://*.myshopify.com;"
    );
    res.removeHeader("X-Frame-Options");
  } else {
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self';");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  
  next();
});

// ====== CORS for specific routes ======
app.use('/defer-config', cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));

// ====== MongoDB Connection ======
mongoose.connect(process.env.MONGO_URI);

mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB connected");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});

// ====== Static Files ======
app.use(express.static(path.join(__dirname, "public")));

// ====== Route Imports ======
const shopifyRoutes = require("./routes/shopify");
const rlRoutes = require("./routes/shopifyConnect");
const webhookRoutes = require("./routes/webhooks");
const deferConfigRoutes = require("./routes/deferConfig");
const dashboardRoutes = require("./routes/dashboard");
const dashboardProxyRoutes = require("./routes/dashboardProxy");
const performanceRoutes = require("./routes/performance");

// ====== Mount Routes ======
app.use("/shopify", shopifyRoutes);
app.use("/rl", rlRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/defer-config", deferConfigRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/api/dashboard", dashboardProxyRoutes);
app.use("/api/performance", performanceRoutes);

// ====== Root Route (Embedded Dashboard) ======
app.get("/", (req, res) => {
  const { shop, host, embedded, hmac, timestamp } = req.query;
  
  console.log(`Root route accessed:`, {
    shop: shop || 'none',
    embedded: embedded || 'none',
    hasAuth: !!(hmac || timestamp)
  });

  // Auto-fix: Shopify OAuth callback without embedded=1
  const isFromShopifyOAuth = shop && host && (hmac || timestamp);
  
  if (isFromShopifyOAuth && embedded !== '1') {
    console.log(`⚠️ Auto-fixing: adding embedded=1 to OAuth callback`);
    const params = new URLSearchParams(req.query);
    params.set('embedded', '1');
    return res.redirect(`/?${params.toString()}`);
  }

  // For embedded apps, shop is required
  if (embedded === '1' && !shop) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Shop Parameter Required</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f6f6f7; }
          .error { background: white; padding: 40px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          h1 { color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>Missing Shop Parameter</h1>
          <p>This embedded app requires a shop parameter.</p>
          <p><code>/?shop=your-shop.myshopify.com&embedded=1</code></p>
        </div>
      </body>
      </html>
    `);
  }

  // Serve static frontend
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== Health Check ======
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    app: 'rl-shopify-connector',
    version: '3.0.0',
    features: ['oauth', 'theme-injection', 'webhooks', 'rl-core-integration'],
    environment: process.env.NODE_ENV || 'development',
    rl_core: process.env.RL_CORE_URL
  });
});

// ====== Debug Route ======
app.get('/debug/shop', async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ error: "Missing shop parameter" });
  }

  try {
    const ShopModel = require("./models/Shop");
    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.json({ found: false, shop });
    }

    res.json({
      found: true,
      shop: shopData.shop,
      has_access_token: !!shopData.access_token,
      has_api_token: !!shopData.api_token,
      short_id: shopData.short_id,
      connected_at: shopData.connected_at,
      script_injected: shopData.script_injected,
      critical_css_injected: shopData.critical_css_injected,
      needs_setup: shopData.needs_setup,
      reauth_required: shopData.reauth_required
    });
  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ====== Error Handling ======
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ 
    ok: false, 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ====== 404 Handler ======
app.use((req, res) => {
  console.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    ok: false, 
    error: 'Route not found',
    path: req.originalUrl 
  });
});

// ====== Graceful Shutdown ======
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`✅ RL-Shopify Connector running on port ${PORT}`);
  console.log(`🌐 App URL: ${process.env.APP_URL}`);
  console.log(`🔗 RL Core: ${process.env.RL_CORE_URL}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📦 Features: OAuth, Theme Injection, Webhooks, Dashboard Proxy`);
});

module.exports = { app };