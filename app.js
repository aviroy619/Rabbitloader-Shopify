// app.js
// RabbitLoader ↔ Shopify (Release 1) with robust RL callback + manual connect UI
// - Shopify OAuth (REST)
// - RL connect via redirect (cookie) OR manual paste (shop fallback)
// - Safe rl-token decoding (URL-decoded + base64 -> JSON)
// - Script injection into layout/theme.liquid
// - Health / status / debug routes

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const atob = require('atob'); // For base64 decoding if needed, though Buffer.from is preferred

const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = 'read_themes,write_themes';
const APP_URL = process.env.APP_URL; // e.g. https://xxxx.ngrok-free.app

// RabbitLoader API credentials (add these to your .env file)
const RABBITLOADER_CLIENT_ID = process.env.RABBITLOADER_CLIENT_ID;
const RABBITLOADER_CLIENT_SECRET = process.env.RABBITLOADER_CLIENT_SECRET;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// In-memory store (replace with DB in production)
const storeDB = global.__STORE_DB__ || (global.__STORE_DB__ = {}); // { shop: { access_token, did, api_token } }

// ---------------- Utility & Debug ----------------
app.get('/', (_req, res) => res.send('RabbitLoader Shopify App is running.'));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    APP_URL: APP_URL || null,
    SHOPIFY_API_KEY: SHOPIFY_API_KEY ? 'present' : 'missing',
    SHOPIFY_API_SECRET: SHOPIFY_API_SECRET ? 'present' : 'missing',
    RABBITLOADER_CLIENT_ID: RABBITLOADER_CLIENT_ID ? 'present' : 'missing',
    RABBITLOADER_CLIENT_SECRET: RABBITLOADER_CLIENT_SECRET ? 'present' : 'missing',
  });
});

// Shows if we have the tokens for a shop
app.get('/status', (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = storeDB[shop] || {};
  res.json({
    shop,
    has_shopify_access_token: !!rec.access_token,
    has_rabbitloader_did: !!rec.did,
    did: rec.did || null,
    // Note: It's not safe to expose api_token in status for production
  });
});

// Echo back whatever query/cookies arrived (for debugging token delivery)
app.get('/debug/echo', (req, res) => {
  res.json({ query: req.query, cookies: req.cookies });
});

// Simple page to paste rl-token manually if RL redirect complains
app.get('/manual-connect', (_req, res) => {
  res.type('html').send(`
    <form method="POST" action="/manual-connect" style="font-family:sans-serif;margin:2rem;max-width:520px">
      <h2>RabbitLoader Manual Connect</h2>
      <label>Shop domain (e.g., demorbl.myshopify.com)</label><br/>
      <input name="shop" value="" placeholder="yourshop.myshopify.com" style="width:100%;padding:8px" required />
      <br/><br/>
      <label>rl-token (from RabbitLoader URL - this token should be the base64 encoded JSON directly containing did and api_token)</label><br/>
      <textarea name="token" placeholder="paste rl-token here" style="width:100%;height:160px;padding:8px" required></textarea>
      <br/><br/>
      <button type="submit" style="padding:10px 16px">Save & Inject</button>
      <p style="color:#666">Tip: On the RabbitLoader page, use a bookmarklet to copy the token:<br/>
      <code>javascript:(()=>{const m=location.href.match(/[?&]rl-token=([^&#]+)/);if(m){prompt('Copy rl-token:',decodeURIComponent(m[1]));}else{alert('rl-token not found in URL');}})();</code></p>
    </form>
  `);
});

app.post('/manual-connect', async (req, res) => {
  try {
    const shop = (req.body.shop || '').trim();
    if (!shop) return res.status(400).send('shop required');

    const token = req.body.token;
    // Using Buffer.from for base64 decoding
    const json = Buffer.from(decodeURIComponent(token), 'base64').toString('utf8');
    const data = JSON.parse(json); // { did, api_token }

    if (!data.did || !data.api_token) {
        throw new Error('Decoded token is missing DID or API token.');
    }

    storeDB[shop] = { ...(storeDB[shop] || {}), did: data.did, api_token: data.api_token };

    return res.redirect(`/inject-script?shop=${encodeURIComponent(shop)}`);
  } catch (e) {
    console.error('manual-connect error:', e?.message || e);
    res.status(400).send('Invalid token or token format. Ensure it\'s a base64 encoded JSON with did and api_token.');
  }
});

