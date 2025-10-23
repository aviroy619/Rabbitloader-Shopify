// routes/shopifyCrawler.js
// Crawls Shopify store and syncs pages to rl-core

const express = require('express');
const router = express.Router();
const axios = require('axios');
const ShopModel = require('../models/Shop');
const { shopifyRequest, shopifyGraphQL } = require('../utils/shopifyApi');

const RL_CORE_URL = process.env.RL_CORE_URL || 'http://localhost:4000';

// ============================================================
// POST /crawler/start - Start full site crawl
// ============================================================
router.post('/start', async (req, res) => {
  const { shop } = req.query;
  
  console.log(`[Crawler] Starting crawl for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({
      ok: false,
      error: 'Shop parameter required'
    });
  }

  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.access_token) {
      return res.status(404).json({
        ok: false,
        error: 'Shop not found or not authenticated'
      });
    }

    // Start crawl in background
    res.json({
      ok: true,
      message: 'Site crawl started',
      shop
    });

    // Run crawl asynchronously
    crawlShopifyStore(shop, shopRecord.access_token).catch(err => {
      console.error(`[Crawler] Error crawling ${shop}:`, err);
    });

  } catch (error) {
    console.error('[Crawler] Start error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ============================================================
// Main crawl function
// ============================================================
async function crawlShopifyStore(shop, accessToken) {
  console.log(`[Crawler] 🕷️  Crawling ${shop}...`);
  
  const startTime = Date.now();
  const templateGroups = {};

  try {
    // ============================================================
    // 1. Fetch Products via GraphQL (paginated)
    // ============================================================
    console.log(`[Crawler] Fetching products...`);
    
    let products = [];
    let hasNextPage = true;
    let cursor = null;
    
    while (hasNextPage) {
      const query = `
        query GetProducts($cursor: String) {
          products(first: 250, after: $cursor) {
            edges {
              cursor
              node {
                id
                handle
                title
                onlineStoreUrl
                status
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
      
      const variables = cursor ? { cursor } : {};
      const response = await shopifyGraphQLRequest(shop, accessToken, query, variables);
      
      if (!response.data?.products) break;
      
      const edges = response.data.products.edges;
      edges.forEach(edge => {
        const product = edge.node;
        if (product.status === 'ACTIVE' && product.onlineStoreUrl) {
          products.push({
            id: product.id,
            handle: product.handle,
            title: product.title,
            url: `/products/${product.handle}`,
            full_url: product.onlineStoreUrl
          });
        }
      });
      
      hasNextPage = response.data.products.pageInfo.hasNextPage;
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      
      console.log(`[Crawler] Fetched ${products.length} products so far...`);
    }
    
    console.log(`[Crawler] ✅ Total products: ${products.length}`);
    
    // Group products by template
    templateGroups['product'] = {
      count: products.length,
      sample_page: products.length > 0 ? products[0].url : null,
      pages: products.map(p => ({
        id: p.id,
        url: p.url,
        title: p.title,
        handle: p.handle,
        critical_css_enabled: true,
        js_defer_rules: []
      }))
    };

    // ============================================================
    // 2. Fetch Collections via GraphQL (paginated)
    // ============================================================
    console.log(`[Crawler] Fetching collections...`);
    
    let collections = [];
    hasNextPage = true;
    cursor = null;
    
    while (hasNextPage) {
      const query = `
        query GetCollections($cursor: String) {
          collections(first: 250, after: $cursor) {
            edges {
              cursor
              node {
                id
                handle
                title
                onlineStoreUrl
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
      
      const variables = cursor ? { cursor } : {};
      const response = await shopifyGraphQLRequest(shop, accessToken, query, variables);
      
      if (!response.data?.collections) break;
      
      const edges = response.data.collections.edges;
      edges.forEach(edge => {
        const collection = edge.node;
        if (collection.onlineStoreUrl) {
          collections.push({
            id: collection.id,
            handle: collection.handle,
            title: collection.title,
            url: `/collections/${collection.handle}`,
            full_url: collection.onlineStoreUrl
          });
        }
      });
      
      hasNextPage = response.data.collections.pageInfo.hasNextPage;
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      
      console.log(`[Crawler] Fetched ${collections.length} collections so far...`);
    }
    
    console.log(`[Crawler] ✅ Total collections: ${collections.length}`);
    
    // Group collections by template
    if (collections.length > 0) {
      templateGroups['collection'] = {
        count: collections.length,
        sample_page: collections[0].url,
        pages: collections.map(c => ({
          id: c.id,
          url: c.url,
          title: c.title,
          handle: c.handle,
          critical_css_enabled: true,
          js_defer_rules: []
        }))
      };
    }

    // ============================================================
    // 3. Fetch Pages via REST API
    // ============================================================
    console.log(`[Crawler] Fetching pages...`);
    
    const pagesResponse = await shopifyRESTRequest(shop, accessToken, 'pages.json?limit=250');
    
    const pages = [];
    if (pagesResponse.pages) {
      pagesResponse.pages.forEach(page => {
        pages.push({
          id: `page_${page.id}`,
          handle: page.handle,
          title: page.title,
          url: `/pages/${page.handle}`,
          full_url: `https://${shop}/pages/${page.handle}`
        });
      });
    }
    
    console.log(`[Crawler] ✅ Total pages: ${pages.length}`);
    
    if (pages.length > 0) {
      templateGroups['page'] = {
        count: pages.length,
        sample_page: pages[0].url,
        pages: pages.map(p => ({
          id: p.id,
          url: p.url,
          title: p.title,
          handle: p.handle,
          critical_css_enabled: true,
          js_defer_rules: []
        }))
      };
    }

    // ============================================================
    // 4. Add Homepage
    // ============================================================
    templateGroups['index'] = {
      count: 1,
      sample_page: '/',
      pages: [{
        id: 'homepage',
        url: '/',
        title: 'Home',
        handle: 'index',
        critical_css_enabled: true,
        js_defer_rules: []
      }]
    };

    // ============================================================
    // 5. Get Active Theme
    // ============================================================
    let activeThemeName = 'Unknown';
    try {
      const themesData = await shopifyRESTRequest(shop, accessToken, 'themes.json');
      const activeTheme = themesData.themes?.find(t => t.role === 'main');
      if (activeTheme) {
        activeThemeName = activeTheme.name;
      }
    } catch (err) {
      console.warn(`[Crawler] Could not fetch theme: ${err.message}`);
    }

    // ============================================================
    // 6. Calculate totals
    // ============================================================
    const totalPages = Object.values(templateGroups).reduce((sum, group) => sum + group.count, 0);
    
    const crawlTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[Crawler] ✅ Crawl complete in ${crawlTime}s`);
    console.log(`[Crawler] Total: ${totalPages} pages across ${Object.keys(templateGroups).length} templates`);

    // ============================================================
    // 7. Send to RL Core
    // ============================================================
    console.log(`[Crawler] Sending data to RL Core...`);
    
    const siteData = {
      template_groups: templateGroups,
      total_pages: totalPages,
      active_theme: activeThemeName
    };

   const shopRecord = await ShopModel.findOne({ shop });

const rlCoreResponse = await axios.post(
  `${RL_CORE_URL}/site-analysis/analyze`,
  { site_data: siteData },
  {
    headers: {
      'Content-Type': 'application/json',
      'X-Shop': shop,
      'X-Platform': 'shopify',
      'X-API-Key': shopRecord.api_token || shopRecord.rl_api_token
    },
    timeout: 30000
  }
);

    if (rlCoreResponse.data.ok) {
      console.log(`[Crawler] ✅ Data sent to RL Core successfully`);
      
      // Update local shop record
      await ShopModel.updateOne(
        { shop },
        {
          $set: {
            setup_in_progress: false,
            last_crawl_at: new Date(),
            last_crawl_pages: totalPages
          },
          $push: {
            history: {
              event: 'site_crawl_completed',
              timestamp: new Date(),
              details: {
                total_pages: totalPages,
                templates: Object.keys(templateGroups).length,
                duration_seconds: parseFloat(crawlTime)
              }
            }
          }
        }
      );
    } else {
      throw new Error('RL Core rejected site data');
    }

    console.log(`[Crawler] 🎉 All done for ${shop}!`);

  } catch (error) {
    console.error(`[Crawler] ❌ Crawl failed for ${shop}:`, error.message);
    
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          setup_in_progress: false,
          setup_failed: true
        },
        $push: {
          history: {
            event: 'site_crawl_failed',
            timestamp: new Date(),
            details: { error: error.message }
          }
        }
      }
    );
    
    throw error;
  }
}

// ============================================================
// Helper: Shopify GraphQL Request
// ============================================================
async function shopifyGraphQLRequest(shop, accessToken, query, variables = {}) {
  const response = await axios.post(
    `https://${shop}/admin/api/2024-01/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  );
  
  return response.data;
}

// ============================================================
// Helper: Shopify REST Request
// ============================================================
async function shopifyRESTRequest(shop, accessToken, endpoint) {
  const response = await axios.get(
    `https://${shop}/admin/api/2024-01/${endpoint}`,
    {
      headers: {
        'X-Shopify-Access-Token': accessToken
      },
      timeout: 30000
    }
  );
  
  return response.data;
}

// ============================================================
// GET /crawler/status - Check crawl status
// ============================================================
router.get('/status', async (req, res) => {
  const { shop } = req.query;
  
  try {
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord) {
      return res.status(404).json({
        ok: false,
        error: 'Shop not found'
      });
    }

    res.json({
      ok: true,
      shop,
      last_crawl_at: shopRecord.last_crawl_at,
      last_crawl_pages: shopRecord.last_crawl_pages,
      setup_in_progress: shopRecord.setup_in_progress,
      setup_failed: shopRecord.setup_failed
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

module.exports = router;