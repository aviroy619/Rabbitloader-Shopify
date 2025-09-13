require("dotenv").config();

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

// ====== Shopify Status Route ======
app.get("/shopify/status", async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const record = await ShopModel.findOne({ shop });
    if (!record) {
      return res.json({
        ok: true,
        connected: false,
        shop
      });
    }

    res.json({
      ok: true,
      connected: true,
      shop: record.shop,
      connected_at: record.connected_at,
      short_id: record.short_id
    });
  } catch (err) {
    console.error("Status check failed:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ====== Shopify → RabbitLoader OAuth Callback ======
app.get("/shopify/auth/callback", async (req, res) => {
  const shop = req.query.shop;
  const rlToken = req.query["rl-token"]; // ✅ fix hyphen issue

  if (!shop || !rlToken) {
    return res.status(400).send("Missing required parameters");
  }

  try {
    // Save or update shop record
    await ShopModel.findOneAndUpdate(
      { shop },
      {
        shop,
        api_token: rlToken,
        connected_at: new Date()
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Shop ${shop} connected with RL token`);

    // Redirect back to app dashboard with "connected" flag
    const redirectUrl = `/index.html?shop=${encodeURIComponent(shop)}&connected=1`;
    res.redirect(redirectUrl);

  } catch (err) {
    console.error("❌ Auth callback error:", err);
    res.status(500).send("Server error");
  }
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`✅ RL-Shopify app running on port ${PORT}`);
});
