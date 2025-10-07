const compression = require("compression");
require("dotenv").config();

// Environment validation
const requiredEnvVars = [
  'SHOPIFY_API_KEY', 
  'SHOPIFY_API_SECRET',
  'APP_URL', 
  'MONGO_URI',
  'SESSION_SECRET'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    console.error(`Please add ${envVar} to your .env file`);
    process.exit(1);
  }
});

console.log(`Environment validation passed`);
const dbName = (process.env.MONGO_URI.match(/\/([^/?]+)(\?|$)/) || [])[1] || 'unknown';
console.log(`MongoDB URI configured for: ${dbName} database`);

const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const path = require("path");
const ShopModel = require("./models/Shop");

// Import enhanced PSI analyzer
const { analyzeSinglePage: analyzePageWithPSI } = require('./utils/psiAnalyzer');

// Initialize express
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;

// ====== Middleware ======
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ====== Session Support for OAuth ======
const session = require('express-session');
const MongoStore = require('connect-mongo');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    touchAfter: 24 * 3600, // 24 hours
    dbName: 'RLPlatforms'
  }),
  cookie: { 
    secure: true, // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ====== Security: Enhanced CSP for Shopify Embedding ======
app.use((req, res, next) => {
  const { embedded } = req.query;
  
  if (embedded === '1') {
    // Embedded app - more restrictive CSP
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.shopify.com https://shopify.rb8.in; " +
      "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
      "connect-src 'self' https://shopify.rb8.in https://*.myshopify.com https://rabbitloader.com https://apiv2.rabbitloader.com; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' https: data:;"
    );
    
    // Allow embedding in Shopify admin
    res.removeHeader("X-Frame-Options");
    
    console.log(`Setting embedded app CSP headers for ${req.path}`);
  } else {
    // Standalone app - standard CSP
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.shopify.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' https://rabbitloader.com https://apiv2.rabbitloader.com;"
    );
    
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  
  next();
});

// ====== MongoDB Connection ======
mongoose.connect(process.env.MONGO_URI);

mongoose.connection.on("connected", () => {
  console.log("MongoDB connected");
});
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

// ====== Static Files ======
app.use(express.static(path.join(__dirname, "public")));

// ====== Route Imports ======
const shopifyRoutes = require("./routes/shopify");
const deferConfigRoutes = require("./routes/deferConfig");
const shopifyConnectRoutes = require("./routes/shopifyConnect");

// ====== Public Routes (BEFORE auth middleware) ======
// These need to be mounted before the auth middleware to avoid shop parameter requirements

// ====== API Routes for Lighthouse Integration ======

// API Route for Environment Variables
app.get("/api/env", (req, res) => {
  res.json({
    ok: true,
    env: {
      APP_URL: process.env.APP_URL,
      SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01",
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY
    }
  });
});

// NEW: API Route for Lighthouse-generated configurations
app.post("/api/lighthouse-config", async (req, res) => {
  try {
    const { shop, config } = req.body;
    
    if (!shop) {
      return res.status(400).json({ 
        error: "shop parameter required",
        ok: false 
      });
    }

    // Validate shop format
    if (!shop.includes('.myshopify.com')) {
      return res.status(400).json({ 
        error: "Invalid shop format",
        ok: false 
      });
    }

    // Validate configuration structure
    if (!config || !config.rules || !Array.isArray(config.rules)) {
      return res.status(400).json({ 
        error: "Invalid configuration format - missing rules array",
        ok: false 
      });
    }

    // Save Lighthouse-generated configuration
    const updatedShop = await ShopModel.findOneAndUpdate(
      { shop },
      { 
        $set: { 
          deferConfig: {
            ...config,
            source: "lighthouse",
            updated_at: new Date(),
            version: "1.0.0"
          }
        } 
      },
      { upsert: true, new: true }
    );

    console.log(`Lighthouse config saved for ${shop}:`, {
      rules: config.rules.length,
      enabled: config.enabled,
      source: "lighthouse"
    });

    res.json({
      ...config,
      ok: true,
      message: "Lighthouse configuration saved successfully",
      shop: shop,
      source: "lighthouse"
    });

  } catch (error) {
    console.error('Error saving lighthouse config:', error);
    res.status(500).json({ 
      error: "Internal server error",
      ok: false 
    });
  }
});

