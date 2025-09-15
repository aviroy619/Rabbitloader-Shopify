const mongoose = require("mongoose");

const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true, required: true },
  access_token: String,    // ← ADDED: Shopify OAuth token
  short_id: String,        // RabbitLoader DID
  api_token: String,       // RL API token
  connected_at: Date,
  history: { type: Array, default: [] }  // ← ADDED: Default empty array
});

// ✅ Prevent OverwriteModelError
module.exports = mongoose.models.Shop || mongoose.model("Shop", ShopSchema);