// ---------------- Shopify OAuth (REST) ----------------
app.get('/shopify/auth', (req, res) => {
  const shop = (req.query.shop || '').trim();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return res.status(400).send('Invalid or missing ?shop=xxxx.myshopify.com');
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

    storeDB[shop] = { ...(storeDB[shop] || {}), access_token: tokenRes.data.access_token };
    res.send(`Shopify access token saved for ${shop}`);
  } catch (err) {
    console.error('Shopify OAuth error:', err?.response?.data || err.message);
    res.status(500).send('Shopify OAuth failed');
  }
});

// ---------------- RabbitLoader Connect ----------------
// Builds RL URL and sets a short-lived cookie for shop (nice-to-have)
app.get('/connect', (req, res) => {
  const shop = (req.query.shop || '').trim();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return res.status(400).send('Invalid or missing ?shop=xxxx.myshopify.com');
  }

  // Store shop in a cookie for the callback, as RL might not pass it back in query params.
  res.cookie('shop', shop, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true, // ngrok is https
    maxAge: 10 * 60 * 1000, // 10 minutes
  });

  const site_url = `https://${shop}`;
  // The redirect_url to which RabbitLoader will send the temporary authorization code
  const redirect_url = `${APP_URL}/auth/callback`;
  const shopify_version = '2024.01'; // Update as needed
  const plugin_version = '1.0.0'; // Update as needed

  // RabbitLoader's authorization URL (confirm with RL docs)
  const rlURL =
    `https://rabbitloader.com/account/` + // This might be their auth endpoint
    `?source=shopify` +
    `&action=connect` + // Or 'authorize', 'oauth' depending on their flow
    `&client_id=${encodeURIComponent(RABBITLOADER_CLIENT_ID)}` + // Needed for OAuth
    `&site_url=${encodeURIComponent(site_url)}` +
    `&redirect_url=${encodeURIComponent(redirect_url)}` +
    `&cms_v=${encodeURIComponent(shopify_version)}` +
    `&plugin_v=${encodeURIComponent(plugin_version)}`;

  console.log(`Redirecting to RabbitLoader: ${rlURL}`);
  res.redirect(rlURL);
});

