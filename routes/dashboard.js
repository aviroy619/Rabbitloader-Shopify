const express = require("express");
const router = express.Router();

// Helper function to inject defer script
async function injectDeferScript(shop, did, accessToken) {
  console.log(`[RL] Attempting auto defer script injection for ${shop} with DID: ${did}`);

  try {
    // Get active theme
    const themesResponse = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!themesResponse.ok) {
      throw new Error(`Failed to fetch themes: ${themesResponse.status}`);
    }

    const themesData = await themesResponse.json();
    const activeTheme = themesData.themes.find(theme => theme.role === 'main');
    
    if (!activeTheme) {
      throw new Error("No active theme found");
    }

    // Get theme.liquid file
    const assetResponse = await fetch(`https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json?asset[key]=layout/theme.liquid`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!assetResponse.ok) {
      throw new Error(`Failed to fetch theme.liquid: ${assetResponse.status}`);
    }

    const assetData = await assetResponse.json();
    let themeContent = assetData.asset.value;

    // Check if defer script already exists
    const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
    
    if (themeContent.includes(`defer-config/loader.js?shop=${shop}`) || 
        themeContent.includes(deferLoaderUrl) ||
        themeContent.includes('RabbitLoader Defer Configuration')) {
      console.log(`[RL] Defer script already exists in theme for ${shop}`);
      return { success: true, message: "Defer script already exists", already_exists: true };
    }

    // Find first <script> tag to inject BEFORE it
    const firstJSPattern = /(<script[^>]*>)/;
    const jsMatch = themeContent.match(firstJSPattern);
    
 const scriptTag = `  <!-- RabbitLoader Defer Configuration -->
  <script>
    // Check for ?norl parameter to disable RabbitLoader
    if (!window.location.search.includes('norl')) {
      var s = document.createElement('script');
      s.src = '${deferLoaderUrl}';
      document.head.appendChild(s);
    } else {
      console.log('RabbitLoader disabled via ?norl parameter');
    }
  </script>
`;
    
    if (jsMatch) {
      themeContent = themeContent.replace(firstJSPattern, scriptTag + '$1');
      console.log(`[RL] Injecting defer script BEFORE first JS`);
    } else {
      const headOpenTag = '<head>';
      if (!themeContent.includes(headOpenTag)) {
        throw new Error("Could not find <head> tag in theme.liquid");
      }
      themeContent = themeContent.replace(headOpenTag, `${headOpenTag}\n${scriptTag}`);
      console.log(`[RL] Injecting defer script after <head> (no JS found)`);
    }

    // Update theme file
    const updateResponse = await fetch(`https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        asset: {
          key: 'layout/theme.liquid',
          value: themeContent
        }
      })
    });

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      throw new Error(`Theme update failed: ${updateResponse.status} - ${JSON.stringify(errorData)}`);
    }

    console.log(`[RL] Defer script auto-injected successfully for ${shop}`);
    return { 
      success: true, 
      message: "Defer script injected successfully",
      deferLoaderUrl,
      themeId: activeTheme.id,
      position: jsMatch ? 'before-first-js' : 'after-head'
    };

  } catch (error) {
    console.error(`[RL] Auto-injection failed for ${shop}:`, error);
    throw error;
  }
}

// ============================================================
// ROUTE: RabbitLoader OAuth Callback
// ============================================================
router.get("/rl-callback", async (req, res) => {
  const { shop, "rl-token": rlToken } = req.query;

  console.log("[RL] Callback received:", {
    hasRlToken: !!rlToken,
    shop,
    allParams: Object.keys(req.query),
    referer: req.headers.referer
  });

  if (!rlToken || !shop) {
    console.error("[RL] Missing rl-token or shop parameter in callback");
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Callback Error</title>
        <style>body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }</style>
      </head>
      <body>
        <h2>RabbitLoader Callback Error</h2>
        <p>Missing required parameters. Please try connecting again.</p>
        <a href="/?shop=${encodeURIComponent(shop || '')}" style="color: #007bff;">Return to App</a>
      </body>
      </html>
    `);
  }

  try {
    const decoded = JSON.parse(Buffer.from(rlToken, "base64").toString("utf8"));
    console.log("[RL] Decoded token:", {
      hasDid: !!(decoded.did || decoded.short_id),
      hasApiToken: !!decoded.api_token,
      platform: decoded.platform,
      accountId: decoded.account_id
    });
    
    const ShopModel = require("../models/Shop");
    
    const updateData = {
      $set: {
        short_id: decoded.did || decoded.short_id,
        api_token: decoded.api_token,
        connected_at: new Date(),
        needs_setup: true
      },
      $push: {
        history: {
          event: "connect",
          timestamp: new Date(),
          details: { 
            via: "rl-callback",
            platform: decoded.platform || 'shopify'
          }
        }
      }
    };

    if (decoded.account_id) {
      updateData.$set.account_id = decoded.account_id;
    }

    await ShopModel.findOneAndUpdate(
      { shop },
      updateData,
      { upsert: true, new: true }
    );

    console.log(`[RL] Connection saved for shop: ${shop}`);

    const shopBase64 = Buffer.from(`${shop}/admin`).toString('base64');
    const hostParam = req.query.host || shopBase64;
    
    let redirectUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(hostParam)}&embedded=1&connected=1&trigger_setup=1`;
    
    console.log("[RL] Redirecting to dashboard with trigger_setup flag:", redirectUrl);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error("[RL] Callback processing error:", error);
    
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Error</title>
        <style>body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }</style>
      </head>
      <body>
        <h2>RabbitLoader Connection Error</h2>
        <p>Failed to process the connection. Please try again.</p>
        <p><strong>Error:</strong> ${error.message}</p>
        <a href="/?shop=${encodeURIComponent(shop || '')}" style="color: #007bff;">Return to App</a>
      </body>
      </html>
    `);
  }
});

