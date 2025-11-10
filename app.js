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
// IMPORTANT: Raw body middleware for webhooks MUST come BEFORE bodyParser
app.use('/webhooks/app/uninstalled', (req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
});

// Handle empty/null bodies gracefully
app.use(bodyParser.json({
  strict: false,
  verify: (req, res, buf, encoding) => {
    if (buf.length === 0 || buf.toString().trim() === '' || buf.toString() === 'null') {
      req.body = {};
    }
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/dashboard-static", express.static(path.join(__dirname, "public")));

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
const dashboardRoutes = require("./routes/dashboard");
const dashboardProxyRoutes = require("./routes/dashboardProxy");
const performanceRoutes = require("./routes/performance");
const shopifyCrawler = require('./routes/shopifyCrawler');  // ✅ only once
//
// ====== Mount Routes ======
app.use("/shopify", shopifyRoutes);
app.use("/rl", rlRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/api/dashboard", dashboardProxyRoutes);
app.use("/api/performance", performanceRoutes);
app.use('/crawler', shopifyCrawler);  // ✅ mounted cleanly


// ====== Root Route (Embedded Dashboard) ======
app.get("/", async (req, res) => {
  const { shop, host, embedded, hmac, timestamp } = req.query;

  console.log(`Root route accessed:`, { shop: shop || 'none', embedded: embedded || 'none' });

  // If no shop param – send to install flow
  if (!shop) {
    console.log("⚠️ No shop param – redirecting to install");
    return res.redirect("/auth?step=start");
  }

  // Check if shop already has access_token
  try {
    const ShopModel = require("./models/Shop");
    const existingShop = await ShopModel.findOne({ shop });
    
    // If shop doesn't have access token, trigger OAuth
    if (!existingShop || !existingShop.access_token) {
      console.log(`🔐 Fresh install detected for ${shop} – triggering OAuth`);
      return res.redirect(`/shopify/auth?shop=${encodeURIComponent(shop)}&host=${host}`);
    }
  } catch (err) {
    console.error("Root route error:", err);
  }

  // Already authenticated – go to dashboard
  const params = new URLSearchParams(req.query);
  return res.redirect(`/dashboard?${params.toString()}`);
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

// ====== DEBUG ROUTE ======
app.get("/rl/debug/:shop", async (req, res) => {
  const { shop } = req.params;
  
  try {
    const ShopModel = require("./models/Shop");
    const shopDomain = shop.endsWith(".myshopify.com") ? shop : `${shop}.myshopify.com`;
    const shopRecord = await ShopModel.findOne({ shop: shopDomain });
    
    if (!shopRecord) {
      return res.json({ 
        found: false, 
        shop: shopDomain,
        api_token: null,
        short_id: null
      });
    }
    
    res.json({
      found: true,
      shop: shopRecord.shop,
      has_access_token: !!shopRecord.access_token,
      api_token: shopRecord.api_token,
      short_id: shopRecord.short_id,
      connected_at: shopRecord.connected_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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