// RL → your app with a temporary authorization code (e.g., ?code=ABC)
// This endpoint now performs the server-to-server token exchange
app.get('/auth/callback', async (req, res) => {
  // RabbitLoader is likely sending an authorization `code` parameter, not `rl-token` directly
  const rlAuthCode = req.query.code; // Or check for 'token', 'rl-token' based on RL docs
  const shop = req.cookies.shop || (req.query.shop || '').trim();

  if (!rlAuthCode) {
    console.error("No RabbitLoader authorization code received in callback:", req.query);
    return res.status(400).send('RabbitLoader connect failed: Missing authorization code.');
  }
  if (!shop) {
    return res.status(400).send('Missing shop context (cookie expired or no ?shop=...)');
  }

  try {
    // Step 1: Exchange the temporary authorization code for permanent API token and DID
    // This POST request must be made from your backend to RabbitLoader's token endpoint.
    // Confirm the exact URL and body parameters with RabbitLoader's API documentation.
    const tokenExchangeResponse = await axios.post(
      'https://api.rabbitloader.com/oauth/token', // Placeholder: Confirm exact RL token exchange URL
      {
        client_id: RABBITLOADER_CLIENT_ID,
        client_secret: RABBITLOADER_CLIENT_SECRET,
        code: rlAuthCode,
        redirect_uri: `${APP_URL}/auth/callback`, // Must match what was sent in /connect
        grant_type: 'authorization_code' // Standard OAuth grant type
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const { access_token: rlApiToken, did } = tokenExchangeResponse.data;

    if (!rlApiToken || !did) {
        throw new Error('RabbitLoader token exchange response missing API token or DID.');
    }

    // Step 2: Store the permanent RabbitLoader API token and DID
    storeDB[shop] = { ...(storeDB[shop] || {}), did: did, api_token: rlApiToken };

    // Clear the shop cookie if it was used
    if (req.cookies.shop) res.clearCookie('shop');

    // Redirect user to the script injection step after successful connect
    return res.redirect(`/inject-script?shop=${encodeURIComponent(shop)}`);

  } catch (err) {
    console.error('RabbitLoader connect (token exchange) failed:', err?.response?.data || err.message);
    let errorMessage = 'Error connecting to RabbitLoader. ';
    if (err.response && err.response.data && typeof err.response.data === 'object') {
        errorMessage += `Details: ${JSON.stringify(err.response.data)}`;
    } else if (err.message) {
        errorMessage += `Details: ${err.message}`;
    }
    return res.status(500).send(errorMessage);
  }
});

// ---------------- Theme Script Injection ----------------
app.get('/inject-script', async (req, res) => {
  const shop = (req.query.shop || '').trim();
  const rec = storeDB[shop] || {};
  if (!shop || !rec.access_token) {
    return res.status(400).send('Missing shop or Shopify access token. Complete Shopify OAuth first.');
  }
  if (!rec.did) {
    return res.status(400).send('Missing RabbitLoader DID. Complete RabbitLoader connect first.');
  }

  try {
    // 1) Get the active theme
    const themeRes = await axios.get(`https://${shop}/admin/api/2023-04/themes.json`, {
      headers: { 'X-Shopify-Access-Token': rec.access_token },
    });
    const activeTheme = themeRes.data.themes.find(t => t.role === 'main');
    if (!activeTheme) return res.status(500).send('No active theme found on Shopify.');

    // 2) Get the content of layout/theme.liquid
    const layoutRes = await axios.get(
      `https://${shop}/admin/api/2023-04/themes/${activeTheme.id}/assets.json`,
      {
        params: { 'asset[key]': 'layout/theme.liquid' },
        headers: { 'X-Shopify-Access-Token': rec.access_token },
      }
    );
    let content = layoutRes.data.asset?.value || '';

    // 3) Inject the RabbitLoader script tag before </head>
    // Ensure the script URL is correct and uses the dynamically obtained DID
    const scriptTag = `<script src="https://cfw.rabbitloader.xyz/${rec.did}/u.js.red.js"></script>`;
    if (!content.includes(scriptTag)) {
      if (!content.includes('</head>')) {
        // If </head> is missing, return an error or try to append it at the end of body
        return res.status(500).send('theme.liquid missing </head> tag for script injection.');
      }
      content = content.replace('</head>', `${scriptTag}\n</head>`);
      await axios.put(
        `https://${shop}/admin/api/2023-04/themes/${activeTheme.id}/assets.json`,
        { asset: { key: 'layout/theme.liquid', value: content } },
        { headers: { 'X-Shopify-Access-Token': rec.access_token } }
      );
      res.send(`RabbitLoader script injected successfully into ${shop}'s theme.`);
    } else {
      res.send(`RabbitLoader script already present in ${shop}'s theme.`);
    }

  } catch (err) {
    console.error('Script injection failed:', err?.response?.data || err.message);
    res.status(500).send('Script injection failed. Check logs for details.');
  }
});

// ---------------- Helper: show script (manual paste) ----------------
app.get('/script-tag', (req, res) => {
  const shop = (req.query.shop || '').trim();
  const did = storeDB[shop]?.did;
  if (!did) return res.status(404).send('No DID found for this shop. Run /connect or /manual-connect.');
  res.type('text/html').send(`<script src="https://cfw.rabbitloader.xyz/${did}/u.js.red.js"></script>`);
});

app.listen(PORT, () => console.log(`RabbitLoader Shopify app running on port ${PORT}`));