// ============================================================
// ROUTE: Initiate RabbitLoader Connection
// ============================================================
router.get("/rl-connect", async (req, res) => {
  const { shop, host } = req.query;
  
  console.log(`[RL] Connect request for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const connectUrl = new URL('https://rabbitloader.com/account/');
    connectUrl.searchParams.set('source', 'shopify');
    connectUrl.searchParams.set('action', 'connect');
    connectUrl.searchParams.set('site_url', `https://${shop}`);
    
    const redirectUrl = new URL('/rl/rl-callback', process.env.APP_URL);
    redirectUrl.searchParams.set('shop', shop);
    if (host) {
      redirectUrl.searchParams.set('host', host);
    }
    
    connectUrl.searchParams.set('redirect_url', redirectUrl.toString());
    connectUrl.searchParams.set('cms_v', 'shopify');
    connectUrl.searchParams.set('plugin_v', '1.0.0');

    const finalUrl = connectUrl.toString();
    console.log(`[RL] Redirecting to RabbitLoader: ${finalUrl}`);

    res.redirect(finalUrl);
    
  } catch (error) {
    console.error(`[RL] ❌ Connect error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to initiate connection" 
    });
  }
});

// ============================================================
// ROUTE: Get Shop Status
// ============================================================
router.get("/status", async (req, res) => {
  const { shop } = req.query;
  
  console.log(`[RL] Status check for: ${shop}`);
  
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
      return res.json({ 
        ok: true, 
        connected: false,
        message: "Shop not found"
      });
    }
    
    res.json({
      ok: true,
      connected: !!shopRecord.api_token,
      did: shopRecord.short_id,
      script_injected: shopRecord.script_injected || false,
      critical_css_injected: shopRecord.critical_css_injected || false,
      needs_setup: shopRecord.needs_setup || false,
      setup_completed: shopRecord.setup_completed || false,
      connected_at: shopRecord.connected_at,
      site_structure: shopRecord.site_structure || null
    });
    
  } catch (error) {
    console.error(`[RL] Status check error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Get Dashboard Data
// ============================================================
router.get("/dashboard-data", async (req, res) => {
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

    res.json({
      ok: true,
      data: {
        did: shopRecord.short_id,
        reports_url: `https://rabbitloader.com/account/`,
        customize_url: `https://rabbitloader.com/account/`,
        api_token: shopRecord.api_token ? 'present' : 'missing',
        connected_at: shopRecord.connected_at,
        script_injected: shopRecord.script_injected || false,
        critical_css_injected: shopRecord.critical_css_injected || false,
        site_structure: shopRecord.site_structure || null
      }
    });
  } catch (error) {
    console.error('[Dashboard Data] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Get Manual Instructions
// ============================================================
router.get("/manual-instructions", async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  const deferLoaderUrl = `${process.env.APP_URL}/defer-config/loader.js?shop=${encodeURIComponent(shop)}`;
  
  res.json({
    ok: true,
    scriptTag: `<script src="${deferLoaderUrl}"></script>`,
    instructions: {
      step1: "In your Shopify admin, go to Online Store > Themes",
      step2: "Click Actions > Edit code on your active theme",
      step3: "In the left sidebar, find and click on theme.liquid under Layout",
      step4: "Locate the opening <head> tag (usually near the top of the file)",
      step5: "Add the script AFTER <head> and BEFORE any other scripts",
      step6: "Click Save in the top right corner",
      step7: "Test your store to ensure everything works correctly",
      step8: "Configure defer rules in the Defer Configuration section below"
    }
  });
});

// ============================================================
// ROUTE: Auto-Inject Script
// ============================================================
router.post("/inject-script", async (req, res) => {
  const { shop } = req.body;
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.accessToken) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Shop not found or access token missing' 
      });
    }

    const result = await injectDeferScript(
      shop, 
      shopRecord.short_id, 
      shopRecord.accessToken
    );

    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          script_injected: true,
          script_injection_attempted: true
        },
        $push: {
          history: {
            event: "script_injection",
            timestamp: new Date(),
            details: {
              success: result.success,
              position: result.position,
              theme_id: result.themeId
            }
          }
        }
      }
    );

    res.json({ 
      ok: true, 
      message: result.message,
      ...result
    });

  } catch (error) {
    console.error('[Inject Script] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Disconnect
// ============================================================
router.post("/disconnect", async (req, res) => {
  const { shop } = req.body;
  
  console.log(`[RL] Disconnect request for: ${shop}`);
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    
    await ShopModel.updateOne(
      { shop },
      {
        $unset: { 
          api_token: "", 
          short_id: "",
          script_injected: "",
          script_injection_attempted: "",
          critical_css_injected: ""
        },
        $set: { 
          connected_at: null,
          needs_setup: false,
          setup_completed: false
        },
        $push: {
          history: {
            event: "disconnect",
            timestamp: new Date(),
            details: { via: "manual-disconnect" }
          }
        }
      }
    );

    console.log(`[RL] ✅ Disconnected shop: ${shop}`);
    
    res.json({ 
      ok: true, 
      message: "Disconnected from RabbitLoader successfully" 
    });
    
  } catch (error) {
    console.error(`[RL] ❌ Disconnect error:`, error);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to disconnect" 
    });
  }
});

