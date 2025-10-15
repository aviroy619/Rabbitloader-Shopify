const mongoose = require('mongoose');

const PagePerformanceSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  url: { type: String, required: true },
  mobile_score: { type: Number, required: true },
  desktop_score: { type: Number, required: true },
  analyzed_at: { type: Date, default: Date.now, index: true }
});

PagePerformanceSchema.index({ shop: 1, url: 1, analyzed_at: -1 });

module.exports = mongoose.model('PagePerformance', PagePerformanceSchema);