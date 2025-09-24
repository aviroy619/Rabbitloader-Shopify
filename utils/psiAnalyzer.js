// utils/psiAnalyzer.js - Enhanced PageSpeed Insights Analysis

const axios = require('axios');
const { categorizeShopifyJS, calculateDeferPriority } = require('/shopifyJSCategorizer');

/**
 * Main PSI analysis function for a single page
 * @param {Object} task - Analysis task with shop, template, url, page_count
 * @returns {Object} Comprehensive analysis results
 */
async function analyzeSinglePage(task) {
  const { shop, template, url, page_count } = task;
  
  // Build full URL
  const fullUrl = url.startsWith('http') ? url : `https://${shop}${url}`;
  
  console.log(`Starting comprehensive PSI analysis for ${fullUrl}`);
  
  // Call PSI API
  const psiResponse = await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
    params: {
      url: fullUrl,
      key: process.env.PAGESPEED_API_KEY,
      strategy: 'mobile',
      category: ['performance', 'accessibility'],
      locale: 'en'
    },
    timeout: 180000 // 3 minute timeout
  });
  
  const psiData = psiResponse.data;
  
  // Enhanced JavaScript file extraction
  const jsAnalysis = extractJavaScriptFiles(psiData, shop);
  
  console.log(`Found ${jsAnalysis.totalFiles} JS files for ${template}:`, {
    shopifyCore: jsAnalysis.categories['Shopify Core']?.length || 0,
    shopifyApps: jsAnalysis.categories['Shopify App']?.length || 0,
    shopifyTheme: jsAnalysis.categories['Shopify Theme']?.length || 0,
    thirdParty: jsAnalysis.categories['Third-Party']?.length || 0
  });
  
  // Generate defer recommendations based on comprehensive analysis
  const deferRecommendations = generateDeferRecommendations(jsAnalysis);
  
  return {
    shop,
    template,
    url: fullUrl,
    jsAnalysis,
    deferRecommendations,
    psiRawData: psiData.lighthouseResult,
    analysisSummary: {
      total_js_files: jsAnalysis.totalFiles,
      total_waste_kb: jsAnalysis.totalWasteKB,
      render_blocking_count: jsAnalysis.renderBlocking.length,
      high_priority_defer_count: deferRecommendations.filter(r => r.priority === 'high').length
    }
  };
}

/**
 * Extract JavaScript files from PSI response with comprehensive parsing
 * @param {Object} psiData - PSI API response data
 * @param {string} shop - Shop domain for categorization
 * @returns {Object} Comprehensive JS analysis
 */