// NEW: API Route to trigger Lighthouse analysis
app.post("/api/analyze-performance", async (req, res) => {
  try {
    const { shop, url } = req.body;
    
    if (!shop || !url) {
      return res.status(400).json({ 
        error: "shop and url parameters required",
        ok: false 
      });
    }

    // This would integrate with your Lighthouse API service
    // For now, return a placeholder response
    res.json({
      ok: true,
      message: "Performance analysis queued",
      shop: shop,
      url: url,
      analysis_id: `analysis_${Date.now()}`,
      status: "pending"
    });

    // TODO: Implement actual Lighthouse API integration here
    console.log(`Performance analysis requested for ${shop}: ${url}`);

  } catch (error) {
    console.error('Error triggering performance analysis:', error);
    res.status(500).json({ 
      error: "Failed to trigger analysis",
      ok: false 
    });
  }
});

// API Route for shop status check
app.get("/api/status", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required in x-shop header or query" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.json({
        ok: true,
        connected: false,
        shop: shop
      });
    }

    res.json({
      ok: true,
      connected: !!shopData.short_id,
      did: shopData.short_id,
      script_injected: shopData.script_injected || false,
      shop: shop,
      connected_at: shopData.connected_at
    });

  } catch (error) {
    console.error('Error checking shop status:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// ====== Additional Shopify API Proxy Routes ======

// Debug shop - check if app has token saved
app.get("/shopify/debug-shop", async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.json({
        ok: false,
        found: false,
        shop: shop,
        message: "Shop not found in database"
      });
    }

    res.json({
      ok: true,
      found: true,
      shop: shop,
      has_access_token: !!shopData.access_token,
      connected_at: shopData.connected_at,
      script_injected: shopData.script_injected,
      access_token_preview: shopData.access_token ? `${shopData.access_token.substring(0, 15)}...` : null
    });

  } catch (error) {
    console.error('Error in debug-shop:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// List themes
app.get("/api/themes", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/2025-01/themes.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      themes: response.data.themes
    });

  } catch (error) {
    console.error('Error fetching themes:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch themes" 
    });
  }
});

// List products
app.get("/api/products", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/2025-01/products.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      products: response.data.products
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch products" 
    });
  }
});

// List script tags
app.get("/api/script-tags", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/2025-01/script_tags.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      script_tags: response.data.script_tags
    });

  } catch (error) {
    console.error('Error fetching script tags:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch script tags" 
    });
  }
});

// Add script tag
app.post("/api/script-tags", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    const { src, event = "onload" } = req.body;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    if (!src) {
      return res.status(400).json({ 
        ok: false, 
        error: "Script src parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.post(`https://${shop}/admin/api/2025-01/script_tags.json`, {
      script_tag: {
        event: event,
        src: src
      }
    }, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      ok: true,
      script_tag: response.data.script_tag,
      message: "Script tag added successfully"
    });

  } catch (error) {
    console.error('Error adding script tag:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to add script tag" 
    });
  }
});

// List pages
app.get("/api/pages", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const response = await axios.get(`https://${shop}/admin/api/2025-01/pages.json`, {
      headers: {
        'X-Shopify-Access-Token': shopData.access_token
      }
    });

    res.json({
      ok: true,
      pages: response.data.pages
    });

  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.response?.data?.errors || "Failed to fetch pages" 
    });
  }
});

