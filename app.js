// app.js - RabbitLoader Shopify App (Full RL Console First)
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const mongoose = require("mongoose");
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection with proper logging
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', () => console.log('✅ MongoDB connected'));
mongoose.connection.on('error', err => console.error('❌ MongoDB error:', err));

// Define schema
const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true },
  access_token: String,
  short_id: String,    // RabbitLoader DID
  api_token: String,   // RL API token
  connected_at: Date,
  history: Array
});

const ShopModel = mongoose.model("Shop", ShopSchema);

// Shopify Config
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION;
const APP_URL = process.env.APP_URL;

// RabbitLoader Config
const SHOPIFY_PLATFORM_VERSION = '2023-10';
const RABBITLOADER_PLUGIN_VERSION = '1.0.0';

// Content Security Policy middleware for Shopify embedding
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com"
  );
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ---------------- Helper Functions ----------------
async function getShopInfo(shop, accessToken) {
  try {
    const response = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });
    return response.data.shop;
  } catch (error) {
    console.error('❌ Error fetching shop info:', {
      status: error?.response?.status || 'N/A',
      data: error?.response?.data || 'No response data',
      message: error.message || 'Unknown error'
    });
    return null;
  }
}

// ⚠️🍸⚠️🍸 No direct token API for RabbitLoader.
// DID + API token are returned via rl-token redirect after user authenticates on rabbitloader.com
async function fetchRLToken(siteUrl) {
  console.warn("⚠️🍸⚠️🍸 fetchRLToken() is deprecated. Use rl-token redirect flow instead.");
  return null;
}

async function logEvent(shop, type, message) {
  try {
    const historyItem = {
      type,
      message,
      timestamp: new Date().toISOString()
    };
    
    await ShopModel.updateOne(
      { shop },
      { 
        $push: { 
          history: { 
            $each: [historyItem], 
            $position: 0, 
            $slice: 5 
          } 
        } 
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error logging event:', error);
  }
}

// ---------------- Shopify OAuth ----------------
app.get('/shopify/auth', (req, res) => {
  const shop = (req.query.shop || '').trim();
  if (!shop) {
    return res.type('html').send(`
      <div style="font-family:sans-serif;margin:2rem;text-align:center">
        <h2>🔗 Connect Your Shopify Store</h2>
        <p>Please provide your shop URL:</p>
        <form method="GET" action="/shopify/auth">
          <input type="text" name="shop" placeholder="yourstore.myshopify.com" style="padding:10px;margin:10px;width:300px">
          <button type="submit" style="padding:10px 20px;background:#0066cc;color:white;border:none;cursor:pointer">Connect</button>
        </form>
      </div>
    `);
  }
  
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return res.status(400).send('Invalid shop format. Please use: yourstore.myshopify.com');
  }

  const redirectUri = `${APP_URL}/shopify/auth/callback`;
  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_API_KEY)}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(installUrl);
});

