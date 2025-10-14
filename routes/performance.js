const express = require('express');
const router = express.Router();
const microserviceClient = require('../services/microserviceClient');
const ShopModel = require('../models/Shop');

// Get homepage performance (PSI + CrUX)
router.get('/api/performance/homepage', async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ ok: false, error: 'Shop parameter required' });
  }

  try {
    console.log(`[Performance] Getting homepage data for: ${shop}`);

    // Get shop record from MongoDB
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.status(404).json({ ok: false, error: 'Shop not found' });
    }

    if (!shopRecord.short_id) {
      return res.status(400).json({ ok: false, error: 'Shop not connected to RabbitLoader' });
    }

    // Call microservice
    const data = await microserviceClient.analyzePerformance(
      shopRecord.short_id,
      `https://${shop}`,
      'homepage'
    );

    console.log(`[Performance] Homepage data received for: ${shop}`);
    res.json(data);

  } catch (error) {
    console.error('[Performance] Homepage error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || 'Failed to fetch performance data'
    });
  }
});

// Get template performance (product, collection, blog)
router.get('/api/performance/template', async (req, res) => {
  const { shop, type } = req.query;

  if (!shop || !type) {
    return res.status(400).json({ ok: false, error: 'Shop and type parameters required' });
  }

  try {
    console.log(`[Performance] Getting ${type} data for: ${shop}`);

    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ ok: false, error: 'Shop not connected to RabbitLoader' });
    }

    // Get sample URL based on template type
    const sampleUrl = getSampleUrlForTemplate(shop, type);

    // Call microservice
    const data = await microserviceClient.analyzePerformance(
      shopRecord.short_id,
      sampleUrl,
      type
    );

    console.log(`[Performance] ${type} data received for: ${shop}`);
    res.json(data);

  } catch (error) {
    console.error(`[Performance] ${type} error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || 'Failed to fetch performance data'
    });
  }
});

// Get script analysis for specific page
router.get('/api/scripts/analyze', async (req, res) => {
  const { shop, url } = req.query;

  if (!shop || !url) {
    return res.status(400).json({ ok: false, error: 'Shop and URL parameters required' });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ ok: false, error: 'Shop not connected' });
    }

    const data = await microserviceClient.getDeferConfig(
      shopRecord.short_id,
      url
    );

    res.json(data);

  } catch (error) {
    console.error('[Scripts] Analyze error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Update defer configuration
router.post('/api/defer/update', async (req, res) => {
  const { shop, script_url, action, scope, page_url } = req.body;

  if (!shop || !script_url || !action || !scope) {
    return res.status(400).json({ ok: false, error: 'Missing required parameters' });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ ok: false, error: 'Shop not connected' });
    }

    const data = await microserviceClient.updateDeferConfig(
      shopRecord.short_id,
      script_url,
      action,
      scope,
      page_url
    );

    res.json(data);

  } catch (error) {
    console.error('[Defer] Update error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get CSS status
router.get('/api/css/status', async (req, res) => {
  const { shop, url } = req.query;

  if (!shop || !url) {
    return res.status(400).json({ ok: false, error: 'Shop and URL parameters required' });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ ok: false, error: 'Shop not connected' });
    }

    const data = await microserviceClient.getCSSConfig(
      shopRecord.short_id,
      url
    );

    res.json(data);

  } catch (error) {
    console.error('[CSS] Status error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Toggle Critical CSS
router.post('/api/css/toggle', async (req, res) => {
  const { shop, action, scope, page_url, reason } = req.body;

  if (!shop || !action || !scope) {
    return res.status(400).json({ ok: false, error: 'Missing required parameters' });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ ok: false, error: 'Shop not connected' });
    }

    const data = await microserviceClient.toggleCSS(
      shopRecord.short_id,
      action,
      scope,
      page_url,
      reason
    );

    res.json(data);

  } catch (error) {
    console.error('[CSS] Toggle error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get active optimizations
router.get('/api/optimizations/active', async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ ok: false, error: 'Shop parameter required' });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ ok: false, error: 'Shop not connected' });
    }

    const data = await microserviceClient.getActiveOptimizations(
      shopRecord.short_id
    );

    res.json(data);

  } catch (error) {
    console.error('[Optimizations] Active error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Helper function to get sample URL for template type
function getSampleUrlForTemplate(shop, type) {
  const baseUrl = `https://${shop}`;
  
  switch (type) {
    case 'product':
      return `${baseUrl}/products/sample-product`;
    case 'collection':
      return `${baseUrl}/collections/all`;
    case 'blog':
      return `${baseUrl}/blogs/news`;
    case 'page':
      return `${baseUrl}/pages/about`;
    default:
      return baseUrl;
  }
}

module.exports = router;