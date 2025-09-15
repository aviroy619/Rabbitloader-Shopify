const mongoose = require("mongoose");

const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true, required: true },
  access_token: String,    // Shopify OAuth token
  short_id: String,        // RabbitLoader DID
  api_token: String,       // RL API token
  connected_at: Date,
  history: { type: Array, default: [] },
  script_injected: { type: Boolean, default: false },           // Tracks if script was successfully injected
  script_injection_attempted: { type: Boolean, default: false } // Tracks if injection was attempted (prevents retry loops)
});

// Prevent OverwriteModelError
module.exports = mongoose.models.Shop || mongoose.model("Shop", ShopSchema);