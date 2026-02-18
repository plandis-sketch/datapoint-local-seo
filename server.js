const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3460;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

app.use(express.json());

class LocalSEOAnalyzer {
  async analyzeWebsite(url, businessName, location) {
    const results = {
      url, businessName, location,
      analyzedAt: new Date().toISOString(),
      scores: { overall: 0, onPage: 0, local: 0, technical: 0, gbp: 0 },
      issues: [],
      opportunities: [],
      whatsWorking: [],
      topRecommendation: '',
      checks: {},
      googleBusinessProfile: null
    };

    try {
      if (!url.startsWith('http')) url = 'https://' + url;

      const response = await axios.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOAnalyzer/1.0)' },
        maxRedirects: 5
      });
      
      const html = response.data;
      const lowerHtml = html.toLowerCase();
      const $ = cheerio.load(html);
      
      const pageData = {
        title: $('title').text().trim(),
        metaDescription: $('meta[name="description"]').attr('content') || '',
        h1s: $('h1').map((i, el) => $(el).text().trim()).get(),
        images: $('img').length,
        imagesWithAlt: $('img[alt]').length,
        wordCount: $('body').text().split(/\s+/).filter(w => w.length > 0).length,
        hasSchema: lowerHtml.includes('"@type"') || lowerHtml.includes('schema.org')
      };

      const locationParts = location.split(',').map(p => p.trim().toLowerCase());
      const city = locationParts[0];
      
      // ON-PAGE SEO CHECKS
      const onPageChecks = {
        titleOptimized: pageData.title.length >= 30 && pageData.title.length <= 60,
        titleHasCity: pageData.title.toLowerCase().includes(city),
        metaPresent: pageData.metaDescription.length > 0,
        metaOptimized: pageData.metaDescription.length >= 120 && pageData.metaDescription.length <= 160,
        h1Present: pageData.h1s.length === 1,
        h1HasCity: pageData.h1s.some(h => h.toLowerCase().includes(city)),
        contentLength: pageData.wordCount >= 300
      };

      let onPageScore = 0;
      if (onPageChecks.titleOptimized) onPageScore += 20;
      else results.issues.push({priority: 'high', category: 'Title', issue: 'Title not optimized', fix: 'Keep title 30-60 characters'});
      
      if (onPageChecks.titleHasCity) onPageScore += 20;
      else results.issues.push({priority: 'critical', category: 'Local SEO', issue: 'Title missing city', fix: 'Add "' + city + '" to title tag'});
      
      if (onPageChecks.metaOptimized) onPageScore += 15;
      else if (pageData.metaDescription.length > 0) results.issues.push({priority: 'medium', category: 'Meta', issue: 'Meta description not optimized', fix: 'Keep meta 120-160 characters'});
      else results.issues.push({priority: 'high', category: 'Meta', issue: 'Missing meta description', fix: 'Add compelling meta description'});
      
      if (onPageChecks.h1Present) onPageScore += 15;
      else results.issues.push({priority: 'high', category: 'H1', issue: pageData.h1s.length === 0 ? 'Missing H1' : 'Multiple H1s', fix: 'Use exactly one H1'});
      
      if (onPageChecks.h1HasCity) onPageScore += 15;
      else results.issues.push({priority: 'critical', category: 'H1 Local', issue: 'H1 missing city', fix: 'Add "' + city + '" to your H1'});
      
      if (onPageChecks.contentLength) onPageScore += 15;
      else results.issues.push({priority: 'medium', category: 'Content', issue: 'Thin content', fix: 'Add more content (500+ words)'});

      results.scores.onPage = Math.min(100, onPageScore);
      results.checks.onPage = onPageChecks;

      // LOCAL SEO CHECKS
      const localChecks = {
        cityInContent: lowerHtml.includes(city),
        hasPhone: /\(\d{3}\)\s*\d{3}[-.]\d{4}|\d{3}[-.]\d{3}[-.]\d{4}/.test(html),
        hasAddress: /\d+\s+[^,]+(?:street|st|avenue|ave|road|rd|drive|dr)/i.test(html),
        hasLocalSchema: lowerHtml.includes('localbusiness') || lowerHtml.includes('"@type": "localbusiness"')
      };

      let localScore = 0;
      if (localChecks.cityInContent) localScore += 30;
      else results.issues.push({priority: 'critical', category: 'Content', issue: 'Missing city in content', fix: 'Mention "' + city + '" 3-5 times'});
      
      if (localChecks.hasPhone && localChecks.hasAddress) localScore += 25;
      else results.issues.push({priority: 'critical', category: 'NAP', issue: 'Missing NAP', fix: 'Add phone + address to footer'});
      
      if (localChecks.hasLocalSchema) localScore += 25;
      else results.issues.push({priority: 'high', category: 'Schema', issue: 'No LocalBusiness schema', fix: 'Add JSON-LD schema markup'});

      results.scores.local = Math.min(100, localScore);
      results.checks.local = localChecks;

      // TECHNICAL CHECKS
      const techScore = url.startsWith('https') ? 85 : 50;
      if (!url.startsWith('https')) results.issues.push({priority: 'critical', category: 'Security', issue: 'Not HTTPS', fix: 'Install SSL certificate'});
      results.scores.technical = techScore;

      // GBP CHECK - better search
      const gbp = await this.checkGBP(businessName, city);
      results.googleBusinessProfile = gbp;
      results.scores.gbp = gbp.found ? 100 : 0;
      if (!gbp.found) results.issues.push({priority: 'critical', category: 'GBP', issue: 'GBP not found', fix: 'Verify GBP is claimed'});

      // OVERALL
      results.scores.overall = Math.round((results.scores.onPage * 0.3) + (results.scores.local * 0.35) + (results.scores.technical * 0.15) + (results.scores.gbp * 0.2));

      // TOP RECOMMENDATION
      const critical = results.issues.filter(i => i.priority === 'critical');
      if (critical.length > 0) {
        results.topRecommendation = 'Priority: ' + critical[0].fix;
      } else if (results.issues.length > 0) {
        results.topRecommendation = 'Next: ' + results.issues[0].fix;
      } else {
        results.topRecommendation = 'Great job! Get more reviews to improve rankings.';
      }

      // WHAT'S WORKING
      if (onPageChecks.titleHasCity) results.whatsWorking.push('Title includes city');
      if (localChecks.cityInContent) results.whatsWorking.push('Content has location');
      if (localChecks.hasLocalSchema) results.whatsWorking.push('Schema markup present');
      if (gbp.found) results.whatsWorking.push('GBP is active');

      return results;
    } catch (error) {
      return { error: error.message, scores: { overall: 0, onPage: 0, local: 0, technical: 0, gbp: 0 } };
    }
  }

  async checkGBP(businessName, city) {
    if (!GOOGLE_PLACES_API_KEY) return { found: false, error: 'No API key' };
    
    try {
      // Try multiple search variations
      const queries = [
        businessName + ' ' + city,
        businessName.replace(/[^a-zA-Z0-9\s]/g, '') + ' ' + city,
        businessName.toLowerCase().replace(/inc|llc|corp/g, '').trim() + ' ' + city
      ];
      
      for (const query of queries) {
        const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
          params: { query: query, key: GOOGLE_PLACES_API_KEY },
          timeout: 5000
        });

        if (response.data.results && response.data.results.length > 0) {
          const place = response.data.results[0];
          return { 
            found: true, 
            name: place.name, 
            rating: place.rating,
            reviews: place.user_ratings_total,
            address: place.formatted_address
          };
        }
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
        body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; max-width: 900px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
        .form { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        button { background: #667eea; color: white; padding: 15px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; width: 100%; }
        .results { margin-top: 30px; }
        .score-big { font-size: 56px; font-weight: bold; color: #667eea; text-align: center; }
        .score-label { text-align: center; color: #666; margin-bottom: 20px; }
        .issue { background: #fff3cd; padding: 15px; margin: 10px 0; border-left: 4px solid #ffc107; border-radius: 5px; }
        .issue.critical { background: #f8d7da; border-left-color: #dc3545; }
        .working { background: #d4edda; padding: 10px 15px; margin: 5px 0; border-radius: 5px; color: #155724; }
        .recommendation { background: #e7f3ff; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #0066cc; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🚀 Data Point Local SEO Analyzer</h1>
        <p>Find issues and rank higher in local search</p>
      </div>
      <div class="form">
        <h2>Analyze Your Website</h2>
        <input type="text" id="url" placeholder="Website URL (https://example.com)">
        <input type="text" id="businessName" placeholder="Business Name">
        <input type="text" id="location" placeholder="Location (e.g., Virginia Beach, VA)">
        <button onclick="analyze()">🔍 Analyze Website</button>
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
          
          document.getElementById('results').innerHTML = '<p style="text-align:center;padding:40px;">Analyzing...</p>';
          
          try {
            const response = await fetch('/api/analyze?url=' + encodeURIComponent(url) + '&businessName=' + encodeURIComponent(businessName) + '&location=' + encodeURIComponent(location));
            const data = await response.json();
            
            if (data.error) {
              document.getElementById('results').innerHTML = '<p>Error: ' + data.error + '</p>';
              return;
            }
            
            let html = '<div class="score-big">' + data.scores.overall + '/100</div>';
            html += '<div class="score-label">Overall Local SEO Score</div>';
            
            if (data.topRecommendation) {
              html += '<div class="recommendation"><strong>🎯 Top Priority:</strong> ' + data.topRecommendation + '</div>';
            }
            
            if (data.whatsWorking && data.whatsWorking.length > 0) {
              html += '<h3>✅ What\'s Working</h3>';
              data.whatsWorking.forEach(item => {
                html += '<div class="working">' + item + '</div>';
              });
            }
            
            if (data.issues && data.issues.length > 0) {
              html += '<h3>⚠️ Issues to Fix (' + data.issues.length + ')</h3>';
              data.issues.forEach(issue => {
                const cssClass = issue.priority === 'critical' ? 'issue critical' : 'issue';
                html += '<div class="' + cssClass + '"><strong>[' + issue.category + '] ' + issue.issue + '</strong><br><em>Fix: ' + issue.fix + '</em></div>';
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

app.listen(PORT, () => {
  console.log('Local SEO Analyzer running on port ' + PORT);
});