// Replace the existing /api/site-analysis route with this improved version
app.get("/api/site-analysis", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData || !shopData.access_token) {
      return res.status(401).json({
        ok: false,
        error: "Shop not authenticated"
      });
    }

    const headers = { 'X-Shopify-Access-Token': shopData.access_token };
    const allPages = [];
    const templateCategories = {};

    // 1. Get Pages and Themes (we know these work)
    const [pagesResponse, themesResponse] = await Promise.all([
      axios.get(`https://${shop}/admin/api/2025-01/pages.json`, { headers }),
      axios.get(`https://${shop}/admin/api/2025-01/themes.json`, { headers })
    ]);

    const activeTheme = themesResponse.data.themes.find(theme => theme.role === 'main');

    // Process pages
    pagesResponse.data.pages.forEach(page => {
      const template = page.template_suffix || 'page';
      const pageData = {
        id: `page_${page.id}`,
        title: page.title,
        handle: page.handle,
        url: `/${page.handle}`,
        type: 'content_page',
        template: template
      };
      allPages.push(pageData);
      addToCategory(templateCategories, template, pageData);
    });

    // 2. Try to get Products (handle failure gracefully)
    try {
      const productsResponse = await axios.get(`https://${shop}/admin/api/2025-01/products.json?limit=50`, { headers });
      
      productsResponse.data.products.forEach(product => {
        const template = product.template_suffix || 'product';
        const pageData = {
          id: `product_${product.id}`,
          title: product.title,
          handle: product.handle,
          url: `/products/${product.handle}`,
          type: 'product_page',
          template: template
        };
        allPages.push(pageData);
        addToCategory(templateCategories, template, pageData);
      });
    } catch (error) {
      console.log('Products API failed:', error.response?.status);
    }

    // 3. Try to get Collections (handle failure gracefully)  
    try {
      const collectionsResponse = await axios.get(`https://${shop}/admin/api/2025-01/collections.json`, { headers });
      
      collectionsResponse.data.collections.forEach(collection => {
        if (collection.handle === 'frontpage') return;
        
        const template = collection.template_suffix || 'collection';
        const pageData = {
          id: `collection_${collection.id}`,
          title: collection.title,
          handle: collection.handle,
          url: `/collections/${collection.handle}`,
          type: 'collection_page',
          template: template
        };
        allPages.push(pageData);
        addToCategory(templateCategories, template, pageData);
      });
    } catch (error) {
      console.log('Collections API failed:', error.response?.status);
    }

    // Generate statistics
    const stats = {
      total_pages: allPages.length,
      by_type: {},
      by_template: {},
      template_count: Object.keys(templateCategories).length
    };

    allPages.forEach(page => {
      stats.by_type[page.type] = (stats.by_type[page.type] || 0) + 1;
    });

    Object.keys(templateCategories).forEach(template => {
      stats.by_template[template] = templateCategories[template].length;
    });

    // === ADD STEP 2 CODE HERE ===
    // Save site structure to database
    const templateGroups = new Map();

    Object.keys(templateCategories).forEach(template => {
      templateGroups.set(template, {
        count: templateCategories[template].length,
        pages: templateCategories[template],
        sample_page: templateCategories[template][0]?.url, // First page as sample
        psi_analyzed: false,
        js_files: [],
        defer_recommendations: [],
        user_defer_config: []
      });
    });

    // Save to database
    await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          'site_structure.last_analyzed': new Date(),
          'site_structure.active_theme': activeTheme ? activeTheme.name : 'Unknown',
          'site_structure.template_groups': templateGroups
        }
      },
      { upsert: true }
    );

    console.log(`Site structure saved for ${shop} - ${Object.keys(templateCategories).length} template groups found`);
    // === END STEP 2 CODE ===

    res.json({
      ok: true,
      shop: shop,
      active_theme: activeTheme ? activeTheme.name : 'Unknown',
      statistics: stats,
      templates: {
        categories: templateCategories,
        summary: stats.by_template
      },
      all_pages: allPages
    });

  } catch (error) {
    console.error('Error analyzing complete site:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to analyze site"
    });
  }
});

// ====== Enhanced PSI Analysis Section ======

// Simple in-memory queue for PSI analysis
const psiAnalysisQueue = [];
let isProcessingPSI = false;

// PSI Analysis Queue Processor - Updated to use new analyzer
async function processPSIQueue() {
  if (isProcessingPSI || psiAnalysisQueue.length === 0) return;
  
  isProcessingPSI = true;
  console.log(`Processing PSI queue - ${psiAnalysisQueue.length} items remaining`);
  
  while (psiAnalysisQueue.length > 0) {
    const task = psiAnalysisQueue.shift();
    try {
      console.log(`Analyzing ${task.url} for shop ${task.shop}`);
      
      // Use the new enhanced analyzer
      const analysisResult = await analyzePageWithPSI(task);
      
      // Save comprehensive results to database
      await saveAnalysisResults(analysisResult);
      
      // Wait 2 seconds between requests to respect API limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`PSI analysis failed for ${task.url}:`, error.message);
      
      // Mark as failed in database
      await markAnalysisAsFailed(task, error.message);
    }
  }
  
  isProcessingPSI = false;
}

