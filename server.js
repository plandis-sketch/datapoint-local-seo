const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3460;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDLlwetJYSLaHVmdbqRUVIxQjtDSlDs2kk';

app.use(express.json());

class LocalSEOAnalyzer {
  async analyzeWebsite(url, businessName, location) {
    const results = {
      url, businessName, location,
      analyzedAt: new Date().toISOString(),
      scores: { overall: 0, localSEO: 0, gbp: 0, technical: 0, content: 0 },
      issues: [],
      checks: {},
      googleBusinessProfile: null
    };

    try {
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const html = response.data.toLowerCase();
      const $ = cheerio.load(response.data);
      const title = $('title').text();
      const metaDescription = $('meta[name="description"]').attr('content') || '';

      const checks = {
        hasPhone: /\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/.test(html),
        hasAddress: /\d+\s+[^,]+,\s*[a-z]+/.test(html),
        hasSchema: html.includes('localbusiness') || html.includes('schema.org'),
        hasLocation: html.includes(location.toLowerCase()),
        titleLength: title ? title.length : 0,
        hasMetaDescription: metaDescription && metaDescription.length > 0,
        hasH1: $('h1').length > 0,
        h1Count: $('h1').length
      };

      results.checks = checks;

      let localSEOScore = 50;
      let technicalScore = 50;
      let contentScore = 50;

      if (checks.hasPhone) localSEOScore += 15;
      else results.issues.push({priority: 'critical', category: 'NAP', issue: 'No phone number found', fix: 'Add clickable phone number'});

      if (checks.hasAddress) localSEOScore += 10;
      else results.issues.push({priority: 'high', category: 'NAP', issue: 'No address found', fix: 'Add business address'});

      if (checks.hasSchema) localSEOScore += 15;
      else results.issues.push({priority: 'high', category: 'Schema', issue: 'No LocalBusiness schema', fix: 'Add JSON-LD schema markup'});

      if (checks.hasLocation) contentScore += 20;
      else results.issues.push({priority: 'critical', category: 'Content', issue: `Location "${location}" not found`, fix: `Add ${location} to content`});

      if (checks.titleLength >= 30 && checks.titleLength <= 60) technicalScore += 15;
      else results.issues.push({priority: 'medium', category: 'Technical', issue: `Title is ${checks.titleLength} chars`, fix: 'Use 30-60 characters'});

      if (checks.hasMetaDescription) technicalScore += 10;
      else results.issues.push({priority: 'medium', category: 'Technical', issue: 'Missing meta description', fix: 'Add meta description'});

      if (checks.hasH1) technicalScore += 10;
      else results.issues.push({priority: 'high', category: 'Technical', issue: 'No H1 tag', fix: 'Add one H1 with main keyword'});

      const gbp = await this.checkGBP(businessName, location);
      results.googleBusinessProfile = gbp;
      results.scores.gbp = gbp.found ? 100 : 0;
      if (!gbp.found) results.issues.push({priority: 'critical', category: 'GBP', issue: 'Google Business Profile not found', fix: 'Claim your GBP'});

      results.scores.localSEO = Math.min(100, Math.max(0, localSEOScore));
      results.scores.technical = Math.min(100, Math.max(0, technicalScore));
      results.scores.content = Math.min(100, Math.max(0, contentScore));
      results.scores.overall = Math.round((results.scores.localSEO * 0.4) + (results.scores.technical * 0.3) + (results.scores.content * 0.2) + (results.scores.gbp * 0.1));

      return results;
    } catch (error) {
      return {
        error: error.message,
        scores: { overall: 0, localSEO: 0, gbp: 0, technical: 0, content: 0 },
        issues: [{priority: 'critical', category: 'Error', issue: error.message, fix: 'Check URL is correct'}]
      };
    }
  }

  async checkGBP(businessName, location) {
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: { query: `${businessName} ${location}`, key: GOOGLE_PLACES_API_KEY },
        timeout: 5000
      });
      if (response.data.results && response.data.results.length > 0) {
        const place = response.data.results[0];
        return { found: true, name: place.name, rating: place.rating, address: place.formatted_address };
      }
      return { found: false };
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
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; text-align: center; }
        .form { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        button { background: #667eea; color: white; padding: 15px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; width: 100%; }
        .results { margin-top: 30px; }
        .score { font-size: 48px; font-weight: bold; color: #667eea; text-align: center; }
        .score-label { text-align: center; color: #666; margin-bottom: 20px; }
        .issue { background: #fff3cd; padding: 15px; margin: 10px 0; border-left: 4px solid #ffc107; border-radius: 5px; }
        .issue.critical { background: #f8d7da; border-left-color: #dc3545; }
        .loading { text-align: center; padding: 40px; }
        .error { background: #f8d7da; padding: 20px; border-radius: 5px; color: #721c24; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🚀 Data Point Local SEO</h1>
        <p>Analyze client websites for local SEO</p>
      </div>
      <div class="form">
        <h2>Analyze Website</h2>
        <input type="text" id="url" placeholder="Website URL (e.g., https://example.com)">
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
          
          document.getElementById('results').innerHTML = '<div class="loading">Analyzing...</div>';
          
          try {
            const response = await fetch('/api/analyze?url=' + encodeURIComponent(url) + '&businessName=' + encodeURIComponent(businessName) + '&location=' + encodeURIComponent(location));
            const data = await response.json();
            
            if (data.error) {
              document.getElementById('results').innerHTML = '<div class="error">Error: ' + data.error + '</div>';
              return;
            }
            
            let html = '<div class="score">' + data.scores.overall + '/100</div>';
            html += '<div class="score-label">Local SEO Score</div>';
            
            if (data.issues && data.issues.length > 0) {
              html += '<h3>Issues Found (' + data.issues.length + ')</h3>';
              data.issues.forEach(issue => {
                const cssClass = issue.priority === 'critical' ? 'issue critical' : 'issue';
                html += '<div class="' + cssClass + '"><strong>[' + issue.category + '] ' + issue.issue + '</strong><br><em>Fix: ' + issue.fix + '</em></div>';
              });
            } else {
              html += '<p>✅ No major issues found!</p>';
            }
            
            document.getElementById('results').innerHTML = html;
          } catch (error) {
            document.getElementById('results').innerHTML = '<div class="error">Error: ' + error.message + '</div>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log('Local SEO running on port ' + PORT);
});
