const mongoose = require("mongoose");

const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true },
  access_token: String,
  short_id: String,    // RabbitLoader DID
  api_token: String,   // RL API token
  connected_at: Date,
  history: [
    {
      event: String,   // "connect" | "disconnect"
      timestamp: Date,
      details: Object  // optional metadata
    }
  ]
});

module.exports = mongoose.model("Shop", ShopSchema);