// ============================================================
// ROUTE: Health Check
// ============================================================
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "rabbitloader-shopify-integration",
    timestamp: new Date().toISOString(),
    routes: [
      "rl-callback",
      "rl-connect",
      "status",
      "dashboard-data",
      "manual-instructions",
      "inject-script",
      "disconnect",
      "health",
      "debug"
    ],
    features: [
      "oauth-connection",
      "auto-script-injection",
      "manual-instructions",
      "setup-flow",
      "disconnect"
    ]
  });
});

// ============================================================
// ROUTE: Debug
// ============================================================
router.get("/debug/:shop", async (req, res) => {
  const { shop } = req.params;
  
  try {
    const ShopModel = require("../models/Shop");
    
    let shopRecord = await ShopModel.findOne({ shop });
    if (!shopRecord && !shop.includes('.myshopify.com')) {
      shopRecord = await ShopModel.findOne({ shop: shop + '.myshopify.com' });
    }
    
    if (!shopRecord) {
      return res.json({ 
        found: false, 
        shop,
        message: "Shop not found in database"
      });
    }
    
    res.json({
      found: true,
      shop: shopRecord.shop,
      connected: !!shopRecord.api_token,
      needs_setup: shopRecord.needs_setup || false,
      setup_completed: shopRecord.setup_completed || false,
      script_injected: shopRecord.script_injected || false,
      critical_css_injected: shopRecord.critical_css_injected || false,
      injection_attempted: shopRecord.script_injection_attempted || false,
      connected_at: shopRecord.connected_at,
      did: shopRecord.short_id,
      account_id: shopRecord.account_id,
      history: shopRecord.history || [],
      site_structure: shopRecord.site_structure || null
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message 
    });
  }
});
// ============================================================
// ROUTE: Get Pages List with Templates (OPTIMIZED - PAGINATED)
// ============================================================
router.get("/pages-list", async (req, res) => {
  const { shop, page = 1, limit = 100 } = req.query;
  
  if (!shop) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop parameter required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.json({
        ok: true,
        data: {
          templates: {},
          all_pages: [],
          total_pages: 0,
          page: 1,
          total_pages_count: 0,
          has_more: false
        },
        message: "No site structure found. Run site analysis first."
      });
    }

    const { site_structure } = shopRecord;
    const templateGroups = site_structure.template_groups instanceof Map ?
      site_structure.template_groups :
      new Map(Object.entries(site_structure.template_groups));

    // Build templates summary (lightweight - no pages array)
    const templates = {};
    let allPages = [];
    
    for (const [templateName, templateData] of templateGroups) {
      const pages = templateData.pages || [];
      
      // Summary only for templates object
      templates[templateName] = {
        count: templateData.count || pages.length,
        sample_page: templateData.sample_page || (pages[0] ? pages[0].url : '/'),
        critical_css_enabled: templateData.critical_css_enabled !== false,
        js_defer_count: (templateData.js_defer_rules || []).length
        // DON'T include full pages array here
      };
      
      // Collect all pages for pagination
      allPages.push(...pages.map(page => ({
        ...page,
        template: templateName,
        critical_css_enabled: page.critical_css_enabled !== false,
        js_defer_count: (page.js_defer_rules || []).length
      })));
    }

    // Paginate
    const pageNum = parseInt(page) || 1;
    const pageLimit = Math.min(parseInt(limit) || 100, 200); // Max 200 per page
    const startIndex = (pageNum - 1) * pageLimit;
    const endIndex = startIndex + pageLimit;
    
    const paginatedPages = allPages.slice(startIndex, endIndex);
    const totalPages = allPages.length;
    const hasMore = endIndex < totalPages;

    console.log(`[Pages List] Loaded page ${pageNum} (${paginatedPages.length} pages) of ${totalPages} total for ${shop}`);

    res.json({
      ok: true,
      data: {
        templates: templates,
        all_pages: paginatedPages,
        total_pages: paginatedPages.length,
        total_pages_count: totalPages,
        total_templates: Object.keys(templates).length,
        page: pageNum,
        limit: pageLimit,
        has_more: hasMore
      }
    });

  } catch (error) {
    console.error('[Pages List] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Toggle Critical CSS for Template
// ============================================================
router.post("/toggle-template-css", async (req, res) => {
  const { shop, template, enabled } = req.body;
  
  if (!shop || !template) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop and template parameters required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    
    // Update template-level setting
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          [`site_structure.template_groups.${template}.critical_css_enabled`]: enabled
        },
        $push: {
          history: {
            event: "toggle_template_css",
            timestamp: new Date(),
            details: {
              template: template,
              enabled: enabled
            }
          }
        }
      }
    );

    console.log(`[Toggle CSS] Template ${template} CSS ${enabled ? 'enabled' : 'disabled'} for ${shop}`);

    res.json({
      ok: true,
      message: `Critical CSS ${enabled ? 'enabled' : 'disabled'} for template ${template}`
    });

  } catch (error) {
    console.error('[Toggle Template CSS] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Toggle Critical CSS for Single Page
// ============================================================
router.post("/toggle-page-css", async (req, res) => {
  const { shop, page_id, template, enabled } = req.body;
  
  if (!shop || !page_id || !template) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop, page_id, and template parameters required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop site structure not found" 
      });
    }

    // Find and update the specific page
    const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
      shopRecord.site_structure.template_groups :
      new Map(Object.entries(shopRecord.site_structure.template_groups));
    
    const templateData = templateGroups.get(template);
    
    if (!templateData) {
      return res.status(404).json({ 
        ok: false, 
        error: "Template not found" 
      });
    }

    const pages = templateData.pages || [];
    const pageIndex = pages.findIndex(p => p.id === page_id);
    
    if (pageIndex === -1) {
      return res.status(404).json({ 
        ok: false, 
        error: "Page not found" 
      });
    }

    // Update the page
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          [`site_structure.template_groups.${template}.pages.${pageIndex}.critical_css_enabled`]: enabled
        },
        $push: {
          history: {
            event: "toggle_page_css",
            timestamp: new Date(),
            details: {
              page_id: page_id,
              template: template,
              enabled: enabled
            }
          }
        }
      }
    );

    console.log(`[Toggle CSS] Page ${page_id} CSS ${enabled ? 'enabled' : 'disabled'} for ${shop}`);

    res.json({
      ok: true,
      message: `Critical CSS ${enabled ? 'enabled' : 'disabled'} for page`
    });

  } catch (error) {
    console.error('[Toggle Page CSS] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Get JS Rules (Template or Page)
// ============================================================
router.get("/js-rules", async (req, res) => {
  const { shop, template, page_id } = req.query;
  
  if (!shop || (!template && !page_id)) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop and either template or page_id required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.json({
        ok: true,
        rules: []
      });
    }

    let rules = [];

    if (template) {
      // Get template-level rules
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      const templateData = templateGroups.get(template);
      rules = templateData?.js_defer_rules || [];
    } else if (page_id) {
      // Get page-level rules
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      for (const [templateName, templateData] of templateGroups) {
        const pages = templateData.pages || [];
        const page = pages.find(p => p.id === page_id);
        
        if (page) {
          rules = page.js_defer_rules || [];
          break;
        }
      }
    }

    res.json({
      ok: true,
      rules: rules
    });

  } catch (error) {
    console.error('[Get JS Rules] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Add JS Rule
// ============================================================
router.post("/add-js-rule", async (req, res) => {
  const { shop, template, page_id, pattern, action, delay, reason } = req.body;
  
  if (!shop || !pattern || !action) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop, pattern, and action are required" 
    });
  }

  if (!['defer', 'async', 'delay', 'block'].includes(action)) {
    return res.status(400).json({ 
      ok: false, 
      error: "Action must be one of: defer, async, delay, block" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    
    const newRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pattern: pattern,
      action: action,
      delay: action === 'delay' ? (delay || 3000) : null,
      reason: reason || '',
      created_at: new Date()
    };

    let updateQuery = {};
    
    if (template) {
      // Add to template
      updateQuery = {
        $push: {
          [`site_structure.template_groups.${template}.js_defer_rules`]: newRule,
          history: {
            event: "add_js_rule",
            timestamp: new Date(),
            details: {
              template: template,
              pattern: pattern,
              action: action
            }
          }
        }
      };
    } else if (page_id) {
      // Add to specific page - need to find it first
      const shopRecord = await ShopModel.findOne({ shop });
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      let foundTemplate = null;
      let pageIndex = -1;
      
      for (const [templateName, templateData] of templateGroups) {
        const pages = templateData.pages || [];
        pageIndex = pages.findIndex(p => p.id === page_id);
        
        if (pageIndex !== -1) {
          foundTemplate = templateName;
          break;
        }
      }
      
      if (!foundTemplate) {
        return res.status(404).json({ 
          ok: false, 
          error: "Page not found" 
        });
      }
      
      updateQuery = {
        $push: {
          [`site_structure.template_groups.${foundTemplate}.pages.${pageIndex}.js_defer_rules`]: newRule,
          history: {
            event: "add_js_rule",
            timestamp: new Date(),
            details: {
              page_id: page_id,
              pattern: pattern,
              action: action
            }
          }
        }
      };
    } else {
      return res.status(400).json({ 
        ok: false, 
        error: "Either template or page_id must be provided" 
      });
    }

    await ShopModel.updateOne({ shop }, updateQuery);

    console.log(`[Add JS Rule] Added rule for ${shop}: ${pattern} -> ${action}`);

    res.json({
      ok: true,
      message: "JS rule added successfully",
      rule: newRule
    });

  } catch (error) {
    console.error('[Add JS Rule] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Delete JS Rule
// ============================================================
router.post("/delete-js-rule", async (req, res) => {
  const { shop, rule_id } = req.body;
  
  if (!shop || !rule_id) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop and rule_id are required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not found" 
      });
    }

    // Find and remove the rule
    const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
      shopRecord.site_structure.template_groups :
      new Map(Object.entries(shopRecord.site_structure.template_groups));
    
    let ruleFound = false;
    
    for (const [templateName, templateData] of templateGroups) {
      // Check template-level rules
      if (templateData.js_defer_rules) {
        const ruleIndex = templateData.js_defer_rules.findIndex(r => r.id === rule_id);
        if (ruleIndex !== -1) {
          await ShopModel.updateOne(
            { shop },
            {
              $pull: {
                [`site_structure.template_groups.${templateName}.js_defer_rules`]: { id: rule_id }
              }
            }
          );
          ruleFound = true;
          break;
        }
      }
      
      // Check page-level rules
      if (templateData.pages) {
        for (let i = 0; i < templateData.pages.length; i++) {
          const page = templateData.pages[i];
          if (page.js_defer_rules) {
            const ruleIndex = page.js_defer_rules.findIndex(r => r.id === rule_id);
            if (ruleIndex !== -1) {
              await ShopModel.updateOne(
                { shop },
                {
                  $pull: {
                    [`site_structure.template_groups.${templateName}.pages.${i}.js_defer_rules`]: { id: rule_id }
                  }
                }
              );
              ruleFound = true;
              break;
            }
          }
        }
        if (ruleFound) break;
      }
    }

    if (!ruleFound) {
      return res.status(404).json({ 
        ok: false, 
        error: "Rule not found" 
      });
    }

    console.log(`[Delete JS Rule] Deleted rule ${rule_id} for ${shop}`);

    res.json({
      ok: true,
      message: "JS rule deleted successfully"
    });

  } catch (error) {
    console.error('[Delete JS Rule] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Export Defer Configuration (for loader.js)
// ============================================================
router.get("/export-defer-config", async (req, res) => {
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
    
    if (!shopRecord || !shopRecord.site_structure) {
      return res.json({
        ok: true,
        config: {
          templates: {},
          global_rules: []
        }
      });
    }

    const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
      shopRecord.site_structure.template_groups :
      new Map(Object.entries(shopRecord.site_structure.template_groups));
    
    const config = {
      templates: {},
      global_rules: []
    };
    
    for (const [templateName, templateData] of templateGroups) {
      config.templates[templateName] = {
        critical_css_enabled: templateData.critical_css_enabled !== false,
        js_defer_rules: templateData.js_defer_rules || []
      };
    }

    res.json({
      ok: true,
      config: config,
      shop: shop,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Export Config] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});
// ============================================================
// ROUTE: Analyze Page Performance
// ============================================================
router.get("/analyze-page", async (req, res) => {
  const { shop, url } = req.query;
  
  if (!shop || !url) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop and url parameters required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    const shopRecord = await ShopModel.findOne({ shop });
    
    if (!shopRecord || !shopRecord.short_id) {
      return res.status(404).json({ 
        ok: false, 
        error: "Shop not connected to RabbitLoader" 
      });
    }

    const fullUrl = `https://${shop}${url}`;
    
    // Call Google PageSpeed Insights API directly
    const PSI_API_KEY = process.env.GOOGLE_PSI_API_KEY || 'YOUR_API_KEY';
    
   // Fetch mobile score
// Fetch mobile score
const mobileUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(fullUrl)}&strategy=mobile&key=${PSI_API_KEY}`;
const mobileResponse = await fetch(mobileUrl);
const mobileData = await mobileResponse.json();

// Fetch desktop score
const desktopUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(fullUrl)}&strategy=desktop&key=${PSI_API_KEY}`;
const desktopResponse = await fetch(desktopUrl);
const desktopData = await desktopResponse.json();

const mobileScore = Math.round((mobileData?.lighthouseResult?.categories?.performance?.score || 0) * 100);
const desktopScore = Math.round((desktopData?.lighthouseResult?.categories?.performance?.score || 0) * 100);

console.log(`[Analyze Page] PSI Scores for ${url}: Mobile=${mobileScore}, Desktop=${desktopScore}`);
    res.json({
      ok: true,
      scores: {
        mobile: mobileScore,
        desktop: desktopScore
      },
      url: url,
      analyzed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Analyze Page] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Apply JS Rule (Page/Template/Global)
// ============================================================
router.post("/apply-js-rule", async (req, res) => {
  const { shop, scope, template, pageId, scriptUrl, action } = req.body;
  
  if (!shop || !scope || !action) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop, scope, and action are required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    
    const newRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pattern: scriptUrl,
      action: action,
      created_at: new Date()
    };

    let updateQuery = {};
    
    if (scope === 'page') {
      // Apply to single page
      const shopRecord = await ShopModel.findOne({ shop });
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      let foundTemplate = null;
      let pageIndex = -1;
      
      for (const [templateName, templateData] of templateGroups) {
        const pages = templateData.pages || [];
        pageIndex = pages.findIndex(p => p._doc?.id === pageId || p.id === pageId);
        
        if (pageIndex !== -1) {
          foundTemplate = templateName;
          break;
        }
      }
      
      if (!foundTemplate) {
        return res.status(404).json({ 
          ok: false, 
          error: "Page not found" 
        });
      }
      
      updateQuery = {
        $push: {
          [`site_structure.template_groups.${foundTemplate}.pages.${pageIndex}.js_defer_rules`]: newRule
        }
      };
      
    } else if (scope === 'template') {
      // Apply to all pages in template
      updateQuery = {
        $push: {
          [`site_structure.template_groups.${template}.js_defer_rules`]: newRule
        }
      };
      
    } else if (scope === 'global') {
      // Apply to all templates
      const shopRecord = await ShopModel.findOne({ shop });
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      const updates = [];
      for (const templateName of templateGroups.keys()) {
        updates.push(
          ShopModel.updateOne(
            { shop },
            {
              $push: {
                [`site_structure.template_groups.${templateName}.js_defer_rules`]: newRule
              }
            }
          )
        );
      }
      
      await Promise.all(updates);
      
      return res.json({
        ok: true,
        message: `JS rule applied globally to all templates`
      });
    }

    await ShopModel.updateOne({ shop }, updateQuery);

    console.log(`[Apply JS Rule] Applied ${action} for ${scriptUrl} to ${scope} in ${shop}`);

    res.json({
      ok: true,
      message: `JS rule applied successfully to ${scope}`,
      rule: newRule
    });

  } catch (error) {
    console.error('[Apply JS Rule] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ============================================================
// ROUTE: Apply CSS Setting (Page/Template/Global)
// ============================================================
router.post("/apply-css-setting", async (req, res) => {
  const { shop, scope, template, pageId, enabled } = req.body;
  
  if (!shop || !scope || enabled === undefined) {
    return res.status(400).json({ 
      ok: false, 
      error: "Shop, scope, and enabled are required" 
    });
  }

  try {
    const ShopModel = require("../models/Shop");
    let updateQuery = {};
    
    if (scope === 'page') {
      // Apply to single page
      const shopRecord = await ShopModel.findOne({ shop });
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      let foundTemplate = null;
      let pageIndex = -1;
      
      for (const [templateName, templateData] of templateGroups) {
        const pages = templateData.pages || [];
        pageIndex = pages.findIndex(p => p._doc?.id === pageId || p.id === pageId);
        
        if (pageIndex !== -1) {
          foundTemplate = templateName;
          break;
        }
      }
      
      if (!foundTemplate) {
        return res.status(404).json({ 
          ok: false, 
          error: "Page not found" 
        });
      }
      
      updateQuery = {
        $set: {
          [`site_structure.template_groups.${foundTemplate}.pages.${pageIndex}.critical_css_enabled`]: enabled
        }
      };
      
    } else if (scope === 'template') {
      // Apply to template
      updateQuery = {
        $set: {
          [`site_structure.template_groups.${template}.critical_css_enabled`]: enabled
        }
      };
      
    } else if (scope === 'global') {
      // Apply to all templates
      const shopRecord = await ShopModel.findOne({ shop });
      const templateGroups = shopRecord.site_structure.template_groups instanceof Map ?
        shopRecord.site_structure.template_groups :
        new Map(Object.entries(shopRecord.site_structure.template_groups));
      
      const updates = [];
      for (const templateName of templateGroups.keys()) {
        updates.push(
          ShopModel.updateOne(
            { shop },
            {
              $set: {
                [`site_structure.template_groups.${templateName}.critical_css_enabled`]: enabled
              }
            }
          )
        );
      }
      
      await Promise.all(updates);
      
      return res.json({
        ok: true,
        message: `Critical CSS ${enabled ? 'enabled' : 'disabled'} globally`
      });
    }

    await ShopModel.updateOne({ shop }, updateQuery);

    console.log(`[Apply CSS Setting] Set to ${enabled} for ${scope} in ${shop}`);

    res.json({
      ok: true,
      message: `Critical CSS ${enabled ? 'enabled' : 'disabled'} for ${scope}`
    });

  } catch (error) {
    console.error('[Apply CSS Setting] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});
// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  router,
  injectDeferScript
};