// Save analysis results to database AND apply defer rules
async function saveAnalysisResults(analysisResult) {
  const { shop, template, jsAnalysis, deferRecommendations, psiRawData, analysisSummary } = analysisResult;
  
  await ShopModel.findOneAndUpdate(
    { shop },
    {
      $set: {
        [`site_structure.template_groups.${template}.psi_analyzed`]: true,
        [`site_structure.template_groups.${template}.js_files`]: jsAnalysis.allFiles.map(f => f.url),
        [`site_structure.template_groups.${template}.js_analysis`]: {
          total_files: jsAnalysis.totalFiles,
          categories: Object.keys(jsAnalysis.categories).reduce((acc, cat) => {
            acc[cat] = jsAnalysis.categories[cat].length;
            return acc;
          }, {}),
          category_details: jsAnalysis.categories,
          render_blocking: jsAnalysis.renderBlocking,
          unused_js: jsAnalysis.unusedJs.map(u => ({
            url: u.url,
            wastedPercent: u.wastedPercent,
            wastedKB: u.wastedKB,
            category: u.category,
            deferPriority: u.deferPriority
          })),
          total_waste_kb: jsAnalysis.totalWasteKB
        },
        [`site_structure.template_groups.${template}.defer_recommendations`]: deferRecommendations,
        [`site_structure.template_groups.${template}.last_psi_analysis`]: new Date(),
        [`site_structure.template_groups.${template}.analysis_summary`]: analysisSummary,
        // Store compressed PSI data (optional - only key metrics)
        [`site_structure.template_groups.${template}.psi_metrics`]: {
          performance_score: psiRawData?.audits?.['performance']?.score * 100 || 0,
          lcp_time: psiRawData?.audits?.['largest-contentful-paint']?.numericValue || 0,
          fid_time: psiRawData?.audits?.['first-input-delay']?.numericValue || 0,
          cls_score: psiRawData?.audits?.['cumulative-layout-shift']?.numericValue || 0,
          created_at: new Date(),
          url_analyzed: analysisResult.url
        }
      }
    }
  );
  
  console.log(`Enhanced PSI analysis saved for ${shop} template ${template}:`, {
    jsFiles: jsAnalysis.totalFiles,
    deferRecommendations: deferRecommendations.length,
    totalWasteKB: jsAnalysis.totalWasteKB,
    categories: Object.keys(jsAnalysis.categories).filter(cat => jsAnalysis.categories[cat].length > 0)
  });
  
  // NEW: Auto-apply defer rules to pages
  await applyTemplateRulesToPages(shop, template, deferRecommendations);
}

// NEW FUNCTION: Apply template rules to pages
async function applyTemplateRulesToPages(shop, template, deferRecommendations) {
  try {
    // Filter for high/medium priority recommendations only
    const rules = deferRecommendations
      .filter(rec => rec.priority === 'high' || rec.priority === 'medium')
      .map((rec, idx) => {
        // Escape regex special characters in the file URL
        const escapedUrl = rec.file
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // FIXED: Correct escape pattern
          .replace(/https?:\/\/[^\/]+/, '.*'); // Make domain flexible
        
        return {
          id: `${template}-rule-${idx}`,
          src_regex: escapedUrl,
          action: 'defer',
          priority: rec.priority === 'high' ? 8 : 5,
          enabled: true,
          conditions: {
            page_types: [template]
          },
          generated_from: {
            template: template,
            original_file: rec.file,
            reason: rec.reason,
            confidence: rec.confidence
          }
        };
      });
    
    if (rules.length === 0) {
      console.log(`No rules to apply for template ${template}`);
      return;
    }

    // Get existing defer config or create new one
    const shopData = await ShopModel.findOne({ shop });
    const existingRules = shopData?.deferConfig?.rules || [];
    
    // Remove old rules for this template to avoid duplicates
    const filteredRules = existingRules.filter(rule => 
      !rule.id?.startsWith(`${template}-rule-`)
    );
    
    // Add new rules
    const updatedRules = [...filteredRules, ...rules];
    
    // Update defer config in database
    await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          'deferConfig.rules': updatedRules,
          'deferConfig.enabled': true,
          'deferConfig.updated_at': new Date(),
          'deferConfig.source': 'auto',
          'deferConfig.release_after_ms': 2000
        }
      },
      { upsert: true }
    );
    
    console.log(`Applied ${rules.length} defer rules for template ${template} on shop ${shop}`);
    
  } catch (error) {
    console.error(`Error applying template rules for ${template}:`, error);
    throw error;
  }
}

// Mark analysis as failed
async function markAnalysisAsFailed(task, errorMessage) {
  const { shop, template } = task;
  
  await ShopModel.findOneAndUpdate(
    { shop },
    {
      $set: {
        [`site_structure.template_groups.${template}.psi_analyzed`]: false,
        [`site_structure.template_groups.${template}.psi_error`]: {
          message: errorMessage,
          timestamp: new Date(),
          url_attempted: task.url
        }
      }
    }
  );
}

