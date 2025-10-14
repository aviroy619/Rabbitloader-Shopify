// ============================================
// services/jsDeferService.js
// ============================================

const axios = require('axios');
const ShopModel = require('../models/Shop');
const amqp = require('amqplib');

class JsDeferService {
  constructor() {
    this.baseURL = process.env.JS_DEFER_SERVICE_URL || 'http://45.32.212.222:3002';
    this.timeout = 120000; // 2 minutes
    
    // RabbitMQ properties
    this.rabbitmqURL = process.env.RABBITMQ_URL || 'amqp://guest:guest@45.32.212.222:5672';
    this.queueName = process.env.RABBITMQ_QUEUE || 'psi_results_queue';
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
  }

  /**
   * Queue PSI analysis for a single template/page
   * POST /analyze/page
   */
  async queueAnalysis(params) {
    const { shop, template, url } = params;

    try {
      console.log(`[JS Defer] Queueing analysis: ${template} for ${shop}`);
      
      const response = await axios.post(
        `${this.baseURL}/analyze/page`,
        { shop, template, url },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000 // 10 seconds for queueing
        }
      );

      // Response format:
      // { ok: true, jobId: "psi_xxx", message: "...", estimated_time_seconds: 120 }
      
      if (response.data.ok) {
        console.log(`[JS Defer] ✅ Analysis queued: ${response.data.jobId}`);
        return {
          success: true,
          jobId: response.data.jobId,
          estimatedTime: response.data.estimated_time_seconds
        };
      }

      return {
        success: false,
        error: response.data.error || 'Failed to queue analysis'
      };

    } catch (error) {
      console.error(`[JS Defer] ❌ Queue failed:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get latest completed analysis result
   * GET /results/peek
   */
  async peekResults() {
    try {
      const response = await axios.get(
        `${this.baseURL}/results/peek`,
        { timeout: 5000 }
      );

      // Returns the full analysis result with js_files, defer_recommendations, etc.
      if (response.data.ok && response.data.result) {
        return {
          success: true,
          result: response.data.result
        };
      }

      return {
        success: false,
        error: 'No results available'
      };

    } catch (error) {
      console.error(`[JS Defer] ❌ Peek failed:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get specific shop/template results
   * GET /results/:shop/:template (if this endpoint exists)
   */
  async getResults(shop, template) {
    try {
      const response = await axios.get(
        `${this.baseURL}/results/${encodeURIComponent(shop)}/${encodeURIComponent(template)}`,
        { timeout: 5000 }
      );

      if (response.data.ok && response.data.result) {
        return {
          success: true,
          result: response.data.result
        };
      }

      return {
        success: false,
        error: 'Results not found'
      };

    } catch (error) {
      // Fallback to peek if specific endpoint doesn't exist
      console.warn(`[JS Defer] Specific results not found, trying peek...`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process and save analysis result to main app database
   */
  async saveAnalysisToDatabase(analysisResult) {
    const { shop, template, js_files, defer_recommendations, psi_metrics, summary } = analysisResult;

    try {
      // Extract defer recommendations by action type
      const deferRules = [];
      
      // Process async recommendations (high priority)
      if (defer_recommendations.async?.files) {
        defer_recommendations.async.files.forEach((file, idx) => {
          deferRules.push({
            id: `${template}-async-${idx}`,
            src_regex: this.urlToRegex(file.url),
            action: 'defer', // Map 'async' to 'defer' for our system
            priority: 8,
            enabled: true,
            conditions: { page_types: [template] },
            generated_from: {
              template,
              original_file: file.url,
              reason: file.reason,
              confidence: file.confidence
            }
          });
        });
      }

      // Process defer recommendations
      if (defer_recommendations.defer?.files) {
        defer_recommendations.defer.files.forEach((file, idx) => {
          deferRules.push({
            id: `${template}-defer-${idx}`,
            src_regex: this.urlToRegex(file.url),
            action: 'defer',
            priority: 6,
            enabled: true,
            conditions: { page_types: [template] },
            generated_from: {
              template,
              original_file: file.url,
              reason: file.reason,
              confidence: file.confidence
            }
          });
        });
      }

      // Process delay recommendations
      if (defer_recommendations.delay?.files) {
        defer_recommendations.delay.files.forEach((file, idx) => {
          deferRules.push({
            id: `${template}-delay-${idx}`,
            src_regex: this.urlToRegex(file.url),
            action: 'defer',
            priority: 4,
            enabled: true,
            conditions: { page_types: [template] },
            generated_from: {
              template,
              original_file: file.url,
              reason: file.reason,
              confidence: file.confidence
            }
          });
        });
      }

      // Update shop record with analysis data
      await ShopModel.findOneAndUpdate(
        { shop },
        {
          $set: {
            [`site_structure.template_groups.${template}.psi_analyzed`]: true,
            [`site_structure.template_groups.${template}.js_files`]: js_files.map(f => f.url),
            [`site_structure.template_groups.${template}.defer_recommendations`]: defer_recommendations,
            [`site_structure.template_groups.${template}.last_psi_analysis`]: new Date(),
            [`site_structure.template_groups.${template}.psi_metrics`]: psi_metrics,
            [`site_structure.template_groups.${template}.analysis_summary`]: summary
          }
        }
      );

      // Apply defer rules to deferConfig if we have recommendations
      if (deferRules.length > 0) {
        await this.applyDeferRules(shop, template, deferRules);
      }

      console.log(`[JS Defer] ✅ Analysis saved for ${shop}/${template}: ${deferRules.length} rules`);

      return { success: true, rulesApplied: deferRules.length };

    } catch (error) {
      console.error(`[JS Defer] ❌ Save failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Apply defer rules to shop's deferConfig
   */
  async applyDeferRules(shop, template, rules) {
    try {
      const shopData = await ShopModel.findOne({ shop });
      const existingRules = shopData?.deferConfig?.rules || [];
      
      // Remove old rules for this template
      const filteredRules = existingRules.filter(rule => 
        !rule.id?.startsWith(`${template}-`)
      );
      
      // Add new rules
      const updatedRules = [...filteredRules, ...rules];
      
      await ShopModel.findOneAndUpdate(
        { shop },
        {
          $set: {
            'deferConfig.rules': updatedRules,
            'deferConfig.enabled': true,
            'deferConfig.updated_at': new Date(),
            'deferConfig.source': 'auto'
          }
        },
        { upsert: true }
      );

      console.log(`[JS Defer] ✅ Applied ${rules.length} rules for ${template}`);

    } catch (error) {
      console.error(`[JS Defer] ❌ Apply rules failed:`, error.message);
      throw error;
    }
  }

  /**
   * Convert URL to regex pattern (escape special chars, make domain flexible)
   */
  urlToRegex(url) {
    return url
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/https?:\/\/[^\/]+/, '.*');
  }

  /**
   * Bulk queue analysis for multiple templates
   */
  async queueBulkAnalysis(params) {
    const { shop, templates } = params;
    const results = [];

    console.log(`[JS Defer] Bulk queueing ${templates.length} templates for ${shop}`);

    for (const template of templates) {
      const result = await this.queueAnalysis({
        shop,
        template: template.template,
        url: template.url
      });

      results.push({
        template: template.template,
        ...result
      });

      // Wait 1 second between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[JS Defer] ✅ Queued ${successCount}/${templates.length} analyses`);

    return {
      success: successCount > 0,
      results,
      successCount,
      totalCount: templates.length
    };
  }

  /**
   * Poll for results and save to database
   * This should be called periodically or after queueing analysis
   */
  async pollAndSaveResults(maxAttempts = 5) {
    console.log(`[JS Defer] Polling for results...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const peekResult = await this.peekResults();
      
      if (peekResult.success && peekResult.result) {
        // Save to database
        await this.saveAnalysisToDatabase(peekResult.result);
        return { success: true, result: peekResult.result };
      }

      if (attempt < maxAttempts) {
        console.log(`[JS Defer] No results yet, waiting... (${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      }
    }

    return { success: false, error: 'No results after polling' };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.baseURL}/health`, {
        timeout: 3000
      });
      return response.data.ok === true;
    } catch (error) {
      console.error(`[JS Defer] Health check failed:`, error.message);
      return false;
    }
  }

  /**
   * Get categorizer stats
   */
  async getCategorizerStats() {
    try {
      const response = await axios.get(`${this.baseURL}/categorizer/stats`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error(`[JS Defer] Stats failed:`, error.message);
      return null;
    }
  }

  /**
   * Connect to RabbitMQ and start consuming PSI results
   */
  async connectRabbitMQ() {
    try {
      console.log(`[RabbitMQ] Connecting to ${this.rabbitmqURL}...`);
      
      // Create connection
      this.connection = await amqp.connect(this.rabbitmqURL);
      this.channel = await this.connection.createChannel();
      
      // Assert queue exists
      await this.channel.assertQueue(this.queueName, { durable: true });
      
      // Set prefetch to process one message at a time
      this.channel.prefetch(1);
      
      console.log(`✅ [RabbitMQ] Connected to queue: ${this.queueName}`);
      this.isConnected = true;
      
      // Start consuming messages
      this.channel.consume(this.queueName, async (msg) => {
        if (msg !== null) {
          try {
            const result = JSON.parse(msg.content.toString());
            console.log(`[RabbitMQ] 📨 Received result for ${result.shop}/${result.template}`);
            
            // Process the message
            await this.handlePSIResult(result);
            
            // Acknowledge message (remove from queue)
            this.channel.ack(msg);
            console.log(`[RabbitMQ] ✅ Processed and acknowledged: ${result.jobId}`);
            
          } catch (error) {
            console.error(`[RabbitMQ] ❌ Failed to process message:`, error);
            
            // Reject message and requeue if processing failed
            this.channel.nack(msg, false, true);
          }
        }
      }, {
        noAck: false // Manual acknowledgment
      });
      
      // Handle connection errors
      this.connection.on('error', (err) => {
        console.error('[RabbitMQ] ❌ Connection error:', err);
        this.isConnected = false;
      });
      
      this.connection.on('close', () => {
        console.log('[RabbitMQ] Connection closed, reconnecting in 5s...');
        this.isConnected = false;
        setTimeout(() => this.connectRabbitMQ(), 5000);
      });
      
    } catch (error) {
      console.error('[RabbitMQ] ❌ Connection failed:', error);
      this.isConnected = false;
      
      // Retry connection after 10 seconds
      console.log('[RabbitMQ] Retrying connection in 10s...');
      setTimeout(() => this.connectRabbitMQ(), 10000);
    }
  }

  /**
   * Handle PSI result from RabbitMQ
   */
  async handlePSIResult(result) {
    const { shop, template, jobId, status } = result;
    
    // Only process completed results
    if (status !== 'completed') {
      console.log(`[RabbitMQ] ⚠️ Skipping ${status} result: ${jobId}`);
      return;
    }
    
    console.log(`[RabbitMQ] Processing result for ${shop}/${template}`);
    
    // Use existing saveAnalysisToDatabase method
    await this.saveAnalysisToDatabase(result);
    
    console.log(`[RabbitMQ] ✅ Saved to database: ${shop}/${template}`);
  }

  /**
   * Close RabbitMQ connection
   */
  async closeRabbitMQ() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      console.log('[RabbitMQ] Connection closed');
    } catch (error) {
      console.error('[RabbitMQ] Error closing connection:', error);
    }
  }
}

module.exports = new JsDeferService();