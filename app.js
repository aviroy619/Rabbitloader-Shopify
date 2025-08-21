/* server.js — RabbitLoader “connect” flow (Laravel-equivalent) */

const express = require('express');
const morgan = require('morgan');

const app = express();
app.use(express.json());
app.use(morgan('tiny'));

/**
 * Minimal persistence (replace with Mongo/Redis/DB)
 * Map key: shop (myshopify host). Value: { short_id, rabbit_api_res }
 */
const store = new Map();

/** Env */
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// This must match your Shopify app handle (as it appears at /admin/apps/<handle>)
const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || 'rabbitloader-1';

/** Utils */
function assertShop(host) {
  if (!host || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(host)) {
    const e = new Error('Invalid or missing ?shop=<your-shop>.myshopify.com');
    e.status = 400;
    throw e;
  }
}

/** Robust base64 decode for rl-token (handles +/space issues) */
function decodeRlToken(b64) {
  if (!b64) throw new Error('Empty rl-token');
  const fixed = b64.replace(/ /g, '+'); // guard against + turned into spaces
  const json = Buffer.from(fixed, 'base64').toString('utf8');
  return JSON.parse(json);
}

/**
 * HOME — also the RL callback target.
 * RL will redirect back to this route (your app’s home in Admin) with ?rl-token=...
 * We also require ?shop=... so we can key storage.
 */
app.get('/', async (req, res) => {
  try {
    const shop = String(req.query.shop || '').trim();
    assertShop(shop);

    const rlToken = req.query['rl-token'];

    if (rlToken) {
      // Decode & persist
      const payload = decodeRlToken(String(rlToken));
      if (!payload.did) {
        return res.status(400).send('Invalid rl-token: missing "did"');
      }

      store.set(shop, {
        short_id: payload.did,
        rabbit_api_res: payload, // keep full decoded payload
      });

      // In Laravel they also update a Shopify metafield with short_id — you can do that here too.
      // await writeShopMetafield(shop, 'rabbitloader.short_id', payload.did)

      return res
        .status(200)
        .send(
          `<h1>RabbitLoader Connected</h1>
           <p>Shop: ${shop}</p>
           <p>Short ID (did): ${payload.did}</p>
           <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`
        );
    }

    // No rl-token — show current status and a connect link
    const rec = store.get(shop);
    const connected = Boolean(rec?.short_id);

    res
      .status(200)
      .send(
        `<h1>RabbitLoader ${connected ? 'is connected' : 'not connected'}</h1>
         <p>Shop: ${shop}</p>
         ${
           connected
             ? `<p>Short ID: ${rec.short_id}</p>`
             : `<a href="/connect-rabbitloader?shop=${encodeURIComponent(
                 shop
               )}">Connect RabbitLoader</a>`
         }`
      );
  } catch (err) {
    res.status(err.status || 500).send(err.message || 'Error');
  }
});

/**
 * CONNECT → build the exact RL URL and redirect the merchant.
 * Mirrors the Laravel logic:
 *   - site_url = storefront base (we use https://<shop> as a safe default)
 *   - redirect_url = https://<shop>/admin/apps/<handle>?  (note the trailing '?')
 */
app.get('/connect-rabbitloader', (req, res) => {
  try {
    const shop = String(req.query.shop || '').trim();
    assertShop(shop);

    // If you have the real storefront domain, use that. Fallback to myshopify.
    const siteUrl = req.query.site_url
      ? String(req.query.site_url)
      : `https://${shop}`;

    // This must be the ADMIN app URL on the myshopify host, and MUST end with '?'.
    const redirectBackToAdmin = `https://${shop}/admin/apps/${SHOPIFY_APP_HANDLE}?`;

    // Build RL URL (encode params ONCE)
    const rl = new URL('https://rabbitloader.com/account/');
    rl.searchParams.set('source', 'shopify');
    rl.searchParams.set('action', 'connect');
    rl.searchParams.set('site_url', siteUrl);
    rl.searchParams.set('redirect_url', redirectBackToAdmin);
    rl.searchParams.set('cms_v', '2023-10');
    rl.searchParams.set('plugin_v', '1.0.0');

    return res.redirect(302, rl.toString());
  } catch (err) {
    res.status(err.status || 500).send(err.message || 'Error');
  }
});

/** Status endpoint to inspect what we saved */
app.get('/debug/rabbitloader', (req, res) => {
  try {
    const shop = String(req.query.shop || '').trim();
    assertShop(shop);
    const rec = store.get(shop) || null;
    res.json({ shop, record: rec });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Error' });
  }
});

/** Helpers */
function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Start */
app.listen(PORT, () => {
  console.log(`Server on ${BASE_URL}`);
  console.log(
    `Visit: ${BASE_URL}/?shop=<your-shop>.myshopify.com  (or /connect-rabbitloader?shop=...)`
  );
});
