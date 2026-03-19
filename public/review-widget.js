(function () {
  'use strict';

  // Find the script tag to read config attributes
  var scriptTag = document.currentScript;
  if (!scriptTag) return;

  var placeId = scriptTag.getAttribute('data-place-id');
  var apiBase = scriptTag.getAttribute('data-api') || scriptTag.src.replace('/public/review-widget.js', '');
  var accentColor = scriptTag.getAttribute('data-accent') || '#1a7a42';
  var maxReviews = parseInt(scriptTag.getAttribute('data-max') || '10', 10);
  var containerId = scriptTag.getAttribute('data-container') || null;
  var heading = scriptTag.getAttribute('data-heading') || 'See What Our Clients Have to Say';
  var subheading = scriptTag.getAttribute('data-subheading') || '';

  if (!placeId) {
    console.error('[ReviewWidget] Missing data-place-id attribute');
    return;
  }

  // ─── STYLES ──────────────────────────────────────────────────────────
  var WIDGET_CSS = '' +
    '.rw-container { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 40px 20px; box-sizing: border-box; }' +
    '.rw-header { text-align: center; margin-bottom: 36px; }' +
    '.rw-header h2 { font-size: 32px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px; }' +
    '.rw-header p { font-size: 16px; color: #666; margin: 0; }' +
    '.rw-track-wrapper { position: relative; overflow: hidden; }' +
    '.rw-track { display: flex; transition: transform 0.4s ease; gap: 24px; }' +
    '.rw-card { flex: 0 0 calc(33.333% - 16px); background: #fff; border-radius: 12px; padding: 28px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); border-top: 4px solid ' + accentColor + '; box-sizing: border-box; display: flex; flex-direction: column; min-height: 220px; }' +
    '.rw-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }' +
    '.rw-author-info { display: flex; flex-direction: column; }' +
    '.rw-author { font-size: 17px; font-weight: 600; color: #1a1a1a; }' +
    '.rw-stars { display: flex; gap: 2px; margin-top: 4px; }' +
    '.rw-star { width: 18px; height: 18px; }' +
    '.rw-google-icon { width: 28px; height: 28px; flex-shrink: 0; }' +
    '.rw-text { font-size: 14px; line-height: 1.6; color: #444; flex: 1; }' +
    '.rw-time { font-size: 12px; color: #999; margin-top: 12px; }' +
    '.rw-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 2; font-size: 18px; color: #fff; transition: background 0.2s; }' +
    '.rw-nav:hover { opacity: 0.85; }' +
    '.rw-nav-prev { left: -8px; }' +
    '.rw-nav-next { right: -8px; }' +
    '.rw-loading { text-align: center; padding: 60px 20px; color: #888; font-size: 15px; }' +
    '.rw-loading-dots span { animation: rw-blink 1.4s infinite both; }' +
    '.rw-loading-dots span:nth-child(2) { animation-delay: 0.2s; }' +
    '.rw-loading-dots span:nth-child(3) { animation-delay: 0.4s; }' +
    '@keyframes rw-blink { 0%,80%,100% { opacity: 0; } 40% { opacity: 1; } }' +
    '.rw-error { text-align: center; padding: 40px 20px; color: #999; font-size: 14px; }' +
    '.rw-error a { color: ' + accentColor + '; text-decoration: none; }' +
    '@media (max-width: 900px) { .rw-card { flex: 0 0 calc(50% - 12px); } }' +
    '@media (max-width: 600px) { .rw-card { flex: 0 0 100%; } .rw-header h2 { font-size: 24px; } }';

  // ─── SVGs ────────────────────────────────────────────────────────────
  var STAR_FILLED = '<svg class="rw-star" viewBox="0 0 24 24" fill="#FBBC04"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  var STAR_EMPTY = '<svg class="rw-star" viewBox="0 0 24 24" fill="#DDD"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  var GOOGLE_G = '<svg class="rw-google-icon" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  var ARROW_LEFT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M10.5 12.5L6 8l4.5-4.5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ARROW_RIGHT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M5.5 3.5L10 8l-4.5 4.5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderStars(rating) {
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html += i <= rating ? STAR_FILLED : STAR_EMPTY;
    }
    return html;
  }

  function truncateText(text, maxLen) {
    if (!text || text.length <= maxLen) return text || '';
    return text.substring(0, maxLen).replace(/\s+\S*$/, '') + '...';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ─── GET OR CREATE TARGET ELEMENT ────────────────────────────────────
  var target;
  if (containerId) {
    target = document.getElementById(containerId);
  }
  if (!target) {
    target = document.createElement('div');
    scriptTag.parentNode.insertBefore(target, scriptTag);
  }

  // ─── INJECT STYLES IMMEDIATELY ───────────────────────────────────────
  var styleEl = document.createElement('style');
  styleEl.textContent = WIDGET_CSS;
  document.head.appendChild(styleEl);

  // ─── SHOW LOADING STATE ──────────────────────────────────────────────
  target.innerHTML =
    '<div class="rw-container">' +
      '<div class="rw-header">' +
        '<h2>' + escapeHtml(heading) + '</h2>' +
      '</div>' +
      '<div class="rw-loading">Loading reviews<span class="rw-loading-dots"><span>.</span><span>.</span><span>.</span></span></div>' +
    '</div>';

  // ─── RENDER REVIEWS ──────────────────────────────────────────────────
  function render(data) {
    var reviews = data.reviews.slice(0, maxReviews);
    if (reviews.length === 0) {
      target.innerHTML =
        '<div class="rw-container">' +
          '<div class="rw-header"><h2>' + escapeHtml(heading) + '</h2></div>' +
          '<div class="rw-error">No reviews found for this business.</div>' +
        '</div>';
      return;
    }

    var sub = subheading || (data.rating + ' stars from ' + data.totalReviews + ' reviews on Google');

    var cardsHtml = '';
    for (var i = 0; i < reviews.length; i++) {
      var r = reviews[i];
      cardsHtml +=
        '<div class="rw-card">' +
          '<div class="rw-card-header">' +
            '<div class="rw-author-info">' +
              '<span class="rw-author">' + escapeHtml(r.author) + '</span>' +
              '<div class="rw-stars">' + renderStars(r.rating) + '</div>' +
            '</div>' +
            GOOGLE_G +
          '</div>' +
          '<div class="rw-text">' + escapeHtml(truncateText(r.text, 350)) + '</div>' +
          '<div class="rw-time">' + escapeHtml(r.time) + '</div>' +
        '</div>';
    }

    target.innerHTML =
      '<div class="rw-container">' +
        '<div class="rw-header">' +
          '<h2>' + escapeHtml(heading) + '</h2>' +
          '<p>' + escapeHtml(sub) + '</p>' +
        '</div>' +
        '<div class="rw-track-wrapper">' +
          '<div class="rw-track">' + cardsHtml + '</div>' +
          (reviews.length > 3 ? '<button class="rw-nav rw-nav-prev" style="background:' + accentColor + '">' + ARROW_LEFT + '</button>' +
          '<button class="rw-nav rw-nav-next" style="background:' + accentColor + '">' + ARROW_RIGHT + '</button>' : '') +
        '</div>' +
      '</div>';

    // ─── CAROUSEL LOGIC ────────────────────────────────────────────────
    var track = target.querySelector('.rw-track');
    var cards = target.querySelectorAll('.rw-card');
    var prevBtn = target.querySelector('.rw-nav-prev');
    var nextBtn = target.querySelector('.rw-nav-next');
    if (!prevBtn || !nextBtn) return;

    var currentIndex = 0;

    function getVisibleCount() {
      var w = target.querySelector('.rw-track-wrapper').offsetWidth;
      if (w <= 600) return 1;
      if (w <= 900) return 2;
      return 3;
    }

    function slide() {
      var visible = getVisibleCount();
      var maxIndex = Math.max(0, cards.length - visible);
      if (currentIndex > maxIndex) currentIndex = maxIndex;
      if (currentIndex < 0) currentIndex = 0;
      var cardWidth = cards[0].offsetWidth;
      var gap = 24;
      track.style.transform = 'translateX(-' + (currentIndex * (cardWidth + gap)) + 'px)';
    }

    prevBtn.addEventListener('click', function () { currentIndex--; slide(); });
    nextBtn.addEventListener('click', function () { currentIndex++; slide(); });
    window.addEventListener('resize', slide);
  }

  // ─── RENDER ERROR ────────────────────────────────────────────────────
  function renderError() {
    target.innerHTML =
      '<div class="rw-container">' +
        '<div class="rw-header"><h2>' + escapeHtml(heading) + '</h2></div>' +
        '<div class="rw-error">Unable to load reviews right now. <a href="https://search.google.com/local/reviews?placeid=' + encodeURIComponent(placeId) + '" target="_blank" rel="noopener">View reviews on Google</a></div>' +
      '</div>';
  }

  // ─── FETCH AND INIT ─────────────────────────────────────────────────
  var endpoint = apiBase + '/api/reviews/' + encodeURIComponent(placeId);
  var xhr = new XMLHttpRequest();
  xhr.open('GET', endpoint, true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          render(data);
        } catch (e) {
          console.error('[ReviewWidget] Failed to parse response', e);
          renderError();
        }
      } else {
        console.error('[ReviewWidget] API error', xhr.status, xhr.responseText);
        renderError();
      }
    }
  };
  xhr.send();
})();
