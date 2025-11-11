const express = require('express');
const router = express.Router();
const Shop = require('../models/Shop');
const { syncReportData } = require('../utils/rlReportService');

// GET subscription & optimization data
router.get('/report/:shop', async (req, res) => {
  const { shop } = req.params;
  
  try {
    console.log(`[RL Route] Fetching report for: ${shop}`);
    
    // Sync fresh data (will use cache if < 24 hours old)
    const data = await syncReportData(shop);
    
    if (!data) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Could not fetch report data' 
      });
    }

    res.json({
      ok: true,
      shop,
      subscription: data.subscription,
      optimization_status: data.optimization_status
    });
    
  } catch (error) {
    console.error(`[RL Route] Error:`, error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;