// API Route: Start PSI Analysis - Updated
app.post("/api/start-psi-analysis", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }
    
    if (!process.env.PAGESPEED_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "PageSpeed Insights API key not configured"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(400).json({
        ok: false,
        error: "Run site analysis first"
      });
    }

    // Queue PSI analysis for each template's sample page
    const queuedPages = [];
    const templateGroups = shopData.site_structure.template_groups;
    
    // Convert Map to regular object if needed
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    // Always prioritize home page
    let homePageAdded = false;
    
    templates.forEach(([template, group]) => {
      if (group.sample_page && !group.psi_analyzed) {
        const isHomePage = group.sample_page === '/' || template.includes('index') || template.includes('home');
        
        const task = {
          shop: shop,
          template: template,
          url: group.sample_page,
          page_count: group.count,
          priority: isHomePage ? 10 : 1
        };
        
        if (isHomePage && !homePageAdded) {
          queuedPages.unshift(task); // Add to front
          homePageAdded = true;
        } else {
          queuedPages.push(task);
        }
      }
    });

    // Add to processing queue
    psiAnalysisQueue.push(...queuedPages);
    
    // Start processing if not already running
    setTimeout(() => processPSIQueue(), 100);

    res.json({
      ok: true,
      message: `Enhanced PSI analysis queued for ${queuedPages.length} template types`,
      templates_to_analyze: queuedPages.map(p => p.template),
      queue_position: psiAnalysisQueue.length,
      estimated_time_minutes: Math.ceil(queuedPages.length * 3),
      home_page_prioritized: homePageAdded,
      features: [
        'Comprehensive JavaScript extraction',
        'Shopify-specific categorization',
        'Waste percentage analysis',
        'Intelligent defer recommendations',
        'Auto-apply defer rules to pages'
      ]
    });

  } catch (error) {
    console.error('Error starting enhanced PSI analysis:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to start PSI analysis",
      details: error.message 
    });
  }
});

// API Route: Check PSI Analysis Status - Enhanced
app.get("/api/psi-status", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.json({
        ok: true,
        analyzed: false,
        message: "No site structure found"
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    let totalTemplates = 0;
    let analyzedTemplates = 0;
    let totalJSFiles = 0;
    let totalWasteKB = 0;
    const templateStatus = {};
    
    templates.forEach(([template, group]) => {
      if (group.sample_page) {
        totalTemplates++;
        
        // Enhanced status with new analysis data
        templateStatus[template] = {
          analyzed: group.psi_analyzed || false,
          js_files_found: (group.js_files || []).length,
          recommendations_count: (group.defer_recommendations || []).length,
          last_analysis: group.last_psi_analysis,
          // New enhanced data
          js_analysis: group.js_analysis || null,
          analysis_summary: group.analysis_summary || null,
          psi_metrics: group.psi_metrics || null,
          error: group.psi_error || null
        };
        
        if (group.psi_analyzed) {
          analyzedTemplates++;
          totalJSFiles += (group.js_files || []).length;
          totalWasteKB += (group.js_analysis?.total_waste_kb || 0);
        }
      }
    });
    
    res.json({
      ok: true,
      total_templates: totalTemplates,
      analyzed_templates: analyzedTemplates,
      progress_percent: totalTemplates > 0 ? Math.round((analyzedTemplates / totalTemplates) * 100) : 0,
      queue_remaining: psiAnalysisQueue.length,
      is_processing: isProcessingPSI,
      template_status: templateStatus,
      last_analyzed: shopData.site_structure.last_analyzed,
      // Enhanced summary stats
      summary_stats: {
        total_js_files: totalJSFiles,
        total_waste_kb: totalWasteKB,
        avg_js_per_template: analyzedTemplates > 0 ? Math.round(totalJSFiles / analyzedTemplates) : 0,
        avg_waste_per_template: analyzedTemplates > 0 ? Math.round(totalWasteKB / analyzedTemplates) : 0
      }
    });

  } catch (error) {
    console.error('Error checking PSI status:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to check PSI status" 
    });
  }
});

// ====== Template Defer Configuration Routes ======

