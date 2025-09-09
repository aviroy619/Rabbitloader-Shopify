// app.js - RabbitLoader Shopify App (Full RL Console First)
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const mongoose = require("mongoose");

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
const SHOPIFY_SCOPES = 'read_themes,write_themes';
const SHOPIFY_API_VERSION = '2023-04';
const APP_URL = process.env.APP_URL;

// RabbitLoader Config
const SHOPIFY_PLATFORM_VERSION = '2023-10';
const RABBITLOADER_PLUGIN_VERSION = '1.0.0';

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
      status: error?.response?.status,
      data: error?.response?.data,
      message: error.message
    });
    return null;
  }
}

async function fetchRLToken(siteUrl) {
  try {
    // Replace with your actual RabbitLoader API endpoint
    const response = await axios.get(`https://api.rabbitloader.com/get-token`, {
      params: { site_url: siteUrl },
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching RL token:', {
      status: error?.response?.status,
      data: error?.response?.data,
      message: error.message
    });
    return null;
  }
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

    await ShopModel.updateOne(
      { shop },
      { $set: { access_token: tokenRes.data.access_token } },
      { upsert: true }
    );

    await logEvent(shop, "auth", "Shopify OAuth completed");
    console.log(`✅ Shopify OAuth success for ${shop}`);
    res.redirect(`${APP_URL}/?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error('❌ OAuth error:', {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message
    });
    res.status(500).send('Shopify OAuth failed');
  }
});

// ---------------- RabbitLoader Connect (redirect to RL Console) ----------------
app.get('/connect-rabbitloader', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = await ShopModel.findOne({ shop });

  if (!shop || !rec?.access_token) {
    return res.status(400).send('Missing shop or Shopify access token');
  }

  try {
    const shopInfo = await getShopInfo(shop, rec.access_token);
    if (!shopInfo) return res.status(500).send('Could not fetch shop info');

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

    console.log(`🔗 Redirecting ${shop} to RabbitLoader Console`);
    res.redirect(302, rlUrl);
  } catch (error) {
    console.error('❌ Error in connect:', {
      status: error?.response?.status,
      data: error?.response?.data,
      message: error.message
    });
    res.status(500).send('RabbitLoader connect failed');
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

    // Fixed script URL - removed .red extension
    const newScriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js" defer></script>`;
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

    res.send("ℹ️ Script already present.");
  } catch (err) {
    console.error('❌ Injection failed:', {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message
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

    // Fixed script URL - removed .red extension
    const scriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js" defer></script>`;
    if (content.includes(scriptTag)) {
      content = content.replace(scriptTag, '');
      await axios.put(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
        { asset: { key: 'layout/theme.liquid', value: content } },
        { headers: { 'X-Shopify-Access-Token': rec.access_token } }
      );
      await logEvent(shop, "revert", `Removed script for DID ${rec.short_id}`);
      return res.send(`🗑️ Script removed for DID ${rec.short_id}`);
    }

    res.send("ℹ️ No RabbitLoader script found.");
  } catch (err) {
    console.error('❌ Revert failed:', {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message
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
        // Fixed script URL - removed .red extension
        const scriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.short_id}/u.js" defer></script>`;
        if (content.includes(scriptTag)) {
          content = content.replace(scriptTag, '');
          await axios.put(
            `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/themes/${activeTheme.id}/assets.json`,
            { asset: { key: 'layout/theme.liquid', value: content } },
            { headers: { 'X-Shopify-Access-Token': rec.access_token } }
          );
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
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message
    });
    res.status(500).send('Failed to disconnect RabbitLoader');
  }
});

// ---------------- Webhooks ----------------
app.post('/webhooks/app/uninstalled', async (req, res) => {
  const shop = req.headers['x-shopify-shop-domain'];
  await ShopModel.deleteOne({ shop });
  console.log(`🗑️ Shop ${shop} uninstalled, record deleted`);
  res.sendStatus(200);
});

// ---------------- Main App UI ----------------
app.get('/', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rlToken = req.query['rl-token'];
  const connected = req.query.connected;
  const disconnected = req.query.disconnected;

  if (!shop) {
    return res.redirect(`${APP_URL}/shopify/auth`);
  }

  let rec = await ShopModel.findOne({ shop });
  if (!rec?.access_token) {
    return res.redirect(`/shopify/auth?shop=${encodeURIComponent(shop)}`);
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
        return res.redirect(`${APP_URL}/?shop=${encodeURIComponent(shop)}&connected=true`);
      }
    } catch (err) {
      console.warn('⚠️ Invalid rl-token format, will fallback to API');
    }
  }

  // fallback: fetch RL token from API
  const shopInfo = await getShopInfo(shop, rec.access_token);
  const siteUrl = shopInfo?.primary_domain?.host
    ? `https://${shopInfo.primary_domain.host}`
    : `https://${shop}`;

  const rlData = await fetchRLToken(siteUrl);
  if (rlData?.did) {
    await ShopModel.updateOne(
      { shop },
      { $set: { short_id: rlData.did, api_token: rlData.api_token || null, connected_at: new Date() } },
      { upsert: true }
    );
    await logEvent(shop, "connect", `Connected with DID ${rlData.did}`);
    console.log(`✅ RabbitLoader connected for ${shop} with DID ${rlData.did}`);
    // Properly update the in-memory record
    rec = await ShopModel.findOne({ shop });
  }

  const isRLConnected = !!rec?.short_id;
  res.type('html').send(`
    <div style="font-family:sans-serif;margin:2rem;max-width:800px">
      <h1>🚀 RabbitLoader for Shopify</h1>
      <p><strong>Store:</strong> ${shop}</p>
      <p><strong>Shopify Connected:</strong> ✅</p>
      <p><strong>RabbitLoader Connected:</strong> ${isRLConnected ? '✅' : '❌'}</p>
      ${connected === 'true' ? `<div style="background:#d1ecf1;padding:1rem">🎉 Just connected!</div>` : ''}
      ${disconnected === 'true' ? `<div style="background:#f8d7da;padding:1rem">🔌 Disconnected from RabbitLoader.</div>` : ''}
      ${!isRLConnected ? `
        <a href="/connect-rabbitloader?shop=${encodeURIComponent(shop)}"
           style="background:#0066cc;color:white;padding:15px 30px;text-decoration:none;border-radius:6px;font-weight:bold">
          🔗 Activate RabbitLoader
        </a>` : `
        <div style="background:#d4edda;padding:2rem;border-radius:8px">
          <h2>✅ RabbitLoader Active!</h2>
          <p><strong>DID:</strong> <code>${rec.short_id}</code></p>
          <div style="margin-top:1.5rem">
            <a href="/inject-script?shop=${encodeURIComponent(shop)}"
               style="background:#28a745;color:white;padding:12px 24px;border-radius:4px;margin-right:10px;display:inline-block">
              🔧 Inject Script
            </a>
            <a href="/revert-script?shop=${encodeURIComponent(shop)}"
               style="background:#ffc107;color:black;padding:12px 24px;border-radius:4px;margin-right:10px;display:inline-block">
              🗑️ Revert Script
            </a>
            <a href="/disconnect-rabbitloader?shop=${encodeURIComponent(shop)}"
               onclick="return confirm('⚠️ Are you sure you want to disconnect RabbitLoader?');"
               style="background:#dc3545;color:white;padding:12px 24px;border-radius:4px;display:inline-block">
              🔌 Disconnect RabbitLoader
            </a>
          </div>
        </div>
      `}
    </div>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Running on port ${PORT}`);
  console.log(`📱 App URL: ${APP_URL}`);
  console.log(`🔗 OAuth: ${APP_URL}/shopify/auth/callback`);
});