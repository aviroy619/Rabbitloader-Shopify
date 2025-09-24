const { analyzeSinglePage } = require('./utils/psiAnalyzer');
require("dotenv").config();

async function testPSI() {
  console.log('Testing PSI analysis with a public website...');
  console.log('API Key configured:', process.env.PAGESPEED_API_KEY ? 'Yes' : 'No');
  
  // Test with a popular public site that has lots of JavaScript
  const testTask = {
    shop: 'example-shop.myshopify.com', // Fake shop for testing
    template: 'test',
    url: 'https://www.shopify.com', // Public Shopify site
    page_count: 1
  };
  
  try {
    console.log(`\nAnalyzing: ${testTask.url}`);
    console.log('This may take 30-60 seconds...\n');
    
    const result = await analyzeSinglePage(testTask);
    
    console.log('=== PSI Analysis Results ===');
    console.log('URL:', result.url);
    console.log('Total JS files found:', result.jsAnalysis.totalFiles);
    console.log('Total waste KB:', result.jsAnalysis.totalWasteKB);
    console.log('Render blocking files:', result.jsAnalysis.renderBlocking.length);
    console.log('Defer recommendations:', result.deferRecommendations.length);
    
    console.log('\n=== JS Categories ===');
    Object.keys(result.jsAnalysis.categories).forEach(category => {
      const count = result.jsAnalysis.categories[category].length;
      if (count > 0) {
        console.log(`${category}: ${count} files`);
      }
    });
    
    console.log('\n=== Sample JS Files ===');
    result.jsAnalysis.allFiles.slice(0, 5).forEach((file, index) => {
      console.log(`${index + 1}. ${file.url}`);
      console.log(`   Category: ${file.category}`);
      console.log(`   Size: ${file.transferSize || 0} bytes`);
    });
    
    if (result.deferRecommendations.length > 0) {
      console.log('\n=== Top Defer Recommendations ===');
      result.deferRecommendations.slice(0, 3).forEach((rec, index) => {
        console.log(`${index + 1}. ${rec.file}`);
        console.log(`   Reason: ${rec.reason} (${rec.priority} priority)`);
        console.log(`   Confidence: ${rec.confidence}/10`);
        console.log(`   Details: ${rec.details}`);
      });
    } else {
      console.log('\n=== No Defer Recommendations ===');
      console.log('This could mean:');
      console.log('- Site has very optimized JavaScript');
      console.log('- No render-blocking or high-waste JS detected');
      console.log('- PSI analysis did not find significant issues');
    }
    
    console.log('\n=== Raw Analysis Summary ===');
    console.log(JSON.stringify(result.analysisSummary, null, 2));
    
  } catch (error) {
    console.error('PSI analysis failed:', error.message);
    
    if (error.message.includes('API key') || error.message.includes('quota')) {
      console.log('\n🔑 API Key Issues:');
      console.log('1. Check PAGESPEED_API_KEY in .env file');
      console.log('2. Verify API key is valid');
      console.log('3. Ensure PageSpeed Insights API is enabled');
      console.log('4. Check if quota is exceeded');
    }
    
    if (error.message.includes('timeout')) {
      console.log('\n⏱️ Timeout Issues:');
      console.log('1. PageSpeed API is slow (normal)');
      console.log('2. Try again in a few minutes');
    }
    
    console.log('\nFull error details:', error);
  }
}

// Run the test
testPSI().then(() => {
  console.log('\nTest completed.');
  process.exit(0);
}).catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});