app.get('/shopify/auth/callback', async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send('Missing shop or code');

  try {
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    });

    const accessToken = tokenRes.data.access_token;
    await ShopModel.updateOne(
      { shop },
      { $set: { access_token: accessToken } },
      { upsert: true }
    );

    await logEvent(shop, "auth", "Shopify OAuth completed");
    console.log(`✅ Shopify OAuth success for ${shop}`);

    // ---- Auto-inject RL script after install ----
    try {
      const themeRes = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken },
      });
      const activeTheme = themeRes.data.themes.find(t => t.role === 'main');
      if (activeTheme) {
        const layoutRes = await axios.get(
          `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
          {
            params: { 'asset[key]': 'layout/theme.liquid' },
            headers: { 'X-Shopify-Access-Token': accessToken }
          }
        );
        let content = layoutRes.data.asset?.value || '';

        // Insert RL script placeholder (DID will be updated later after RL connect)
        const scriptTag = `<script id="rabbitloader-script" data-rl-placeholder="true" defer></script>`;
        if (!content.includes('id="rabbitloader-script"')) {
          if (content.includes('</head>')) {
            content = content.replace('</head>', `  ${scriptTag}\n</head>`);
          } else {
            content = scriptTag + '\n' + content;
          }
          await axios.put(
            `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
            { asset: { key: 'layout/theme.liquid', value: content } },
            { headers: { 'X-Shopify-Access-Token': accessToken } }
          );
          console.log(`✅ RL script placeholder injected into ${shop} theme.liquid`);
        } else {
          console.warn(`⚠️ RabbitLoader placeholder already exists in ${shop} theme.liquid`);
        }
      }
    } catch (injectErr) {
      console.error("⚠️🍸 Auto-inject failed:", injectErr?.response?.data || injectErr.message);
    }

    res.redirect(`${APP_URL}/?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error('❌ OAuth error:', {
      status: err?.response?.status || 'N/A',
      data: err?.response?.data || 'No response data',
      message: err.message || 'Unknown error'
    });
    res.status(500).send('Shopify OAuth failed');
  }
});

// ---------------- RabbitLoader Connect (return JSON instead of redirect) ----------------
app.get('/connect-rabbitloader', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = await ShopModel.findOne({ shop });

  if (!shop || !rec?.access_token) {
    return res.status(400).json({ error: 'Missing shop or Shopify access token' });
  }

  try {
    const shopInfo = await getShopInfo(shop, rec.access_token);
    if (!shopInfo) return res.status(500).json({ error: 'Could not fetch shop info' });

    const siteUrl = shopInfo.primary_domain
      ? `https://${shopInfo.primary_domain.host}`
      : `https://${shop}`;

    const redirectUrl = `${APP_URL}/?shop=${encodeURIComponent(shop)}`;

    const rlUrl =
      `https://rabbitloader.com/account/` +
      `?source=shopify&action=connect` +
      `&site_url=${encodeURIComponent(siteUrl)}` +
      `&redirect_url=${encodeURIComponent(redirectUrl)}` +
      `&cms_v=${SHOPIFY_PLATFORM_VERSION}` +
      `&plugin_v=${RABBITLOADER_PLUGIN_VERSION}`;

    console.log(`🚀 Preparing RabbitLoader Console URL for ${shop}`);
    
    // Return JSON instead of redirecting to prevent iframe jitter
    res.json({ url: rlUrl });
  } catch (error) {
    console.error('❌ Error in connect:', {
      status: error?.response?.status || 'N/A',
      data: error?.response?.data || 'No response data',
      message: error.message || 'Unknown error'
    });
    res.status(500).json({ error: 'RabbitLoader connect failed' });
  }
});

// ---------------- Script Injection ----------------
app.get('/inject-script', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = await ShopModel.findOne({ shop });
  if (!rec?.short_id) return res.status(400).send('RabbitLoader not connected');

  try {
    const themeRes = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes.json`, {
      headers: { 'X-Shopify-Access-Token': rec.access_token },
    });
    const activeTheme = themeRes.data.themes.find(t => t.role === 'main');
    if (!activeTheme) return res.status(500).send('No active theme found');

    const layoutRes = await axios.get(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
      { params: { 'asset[key]': 'layout/theme.liquid' },
        headers: { 'X-Shopify-Access-Token': rec.access_token } }
    );
    let content = layoutRes.data.asset?.value || '';

    // Fixed script URL - added .red.js extension
    const newScriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js.red.js" defer></script>`;
    if (!content.includes(newScriptTag)) {
      if (content.includes('</head>')) {
        content = content.replace('</head>', `  ${newScriptTag}\n</head>`);
      } else {
        content = newScriptTag + '\n' + content;
      }
      await axios.put(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
        { asset: { key: 'layout/theme.liquid', value: content } },
        { headers: { 'X-Shopify-Access-Token': rec.access_token } }
      );
      await logEvent(shop, "inject", `Injected script for DID ${rec.short_id}`);
      return res.send(`✅ Script injected with DID ${rec.short_id}`);
    }

    res.send("⚠️🍸⚠️🍸 Script already present.");
  } catch (err) {
    console.error('❌ Injection failed:', {
      status: err?.response?.status || 'N/A',
      data: err?.response?.data || 'No response data',
      message: err.message || 'Unknown error'
    });
    res.status(500).send('Script injection failed');
  }
});

