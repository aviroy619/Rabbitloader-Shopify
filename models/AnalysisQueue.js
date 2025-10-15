const mongoose = require('mongoose');

const AnalysisQueueSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  url: { type: String, required: true },
  full_url: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  error: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

AnalysisQueueSchema.index({ shop: 1, url: 1, status: 1 });

module.exports = mongoose.model('AnalysisQueue', AnalysisQueueSchema);