function extractJavaScriptFiles(psiData, shop) {
  const allFiles = [];
  const categories = {
    'Shopify Core': [],
    'Shopify App': [],
    'Shopify Theme': [],
    'Shopify CDN': [],
    'Google Analytics/Tags': [],
    'Facebook/Meta': [],
    'TikTok Analytics': [],
    'Intercom': [],
    'Microsoft Clarity': [],
    'Hotjar': [],
    'Zendesk/Chat': [],
    'Third-Party': []
  };
  const renderBlocking = [];
  const unusedJs = [];
  let totalWasteKB = 0;

  // 1. Extract from network-requests audit
  const networkRequests = psiData.lighthouseResult?.audits?.['network-requests']?.details?.items || [];
  networkRequests.forEach(item => {
    if (isJavaScriptFile(item.url)) {
      const fileInfo = {
        url: item.url,
        transferSize: item.transferSize || 0,
        resourceSize: item.resourceSize || 0,
        networkTime: item.networkRequestTime || 0,
        category: categorizeShopifyJS(item.url, shop),
        source: 'network-requests'
      };
      allFiles.push(fileInfo);
      categories[fileInfo.category].push(fileInfo);
    }
  });

  // 2. Extract from unused-javascript audit (most important for defer decisions)
  const unusedJSAudit = psiData.lighthouseResult?.audits?.['unused-javascript'];
  if (unusedJSAudit?.details?.items) {
    unusedJSAudit.details.items.forEach(item => {
      if (isJavaScriptFile(item.url)) {
        const wastedKB = Math.round((item.wastedBytes || 0) / 1024);
        totalWasteKB += wastedKB;
        
        const unusedInfo = {
          url: item.url,
          totalBytes: item.totalBytes || 0,
          wastedBytes: item.wastedBytes || 0,
          wastedPercent: item.wastedPercent || 0,
          wastedKB: wastedKB,
          category: categorizeShopifyJS(item.url, shop),
          deferPriority: calculateDeferPriority(item.wastedPercent, item.wastedBytes)
        };
        unusedJs.push(unusedInfo);

        // Update allFiles with waste data if URL matches
        const existingFile = allFiles.find(f => f.url === item.url);
        if (existingFile) {
          existingFile.wastedBytes = item.wastedBytes;
          existingFile.wastedPercent = item.wastedPercent;
          existingFile.wastedKB = wastedKB;
          existingFile.deferPriority = unusedInfo.deferPriority;
        }
      }
    });
  }

  // 3. Extract from render-blocking-resources audit
  const renderBlockingAudit = psiData.lighthouseResult?.audits?.['render-blocking-resources'];
  if (renderBlockingAudit?.details?.items) {
    renderBlockingAudit.details.items.forEach(item => {
      if (isJavaScriptFile(item.url)) {
        renderBlocking.push({
          url: item.url,
          wastedMs: item.wastedMs || 0,
          category: categorizeShopifyJS(item.url, shop),
          deferPriority: 'high', // Render-blocking = high priority for deferring
          source: 'render-blocking-resources'
        });
      }
    });
  }

  // 4. Check long-tasks audit for additional render-blocking detection
  const longTasksAudit = psiData.lighthouseResult?.audits?.['long-tasks'];
  if (longTasksAudit?.details?.items) {
    longTasksAudit.details.items.forEach(item => {
      if (isJavaScriptFile(item.url)) {
        const duration = item.duration || 0;
        if (duration > 400) { // Tasks over 400ms are effectively render-blocking
          renderBlocking.push({
            url: item.url,
            duration: duration,
            category: categorizeShopifyJS(item.url, shop),
            deferPriority: 'high',
            source: 'long-tasks'
          });
        }
      }
    });
  }

  return {
    allFiles,
    categories,
    renderBlocking,
    unusedJs,
    totalFiles: allFiles.length,
    totalWasteKB: Math.round(totalWasteKB)
  };
}

/**
 * Generate comprehensive defer recommendations based on analysis
 * @param {Object} jsAnalysis - JavaScript analysis results
 * @returns {Array} Prioritized defer recommendations
 */
function generateDeferRecommendations(jsAnalysis) {
  const recommendations = [];
  
  // High priority: Render-blocking scripts
  jsAnalysis.renderBlocking.forEach(script => {
    recommendations.push({
      file: script.url,
      reason: 'render-blocking',
      priority: 'high',
      category: script.category,
      action: 'defer',
      confidence: 9,
      wastedMs: script.wastedMs || script.duration || 0,
      details: 'Script is blocking initial page render',
      source: script.source
    });
  });
  
  // High priority: High-waste unused JavaScript
  jsAnalysis.unusedJs
    .filter(script => script.deferPriority === 'high')
    .forEach(script => {
      // Don't duplicate if already in render-blocking
      if (!recommendations.find(r => r.file === script.url)) {
        recommendations.push({
          file: script.url,
          reason: 'unused-code',
          priority: 'high',
          category: script.category,
          action: 'defer',
          confidence: 8,
          wastedBytes: script.wastedBytes,
          wastedPercent: script.wastedPercent,
          details: `${script.wastedPercent}% unused code (${script.wastedKB}KB wasted)`
        });
      }
    });
  
  // Medium priority: Medium-waste scripts
  jsAnalysis.unusedJs
    .filter(script => script.deferPriority === 'medium')
    .forEach(script => {
      if (!recommendations.find(r => r.file === script.url)) {
        recommendations.push({
          file: script.url,
          reason: 'unused-code',
          priority: 'medium', 
          category: script.category,
          action: 'defer',
          confidence: 6,
          wastedBytes: script.wastedBytes,
          wastedPercent: script.wastedPercent,
          details: `${script.wastedPercent}% unused code (${script.wastedKB}KB wasted)`
        });
      }
    });
  
  // Sort by priority and confidence
  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    if (priorityOrder[b.priority] !== priorityOrder[a.priority]) {
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    }
    return b.confidence - a.confidence;
  });
}

/**
 * Check if URL is a JavaScript file (excludes JSON files)
 * @param {string} url - URL to check
 * @returns {boolean} True if it's a JavaScript file
 */
function isJavaScriptFile(url) {
  if (!url) return false;
  return url.endsWith('.js') && !url.includes('.json');
}

module.exports = {
  analyzeSinglePage,
  extractJavaScriptFiles,
  generateDeferRecommendations,
  isJavaScriptFile
};