// ---------------- Revert Script ----------------
app.get('/revert-script', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = await ShopModel.findOne({ shop });
  if (!rec?.access_token || !rec?.short_id) return res.status(400).send('Shop not authenticated or not connected');

  try {
    const themeRes = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes.json`, {
      headers: { 'X-Shopify-Access-Token': rec.access_token },
    });
    const activeTheme = themeRes.data.themes.find(t => t.role === 'main');
    if (!activeTheme) return res.status(500).send('No active theme found');

    const layoutRes = await axios.get(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
      { params: { 'asset[key]': 'layout/theme.liquid' },
        headers: { 'X-Shopify-Access-Token': rec.access_token } }
    );
    let content = layoutRes.data.asset?.value || '';

    // Fixed script URL - added .red.js extension
    const scriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js.red.js" defer></script>`;
    if (content.includes(scriptTag)) {
      content = content.replace(scriptTag, '');
      await axios.put(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
        { asset: { key: 'layout/theme.liquid', value: content } },
        { headers: { 'X-Shopify-Access-Token': rec.access_token } }
      );
      await logEvent(shop, "revert", `Removed script for DID ${rec.short_id}`);
      return res.send(`🗑️⚠️🍸 Script removed for DID ${rec.short_id}`);
    }

    res.send("⚠️🍸⚠️🍸 No RabbitLoader script found.");
  } catch (err) {
    console.error('❌ Revert failed:', {
      status: err?.response?.status || 'N/A',
      data: err?.response?.data || 'No response data',
      message: err.message || 'Unknown error'
    });
    res.status(500).send('Failed to revert script');
  }
});

