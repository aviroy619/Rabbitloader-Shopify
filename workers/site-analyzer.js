const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI).then(() => {
  console.log('[Site Analyzer] ✅ Connected to MongoDB');
}).catch(err => {
  console.error('[Site Analyzer] ❌ MongoDB connection failed:', err);
  process.exit(1);
});

async function analyzeSite(shop, accessToken) {
  console.log(`[Site Analyzer] 🔍 Analyzing site structure for ${shop}`);
  
  const ShopModel = require('../models/Shop');
  
  try {
    // Fetch products
    const productsResponse = await fetch(`https://${shop}/admin/api/2025-01/products.json?limit=250`, {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });
    const productsData = await productsResponse.json();
    const products = productsData.products || [];
    
    // Fetch collections
    const collectionsResponse = await fetch(`https://${shop}/admin/api/2025-01/custom_collections.json?limit=250`, {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });
    const collectionsData = await collectionsResponse.json();
    const collections = collectionsData.custom_collections || [];
    
    // Fetch pages
    const pagesResponse = await fetch(`https://${shop}/admin/api/2025-01/pages.json?limit=250`, {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });
    const pagesData = await pagesResponse.json();
    const pages = pagesData.pages || [];
    
    // Build site structure
    const siteStructure = {
      template_groups: {
        homepage: {
          count: 1,
          sample_page: '/',
          critical_css_enabled: true,
          js_defer_rules: [],
          pages: [{
            id: 'homepage',
            url: '/',
            title: 'Homepage',
            critical_css_enabled: true,
            js_defer_rules: []
          }]
        },
        product: {
          count: products.length,
          sample_page: products[0] ? `/products/${products[0].handle}` : '/products/sample',
          critical_css_enabled: true,
          js_defer_rules: [],
          pages: products.map(p => ({
            id: `product_${p.id}`,
            url: `/products/${p.handle}`,
            title: p.title,
            critical_css_enabled: true,
            js_defer_rules: []
          }))
        },
        collection: {
          count: collections.length,
          sample_page: collections[0] ? `/collections/${collections[0].handle}` : '/collections/all',
          critical_css_enabled: true,
          js_defer_rules: [],
          pages: collections.map(c => ({
            id: `collection_${c.id}`,
            url: `/collections/${c.handle}`,
            title: c.title,
            critical_css_enabled: true,
            js_defer_rules: []
          }))
        },
        page: {
          count: pages.length,
          sample_page: pages[0] ? `/pages/${pages[0].handle}` : '/pages/about',
          critical_css_enabled: true,
          js_defer_rules: [],
          pages: pages.map(p => ({
            id: `page_${p.id}`,
            url: `/pages/${p.handle}`,
            title: p.title,
            critical_css_enabled: true,
            js_defer_rules: []
          }))
        }
      },
      analyzed_at: new Date(),
      total_pages: 1 + products.length + collections.length + pages.length
    };
    
    // Save to MongoDB
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          site_structure: siteStructure,
          site_structure_updated_at: new Date()
        }
      }
    );
    
    console.log(`[Site Analyzer] ✅ Analyzed ${siteStructure.total_pages} pages for ${shop}`);
    return siteStructure;
    
  } catch (error) {
    console.error(`[Site Analyzer] ❌ Failed to analyze ${shop}:`, error);
    throw error;
  }
}

module.exports = { analyzeSite };