// API Route: Get defer configuration for a specific template
app.get("/api/defer-config/:template", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    const { template } = req.params;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(404).json({
        ok: false,
        error: "No site structure found. Run site analysis first."
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templateData = templateGroups instanceof Map ? 
      templateGroups.get(template) : 
      templateGroups[template];
    
    if (!templateData) {
      return res.status(404).json({
        ok: false,
        error: `Template '${template}' not found`
      });
    }

    res.json({
      ok: true,
      template: template,
      page_count: templateData.count || 0,
      sample_page: templateData.sample_page,
      psi_analyzed: templateData.psi_analyzed || false,
      js_files: templateData.js_files || [],
      auto_recommendations: templateData.defer_recommendations || [],
      user_config: templateData.user_defer_config || [],
      last_analysis: templateData.last_psi_analysis,
      analysis_status: templateData.psi_analyzed ? 'completed' : 'pending',
      // Enhanced data
      js_analysis: templateData.js_analysis || null,
      psi_metrics: templateData.psi_metrics || null
    });

  } catch (error) {
    console.error('Error fetching template defer config:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// API Route: Update user's defer preferences for a template
app.post("/api/defer-config/:template", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    const { template } = req.params;
    const { defer_settings } = req.body; // Array of {file, defer, reason}
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    if (!defer_settings || !Array.isArray(defer_settings)) {
      return res.status(400).json({ 
        ok: false, 
        error: "defer_settings must be an array" 
      });
    }

    // Validate defer_settings structure
    for (const setting of defer_settings) {
      if (!setting.file || typeof setting.defer !== 'boolean') {
        return res.status(400).json({ 
          ok: false, 
          error: "Each defer setting must have 'file' and 'defer' properties" 
        });
      }
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(404).json({
        ok: false,
        error: "No site structure found. Run site analysis first."
      });
    }

    // Update user defer configuration for the specific template
    await ShopModel.findOneAndUpdate(
      { shop },
      {
        $set: {
          [`site_structure.template_groups.${template}.user_defer_config`]: defer_settings,
          [`site_structure.template_groups.${template}.user_config_updated`]: new Date()
        }
      }
    );

    console.log(`Defer settings updated for ${shop} template ${template}:`, {
      settings_count: defer_settings.length,
      deferred_files: defer_settings.filter(s => s.defer).length
    });
    
    res.json({ 
      ok: true, 
      message: "Defer settings updated successfully",
      template: template,
      settings_applied: defer_settings.length,
      deferred_count: defer_settings.filter(s => s.defer).length
    });

  } catch (error) {
    console.error('Error updating template defer config:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// API Route: Get all templates and their defer status (overview)
app.get("/api/defer-overview", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.json({
        ok: true,
        templates: [],
        message: "No site structure found. Run site analysis first."
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    const overview = templates.map(([template, group]) => ({
      template: template,
      page_count: group.count || 0,
      sample_page: group.sample_page,
      psi_analyzed: group.psi_analyzed || false,
      js_files_count: (group.js_files || []).length,
      auto_recommendations_count: (group.defer_recommendations || []).length,
      user_config_count: (group.user_defer_config || []).length,
      user_deferred_count: (group.user_defer_config || []).filter(c => c.defer).length,
      last_analysis: group.last_psi_analysis,
      has_user_config: (group.user_defer_config || []).length > 0,
      // Enhanced data
      total_waste_kb: group.js_analysis?.total_waste_kb || 0,
      performance_score: group.psi_metrics?.performance_score || 0
    }));

    res.json({
      ok: true,
      shop: shop,
      total_templates: templates.length,
      analyzed_templates: overview.filter(t => t.psi_analyzed).length,
      configured_templates: overview.filter(t => t.has_user_config).length,
      templates: overview,
      last_site_analysis: shopData.site_structure.last_analyzed
    });

  } catch (error) {
    console.error('Error fetching defer overview:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// API Route: Generate defer rules from user configurations
app.get("/api/generate-defer-rules", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.json({
        ok: true,
        rules: [],
        message: "No site structure found."
      });
    }

    const templateGroups = shopData.site_structure.template_groups;
    const templates = templateGroups instanceof Map ? 
      Array.from(templateGroups.entries()) : 
      Object.entries(templateGroups);
    
    const generatedRules = [];
    let ruleId = 1;

    templates.forEach(([template, group]) => {
      if (group.user_defer_config && group.user_defer_config.length > 0) {
        group.user_defer_config.forEach(config => {
          if (config.defer) {
            // Generate regex pattern from file URL - FIXED
            const urlPattern = config.file
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // FIXED: Correct escape pattern
              .replace(/https?:\/\/[^\/]+/, '.*'); // Make domain flexible
            
            generatedRules.push({
              id: `auto-rule-${ruleId++}`,
              src_regex: urlPattern,
              action: 'defer',
              priority: 5,
              enabled: true,
              conditions: {
                page_types: [template]
              },
              generated_from: {
                template: template,
                original_file: config.file,
                user_reason: config.reason || 'User selected for deferring'
              }
            });
          }
        });
      }
    });

    res.json({
      ok: true,
      rules_generated: generatedRules.length,
      rules: generatedRules,
      message: `Generated ${generatedRules.length} defer rules from user configurations`
    });

  } catch (error) {
    console.error('Error generating defer rules:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});
// ====== Critical CSS Integration ======

// API Route: Trigger Critical CSS generation for all templates
app.post("/api/trigger-css-generation", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.body.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    if (!shopData?.site_structure?.template_groups) {
      return res.status(400).json({
        ok: false,
        error: "Run site analysis first"
      });
    }

    // Call Critical CSS microservice
    const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://localhost:3010';
    
    console.log(`Triggering Critical CSS generation for ${shop}`);
    
    const response = await axios.post(
      `${criticalCssServiceUrl}/api/shopify/generate-all-css`,
      { shop },
      {
        timeout: 300000 // 5 minute timeout
      }
    );

    if (!response.data.ok) {
      throw new Error(response.data.error || 'CSS generation failed');
    }

    console.log(`Critical CSS generation completed for ${shop}:`, response.data.summary);

    res.json({
      ok: true,
      message: 'Critical CSS generation completed',
      results: response.data.results,
      summary: response.data.summary
    });

  } catch (error) {
    console.error('Error triggering CSS generation:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to trigger CSS generation"
    });
  }
});

// API Route: Get Critical CSS status for templates
app.get("/api/css-status", async (req, res) => {
  try {
    const shop = req.headers['x-shop'] || req.query.shop;
    
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Shop parameter required"
      });
    }

    const criticalCssServiceUrl = process.env.CRITICAL_CSS_SERVICE_URL || 'http://localhost:3010';
    
    const response = await axios.get(
      `${criticalCssServiceUrl}/api/shopify/${shop}/templates`
    );

    res.json(response.data);

  } catch (error) {
    console.error('Error fetching CSS status:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to fetch CSS status"
    });
  }
});

// Helper function to add pages to template categories
function addToCategory(categories, template, pageData) {
  if (!categories[template]) {
    categories[template] = [];
  }
  categories[template].push(pageData);
}

// Defer config API route
app.get("/defer-config/api", async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ 
        ok: false, 
        error: "Shop parameter required" 
      });
    }

    const shopData = await ShopModel.findOne({ shop });
    
    if (!shopData) {
      return res.json({
        ok: true,
        has_config: false,
        shop: shop,
        message: "Shop not found - no defer config"
      });
    }
    
    res.json({
      ok: true,
      has_config: !!shopData.deferConfig,
      shop: shop,
      deferConfig: shopData.deferConfig || null
    });

  } catch (error) {
    console.error('Error fetching defer config:', error);
    res.status(500).json({ 
      ok: false, 
      error: "Internal server error" 
    });
  }
});

