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

// ============================================
// LOCATION PAGES
// ============================================

const locations = {
  'altoona-pa': {
    city: 'Altoona',
    state: 'PA',
    stateFull: 'Pennsylvania',
    phone: '(814) 205-1010',
    address: '1415 11th Avenue, Suite 200',
    zip: '16601',
    lat: '40.5187',
    lng: '-78.3947',
    mapEmbed: 'Altoona,+PA',
    description: 'Data Point Marketing provides expert local SEO services to businesses in Altoona, Pennsylvania. We help Altoona businesses rank higher in Google search, optimize their Google Business Profile, and attract more local customers.',
    areaDescription: 'Altoona is a vibrant city in Blair County, Pennsylvania, known for its rich railroad heritage and growing business community. With a population of over 44,000 in the metro area, Altoona businesses face increasing competition in local search results.',
    neighborhoods: ['Hollidaysburg', 'Duncansville', 'Bellwood', 'Tyrone', 'Martinsburg', 'Roaring Spring'],
    services: {
      'local-seo': {
        title: 'Local SEO Services',
        slug: 'local-seo',
        metaTitle: 'Local SEO Services in Altoona PA | Data Point Marketing',
        metaDescription: 'Expert local SEO services for Altoona PA businesses. Improve your Google rankings, optimize your GBP, and get more local customers. Free SEO audit available.',
        h1: 'Local SEO Services in Altoona, PA',
        intro: 'Is your Altoona business invisible in local search results? Data Point Marketing specializes in local SEO strategies that help Altoona businesses rank on page one of Google. We understand the Altoona market and know what it takes to outrank your local competition.',
        sections: [
          {
            heading: 'Why Local SEO Matters for Altoona Businesses',
            content: 'When Altoona residents search for services like yours, they turn to Google first. In fact, 46% of all Google searches have local intent. If your business does not appear in the top results for Altoona-area searches, you are losing customers to competitors who do. Our local SEO services ensure your business shows up when and where it matters most in the Altoona market.'
          },
          {
            heading: 'Our Altoona Local SEO Process',
            content: 'We start with a comprehensive audit of your current local search presence in Altoona and surrounding Blair County areas. This includes analyzing your Google Business Profile, local citations, on-page SEO, and competitor positioning. From there, we build a custom strategy designed to improve your visibility for Altoona-specific searches and drive more qualified local traffic to your business.'
          },
          {
            heading: 'What Our Local SEO Services Include',
            list: [
              'Google Business Profile optimization and management',
              'Local keyword research targeting Altoona and Blair County',
              'On-page SEO optimization with local signals',
              'Citation building and NAP consistency across directories',
              'Local link building from Altoona-area sources',
              'Review generation and reputation management',
              'Monthly reporting with Altoona-specific ranking data'
            ]
          }
        ]
      },
      'google-business-profile': {
        title: 'Google Business Profile Management',
        slug: 'google-business-profile',
        metaTitle: 'Google Business Profile Management Altoona PA | Data Point',
        metaDescription: 'Professional Google Business Profile setup and optimization for Altoona PA businesses. Get found in Google Maps, earn more reviews, and stand out locally.',
        h1: 'Google Business Profile Management in Altoona, PA',
        intro: 'Your Google Business Profile is often the first impression Altoona customers have of your business. Data Point Marketing helps Altoona businesses fully optimize their GBP to appear in Google Maps results, the local 3-pack, and drive more calls, visits, and website clicks from local searchers.',
        sections: [
          {
            heading: 'Why Your Altoona GBP Matters',
            content: 'Google Business Profile listings drive a significant portion of local business discovery. For Altoona businesses, an optimized GBP means appearing in the coveted local 3-pack when residents search for your services. A fully optimized profile can increase customer actions by up to 70% compared to incomplete listings.'
          },
          {
            heading: 'Our GBP Optimization for Altoona Businesses',
            list: [
              'Complete profile setup and verification',
              'Category and service area optimization for Altoona and Blair County',
              'Photo and video optimization with local Altoona relevance',
              'Google Posts scheduling with local content',
              'Review response management and review generation strategy',
              'Q&A monitoring and optimization',
              'Insights tracking and monthly performance reporting'
            ]
          }
        ]
      },
      'web-design': {
        title: 'Web Design',
        slug: 'web-design',
        metaTitle: 'Web Design Altoona PA | Local Business Websites | Data Point',
        metaDescription: 'Professional web design for Altoona PA businesses. SEO-optimized, mobile-responsive websites built to convert local visitors into customers.',
        h1: 'Web Design for Altoona, PA Businesses',
        intro: 'Your website is the digital storefront for your Altoona business. Data Point Marketing builds fast, mobile-responsive websites that are optimized for local search from the ground up. We create websites that not only look great but are engineered to rank in Altoona-area searches and convert visitors into customers.',
        sections: [
          {
            heading: 'SEO-First Web Design for the Altoona Market',
            content: 'Every website we build for Altoona businesses is designed with local SEO built in from day one. This means proper schema markup, locally optimized content, fast loading speeds, and mobile responsiveness. We do not just build websites; we build lead-generation tools that work around the clock for your Altoona business.'
          },
          {
            heading: 'What You Get with Our Altoona Web Design Services',
            list: [
              'Custom responsive design tailored to your Altoona brand',
              'LocalBusiness schema markup and structured data',
              'SEO-optimized page structure and content',
              'Mobile-first design for on-the-go Altoona customers',
              'Fast page speeds optimized for Core Web Vitals',
              'Contact forms and call-to-action optimization',
              'Google Analytics and conversion tracking setup'
            ]
          }
        ]
      }
    }
  }
};