// ---------------- Disconnect RabbitLoader ----------------
app.get('/disconnect-rabbitloader', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = await ShopModel.findOne({ shop });
  if (!rec?.access_token) return res.status(400).send('Shop not authenticated');

  try {
    if (rec.short_id) {
      const themeRes = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes.json`, {
        headers: { 'X-Shopify-Access-Token': rec.access_token },
      });
      const activeTheme = themeRes.data.themes.find(t => t.role === 'main');
      if (activeTheme) {
        const layoutRes = await axios.get(
          `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
          { params: { 'asset[key]': 'layout/theme.liquid' },
            headers: { 'X-Shopify-Access-Token': rec.access_token } }
        );
        let content = layoutRes.data.asset?.value || '';
        // Fixed script URL - added .red.js extension
        const scriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js.red.js" defer></script>`;
        if (content.includes(scriptTag)) {
          content = content.replace(scriptTag, '');
          await axios.put(
            `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
            { asset: { key: 'layout/theme.liquid', value: content } },
            { headers: { 'X-Shopify-Access-Token': rec.access_token } }
          );
        } else {
          console.warn(`⚠️ Could not remove script from ${shop} theme during disconnect.`);
        }
      }
    }

    await logEvent(shop, "disconnect", `Disconnected RabbitLoader (removed DID ${rec.short_id})`);
    await ShopModel.updateOne(
      { shop },
      {
        $set: {
          short_id: null,
          api_token: null,
          connected_at: null
        }
      }
    );

    res.redirect(`${APP_URL}/?shop=${encodeURIComponent(shop)}&disconnected=true`);
  } catch (err) {
    console.error('❌ Disconnect failed:', {
      status: err?.response?.status || 'N/A',
      data: err?.response?.data || 'No response data',
      message: err.message || 'Unknown error'
    });
    res.status(500).send('Failed to disconnect RabbitLoader');
  }
});

// ---------------- API Status ----------------
app.get('/api/status', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop' });
  }

  try {
    const rec = await ShopModel.findOne({ shop });
    if (!rec) {
      return res.json({ rabbitloader_connected: false });
    }

    res.json({
      rabbitloader_connected: !!rec.short_id,
      did: rec.short_id,
      history: rec.history || []
    });
  } catch (err) {
    console.error('❌ /api/status failed:', {
  status: err?.response?.status || 'N/A',
  data: err?.response?.data || 'No response data',
  message: err.message || 'Unknown error'
});
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// ---------------- RL Credentials ----------------
app.get('/api/rl-credentials', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  if (!shop) return res.status(400).json({ error: 'Missing shop' });

  try {
    const rec = await ShopModel.findOne({ shop });
    if (!rec) return res.status(404).json({ error: 'Shop not found' });

    // Extract domain name from shop (remove .myshopify.com)
    const domainName = shop.replace('.myshopify.com', '');

    res.json({
      did: rec.short_id,
      api_token: rec.api_token,
      domain: domainName // or rec.domain if you store it separately
    });
  } catch (err) {
    console.error('❌ /api/rl-credentials failed:', {
      status: err?.response?.status || 'N/A',
      data: err?.response?.data || 'No response data',
      message: err.message || 'Unknown error'
    });
    res.status(500).json({ error: 'Failed to fetch RL credentials' });
  }
});

// ---------------- App Embed Endpoints (used by script.js) ----------------
app.get('/api/embed-status', (req, res) => {
  // TODO: replace with real check if you implement Shopify App Embed Blocks
  res.json({ enabled: true });
});

app.get('/api/embed-toggle', (req, res) => {
  // Accept query params ?shop & ?enable=true/false
  const { shop, enable } = req.query;
  console.log(`Embed toggle for ${shop}: ${enable}`);
  res.json({ success: true, enabled: enable === 'true' });
});

// ---------------- RabbitLoader API Proxy Routes ----------------
app.get('/api/rl-billing-subscription', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  if (!shop) return res.status(400).json({ error: 'Missing shop' });

  try {
    const rec = await ShopModel.findOne({ shop });
    if (!rec?.api_token) return res.status(404).json({ error: 'RabbitLoader not connected' });

    let response;
    try {
      response = await axios.get('https://api-v2.rabbitloader.com/billing/subscription', {
        headers: {
          'Authorization': `Bearer ${rec.api_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      if (err?.response?.status === 401) {
  console.warn(`⚠️🍸 API token expired for ${shop}`);
  await logEvent(shop, "error", "RabbitLoader API token expired");

  // Auto-reset token so next connect is clean
  await ShopModel.updateOne(
    { shop },
    { $set: { api_token: null, short_id: null, connected_at: null } }
  );

  return res.status(401).json({ error: 'RabbitLoader token expired, please reconnect.' });
}
      throw err;
    }

    res.json(response.data);
  } catch (err) {
    console.error('❌ /api/rl-billing-subscription failed:', err);
    res.status(500).json({ error: 'Failed to fetch billing subscription' });
  }
});

app.get('/api/rl-pageview-usage', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const startDate = req.query.start_date || '2025-07-22';
  const endDate = req.query.end_date || '2025-08-21';
  
  if (!shop) return res.status(400).json({ error: 'Missing shop' });

  try {
    const rec = await ShopModel.findOne({ shop });
    if (!rec?.api_token || !rec?.short_id) return res.status(404).json({ error: 'RabbitLoader not connected' });

    let response;
    try {
      response = await axios.get(`https://api-v2.rabbitloader.com/domain/pageview/${rec.short_id}?start_date=${startDate}&end_date=${endDate}`, {
        headers: {
          'Authorization': `Bearer ${rec.api_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      if (err?.response?.status === 401) {
        console.warn(`⚠️🍸 API token expired for ${shop}`);
        await logEvent(shop, "error", "RabbitLoader API token expired");

        // Auto-reset token so next connect is clean
        await ShopModel.updateOne(
          { shop },
          { $set: { api_token: null, short_id: null, connected_at: null } }
        );

        return res.status(401).json({ error: 'RabbitLoader token expired, please reconnect.' });
      }
      throw err;
    }

    res.json(response.data);
  } catch (err) {
    console.error('❌ /api/rl-pageview-usage failed:', err);
    res.status(500).json({ error: 'Failed to fetch pageview usage' });
  }
});

app.get('/api/rl-performance-overview', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const startDate = req.query.start_date || '2025-07-21';
  const endDate = req.query.end_date || '2025-08-20';
  
  if (!shop) return res.status(400).json({ error: 'Missing shop' });

  try {
    const rec = await ShopModel.findOne({ shop });
    if (!rec?.api_token) return res.status(404).json({ error: 'RabbitLoader not connected' });

    // Extract domain name from shop
    const domainName = shop.replace('.myshopify.com', '');

    let response;
    try {
      response = await axios.get(`https://api-v1.rabbitloader.com/api/v1/report/overview?domain=${domainName}&start_date=${startDate}&end_date=${endDate}`, {
        headers: {
          'Authorization': `Bearer ${rec.api_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      if (err?.response?.status === 401) {
        console.warn(`⚠️🍸 API token expired for ${shop}`);
        await logEvent(shop, "error", "RabbitLoader API token expired");

        // Auto-reset token so next connect is clean
        await ShopModel.updateOne(
          { shop },
          { $set: { api_token: null, short_id: null, connected_at: null } }
        );

        return res.status(401).json({ error: 'RabbitLoader token expired, please reconnect.' });
      }
      throw err;
    }

    res.json(response.data);
  } catch (err) {
    console.error('❌ /api/rl-performance-overview failed:', err);
    res.status(500).json({ error: 'Failed to fetch performance overview' });
  }
});

// ---------------- Webhooks ----------------
app.post('/webhooks/app/uninstalled', async (req, res) => {
  const shop = req.headers['x-shopify-shop-domain'];
  await ShopModel.deleteOne({ shop });
  console.log(`🗑️⚠️🍸 Shop ${shop} uninstalled, record deleted`);
  res.sendStatus(200);
});

// ---------------- Main App UI ----------------
app.get('/', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const host = req.query.host; // Preserve host parameter
  const rlToken = req.query['rl-token'];
  const connected = req.query.connected;
  const disconnected = req.query.disconnected;

  if (!shop) {
    return res.redirect(`${APP_URL}/shopify/auth`);
  }

  let rec = await ShopModel.findOne({ shop });
  if (!rec?.access_token) {
    const redirectUrl = host 
      ? `/shopify/auth?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
      : `/shopify/auth?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(shop)}`;
    return res.redirect(redirectUrl);
  }

  // RL returned token after console connect
  if (rlToken) {
    try {
      const decoded = Buffer.from(rlToken, 'base64').toString('utf8');
      const tokenData = JSON.parse(decoded);
      if (tokenData.did) {
        await ShopModel.updateOne(
          { shop },
          { $set: { short_id: tokenData.did, api_token: tokenData.api_token || null, connected_at: new Date() } },
          { upsert: true }
        );
        await logEvent(shop, "connect", `Connected with DID ${tokenData.did}`);
        console.log(`✅ RabbitLoader connected for ${shop} with DID ${tokenData.did}`);
        
        // Auto-replace placeholder with actual script
        try {
          const rec = await ShopModel.findOne({ shop });
          if (rec?.short_id) {
            const themeRes = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes.json`, {
              headers: { 'X-Shopify-Access-Token': rec.access_token },
            });
            const activeTheme = themeRes.data.themes.find(t => t.role === 'main');
            if (activeTheme) {
              const layoutRes = await axios.get(
                `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
                { params: { 'asset[key]': 'layout/theme.liquid' },
                  headers: { 'X-Shopify-Access-Token': rec.access_token } }
              );
              let content = layoutRes.data.asset?.value || '';

              const placeholder = `<script id="rabbitloader-script" data-rl-placeholder="true" defer></script>`;
              const newScript = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js.red.js" defer></script>`;

              if (content.includes(placeholder)) {
                content = content.replace(placeholder, newScript);
              } else if (!content.includes(newScript)) {
                // fallback if placeholder not found
                content = content.replace('</head>', `  ${newScript}\n</head>`);
              }

              await axios.put(
                `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
                { asset: { key: 'layout/theme.liquid', value: content } },
                { headers: { 'X-Shopify-Access-Token': rec.access_token } }
              );
              console.log(`✅ Replaced placeholder with live script for DID ${rec.short_id}`);
              await logEvent(shop, "inject", `Auto-injected live script for DID ${rec.short_id}`);
            }
          }
        } catch (err) {
          console.error("⚠️🍸 Failed to replace placeholder script:", err?.response?.data || err.message);
          await logEvent(shop, "error", "Failed to auto-inject script after RL connect");
        }
        
        // Build redirect URL preserving host parameter
        const redirectUrl = host
          ? `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}&connected=true`
          : `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(shop)}&connected=true`;
        return res.redirect(redirectUrl);
      }
    } catch (err) {
      console.warn('⚠️🍸⚠️🍸 Invalid rl-token format, redirecting with error');
      await logEvent(shop, "error", "Invalid RabbitLoader token format");
      
      // Redirect with error parameter instead of silently failing
      const errorRedirectUrl = host
        ? `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}&connection_error=invalid_token`
        : `/?shop=${encodeURIComponent(shop)}&connection_error=invalid_token`;
      return res.redirect(errorRedirectUrl);
    }
  }

  // Get the updated record after potential token processing
  rec = await ShopModel.findOne({ shop });
  const isRLConnected = !!rec?.short_id;
  
  // Serve the appropriate HTML file based on connection status
  if (isRLConnected) {
    // Serve dashboard.html for connected users
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } else {
    // Serve index.html for non-connected users  
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Running on port ${PORT}`);
  console.log(`🔗 App URL: ${APP_URL}`);
  console.log(`🔍 OAuth: ${APP_URL}/shopify/auth/callback`);
});