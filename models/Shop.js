// models/Shop.js (Updated version integrating with your existing model)
const mongoose = require("mongoose");

// Schema for defer configuration rules
const deferRuleSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  src_regex: {
    type: String,
    required: true
  },
  action: {
    type: String,
    enum: ['defer', 'delay', 'block'],
    default: 'defer'
  },
  priority: {
    type: Number,
    default: 0
  },
  conditions: {
    device: {
      type: [String],
      enum: ['mobile', 'tablet', 'desktop']
    },
    page_types: {
      type: [String]
    }
  },
  enabled: {
    type: Boolean,
    default: true
  }
}, { _id: false });

// Schema for defer configuration
const deferConfigSchema = new mongoose.Schema({
  release_after_ms: {
    type: Number,
    default: 2000,
    min: 0,
    max: 30000
  },
  rules: [deferRuleSchema],
  enabled: {
    type: Boolean,
    default: true
  },
  version: {
    type: String,
    default: "1.0.0"
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  source: {
    type: String,
    enum: ['manual', 'lighthouse', 'auto'],
    default: 'manual'
  },
  // Performance tracking
  performance_metrics: {
    avg_load_time_improvement: Number,
    script_defer_count: Number,
    last_measured: Date
  }
}, { _id: false });

// Updated Shop Schema integrating with your existing structure
const ShopSchema = new mongoose.Schema({
  shop: {
    type: String,
    unique: true,   // ensures uniqueness and creates the index automatically
    required: true
  },
  access_token: String,
  
  // RabbitLoader integration (your existing fields)
  short_id: String,    // RabbitLoader DID
  api_token: String,   // RL API token
  connected_at: Date,
  history: Array,
  
  // Additional fields for enhanced functionality
  script_injected: {
    type: Boolean,
    default: false
  },
  script_injection_attempted: {
    type: Boolean,
    default: false
  },
  
  // Defer configuration (NEW)
  deferConfig: deferConfigSchema,
  
  // Usage tracking for API limits
  usage: {
    requests_this_month: {
      type: Number,
      default: 0
    },
    last_request: Date,
    total_requests: {
      type: Number,
      default: 0
    }
  },
  
  // Plan information
  plan: {
    type: String,
    enum: ['free', 'basic', 'premium'],
    default: 'free'
  },
  
  // Shop metadata (can be populated from Shopify API)
  shopInfo: {
    name: String,
    domain: String,
    email: String,
    timezone: String,
    currency: String,
    plan_name: String
  }
}, {
  timestamps: true
});

// Only add extra indexes where needed - NO shop index (unique: true already creates it)
ShopSchema.index({ 'usage.last_request': 1 });

// Methods
ShopSchema.methods.updateUsage = function() {
  this.usage.total_requests += 1;
  this.usage.requests_this_month += 1;
  this.usage.last_request = new Date();
  return this.save();
};

ShopSchema.methods.resetMonthlyUsage = function() {
  this.usage.requests_this_month = 0;
  return this.save();
};

// Static methods
ShopSchema.statics.findByShop = function(shopDomain) {
  return this.findOne({ shop: shopDomain });
};

// Prevent OverwriteModelError (keeping your existing pattern)
module.exports = mongoose.models.Shop || mongoose.model("Shop", ShopSchema);