function locationPageLayout(content, location, canonicalPath) {
  const loc = locations[location];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.metaTitle}</title>
  <meta name="description" content="${content.metaDescription}">
  <link rel="canonical" href="https://datapoint-local-seo.onrender.com${canonicalPath}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; line-height: 1.7; }
    .nav { background: #1a1a2e; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .nav-brand { color: #fff; font-size: 18px; font-weight: 700; text-decoration: none; }
    .nav-links { display: flex; gap: 20px; flex-wrap: wrap; }
    .nav-links a { color: #b0b0d0; text-decoration: none; font-size: 14px; transition: color 0.2s; }
    .nav-links a:hover { color: #fff; }
    .hero { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 60px 24px; text-align: center; }
    .hero h1 { font-size: 36px; margin-bottom: 16px; max-width: 800px; margin-left: auto; margin-right: auto; }
    .hero p { font-size: 18px; opacity: 0.9; max-width: 650px; margin: 0 auto; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .breadcrumb { font-size: 13px; color: #888; margin-bottom: 30px; }
    .breadcrumb a { color: #667eea; text-decoration: none; }
    .section { margin-bottom: 40px; }
    .section h2 { font-size: 24px; color: #1a1a2e; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #667eea; }
    .section p { margin-bottom: 16px; color: #444; }
    .section ul { margin: 16px 0; padding-left: 24px; }
    .section li { margin-bottom: 10px; color: #444; }
    .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
    .service-card { background: #f8f9ff; border: 1px solid #e0e4f5; border-radius: 10px; padding: 24px; transition: transform 0.2s, box-shadow 0.2s; }
    .service-card:hover { transform: translateY(-3px); box-shadow: 0 4px 15px rgba(102,126,234,0.15); }
    .service-card h3 { font-size: 18px; color: #1a1a2e; margin-bottom: 8px; }
    .service-card p { font-size: 14px; color: #666; margin-bottom: 12px; }
    .service-card a { color: #667eea; text-decoration: none; font-weight: 600; font-size: 14px; }
    .cta-box { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; padding: 40px; border-radius: 12px; text-align: center; margin: 40px 0; }
    .cta-box h2 { font-size: 28px; margin-bottom: 12px; }
    .cta-box p { opacity: 0.9; margin-bottom: 20px; }
    .cta-btn { display: inline-block; background: #fff; color: #667eea; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 16px; transition: transform 0.2s; }
    .cta-btn:hover { transform: scale(1.05); }
    .areas-served { background: #f8f9ff; padding: 24px; border-radius: 10px; margin: 30px 0; }
    .areas-served h3 { margin-bottom: 12px; color: #1a1a2e; }
    .area-tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .area-tag { background: #e0e4f5; color: #4a4a6a; padding: 6px 14px; border-radius: 20px; font-size: 13px; }
    .footer { background: #1a1a2e; color: #b0b0d0; padding: 40px 24px; margin-top: 40px; }
    .footer-inner { max-width: 900px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 30px; }
    .footer h4 { color: #fff; margin-bottom: 12px; }
    .footer p, .footer a { font-size: 14px; color: #b0b0d0; text-decoration: none; line-height: 2; }
    .footer a:hover { color: #fff; }
    @media (max-width: 600px) {
      .hero h1 { font-size: 26px; }
      .hero { padding: 40px 16px; }
    }
  </style>
  ${content.schema || ''}
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">Data Point Marketing</a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/locations">Locations</a>
      <a href="/locations/altoona-pa">Altoona, PA</a>
      <a href="/locations/altoona-pa/local-seo">Local SEO</a>
      <a href="/locations/altoona-pa/google-business-profile">GBP</a>
      <a href="/locations/altoona-pa/web-design">Web Design</a>
    </div>
  </nav>
  ${content.body}
  <footer class="footer">
    <div class="footer-inner">
      <div>
        <h4>Data Point Marketing</h4>
        <p>${loc.address}<br>${loc.city}, ${loc.state} ${loc.zip}</p>
        <p><a href="tel:${loc.phone.replace(/[^0-9]/g, '')}">${loc.phone}</a></p>
      </div>
      <div>
        <h4>Services</h4>
        <a href="/locations/altoona-pa/local-seo">Local SEO</a><br>
        <a href="/locations/altoona-pa/google-business-profile">GBP Management</a><br>
        <a href="/locations/altoona-pa/web-design">Web Design</a>
      </div>
      <div>
        <h4>Service Areas</h4>
        <p>${loc.city}, ${loc.state}<br>${loc.neighborhoods.join('<br>')}</p>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

// Locations index page
app.get('/locations', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Locations | Data Point Marketing</title>
  <meta name="description" content="Data Point Marketing serves businesses across Pennsylvania with local SEO, Google Business Profile management, and web design services.">
  <link rel="canonical" href="https://datapoint-local-seo.onrender.com/locations">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; line-height: 1.7; background: #f5f5f5; }
    .nav { background: #1a1a2e; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .nav-brand { color: #fff; font-size: 18px; font-weight: 700; text-decoration: none; }
    .nav-links { display: flex; gap: 20px; }
    .nav-links a { color: #b0b0d0; text-decoration: none; font-size: 14px; }
    .nav-links a:hover { color: #fff; }
    .hero { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 60px 24px; text-align: center; }
    .hero h1 { font-size: 36px; margin-bottom: 16px; }
    .hero p { font-size: 18px; opacity: 0.9; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .location-card { background: #fff; border-radius: 12px; padding: 30px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
    .location-card h2 { font-size: 24px; margin-bottom: 8px; }
    .location-card h2 a { color: #667eea; text-decoration: none; }
    .location-card p { color: #666; margin-bottom: 16px; }
    .service-links { display: flex; gap: 12px; flex-wrap: wrap; }
    .service-links a { background: #f0f0ff; color: #667eea; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; }
    .service-links a:hover { background: #667eea; color: #fff; }
    .footer { background: #1a1a2e; color: #b0b0d0; padding: 30px 24px; text-align: center; margin-top: 40px; font-size: 14px; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">Data Point Marketing</a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/locations">Locations</a>
    </div>
  </nav>
  <div class="hero">
    <h1>Our Service Locations</h1>
    <p>Local SEO and digital marketing services across Pennsylvania</p>
  </div>
  <div class="container">
    <div class="location-card">
      <h2><a href="/locations/altoona-pa">Altoona, Pennsylvania</a></h2>
      <p>Expert local SEO, Google Business Profile management, and web design services for businesses in Altoona and the surrounding Blair County area including Hollidaysburg, Duncansville, and Tyrone.</p>
      <div class="service-links">
        <a href="/locations/altoona-pa">Overview</a>
        <a href="/locations/altoona-pa/local-seo">Local SEO</a>
        <a href="/locations/altoona-pa/google-business-profile">GBP Management</a>
        <a href="/locations/altoona-pa/web-design">Web Design</a>
      </div>
    </div>
  </div>
  <footer class="footer">
    <p>Data Point Marketing &middot; Serving businesses across Pennsylvania</p>
  </footer>
</body>
</html>`;
  res.send(html);
});

// Altoona main location page
app.get('/locations/altoona-pa', (req, res) => {
  const loc = locations['altoona-pa'];
  const schema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Data Point Marketing - Altoona",
  "description": "${loc.description}",
  "telephone": "${loc.phone}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "${loc.address}",
    "addressLocality": "${loc.city}",
    "addressRegion": "${loc.state}",
    "postalCode": "${loc.zip}",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": ${loc.lat},
    "longitude": ${loc.lng}
  },
  "url": "https://datapoint-local-seo.onrender.com/locations/altoona-pa",
  "areaServed": [
    { "@type": "City", "name": "${loc.city}" },
    ${loc.neighborhoods.map(n => `{ "@type": "City", "name": "${n}" }`).join(',\n    ')}
  ],
  "serviceType": ["Local SEO", "Google Business Profile Management", "Web Design"]
}
</script>`;

  const body = `
  <div class="hero">
    <h1>Digital Marketing &amp; Local SEO in Altoona, PA</h1>
    <p>Helping Altoona businesses rank higher in local search and attract more customers</p>
  </div>
  <div class="container">
    <div class="breadcrumb">
      <a href="/">Home</a> &raquo; <a href="/locations">Locations</a> &raquo; Altoona, PA
    </div>

    <div class="section">
      <h2>Local SEO Services for Altoona, Pennsylvania</h2>
      <p>${loc.description}</p>
      <p>${loc.areaDescription}</p>
      <p>Whether you run a restaurant on 11th Avenue, a professional services firm downtown, or a retail shop in Logan Valley Mall, Data Point Marketing has the local SEO expertise to help your Altoona business get found online. We combine proven SEO strategies with deep knowledge of the Altoona market to deliver measurable results.</p>
    </div>

    <div class="services-grid">
      <div class="service-card">
        <h3>Local SEO</h3>
        <p>Rank higher in Altoona-area Google searches with our comprehensive local SEO strategies.</p>
        <a href="/locations/altoona-pa/local-seo">Learn More &rarr;</a>
      </div>
      <div class="service-card">
        <h3>Google Business Profile</h3>
        <p>Optimize your GBP to appear in the local 3-pack and Google Maps for Altoona searches.</p>
        <a href="/locations/altoona-pa/google-business-profile">Learn More &rarr;</a>
      </div>
      <div class="service-card">
        <h3>Web Design</h3>
        <p>SEO-optimized, mobile-responsive websites built for Altoona businesses that convert.</p>
        <a href="/locations/altoona-pa/web-design">Learn More &rarr;</a>
      </div>
    </div>

    <div class="section">
      <h2>Why Altoona Businesses Choose Data Point Marketing</h2>
      <p>We understand the unique challenges that Altoona businesses face in the digital landscape. The Blair County market is competitive, and standing out in local search requires more than just a website. Here is why businesses across Altoona trust Data Point Marketing:</p>
      <ul>
        <li><strong>Local market expertise</strong> &ndash; We know the Altoona market, its neighborhoods, and what local customers are searching for.</li>
        <li><strong>Proven results</strong> &ndash; Our data-driven approach delivers measurable improvements in local search rankings and customer inquiries.</li>
        <li><strong>Full-service approach</strong> &ndash; From GBP optimization to web design, we handle every aspect of your local digital presence.</li>
        <li><strong>Transparent reporting</strong> &ndash; Monthly reports show exactly how your Altoona business is performing in local search.</li>
      </ul>
    </div>

    <div class="areas-served">
      <h3>Areas We Serve Near Altoona</h3>
      <div class="area-tags">
        <span class="area-tag">${loc.city}, ${loc.state}</span>
        ${loc.neighborhoods.map(n => `<span class="area-tag">${n}</span>`).join('\n        ')}
        <span class="area-tag">Blair County</span>
      </div>
    </div>

    <div class="cta-box">
      <h2>Ready to Grow Your Altoona Business?</h2>
      <p>Get a free local SEO audit and see how your business stacks up in Altoona search results.</p>
      <a href="/" class="cta-btn">Get Your Free SEO Audit</a>
    </div>
  </div>`;

  res.send(locationPageLayout(
    { metaTitle: 'Local SEO & Digital Marketing in Altoona PA | Data Point Marketing', metaDescription: 'Data Point Marketing offers expert local SEO, Google Business Profile management, and web design for Altoona PA businesses. Get found locally and grow your business.', body, schema },
    'altoona-pa',
    '/locations/altoona-pa'
  ));
});

// Altoona service sub-pages
app.get('/locations/altoona-pa/:service', (req, res) => {
  const loc = locations['altoona-pa'];
  const serviceData = loc.services[req.params.service];

  if (!serviceData) {
    return res.status(404).send('Page not found');
  }

  const schema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "${serviceData.title} - Altoona, PA",
  "provider": {
    "@type": "LocalBusiness",
    "name": "Data Point Marketing - Altoona",
    "telephone": "${loc.phone}",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "${loc.address}",
      "addressLocality": "${loc.city}",
      "addressRegion": "${loc.state}",
      "postalCode": "${loc.zip}",
      "addressCountry": "US"
    }
  },
  "areaServed": {
    "@type": "City",
    "name": "${loc.city}"
  },
  "description": "${serviceData.metaDescription}"
}
</script>`;

  let sectionsHtml = serviceData.sections.map(s => {
    let html = `<div class="section"><h2>${s.heading}</h2>`;
    if (s.content) html += `<p>${s.content}</p>`;
    if (s.list) {
      html += '<ul>' + s.list.map(item => `<li>${item}</li>`).join('') + '</ul>';
    }
    html += '</div>';
    return html;
  }).join('');

  const otherServices = Object.values(loc.services).filter(s => s.slug !== serviceData.slug);
  const otherServicesHtml = otherServices.map(s => `
    <div class="service-card">
      <h3>${s.title}</h3>
      <p>${s.metaDescription.substring(0, 100)}...</p>
      <a href="/locations/altoona-pa/${s.slug}">Learn More &rarr;</a>
    </div>`).join('');

  const body = `
  <div class="hero">
    <h1>${serviceData.h1}</h1>
    <p>${serviceData.intro.substring(0, 120)}...</p>
  </div>
  <div class="container">
    <div class="breadcrumb">
      <a href="/">Home</a> &raquo; <a href="/locations">Locations</a> &raquo; <a href="/locations/altoona-pa">Altoona, PA</a> &raquo; ${serviceData.title}
    </div>

    <div class="section">
      <p>${serviceData.intro}</p>
    </div>

    ${sectionsHtml}

    <div class="areas-served">
      <h3>Serving Altoona &amp; Surrounding Areas</h3>
      <div class="area-tags">
        <span class="area-tag">${loc.city}, ${loc.state}</span>
        ${loc.neighborhoods.map(n => `<span class="area-tag">${n}</span>`).join('\n        ')}
        <span class="area-tag">Blair County</span>
      </div>
    </div>

    <div class="cta-box">
      <h2>Get Started with ${serviceData.title} in Altoona</h2>
      <p>See how your Altoona business is performing in local search today.</p>
      <a href="/" class="cta-btn">Get Your Free SEO Audit</a>
    </div>

    <h2 style="margin-top:40px;margin-bottom:20px;">Other Services in Altoona</h2>
    <div class="services-grid">
      ${otherServicesHtml}
    </div>
  </div>`;

  res.send(locationPageLayout(
    { metaTitle: serviceData.metaTitle, metaDescription: serviceData.metaDescription, body, schema },
    'altoona-pa',
    '/locations/altoona-pa/' + serviceData.slug
  ));
});

// ============================================
// MAIN PAGES
// ============================================

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
