// ====== Test PSI Analysis Route (5 minute timeout) ======
app.post("/api/test-psi", async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "URL parameter required"
      });
    }
    
    if (!process.env.PAGESPEED_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "PageSpeed Insights API key not configured"
      });
    }

    // Set longer timeout for this specific request
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000); // 5 minutes

    const testTask = {
      shop: 'test-shop.com',
      template: 'test',
      url: url,
      page_count: 1
    };

    console.log(`Testing PSI analysis for: ${url} (5 min timeout)`);
    
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Analysis timed out after 5 minutes')), 300000);
    });
    
    // Race between analysis and timeout
    const analysisResult = await Promise.race([
      analyzePageWithPSI(testTask),
      timeoutPromise
    ]);
    
    res.json({
      ok: true,
      url: analysisResult.url,
      analysis: {
        total_js_files: analysisResult.jsAnalysis.totalFiles,
        total_waste_kb: analysisResult.jsAnalysis.totalWasteKB,
        categories: Object.keys(analysisResult.jsAnalysis.categories).reduce((acc, cat) => {
          acc[cat] = analysisResult.jsAnalysis.categories[cat].length;
          return acc;
        }, {}),
        defer_recommendations: analysisResult.deferRecommendations.length,
        top_recommendations: analysisResult.deferRecommendations.slice(0, 3),
        sample_js_files: analysisResult.jsAnalysis.allFiles.slice(0, 5).map(f => ({
          url: f.url,
          category: f.category,
          size: f.transferSize || 0
        }))
      },
      processing_time: "Analysis completed within 5 minutes"
    });

  } catch (error) {
    console.error('PSI test analysis failed:', error);
    res.status(500).json({ 
      ok: false, 
      error: "PSI analysis failed",
      details: error.message,
      timeout_info: "Request has 5 minute timeout limit"
    });
  }
});