// Defer configuration routes - these need shop parameter validation but not OAuth
app.use("/defer-config", deferConfigRoutes);

// RabbitLoader Connect Routes - FIXED: Mount on specific path to avoid conflicts
app.use("/rl", shopifyConnectRoutes);

// ====== Root Route (BEFORE auth middleware) - UPDATED FOR STATIC HTML ======
app.get("/", (req, res) => {
  const { shop, host, embedded, connected, script_injected } = req.query;
  
  console.log(`Root route accessed:`, {
    shop: shop || 'none',
    host: host ? `${host.substring(0, 20)}...` : 'none',
    embedded: embedded || 'none',
    connected: connected || 'none',
    script_injected: script_injected || 'none',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 50) + '...' : 'none',
    referer: req.headers.referer || 'none'
  });

  // For embedded apps, shop parameter is REQUIRED
  if (embedded === '1' && !shop) {
    console.log(`Embedded app request missing shop parameter`);
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Shop Parameter Required</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f6f6f7;
          }
          .error-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 500px;
            margin: 0 auto;
          }
          h1 { color: #dc3545; margin-bottom: 20px; }
          p { color: #6c757d; margin-bottom: 15px; }
          .code { 
            background: #f8f9fa; 
            padding: 8px 12px; 
            border-radius: 4px; 
            font-family: monospace; 
            color: #495057;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>Missing Shop Parameter</h1>
          <p>This embedded app requires a shop parameter to function.</p>
          <p>Expected URL format:</p>
          <p class="code">/?shop=your-shop.myshopify.com&embedded=1</p>
        </div>
      </body>
      </html>
    `);
  }

  // Serve static HTML file instead of rendering EJS template
  try {
    console.log(`Serving static HTML for shop: ${shop || 'unknown'}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) {
    console.error('Error serving static HTML:', error);
    res.status(500).send('Failed to load page');
  }
});

// ====== Embedded App Authentication Middleware ======
app.use((req, res, next) => {
  // Skip auth for public routes and static files
  const publicRoutes = [
    '/shopify/auth', 
    '/shopify/auth/callback', 
    '/',
    '/api/env',
    '/rl/rl-callback',
    '/health'
  ];
  
  const isStaticFile = req.path.startsWith('/assets/') || 
                      req.path.endsWith('.css') || 
                      req.path.endsWith('.js') || 
                      req.path.endsWith('.png') ||
                      req.path.endsWith('.jpg') ||
                      req.path.endsWith('.ico') ||
                      req.path.endsWith('.html');
  
  const isDeferConfigRoute = req.path.startsWith('/defer-config');
  const isWebhook = req.path.startsWith('/webhooks/');
  const isDebugRoute = req.path.startsWith('/debug/');
  const isRlRoute = req.path.startsWith('/rl/');
  const isApiRoute = req.path.startsWith('/api/');
  
  if (publicRoutes.includes(req.path) || isStaticFile || isDeferConfigRoute || isWebhook || isDebugRoute || isRlRoute || isApiRoute) {
    return next();
  }
  
  const shop = (req.query && req.query.shop) || (req.body && req.body.shop);
  if (!shop && req.path.startsWith('/shopify/')) {
    console.log(`Blocking shopify route ${req.path} - missing shop parameter`);
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }
  
  next();
});

