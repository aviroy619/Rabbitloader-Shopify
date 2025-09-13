const mongoose = require("mongoose");

const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true },
  access_token: String,
  short_id: String,    // RabbitLoader DID
  api_token: String,   // RL API token
  connected_at: Date,
  history: Array
});

// Prevent OverwriteModelError
module.exports = mongoose.models.Shop || mongoose.model("Shop", ShopSchema);
