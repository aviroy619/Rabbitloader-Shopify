const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://rlplatforms_user:Wills619@shopify.6c0ab2b.mongodb.net/RLPlatforms?retryWrites=true&w=majority&appName=shopify';
const PSI_API_KEY = process.env.GOOGLE_PSI_API_KEY;

let isProcessing = false;

// Connect to MongoDB
mongoose.connect(MONGODB_URI).then(() => {
  console.log('[Worker] ✅ Connected to MongoDB');
  startWorker();
}).catch(err => {
  console.error('[Worker] ❌ MongoDB connection failed:', err);
  process.exit(1);
});

async function startWorker() {
  console.log('[Worker] 🚀 Performance analysis worker started');
  console.log('[Worker] 📊 Checking queue every 10 seconds...');
  
  // Process queue every 10 seconds
  setInterval(processQueue, 10000);
  
  // Process immediately on start
  processQueue();
}

async function processQueue() {
  if (isProcessing) {
    console.log('[Worker] ⏭️  Already processing, skipping...');
    return;
  }

  try {
    isProcessing = true;
    
    const AnalysisQueue = require('../models/AnalysisQueue');
    const PagePerformance = require('../models/PagePerformance');
    
    // Get next pending item
    const item = await AnalysisQueue.findOne({ 
      status: 'pending' 
    }).sort({ created_at: 1 });
    
    if (!item) {
      // No pending items
      return;
    }

    console.log(`[Worker] 🔍 Processing: ${item.url} for ${item.shop}`);
    
    // Mark as processing
    item.status = 'processing';
    item.updated_at = new Date();
    await item.save();

    try {
      // Fetch mobile score
      console.log(`[Worker] 📱 Fetching mobile score...`);
      const mobileUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(item.full_url)}&strategy=mobile&key=${PSI_API_KEY}`;
      const mobileResponse = await fetch(mobileUrl);
      const mobileData = await mobileResponse.json();

      if (mobileData.error) {
        throw new Error(`PSI API Error: ${mobileData.error.message}`);
      }

      // Fetch desktop score
      console.log(`[Worker] 🖥️  Fetching desktop score...`);
      const desktopUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(item.full_url)}&strategy=desktop&key=${PSI_API_KEY}`;
      const desktopResponse = await fetch(desktopUrl);
      const desktopData = await desktopResponse.json();

      if (desktopData.error) {
        throw new Error(`PSI API Error: ${desktopData.error.message}`);
      }

      const mobileScore = Math.round((mobileData?.lighthouseResult?.categories?.performance?.score || 0) * 100);
      const desktopScore = Math.round((desktopData?.lighthouseResult?.categories?.performance?.score || 0) * 100);

      console.log(`[Worker] ✅ Scores: Mobile=${mobileScore}, Desktop=${desktopScore}`);

      // Save results
      await PagePerformance.create({
        shop: item.shop,
        url: item.url,
        mobile_score: mobileScore,
        desktop_score: desktopScore,
        analyzed_at: new Date()
      });

      // Mark as completed and delete from queue
      await AnalysisQueue.deleteOne({ _id: item._id });
      
      console.log(`[Worker] ✅ Completed: ${item.url}`);

    } catch (error) {
      console.error(`[Worker] ❌ Analysis failed:`, error.message);
      
      // Mark as failed
      item.status = 'failed';
      item.error = error.message;
      item.updated_at = new Date();
      await item.save();
    }

  } catch (error) {
    console.error('[Worker] ❌ Queue processing error:', error);
  } finally {
    isProcessing = false;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Worker] 🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] 🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});
