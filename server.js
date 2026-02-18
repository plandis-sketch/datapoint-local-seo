const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3460;
const HOST = '0.0.0.0';
const GOOGLE_PLACES_API_KEY = 'AIzaSyDLlwetJYSLaHVmdbqRUVIxQjtDSlDs2kk';

app.use(express.json());
app.use(express.static('public'));

class LocalSEOAnalyzer {
  async analyzeWebsite(url, businessName, location) {
    const results = {
      url, businessName, location,
      analyzedAt: new Date().toISOString(),
      scores: {},
      issues: [],
      googleBusinessProfile: null
    };

    try {
      const browser = await puppeteer.launch({ headless: 'new' });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      const html = await page.content();
      const title = await page.title();
      
      // Check NAP with fixed regex
      const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
      const addressRegex = /\d+\s+[^,]+,\s*[A-Za-z]+/;
      
      const nap = {
        hasPhone: phoneRegex.test(html),
        hasAddress: addressRegex.test(html),
        hasSchema: html.includes('LocalBusiness') || html.includes('schema.org')
      };

      await browser.close();

      // Calculate score
      let score = 100;
      if (!nap.hasPhone) {
        score -= 20;
        results.issues.push({priority: 'critical', category: 'NAP', issue: 'No phone number found', fix: 'Add clickable phone number'});
      }
      if (!nap.hasAddress) {
        score -= 20;
        results.issues.push({priority: 'critical', category: 'NAP', issue: 'No address found', fix: 'Add full address with city/state'});
      }
      if (!nap.hasSchema) {
        score -= 15;
        results.issues.push({priority: 'high', category: 'Schema', issue: 'No LocalBusiness schema', fix: 'Add JSON-LD schema markup'});
      }
      if (!html.includes(location)) {
        score -= 15;
        results.issues.push({priority: 'high', category: 'Content', issue: 'Location not in content', fix: `Add ${location} to title and content`});
      }

      results.scores.localSEO = Math.max(0, score);
      results.technicalSEO = { nap, title };

      // Check GBP
      const gbp = await this.checkGBP(businessName, location);
      results.googleBusinessProfile = gbp;
      results.scores.gbp = gbp.found ? 100 : 0;
      results.scores.overall = Math.round((results.scores.localSEO + results.scores.gbp) / 2);

      return results;
    } catch (error) {
      return { error: error.message };
    }
  }

  async checkGBP(businessName, location) {
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: { query: `${businessName} ${location}`, key: GOOGLE_PLACES_API_KEY }
      });

      if (response.data.results && response.data.results.length > 0) {
        return { found: true, name: response.data.results[0].name, rating: response.data.results[0].rating };
      }
      return { found: false, issues: [{category: 'GBP', issue: 'Google Business Profile not found!'}] };
    } catch (error) {
      return { found: false, error: error.message };
    }
  }
}

app.get('/api/analyze', async (req, res) => {
  const { url, businessName, location } = req.query;
  if (!url || !businessName || !location) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const analyzer = new LocalSEOAnalyzer();
  const results = await analyzer.analyzeWebsite(url, businessName, location);
  res.json(results);
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Data Point Local SEO</title>
      <style>
        body { font-family: Arial; background: #f5f5f5; padding: 20px; max-width: 800px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .form { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
        button { background: #667eea; color: white; padding: 15px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
        button:hover { background: #764ba2; }
        .results { margin-top: 30px; }
        .score { font-size: 48px; font-weight: bold; color: #667eea; }
        .issue { background: #fff3cd; padding: 15px; margin: 10px 0; border-left: 4px solid #ffc107; border-radius: 5px; }
        .critical { background: #f8d7da; border-left-color: #dc3545; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🚀 Data Point Local SEO</h1>
        <p>Analyze client websites for local SEO</p>
      </div>
      <div class="form">
        <h2>Analyze Website</h2>
        <input type="text" id="url" placeholder="Website URL (https://example.com)">
        <input type="text" id="businessName" placeholder="Business Name">
        <input type="text" id="location" placeholder="Location (e.g., Lancaster, PA)">
        <button onclick="analyze()">🔍 Analyze</button>
        <div id="results"></div>
      </div>
      <script>
        async function analyze() {
          const url = document.getElementById('url').value;
          const businessName = document.getElementById('businessName').value;
          const location = document.getElementById('location').value;
          
          if (!url || !businessName || !location) {
            alert('Please fill in all fields');
            return;
          }
          
          document.getElementById('results').innerHTML = '<p>Analyzing... please wait...</p>';
          
          try {
            const response = await fetch('/api/analyze?url=' + encodeURIComponent(url) + '&businessName=' + encodeURIComponent(businessName) + '&location=' + encodeURIComponent(location));
            const data = await response.json();
            
            let html = '<h3>Results</h3><div class="score">' + (data.scores?.overall || 0) + '/100</div><p>Local SEO Score</p>';
            
            if (data.issues && data.issues.length > 0) {
              html += '<h4>Issues Found:</h4>';
              data.issues.forEach(issue => {
                const cssClass = issue.priority === 'critical' ? 'issue critical' : 'issue';
                html += '<div class="' + cssClass + '"><strong>[' + issue.category + ']</strong> ' + issue.issue + '<br><em>Fix: ' + issue.fix + '</em></div>';
              });
            }
            
            document.getElementById('results').innerHTML = html;
          } catch (error) {
            document.getElementById('results').innerHTML = '<p>Error: ' + error.message + '</p>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Local SEO running at http://localhost:${PORT}`);
});
