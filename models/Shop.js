// models/Shop.js
const mongoose = require("mongoose");

// Schema for defer configuration rules
const deferRuleSchema = new mongoose.Schema({
  id: { type: String, required: true },
  src_regex: { type: String, required: true },
  action: { type: String, enum: ['defer', 'delay', 'block'], default: 'defer' },
  priority: { type: Number, default: 0 },
  conditions: {
    device: { type: [String], enum: ['mobile', 'tablet', 'desktop'] },
    page_types: { type: [String] }
  },
  enabled: { type: Boolean, default: true },
  generated_from: {
    template: String,
    original_file: String,
    reason: String,
    confidence: Number
  }
}, { _id: false });

// Schema for defer configuration
const deferConfigSchema = new mongoose.Schema({
  release_after_ms: { type: Number, default: 2000, min: 0, max: 30000 },
  rules: [deferRuleSchema],
  enabled: { type: Boolean, default: true },
  version: { type: String, default: "1.0.0" },
  updated_at: { type: Date, default: Date.now },
  source: { type: String, enum: ['manual', 'lighthouse', 'auto'], default: 'manual' },
  performance_metrics: {
    avg_load_time_improvement: Number,
    script_defer_count: Number,
    last_measured: Date
  }
}, { _id: false });

// Shop Schema
const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true, required: true },
  access_token: String,
  short_id: String,
  api_token: String,
  connected_at: Date,
  history: Array,
  script_injected: { type: Boolean, default: false },
  script_injection_attempted: { type: Boolean, default: false },
  deferConfig: deferConfigSchema,

  // Site structure with FIXED defer_recommendations
  site_structure: {
    last_analyzed: Date,
    active_theme: String,
    template_groups: {
      type: Map,
      of: {
        count: Number,
        pages: [{ id: String, url: String, title: String, handle: String }],
        sample_page: String,
        psi_analyzed: { type: Boolean, default: false },
        js_files: [String],
        
        // FIXED: Complex objects instead of strings
        defer_recommendations: [{
          file: String,
          reason: String,
          priority: String,
          category: String,
          action: String,
          confidence: Number,
          wastedBytes: Number,
          wastedPercent: Number,
          details: String,
          wastedMs: Number,
          duration: Number,
          source: String
        }],
        
        user_defer_config: [{
          file: String,
          defer: Boolean,
          reason: String
        }],
        
        last_psi_analysis: Date,
        user_config_updated: Date,
        
        js_analysis: {
          total_files: Number,
          categories: mongoose.Schema.Types.Mixed,
          category_details: mongoose.Schema.Types.Mixed,
          render_blocking: [String],
          unused_js: [mongoose.Schema.Types.Mixed],
          total_waste_kb: Number
        },
        
        analysis_summary: mongoose.Schema.Types.Mixed,
        
        psi_metrics: {
          performance_score: Number,
          lcp_time: Number,
          fid_time: Number,
          cls_score: Number,
          created_at: Date,
          url_analyzed: String
        },
        
        psi_error: {
          message: String,
          timestamp: Date,
          url_attempted: String
        }
      }
    }
  },

  usage: {
    requests_this_month: { type: Number, default: 0 },
    last_request: Date,
    total_requests: { type: Number, default: 0 }
  },
  
  plan: { type: String, enum: ['free', 'basic', 'premium'], default: 'free' },
  
  shopInfo: {
    name: String,
    domain: String,
    email: String,
    timezone: String,
    currency: String,
    plan_name: String
  }
}, {
  timestamps: true,
  strict: false
});

ShopSchema.index({ 'usage.last_request': 1 });

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

ShopSchema.statics.findByShop = function(shopDomain) {
  return this.findOne({ shop: shopDomain });
};

module.exports = mongoose.models.Shop || mongoose.model("Shop", ShopSchema);