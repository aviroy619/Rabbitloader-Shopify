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

// ====== Security: CSP for Shopify Embedding ======
app.use((req, res, next) => {
  // More permissive CSP for development
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.shopify.com; " +
    "style-src 'self' 'unsafe-inline';"
  );
  
  // Allow embedding in Shopify
  res.setHeader("X-Frame-Options", "ALLOWALL");
  
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

// RabbitLoader Connect Routes
app.use("/", shopifyConnectRoutes);

// ====== Embedded App Authentication Middleware ======
app.use((req, res, next) => {
  // Skip auth for public routes and static files
  const publicRoutes = [
    '/shopify/auth', 
    '/shopify/auth/callback', 
    '/',
    '/account' // Add the RabbitLoader connect route
  ];
  
  const isStaticFile = req.path.startsWith('/assets/') || 
                      req.path.endsWith('.css') || 
                      req.path.endsWith('.js') || 
                      req.path.endsWith('.png') ||
                      req.path.endsWith('.jpg') ||
                      req.path.endsWith('.ico');
  
  // Skip auth for defer-config routes (they have their own validation)
  const isDeferConfigRoute = req.path.startsWith('/defer-config');
  
  if (publicRoutes.includes(req.path) || isStaticFile || isDeferConfigRoute) {
    return next();
  }
  
  // For embedded app routes, ensure shop parameter exists
  const shop = (req.query && req.query.shop) || (req.body && req.body.shop);
  if (!shop && req.path.startsWith('/shopify/')) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }
  
  next();
});

// ====== Shopify Routes (AFTER auth middleware) ======
app.use("/shopify", shopifyRoutes);

// ====== Root Route ======
app.get("/", (req, res) => {
  res.render("index", {
    APP_URL: process.env.APP_URL,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01"
  });
});

// ====== Error Handling ======
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    ok: false, 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ====== 404 Handler ======
app.use((req, res) => {
  res.status(404).json({ 
    ok: false, 
    error: 'Route not found',
    path: req.path 
  });
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`RL-Shopify app running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`App URL: ${process.env.APP_URL}`);
});