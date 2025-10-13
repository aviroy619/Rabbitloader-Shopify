require('dotenv').config();
const mongoose = require('mongoose');
const ShopModel = require('./models/Shop');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const shop = await ShopModel.findOne({ shop: 'au2m2f-zr.myshopify.com' });
  
  if (shop) {
    console.log('Shop:', shop.shop);
    console.log('Access Token:', shop.access_token);
    console.log('Connected At:', shop.connected_at);
    console.log('Last OAuth:', shop.history.filter(h => h.event === 'shopify_auth').pop());
  } else {
    console.log('Shop not found');
  }
  
  process.exit(0);
});