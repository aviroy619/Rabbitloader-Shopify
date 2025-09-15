require("dotenv").config();

// ✅ Environment validation
const requiredEnvVars = [
  'SHOPIFY_API_KEY', 
  'APP_URL', 
  'MONGO_URI'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
});

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

// ====== MongoDB Connection ======
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB connected");
});
mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});

// ====== Shopify Routes ======
const shopifyRoutes = require("./routes/shopify");
app.use("/shopify", shopifyRoutes);

// ====== RabbitLoader Connect Routes ======
const shopifyConnectRoutes = require("./routes/shopifyConnect");
app.use("/", shopifyConnectRoutes);

// ====== Embedded App Authentication Middleware ======
app.use((req, res, next) => {
  // Skip auth for public routes
  const publicRoutes = ['/shopify/auth', '/shopify/auth/callback', '/'];
  if (publicRoutes.includes(req.path)) {
    return next();
  }
  
  // For embedded app routes, ensure shop parameter exists
  const shop = req.query.shop || req.body.shop;
  if (!shop && req.path.startsWith('/shopify/')) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }
  
  next();
});

// ====== Views & Static Files ======
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// ====== Root Route ======
app.get("/", (req, res) => {
  res.render("index", {
    APP_URL: process.env.APP_URL,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01"
  });
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`✅ RL-Shopify app running on port ${PORT}`);
});