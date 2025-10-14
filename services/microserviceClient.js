// HTTP client for calling RabbitLoader microservice
const fetch = require('node-fetch');

class MicroserviceClient {
  constructor() {
    this.baseUrl = process.env.MICROSERVICE_URL || 'https://microservice.rabbitloader.com';
    this.apiKey = process.env.MICROSERVICE_API_KEY;
  }

  // Analyze performance (PSI + CrUX)
  async analyzePerformance(did, url, templateType = 'homepage') {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/performance/analyze`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          did,
          url,
          template_type: templateType,
          platform: 'shopify'
        }),
        timeout: 30000 // 30 second timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Microservice error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Microservice call failed:', error);
      throw error;
    }
  }

  // Get defer configuration
  async getDeferConfig(did, url) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/defer/config?did=${did}&url=${encodeURIComponent(url)}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`Microservice error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get defer config failed:', error);
      throw error;
    }
  }

  // Update defer configuration
  async updateDeferConfig(did, scriptUrl, action, scope, pageUrl = null) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/defer/update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          did,
          script_url: scriptUrl,
          action,
          scope,
          page_url: pageUrl,
          platform: 'shopify'
        }),
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`Microservice error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Update defer config failed:', error);
      throw error;
    }
  }

  // Get CSS configuration
  async getCSSConfig(did, url) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/css/config?did=${did}&url=${encodeURIComponent(url)}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`Microservice error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get CSS config failed:', error);
      throw error;
    }
  }

  // Toggle Critical CSS
  async toggleCSS(did, action, scope, pageUrl = null, reason = null) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/css/toggle`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          did,
          action,
          scope,
          page_url: pageUrl,
          reason,
          platform: 'shopify'
        }),
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`Microservice error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Toggle CSS failed:', error);
      throw error;
    }
  }

  // Get active optimizations
  async getActiveOptimizations(did) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/optimizations/active?did=${did}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`Microservice error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get active optimizations failed:', error);
      throw error;
    }
  }
}

module.exports = new MicroserviceClient();