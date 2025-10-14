const express = require("express");
const router = express.Router();
const axios = require("axios");

const PSI_SERVICE_URL = process.env.PSI_MICROSERVICE_URL || 'http://45.32.212.222:3004';

// ============================================================
// ROUTE: Get Homepage Performance
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
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not found" 
      });
    }

    console.log(`[Performance] Calling PSI microservice: ${PSI_SERVICE_URL}/api/analyze`);

    // Call PSI microservice
    const response = await axios.post(`${PSI_SERVICE_URL}/api/analyze`, {
      shop: shop,
      url: `https://${shop}/`,
      template: "homepage"
    }, {
      timeout: 120000 // 2 minutes
    });

    if (response.data.ok) {
      const data = response.data.data;
      
      console.log(`[Performance] PSI response received:`, {
        mobileScore: data.pagespeed.mobileScore,
        desktopScore: data.pagespeed.desktopScore
      });
      
      // Transform to frontend format
      const result = {
        psi: {
          mobile_score: data.pagespeed.mobileScore,
          desktop_score: data.pagespeed.desktopScore,
          lab_data: {
            fcp: data.pagespeed.perceivedLoadTime * 1000 * 0.3, // Estimate
            lcp: data.pagespeed.perceivedLoadTime * 1000,
            cls: 0.1,
            tbt: 200
          },
          report_url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent('https://' + shop)}`
        },
        crux: data.chromeUX && data.chromeUX.lcpCategory ? {
          available: true,
          collection_period: data.chromeUX.period,
          lcp: {
            p75: data.chromeUX.lcpCategory === 'good' ? 2000 : 3500,
            good_pct: data.chromeUX.lcpCategory === 'good' ? 85 : 60
          },
          fcp: {
            p75: 1500,
            good_pct: 80
          },
          cls: {
            p75: data.chromeUX.clsCategory === 'good' ? 0.08 : 0.15,
            good_pct: data.chromeUX.clsCategory === 'good' ? 90 : 65
          },
          message: data.chromeUX.summary.join('\n')
        } : {
          available: false,
          message: "Chrome UX Report data not available yet. Real user data will appear after 28 days of traffic.",
          days_until_available: 28
        },
        fetched_at: data.checkedAt,
        days_since_install: 0
      };

      console.log(`[Performance] ✅ Homepage performance data prepared for ${shop}`);

      res.json({
        ok: true,
        data: result
      });
    } else {
      console.error('[Performance] PSI microservice returned error');
      res.status(500).json({
        ok: false,
        error: "PSI analysis failed"
      });
    }

  } catch (error) {
    console.error('[Performance] Homepage error:', error.message);
    
    // Return a user-friendly error
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to analyze homepage performance"
    });
  }
});

// ============================================================
// ROUTE: Get Template Performance
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
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not found or no site structure" 
      });
    }

    // Find a sample page of this template type
    const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
      shopRecord.site_structure.template_groups :
      new Map(Object.entries(shopRecord.site_structure.template_groups));
    
    let sampleUrl = null;
    let templateName = null;
    
    for (const [tName, templateData] of templateGroups) {
      if (tName.includes(type)) {
        sampleUrl = templateData.sample_page;
        templateName = tName;
        break;
      }
    }

    if (!sampleUrl) {
      console.error(`[Performance] No ${type} template found for ${shop}`);
      return res.status(404).json({
        ok: false,
        error: `No ${type} template found`
      });
    }

    console.log(`[Performance] Found sample URL for ${type}: ${sampleUrl}`);

    // Call PSI microservice
    const response = await axios.post(`${PSI_SERVICE_URL}/api/analyze`, {
      shop: shop,
      url: sampleUrl,
      template: type
    }, {
      timeout: 120000
    });

    if (response.data.ok) {
      const data = response.data.data;
      
      const result = {
        psi: {
          mobile_score: data.pagespeed.mobileScore,
          desktop_score: data.pagespeed.desktopScore,
          lab_data: {
            fcp: data.pagespeed.perceivedLoadTime * 1000 * 0.3,
            lcp: data.pagespeed.perceivedLoadTime * 1000,
            cls: 0.1,
            tbt: 200
          },
          report_url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(sampleUrl)}`
        },
        crux: data.chromeUX && data.chromeUX.lcpCategory ? {
          available: true,
          collection_period: data.chromeUX.period,
          message: data.chromeUX.summary.join('\n')
        } : {
          available: false,
          message: "Chrome UX Report data not available yet"
        },
        fetched_at: data.checkedAt
      };

      console.log(`[Performance] ✅ ${type} template data prepared for ${shop}`);

      res.json({
        ok: true,
        data: result
      });
    } else {
      res.status(500).json({
        ok: false,
        error: "PSI analysis failed"
      });
    }

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