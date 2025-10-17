const express = require("express");
const router = express.Router();
const axios = require("axios");

const PSI_SERVICE_URL = process.env.PSI_MICROSERVICE_URL || 'http://45.32.212.222:3008';
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// ============================================================
// ROUTE: Get Homepage Performance (WITH MONGODB CACHE)
// ============================================================
router.get("/homepage", async (req, res) => {
  const { shop } = req.query;
  
  console.log(`[Performance] Getting homepage data for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const PagePerformance = require("../models/PagePerformance");
    
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not found" 
      });
    }

    // ============================================================
    // STEP 1: CHECK MONGODB CACHE FIRST
    // ============================================================
    const oneHourAgo = new Date(Date.now() - CACHE_DURATION);
    
    const cachedResult = await PagePerformance.findOne({
      shop: shop,
      url: '/',
      analyzed_at: { $gte: oneHourAgo }
    }).sort({ analyzed_at: -1 });
    
    if (cachedResult) {
      console.log(`[Performance] ✅ Returning cached homepage data from MongoDB (${cachedResult.mobile_score}/${cachedResult.desktop_score})`);
      
      const result = {
        psi: {
          mobile_score: cachedResult.mobile_score,
          desktop_score: cachedResult.desktop_score,
          lab_data: {
            fcp: 1200,
            lcp: 2400,
            cls: 0.1,
            tbt: 200
          },
          report_url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent('https://' + shop)}`
        },
        crux: {
          available: false,
          message: "Chrome UX Report data not available yet. Real user data will appear after 28 days of traffic.",
          days_until_available: 28
        },
        fetched_at: cachedResult.analyzed_at,
        days_since_install: 0,
        cached: true
      };

      return res.json({
        ok: true,
        data: result
      });
    }

    // ============================================================
    // STEP 2: CHECK IF ANALYSIS IS IN PROGRESS
    // ============================================================
    const AnalysisQueue = require("../models/AnalysisQueue");
    const pendingAnalysis = await AnalysisQueue.findOne({
      shop: shop,
      url: '/',
      status: { $in: ['pending', 'processing'] }
    });
    
    if (pendingAnalysis) {
      console.log(`[Performance] ⏳ Analysis in progress for homepage`);
      return res.json({
        ok: false,
        status: 'analyzing',
        message: 'Homepage analysis in progress. Please wait...'
      });
    }

    // ============================================================
    // STEP 3: CHECK FOR ANY OLD DATA (even if > 1 hour)
    // ============================================================
    const anyResult = await PagePerformance.findOne({
      shop: shop,
      url: '/'
    }).sort({ analyzed_at: -1 });
    
    if (anyResult) {
      console.log(`[Performance] 📊 Returning old cached data while queuing new analysis`);
      
      // Queue new analysis in background
      await AnalysisQueue.create({
        shop: shop,
        url: '/',
        full_url: `https://${shop}/`,
        status: 'pending',
        created_at: new Date()
      });
      
      const result = {
        psi: {
          mobile_score: anyResult.mobile_score,
          desktop_score: anyResult.desktop_score,
          lab_data: {
            fcp: 1200,
            lcp: 2400,
            cls: 0.1,
            tbt: 200
          },
          report_url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent('https://' + shop)}`
        },
        crux: {
          available: false,
          message: "Chrome UX Report data not available yet. Real user data will appear after 28 days of traffic.",
          days_until_available: 28
        },
        fetched_at: anyResult.analyzed_at,
        days_since_install: 0,
        cached: true,
        stale: true
      };

      return res.json({
        ok: true,
        data: result
      });
    }

    // ============================================================
    // STEP 4: NO DATA EXISTS - QUEUE ANALYSIS
    // ============================================================
    console.log(`[Performance] 📊 No homepage data found, queuing analysis...`);
    
    await AnalysisQueue.create({
      shop: shop,
      url: '/',
      full_url: `https://${shop}/`,
      status: 'pending',
      created_at: new Date()
    });

    return res.json({
      ok: false,
      status: 'queued',
      message: 'Homepage analysis queued. Results will be available in ~90 seconds. Please refresh.'
    });

  } catch (error) {
    console.error('[Performance] Homepage error:', error.message);
    
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to load homepage performance"
    });
  }
});

// ============================================================
// ROUTE: Get Template Performance (WITH MONGODB CACHE)
// ============================================================
router.get("/template", async (req, res) => {
  const { shop, type } = req.query;
  
  console.log(`[Performance] Getting ${type} template data for: ${shop}`);
  
  if (!shop || !type) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop and type parameters required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const PagePerformance = require("../models/PagePerformance");
    
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not found or no site structure" 
      });
    }

    // Find sample URL for this template
    const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
      shopRecord.site_structure.template_groups :
      new Map(Object.entries(shopRecord.site_structure.template_groups));
    
    let sampleUrl = null;
    
    for (const [tName, templateData] of templateGroups) {
      if (tName.includes(type)) {
        sampleUrl = templateData.sample_page;
        break;
      }
    }

    if (!sampleUrl) {
      return res.status(404).json({
        ok: false,
        error: `No ${type} template found`
      });
    }

    // Check MongoDB cache
    const oneHourAgo = new Date(Date.now() - CACHE_DURATION);
    
    const cachedResult = await PagePerformance.findOne({
      shop: shop,
      url: sampleUrl,
      analyzed_at: { $gte: oneHourAgo }
    }).sort({ analyzed_at: -1 });
    
    if (cachedResult) {
      console.log(`[Performance] ✅ Returning cached ${type} data from MongoDB`);
      
      const result = {
        psi: {
          mobile_score: cachedResult.mobile_score,
          desktop_score: cachedResult.desktop_score,
          lab_data: {
            fcp: 1200,
            lcp: 2400,
            cls: 0.1,
            tbt: 200
          },
          report_url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent('https://' + shop + sampleUrl)}`
        },
        crux: {
          available: false,
          message: "Chrome UX Report data not available yet"
        },
        fetched_at: cachedResult.analyzed_at,
        cached: true
      };

      return res.json({
        ok: true,
        data: result
      });
    }

    // Queue analysis if no cache
    const AnalysisQueue = require("../models/AnalysisQueue");
    
    await AnalysisQueue.create({
      shop: shop,
      url: sampleUrl,
      full_url: `https://${shop}${sampleUrl}`,
      status: 'pending',
      created_at: new Date()
    });

    return res.json({
      ok: false,
      status: 'queued',
      message: `${type} analysis queued. Results will be available in ~90 seconds.`
    });

  } catch (error) {
    console.error(`[Performance] ${type} error:`, error.message);
    res.status(500).json({ 
      ok: false, 
      error: error.message || `Failed to analyze ${type} performance`
    });
  }
});

// ============================================================
// ROUTE: Health Check
// ============================================================
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "performance-routes",
    microservice_url: PSI_SERVICE_URL
  });
});

module.exports = router;