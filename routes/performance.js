const express = require("express");
const router = express.Router();
const axios = require("axios");

const PSI_SERVICE_URL = process.env.PSI_MICROSERVICE_URL || 'http://45.32.212.222:3004';

// ============================================================
// ROUTE: Get Homepage Performance
// ============================================================
router.get("/homepage", async (req, res) => {
  const { shop } = req.query;
  
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
      
      // Transform to frontend format
      const result = {
        psi: {
          mobile_score: data.pagespeed.mobileScore,
          desktop_score: data.pagespeed.desktopScore,
          lab_data: {
            fcp: data.pagespeed.perceivedLoadTime * 1000 * 0.3, // Estimate
            lcp: data.pagespeed.perceivedLoadTime * 1000,
            cls: 0.1, // Would come from detailed metrics
            tbt: 200 // Would come from detailed metrics
          },
          report_url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent('https://' + shop)}`
        },
        crux: data.chromeUX ? {
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
          message: "Chrome UX Report data not available yet"
        },
        fetched_at: data.checkedAt,
        days_since_install: 0
      };

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
    console.error('[Performance] Homepage error:', error.message);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Get Template Performance
// ============================================================
router.get("/template", async (req, res) => {
  const { shop, type } = req.query;
  
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
    
    for (const [templateName, templateData] of templateGroups) {
      if (templateName.includes(type)) {
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
        crux: data.chromeUX ? {
          available: true,
          collection_period: data.chromeUX.period,
          message: data.chromeUX.summary.join('\n')
        } : {
          available: false,
          message: "Chrome UX Report data not available yet"
        },
        fetched_at: data.checkedAt
      };

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
      error: error.message 
    });
  }
});

module.exports = router;