// ====== Shopify Routes (AFTER auth middleware) ======
app.use("/shopify", shopifyRoutes);

// ====== Webhook Handler ======
app.post("/webhooks/app/uninstalled", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const shop = req.get('X-Shopify-Shop-Domain');
    console.log(`App uninstalled for shop: ${shop}`);
    
    if (shop) {
      await ShopModel.updateOne(
        { shop },
        { 
          $unset: { 
            access_token: "", 
            api_token: "", 
            short_id: "",
            script_injected: "",
            script_injection_attempted: ""
          },
          $set: { connected_at: null },
          $push: {
            history: {
              event: "uninstalled",
              timestamp: new Date(),
              details: { via: "webhook" }
            }
          }
        }
      );
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
});

// ====== Health Check ======
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    app: 'rl-shopify',
    version: '2.0.0',
    features: ['defer-script-only', 'auto-injection', 'static-html', 'enhanced-psi-analysis', 'auto-apply-defer-rules'],
    environment: process.env.NODE_ENV || 'development'
  });
});

// ====== Debug Route ======
app.get('/debug/headers', (req, res) => {
  res.json({
    headers: req.headers,
    query: req.query,
    path: req.path,
    method: req.method,
    embedded: req.query.embedded === '1'
  });
});

// ====== Test PSI Analysis Route ======
app.post("/api/test-psi", async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "URL parameter required"
      });
    }
    
    if (!process.env.PAGESPEED_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "PageSpeed Insights API key not configured"
      });
    }

    req.setTimeout(300000);
    res.setTimeout(300000);

    const testTask = {
      shop: 'test-shop.com',
      template: 'test',
      url: url,
      page_count: 1
    };

    console.log(`Testing PSI analysis for: ${url}`);
    
    const analysisResult = await analyzePageWithPSI(testTask);
    
    res.json({
      ok: true,
      url: analysisResult.url,
      analysis: {
        total_js_files: analysisResult.jsAnalysis.totalFiles,
        total_waste_kb: analysisResult.jsAnalysis.totalWasteKB,
        categories: Object.keys(analysisResult.jsAnalysis.categories).reduce((acc, cat) => {
          acc[cat] = analysisResult.jsAnalysis.categories[cat].length;
          return acc;
        }, {}),
        defer_recommendations: analysisResult.deferRecommendations.length,
        top_recommendations: analysisResult.deferRecommendations.slice(0, 3)
      }
    });

  } catch (error) {
    console.error('PSI test analysis failed:', error);
    res.status(500).json({ 
      ok: false, 
      error: "PSI analysis failed",
      details: error.message 
    });
  }
});

// ====== Error Handling ======
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  console.error('Request details:', {
    method: req.method,
    path: req.path,
    query: req.query,
    embedded: req.query.embedded === '1'
  });
  
  res.status(500).json({ 
    ok: false, 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ====== Enhanced 404 Handler for Embedded Apps ======
app.use((req, res) => {
  console.log(`404 - Route not found:`, {
    method: req.method,
    path: req.path,
    query: req.query,
    embedded: req.query.embedded === '1',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 50) + '...' : 'none'
  });
  
  if (req.query.embedded === '1') {
    const shop = req.query.shop;
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Page Not Found</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f6f6f7;
          }
          .error-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 500px;
            margin: 0 auto;
          }
          h1 { color: #dc3545; }
          .btn {
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            text-decoration: none;
            display: inline-block;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>404 - Page Not Found</h1>
          <p>The requested page could not be found.</p>
          <p><strong>Path:</strong> ${req.path}</p>
          <p><strong>Method:</strong> ${req.method}</p>
          ${shop ? `<a href="/?shop=${encodeURIComponent(shop)}&embedded=1" class="btn">Go to App Home</a>` : ''}
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(404).json({ 
      ok: false, 
      error: 'Route not found',
      path: req.path,
      method: req.method
    });
  }
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`RL-Shopify app running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`App URL: ${process.env.APP_URL}`);
  console.log(`Shopify API Key: ${process.env.SHOPIFY_API_KEY ? 'Set' : 'Missing'}`);
  console.log(`Features: Static HTML, Defer script only, Auto-injection enabled, Enhanced PSI Analysis, Auto-apply defer rules`);
});