/**
 * Kinopoisk Downloader - Content Script v107.0.0
 * Poster Tooltip IMDb Badges + Under-Score Main Page IMDb Badge Injector
 */

(function () {
  'use strict';

  console.log('[Kinopoisk Downloader] Active v107.0.0');

  let activeQualityFilter = 'ALL';
  let activeAudioFilter = 'ALL';
  let activeSeasonFilter = 'ALL';

  let torrentsData = [];
  let isLoading = false;
  let hasSearched = false;

  const ICONS = {
    download: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    file: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`
  };

  function isMainMediaPage() {
    const pathname = location.pathname;
    return /^\/(film|series)\/([a-zA-Z0-9_-]+)\/?$/.test(pathname);
  }

  function isPromoBannerLink(link) {
    const href = link.getAttribute('href') || '';

    if (
      href.includes('from_block=trailer_promo') ||
      href.includes('from_block=promo') ||
      href.includes('from_block=main_hero') ||
      href.includes('from_block=hero') ||
      href.includes('from_block=slider')
    ) {
      return true;
    }

    let parent = link.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!parent || parent.tagName === 'BODY') break;
      
      const classAndTid = ((parent.className || '') + ' ' + (parent.getAttribute('data-tid') || '')).toLowerCase();
      if (
        classAndTid.includes('promo') ||
        classAndTid.includes('hero') ||
        classAndTid.includes('banner') ||
        classAndTid.includes('billboard') ||
        classAndTid.includes('featured')
      ) {
        if (parent.querySelector('p, [class*="description"], [class*="synopsis"], [class*="text"]')) {
          return true;
        }
      }
      parent = parent.parentElement;
    }

    return false;
  }

  function cleanTitleString(str) {
    if (!str) return '';

    let s = String(str).replace(/[\r\n\t]+/g, ' ').trim();
    if (/^[1-9]\.\d$/.test(s)) return '';

    s = s.replace(/^[1-9]\.\d\s+/, '').replace(/\s+[1-9]\.\d$/, '');
    
    // Strip year and everything after it
    s = s.replace(/[\.,\s]+\b(19\d\d|20\d\d)\b[\s\S]*/gi, '');

    // Strip genre suffixes (e.g. ". драма", ", триллер", " - комедия", ". сериал")
    s = s.replace(/[\.,\s\-—]+\s*(драма|комедия|криминал|боевик|триллер|ужасы|фантастика|фэнтези|мелодрама|детектив|приключения|мультфильм|аниме|документальный|биография|история|сериал)[\s\S]*/gi, '');

    s = s.replace(/^["'«»“”„\s\.,\-—]+|["'«»“”„\s\.,\-—]+$/g, '').trim();

    return s;
  }

  async function fetchKinopoiskRatingXmlDirect(filmId) {
    if (!filmId || !/^\d+$/.test(String(filmId))) return null;
    try {
      const url = `https://rating.kinopoisk.ru/${filmId}.xml`;
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const imdbMatch = text.match(/<imdb_rating[^>]*>([\d\.]+)</i);
        const kpMatch = text.match(/<kp_rating[^>]*>([\d\.]+)</i);

        let imdb = '';
        let kp = '';

        if (imdbMatch) {
          const num = parseFloat(imdbMatch[1]);
          if (!isNaN(num) && num > 0) imdb = num.toFixed(1);
        }
        if (kpMatch) {
          const num = parseFloat(kpMatch[1]);
          if (!isNaN(num) && num > 0) kp = num.toFixed(1);
        }

        return { imdb, kp };
      }
    } catch (e) {}
    return null;
  }

  // --- Main Film/Series Page IMDb Badge Injector ---
  function injectMainPageImdbBadge() {
    if (!isMainMediaPage()) return;
    if (document.getElementById('kp-dl-main-imdb-badge')) return;

    const currentUrlMatch = location.pathname.match(/\/(film|series)\/([a-zA-Z0-9_-]+)/);
    if (!currentUrlMatch) return;

    const filmId = currentUrlMatch[2];
    const isSeries = location.pathname.includes('/series/');

    let scoreEl = null;

    const candidates = Array.from(document.querySelectorAll('[class*="rating"], [class*="score"], [class*="vote"], a[href*="votes"], span, div'));
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || '').trim();
      if (/^[1-9]\.\d$/.test(text) && text.length <= 4) {
        const rect = el.getBoundingClientRect();
        if (rect.top > 0 && rect.top < 600 && rect.left > window.innerWidth * 0.3) {
          scoreEl = el;
          break;
        }
      }
    }

    if (!scoreEl) {
      scoreEl = document.querySelector('[class*="film-rating"]') || document.querySelector('[data-tid="rating"]');
    }

    if (!scoreEl) return;

    const renderBadge = (imdbVal) => {
      if (!imdbVal || document.getElementById('kp-dl-main-imdb-badge')) return;

      const badge = document.createElement('div');
      badge.id = 'kp-dl-main-imdb-badge';
      badge.className = 'kp-dl-main-imdb-badge';
      badge.innerText = `IMDb ${imdbVal}`;
      badge.title = 'Текущий живой рейтинг IMDb';

      const parent = scoreEl.parentElement;
      if (parent) {
        if (scoreEl.nextSibling) {
          parent.insertBefore(badge, scoreEl.nextSibling);
        } else {
          parent.appendChild(badge);
        }
      }
    };

    fetchKinopoiskRatingXmlDirect(filmId).then(data => {
      if (data && data.imdb) {
        renderBadge(data.imdb);
      } else {
        chrome.runtime.sendMessage({
          action: 'FETCH_FILM_DESCRIPTION',
          filmId: filmId,
          cardTitle: extractFilmData().ruTitle,
          isSeries: isSeries
        }, (res) => {
          if (res && res.success && res.data && res.data.ratingImdb) {
            renderBadge(res.data.ratingImdb);
          }
        });
      }
    });
  }

  // --- Hover Tooltip Feature ---
  let tooltipEl = null;
  let hoverTimer = null;
  let currentHoverFilmId = null;
  let isMouseOverTooltip = false;
  let isMouseOverLink = false;

  const descriptionCache = {};

  function extractSmartSynopsis(fullText) {
    if (!fullText) return '';

    let clean = String(fullText).replace(/[\u00a0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000]/g, ' ').trim();
    clean = clean.replace(/^Рецензия на фильм\s+[^:]+:\s*/i, '').trim();

    if (clean.length <= 200) return clean;

    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [];
    let summary = '';
    for (const s of sentences) {
      if ((summary + s).length <= 210) {
        summary += s;
      } else {
        break;
      }
    }

    if (summary.trim().length >= 30) {
      return summary.trim();
    }

    const cut = clean.substring(0, 180);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 30 ? cut.substring(0, lastSpace) : cut).trim() + '.';
  }

  function extractCardTitle(link) {
    if (!link) return '';

    const img = link.querySelector('img');
    if (img && img.alt) {
      const cleaned = cleanTitleString(img.alt);
      if (cleaned && !/^[1-9]\.\d$/.test(cleaned)) return cleaned;
    }

    const titleAttr = link.getAttribute('title') || link.getAttribute('aria-label');
    if (titleAttr) {
      const cleaned = cleanTitleString(titleAttr);
      if (cleaned && !/^[1-9]\.\d$/.test(cleaned)) return cleaned;
    }

    let parentCard = link.parentElement;
    for (let i = 0; i < 4; i++) {
      if (!parentCard) break;

      const candidates = parentCard.querySelectorAll('[class*="title"], [class*="name"], [class*="Title"], [class*="Name"]');
      for (const el of candidates) {
        const cls = (el.className || '').toLowerCase();
        if (cls.includes('rating') || cls.includes('score') || cls.includes('vote') || cls.includes('badge')) continue;

        const text = el.innerText || el.textContent || '';
        const cleaned = cleanTitleString(text);
        if (cleaned && !/^[1-9]\.\d$/.test(cleaned) && cleaned.length > 1) {
          return cleaned;
        }
      }

      const fallbackElements = parentCard.querySelectorAll('a, p, div');
      for (const el of fallbackElements) {
        const cls = (el.className || '').toLowerCase();
        if (cls.includes('rating') || cls.includes('score') || cls.includes('vote') || cls.includes('badge')) continue;
        if (el.querySelector('[class*="rating"], [class*="score"]')) continue;

        const text = el.innerText || el.textContent || '';
        const cleaned = cleanTitleString(text);
        if (cleaned && !/^[1-9]\.\d$/.test(cleaned) && cleaned.length > 1) {
          return cleaned;
        }
      }

      parentCard = parentCard.parentElement;
    }

    return '';
  }

  function extractCardRating(link) {
    if (!link) return '';
    let parentCard = link.parentElement;
    for (let i = 0; i < 6; i++) {
      if (!parentCard) break;

      // 1. Check rating/score class elements
      const ratingEl = parentCard.querySelector('[class*="rating"], [class*="vote"], [class*="score"], [class*="badge"], [class*="Rating"], [class*="Badge"]');
      if (ratingEl && ratingEl.innerText) {
        const match = ratingEl.innerText.match(/\b([1-9]\.\d|10\.0|10)\b/);
        if (match) return match[1];
      }

      // 2. Universal leaf-node text scanner for green score badge e.g. "8.2", "7.8"
      const allEls = Array.from(parentCard.querySelectorAll('*'));
      for (const el of allEls) {
        if (el.children.length === 0) {
          const t = (el.innerText || el.textContent || '').trim();
          if (/^[1-9]\.\d$/.test(t)) {
            return t;
          }
        }
      }

      parentCard = parentCard.parentElement;
    }
    return '';
  }

  function parseRatingValue(rObj) {
    if (!rObj) return '';
    if (typeof rObj === 'number' || typeof rObj === 'string') {
      const num = parseFloat(rObj);
      if (!isNaN(num) && num > 0 && num <= 10) return num.toFixed(1);
    }
    if (typeof rObj === 'object') {
      const candidate = rObj.kp || rObj.value || rObj.rating || rObj.ratingValue || rObj.filmCrypto?.rating;
      if (candidate) {
        const num = parseFloat(candidate);
        if (!isNaN(num) && num > 0 && num <= 10) return num.toFixed(1);
      }
    }
    return '';
  }

  function parseImdbRating(obj) {
    if (!obj) return '';
    if (typeof obj === 'number' || typeof obj === 'string') {
      const num = parseFloat(obj);
      if (!isNaN(num) && num > 0 && num <= 10) return num.toFixed(1);
    }
    if (typeof obj === 'object') {
      const candidate = obj.imdb || obj.imdbRating || obj.rating?.imdb || obj.rating?.filmCrypto?.imdbRating || obj.ratingImdb;
      if (candidate) {
        const num = parseFloat(candidate);
        if (!isNaN(num) && num > 0 && num <= 10) return num.toFixed(1);
      }
    }
    return '';
  }

  function deepFindImdbRating(obj) {
    if (!obj || typeof obj !== 'object') return '';

    const direct = parseImdbRating(obj);
    if (direct) return direct;

    if (obj.imdb) {
      const parsed = parseRatingValue(obj.imdb);
      if (parsed) return parsed;
    }
    if (obj.imdbRating) {
      const parsed = parseRatingValue(obj.imdbRating);
      if (parsed) return parsed;
    }

    for (const k of Object.keys(obj)) {
      if (k.toLowerCase().includes('imdb')) {
        const val = parseRatingValue(obj[k]);
        if (val) return val;
      }
    }

    return '';
  }

  function scanPageNextDataCache() {
    const scriptEl = document.getElementById('__NEXT_DATA__');
    if (!scriptEl) return;

    try {
      const data = JSON.parse(scriptEl.textContent);
      
      const scanObj = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        const id = obj.id || obj.filmId || obj.movieId || obj.contentId || obj.uuid || obj.kpId;
        const rawShortDesc = obj.topText || obj.shortDescription || obj.socialArgument || obj.shortSynopsis;
        const rawSynopsis = obj.synopsis || obj.description || obj.annotation;
        const rawTitle = obj.title || obj.name || obj.ruName || obj.russianTitle || obj.originalTitle;

        if (id && rawTitle && (rawShortDesc || rawSynopsis)) {
          const year = obj.year || (obj.releaseDate ? String(obj.releaseDate).substring(0, 4) : '');
          const rating = parseRatingValue(obj.rating) || parseRatingValue(obj.userRating) || parseRatingValue(obj.ratingValue);
          const ratingImdb = deepFindImdbRating(obj);

          const descToUse = rawShortDesc ? extractSmartSynopsis(rawShortDesc) : extractSmartSynopsis(rawSynopsis);

          descriptionCache[String(id)] = {
            filmId: String(id),
            title: cleanTitleString(rawTitle),
            year: year ? String(year) : '',
            rating,
            ratingImdb,
            runtimeText: '',
            description: descToUse
          };
        }

        if (Array.isArray(obj)) {
          for (const item of obj) scanObj(item);
        } else {
          for (const k of Object.keys(obj)) {
            if (k === 'navigation' || k === 'user' || k === 'session' || k === 'auth') continue;
            scanObj(obj[k]);
          }
        }
      };

      scanObj(data?.props?.pageProps);
    } catch (e) {}
  }

  function createTooltipElement() {
    if (document.getElementById('kp-dl-hover-tooltip')) {
      tooltipEl = document.getElementById('kp-dl-hover-tooltip');
      return;
    }

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'kp-dl-hover-tooltip';
    tooltipEl.className = 'kp-dl-hover-tooltip';
    tooltipEl.innerHTML = `
      <div class="kp-dl-tooltip-header">
        <div class="kp-dl-tooltip-title"></div>
        <div class="kp-dl-tooltip-ratings-container">
          <div class="kp-dl-tooltip-rating-kp" title="Рейтинг Кинопоиска"></div>
          <div class="kp-dl-tooltip-rating-imdb" title="Рейтинг IMDb"></div>
        </div>
      </div>
      <div class="kp-dl-tooltip-runtime"></div>
      <div class="kp-dl-tooltip-desc"></div>
    `;

    tooltipEl.addEventListener('mouseenter', () => {
      isMouseOverTooltip = true;
    });

    tooltipEl.addEventListener('mouseleave', () => {
      isMouseOverTooltip = false;
      setTimeout(() => {
        if (!isMouseOverLink && !isMouseOverTooltip) {
          hideTooltip();
        }
      }, 100);
    });

    document.body.appendChild(tooltipEl);
  }

  function positionTooltip(targetEl) {
    if (!tooltipEl || !targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const margin = 12;
    let left = rect.right + margin;
    let top = rect.top;

    if (left + tooltipRect.width > window.innerWidth - 16) {
      left = rect.left - tooltipRect.width - margin;
    }

    if (left < 16) {
      left = Math.max(16, rect.left + (rect.width - tooltipRect.width) / 2);
      top = rect.bottom + margin;
    }

    if (top + tooltipRect.height > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - tooltipRect.height - 16);
    }
    if (top < 16) top = 16;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function resetTooltipDOM() {
    if (!tooltipEl) return;
    const titleEl = tooltipEl.querySelector('.kp-dl-tooltip-title');
    const ratingKpEl = tooltipEl.querySelector('.kp-dl-tooltip-rating-kp');
    const ratingImdbEl = tooltipEl.querySelector('.kp-dl-tooltip-rating-imdb');
    const runtimeEl = tooltipEl.querySelector('.kp-dl-tooltip-runtime');
    const descEl = tooltipEl.querySelector('.kp-dl-tooltip-desc');

    if (titleEl) titleEl.innerText = '';
    if (ratingKpEl) {
      ratingKpEl.innerText = '';
      ratingKpEl.style.display = 'none';
    }
    if (ratingImdbEl) {
      ratingImdbEl.innerText = '';
      ratingImdbEl.style.display = 'none';
    }
    if (runtimeEl) {
      runtimeEl.innerText = '';
      runtimeEl.style.display = 'none';
    }
    if (descEl) descEl.innerText = '';
  }

  function hideTooltip() {
    if (isMouseOverTooltip) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    currentHoverFilmId = null;
    if (tooltipEl) {
      tooltipEl.classList.remove('visible');
      resetTooltipDOM();
    }
  }

  function showTooltipData(data, targetEl, isSeries = false) {
    if (!tooltipEl || !data) return;

    resetTooltipDOM();

    const titleEl = tooltipEl.querySelector('.kp-dl-tooltip-title');
    const ratingKpEl = tooltipEl.querySelector('.kp-dl-tooltip-rating-kp');
    const ratingImdbEl = tooltipEl.querySelector('.kp-dl-tooltip-rating-imdb');
    const runtimeEl = tooltipEl.querySelector('.kp-dl-tooltip-runtime');
    const descEl = tooltipEl.querySelector('.kp-dl-tooltip-desc');

    const cleanTitle = cleanTitleString(data.title);
    if (titleEl) titleEl.innerText = cleanTitle || 'Загрузка...';

    // Kinopoisk Rating (Orange Badge)
    const finalRatingKp = data.rating || extractCardRating(targetEl);
    if (ratingKpEl && finalRatingKp) {
      const numRating = parseFloat(finalRatingKp);
      if (!isNaN(numRating) && numRating > 0) {
        ratingKpEl.innerText = `КП ${numRating.toFixed(1)}`;
        ratingKpEl.style.display = 'inline-block';
      } else {
        ratingKpEl.style.display = 'none';
      }
    } else if (ratingKpEl) {
      ratingKpEl.style.display = 'none';
    }

    // IMDb Rating (Gold Badge)
    if (ratingImdbEl && data.ratingImdb) {
      const numImdb = parseFloat(data.ratingImdb);
      if (!isNaN(numImdb) && numImdb > 0) {
        ratingImdbEl.innerText = `IMDb ${numImdb.toFixed(1)}`;
        ratingImdbEl.style.display = 'inline-block';
      } else {
        ratingImdbEl.style.display = 'none';
      }
    } else if (ratingImdbEl) {
      ratingImdbEl.style.display = 'none';
    }

    // Runtime / Seasons
    if (runtimeEl && data.runtimeText) {
      runtimeEl.innerText = data.runtimeText;
      runtimeEl.style.display = 'block';
    } else if (runtimeEl) {
      runtimeEl.style.display = 'none';
    }

    const smartDesc = extractSmartSynopsis(data.description);
    if (descEl) {
      if (smartDesc) {
        descEl.innerText = smartDesc;
        descEl.style.display = 'block';
      } else {
        descEl.innerText = '';
        descEl.style.display = 'none';
      }
    }

    positionTooltip(targetEl);
    tooltipEl.classList.add('visible');
  }

  function initPosterHoverListeners() {
    scanPageNextDataCache();
    createTooltipElement();

    document.addEventListener('mouseover', (e) => {
      const currentUrlMatch = location.pathname.match(/\/(film|series)\/([a-zA-Z0-9_-]+)/);
      const currentPageFilmId = currentUrlMatch ? currentUrlMatch[2] : null;

      const link = e.target.closest('a[href*="/film/"], a[href*="/series/"]');
      if (!link) return;

      if (isPromoBannerLink(link)) {
        return;
      }

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/(film|series)\/([a-zA-Z0-9_-]+)/);
      if (!match) return;

      const filmId = match[2];
      const isSeries = href.includes('/series/') || match[1] === 'series';

      if (currentPageFilmId && filmId === currentPageFilmId) {
        return;
      }

      isMouseOverLink = true;
      currentHoverFilmId = filmId;
      clearTimeout(hoverTimer);

      const isCached = Boolean(descriptionCache[filmId] && (descriptionCache[filmId].ratingImdb || descriptionCache[filmId].description));
      const delayMs = isCached ? 20 : 120;

      const cardTitle = extractCardTitle(link);
      const cardRating = extractCardRating(link);

      hoverTimer = setTimeout(() => {
        if (currentHoverFilmId !== filmId) return;

        if (descriptionCache[filmId] && (descriptionCache[filmId].ratingImdb || descriptionCache[filmId].description)) {
          showTooltipData(descriptionCache[filmId], link, isSeries);
        } else {
          showTooltipData({
            title: cardTitle || 'Загрузка...',
            rating: cardRating,
            runtimeText: '',
            description: ''
          }, link, isSeries);

          // Direct XML Fetch if numeric ID
          if (/^\d+$/.test(filmId)) {
            fetchKinopoiskRatingXmlDirect(filmId).then(xmlData => {
              if (xmlData && (xmlData.imdb || xmlData.kp) && currentHoverFilmId === filmId) {
                if (!descriptionCache[filmId]) {
                  descriptionCache[filmId] = {
                    filmId,
                    title: cardTitle,
                    rating: cardRating || xmlData.kp,
                    ratingImdb: xmlData.imdb,
                    runtimeText: '',
                    description: ''
                  };
                } else {
                  if (xmlData.imdb) descriptionCache[filmId].ratingImdb = xmlData.imdb;
                  if (!descriptionCache[filmId].rating && xmlData.kp) descriptionCache[filmId].rating = xmlData.kp;
                }
                showTooltipData(descriptionCache[filmId], link, isSeries);
              }
            });
          }

          // Complete Description, Rating & Transliterated IMDb Fetch
          chrome.runtime.sendMessage({
            action: 'FETCH_FILM_DESCRIPTION',
            filmId: filmId,
            cardTitle: cardTitle,
            isSeries: isSeries
          }, (res) => {
            if (res && res.success && res.data) {
              if (cardRating && !res.data.rating) {
                res.data.rating = cardRating;
              }
              descriptionCache[filmId] = res.data;
              if (currentHoverFilmId === filmId) {
                showTooltipData(res.data, link, isSeries);
              }
            } else {
              if (currentHoverFilmId === filmId) {
                if (descriptionCache[filmId]) {
                  showTooltipData(descriptionCache[filmId], link, isSeries);
                } else {
                  showTooltipData({
                    title: cardTitle || 'Кинопоиск',
                    rating: cardRating,
                    runtimeText: '',
                    description: ''
                  }, link, isSeries);
                }
              }
            }
          });
        }
      }, delayMs);
    });

    document.addEventListener('mouseout', (e) => {
      const link = e.target.closest('a[href*="/film/"], a[href*="/series/"]');
      if (link) {
        isMouseOverLink = false;
        setTimeout(() => {
          if (!isMouseOverLink && !isMouseOverTooltip) {
            hideTooltip();
          }
        }, 120);
      }
    });

    window.addEventListener('scroll', () => {
      if (!isMouseOverTooltip) {
        hideTooltip();
      }
    }, { passive: true });
  }

  // --- Download Button Logic ---

  function getPluralSeeds(count) {
    if (count === 0) return '0 сидов';

    const abs = Math.abs(count);
    const mod100 = abs % 100;
    const mod10 = abs % 10;

    let word = 'сидов';
    if (mod100 >= 11 && mod100 <= 19) {
      word = 'сидов';
    } else if (mod10 === 1) {
      word = 'сид';
    } else if (mod10 >= 2 && mod10 <= 4) {
      word = 'сида';
    }

    return `~${count} ${word}`;
  }

  function sanitizePureTitle(str) {
    if (!str) return '';
    return str
      .replace(/[\u00a0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
      .replace(/\b\d+\+\b/g, '')
      .replace(/\(\s*сериал[^\)]*\)/gi, '')
      .replace(/\(\s*\d{4}[^\)]*\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractFilmData() {
    let ruTitle = '';
    let origTitle = '';
    let year = '';
    let isSeries = location.pathname.includes('/series/');

    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const item = Array.isArray(data) ? data.find(i => i['@type'] === 'Movie' || i['@type'] === 'TVSeries') : data;
        if (item) {
          if (item['@type'] === 'TVSeries') isSeries = true;
          if (item.name) ruTitle = item.name;
          if (item.alternateName) origTitle = item.alternateName;
          if (item.dateCreated) year = item.dateCreated.substring(0, 4);
          else if (item.releaseDate) year = item.releaseDate.substring(0, 4);
          else if (item.startDate) year = item.startDate.substring(0, 4);
          else if (item.copyrightYear) year = String(item.copyrightYear);
        }
      } catch (e) {}
    }

    const h1El = document.querySelector('h1');
    if (h1El) {
      const fullH1 = h1El.innerText || '';
      if (fullH1.toLowerCase().includes('сериал')) isSeries = true;

      const nameSpan = h1El.querySelector('[itemprop="name"]') || h1El.querySelector('span');
      if (nameSpan && nameSpan.innerText) {
        const candidate = sanitizePureTitle(nameSpan.innerText);
        if (candidate && candidate.length > 1) {
          if (!ruTitle) ruTitle = candidate;
        }
      }

      if (!ruTitle) {
        const cleanH1 = sanitizePureTitle(fullH1.split('(')[0]);
        if (cleanH1) ruTitle = cleanH1;
      }
    }

    if (!year && h1El) {
      const fullH1Text = h1El.innerText || '';
      const m = fullH1Text.match(/\b(19\d\d|20\d\d)\b/);
      if (m) year = m[1];
    }

    if (!year) {
      const yearAnchor = document.querySelector('a[href*="/lists/movies/year/"]');
      if (yearAnchor) year = yearAnchor.innerText.trim();
    }

    ruTitle = sanitizePureTitle(ruTitle);
    origTitle = sanitizePureTitle(origTitle);

    return { ruTitle, origTitle, year, isSeries };
  }

  function findInsertionTarget() {
    const h1El = document.querySelector('h1');
    if (!h1El) return null;

    let heroScope = h1El.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!heroScope || heroScope.tagName === 'BODY') break;
      if (heroScope.querySelector('button') || heroScope.querySelector('[role="button"]')) {
        break;
      }
      heroScope = heroScope.parentElement;
    }
    if (!heroScope) heroScope = h1El.parentElement;

    const allButtons = Array.from(heroScope.querySelectorAll('button, [role="button"], a'));

    const continueBtn = allButtons.find(btn => {
      const text = (btn.innerText || btn.textContent || '').trim();
      return text.includes('Продолжить просмотр') || text.includes('Продолжить');
    });

    const watchBtn = allButtons.find(btn => {
      const text = (btn.innerText || btn.textContent || '').trim();
      return text.startsWith('Смотреть');
    });

    const planBtn = allButtons.find(btn => {
      const text = (btn.innerText || btn.textContent || '').trim();
      return text.includes('Буду смотреть') || text.includes('В списках') || text.includes('В списке');
    });

    const refBtn = continueBtn || watchBtn || planBtn || allButtons[0];

    if (refBtn) {
      let parentRow = refBtn.parentElement;
      while (parentRow && parentRow !== heroScope) {
        const style = window.getComputedStyle(parentRow);
        if (style.display.includes('flex')) {
          break;
        }
        parentRow = parentRow.parentElement;
      }

      if (parentRow) {
        return { element: parentRow, position: 'afterRow', refBtn };
      }
    }

    return { element: h1El.parentElement, position: 'append' };
  }

  function fetchTorrents(filmData, callback) {
    isLoading = true;
    torrentsData = [];
    hasSearched = true;
    activeSeasonFilter = 'ALL';
    callback();

    console.log('[Kinopoisk Downloader v107.0] Searching torrents:', filmData);

    chrome.runtime.sendMessage({
      action: 'SEARCH_TORRENTS',
      ruTitle: filmData.ruTitle,
      origTitle: filmData.origTitle,
      year: filmData.year,
      isSeries: filmData.isSeries
    }, (response) => {
      isLoading = false;
      if (response && response.success && Array.isArray(response.results)) {
        torrentsData = response.results;
      } else {
        torrentsData = [];
      }
      callback();
    });
  }

  function getAvailableSeasons() {
    const singleSeasons = new Set();
    let hasPacks = false;

    for (const t of torrentsData) {
      if (!t.seasonData) continue;
      const s = t.seasonData;
      if (s.type === 'SINGLE') {
        singleSeasons.add(s.season);
      } else if (s.type === 'RANGE' || s.type === 'ALL_PACK') {
        hasPacks = true;
      }
    }

    return {
      singleSeasons: Array.from(singleSeasons).sort((a, b) => a - b),
      hasPacks
    };
  }

  function getFilteredTorrents() {
    return torrentsData.filter(t => {
      if (activeQualityFilter !== 'ALL' && t.quality !== activeQualityFilter) {
        return false;
      }
      if (activeAudioFilter !== 'ALL') {
        if (activeAudioFilter === 'DUB' && t.audioTag !== 'DUB') return false;
        if (activeAudioFilter === 'MVO' && t.audioTag !== 'MVO') return false;
        if (activeAudioFilter === 'AVO' && t.audioTag !== 'AVO') return false;
      }

      if (activeSeasonFilter !== 'ALL') {
        if (activeSeasonFilter === 'PACKS') {
          if (!t.seasonData || (t.seasonData.type !== 'RANGE' && t.seasonData.type !== 'ALL_PACK')) {
            return false;
          }
        } else {
          const targetSeason = parseInt(activeSeasonFilter, 10);
          if (!t.seasonData || t.seasonData.type !== 'SINGLE' || t.seasonData.season !== targetSeason) {
            return false;
          }
        }
      }

      return true;
    });
  }

  function handleTorrentDownload(t, btnElement) {
    const originalText = btnElement.innerText;
    btnElement.innerText = 'Загрузка...';
    btnElement.disabled = true;

    const filename = `${t.title}.torrent`;

    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_TORRENT_FILE',
      torrentUrl: t.torrentUrl,
      filename: filename
    }, (res) => {
      btnElement.innerText = originalText;
      btnElement.disabled = false;
    });
  }

  function createDownloadButton() {
    if (!isMainMediaPage()) return;

    if (document.getElementById('kp-dl-container')) return;

    const filmData = extractFilmData();
    if (!filmData.ruTitle) return;

    const target = findInsertionTarget();
    if (!target) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'kp-dl-container';
    wrapper.className = 'kp-dl-wrapper';

    const button = document.createElement('button');
    button.className = 'kp-dl-btn';
    button.type = 'button';
    button.innerHTML = `${ICONS.download} <span>Скачать</span>`;

    const menu = document.createElement('div');
    menu.className = 'kp-dl-menu';

    function renderMenu() {
      const filteredList = getFilteredTorrents();
      const seasonInfo = getAvailableSeasons();

      let seasonFilterHtml = '';
      if (seasonInfo.singleSeasons.length > 0 || seasonInfo.hasPacks) {
        seasonFilterHtml = `
          <div class="kp-dl-filter-group">
            <div class="kp-dl-filter-label">Сезон</div>
            <div class="kp-dl-filters">
              <button type="button" class="kp-dl-filter-btn ${activeSeasonFilter === 'ALL' ? 'active' : ''}" data-season="ALL">Все раздачи</button>
              ${seasonInfo.hasPacks ? `
                <button type="button" class="kp-dl-filter-btn ${activeSeasonFilter === 'PACKS' ? 'active' : ''}" data-season="PACKS">Полный</button>
              ` : ''}
              ${seasonInfo.singleSeasons.map(sNum => `
                <button type="button" class="kp-dl-filter-btn ${activeSeasonFilter === String(sNum) ? 'active' : ''}" data-season="${sNum}">${sNum} сезон</button>
              `).join('')}
            </div>
          </div>
        `;
      }

      let contentHtml = '';

      if (isLoading) {
        contentHtml = `
          <div class="kp-dl-loading">
            <div class="kp-dl-spinner"></div>
            <span>Поиск раздач...</span>
          </div>
        `;
      } else if (filteredList.length === 0) {
        contentHtml = `
          <div class="kp-dl-empty">
            <span>Раздач по выбранным фильтрам не найдено</span>
          </div>
        `;
      } else {
        contentHtml = `
          <div class="kp-dl-list">
            ${filteredList.map((t, idx) => {
              const seedText = getPluralSeeds(t.seeds);
              const seedDisplay = `<span class="kp-dl-seeds">${seedText}</span>`;
              const seasonTagDisplay = t.seasonData ? `<span class="kp-dl-badge kp-dl-badge-season">${t.seasonData.label}</span>` : '';
              const epTagDisplay = t.episodeData ? `<span class="kp-dl-badge kp-dl-badge-ep">${t.episodeData.label}</span>` : '';

              return `
                <div class="kp-dl-torrent-card">
                  <div class="kp-dl-torrent-header">
                    <div class="kp-dl-torrent-title">${t.title}</div>
                    <div class="kp-dl-header-right">
                      ${seasonTagDisplay}
                      ${epTagDisplay}
                      <span class="kp-dl-badge">${t.quality}</span>
                    </div>
                  </div>
                  
                  <div class="kp-dl-torrent-meta">
                    <span class="kp-dl-audio-tag">${t.audioName}</span>
                    <span class="kp-dl-size">${t.size} • ${seedDisplay}</span>
                  </div>

                  <div class="kp-dl-actions">
                    <button type="button" class="kp-dl-main-download-btn" data-torrent-idx="${idx}">
                      ${ICONS.file} <span>Скачать .torrent</span>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      menu.innerHTML = `
        <div class="kp-dl-header">
          <span class="kp-dl-title">Торрент-раздачи (${filteredList.length})</span>
          <button type="button" class="kp-dl-refresh-btn" title="Обновить список раздач">
            ${ICONS.refresh} <span>Обновить</span>
          </button>
        </div>

        ${seasonFilterHtml}

        <div class="kp-dl-filter-group">
          <div class="kp-dl-filter-label">Озвучка</div>
          <div class="kp-dl-filters">
            <button type="button" class="kp-dl-filter-btn ${activeAudioFilter === 'ALL' ? 'active' : ''}" data-audio="ALL">Все</button>
            <button type="button" class="kp-dl-filter-btn ${activeAudioFilter === 'DUB' ? 'active' : ''}" data-audio="DUB">Дубляж</button>
            <button type="button" class="kp-dl-filter-btn ${activeAudioFilter === 'MVO' ? 'active' : ''}" data-audio="MVO">Студии / MVO</button>
            <button type="button" class="kp-dl-filter-btn ${activeAudioFilter === 'AVO' ? 'active' : ''}" data-audio="AVO">Авторский / AVO</button>
          </div>
        </div>

        <div class="kp-dl-filter-group">
          <div class="kp-dl-filter-label">Качество</div>
          <div class="kp-dl-filters">
            <button type="button" class="kp-dl-filter-btn ${activeQualityFilter === 'ALL' ? 'active' : ''}" data-quality="ALL">Всё</button>
            <button type="button" class="kp-dl-filter-btn ${activeQualityFilter === '4K' ? 'active' : ''}" data-quality="4K">4K</button>
            <button type="button" class="kp-dl-filter-btn ${activeQualityFilter === '1080p' ? 'active' : ''}" data-quality="1080p">1080p</button>
            <button type="button" class="kp-dl-filter-btn ${activeQualityFilter === '720p' ? 'active' : ''}" data-quality="720p">720p</button>
            <button type="button" class="kp-dl-filter-btn ${activeQualityFilter === '576p' ? 'active' : ''}" data-quality="576p">576p</button>
            <button type="button" class="kp-dl-filter-btn ${activeQualityFilter === '480p' ? 'active' : ''}" data-quality="480p">480p</button>
          </div>
        </div>

        ${contentHtml}
      `;

      const refreshBtn = menu.querySelector('.kp-dl-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          fetchTorrents(filmData, renderMenu);
        });
      }

      menu.querySelectorAll('[data-season]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          activeSeasonFilter = btn.dataset.season;
          renderMenu();
        });
      });

      menu.querySelectorAll('[data-torrent-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.torrentIdx, 10);
          const torrentItem = filteredList[idx];
          if (torrentItem) {
            handleTorrentDownload(torrentItem, btn);
          }
        });
      });

      menu.querySelectorAll('[data-quality]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          activeQualityFilter = btn.dataset.quality;
          renderMenu();
        });
      });

      menu.querySelectorAll('[data-audio]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          activeAudioFilter = btn.dataset.audio;
          renderMenu();
        });
      });
    }

    renderMenu();

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = wrapper.classList.toggle('active');
      if (isActive && !hasSearched && !isLoading) {
        fetchTorrents(filmData, renderMenu);
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove('active');
      }
    });

    wrapper.appendChild(button);
    wrapper.appendChild(menu);

    if (target.position === 'afterRow' && target.element.parentNode) {
      target.element.parentNode.insertBefore(wrapper, target.element.nextSibling);
      if (target.refBtn) {
        const syncWidth = () => {
          const w = target.refBtn.offsetWidth;
          if (w > 40) {
            button.style.width = `${w}px`;
          }
        };
        syncWidth();
        setTimeout(syncWidth, 100);
        setTimeout(syncWidth, 300);
      }
    } else if (target.position === 'after' && target.element.parentNode) {
      target.element.parentNode.insertBefore(wrapper, target.element.nextSibling);
    } else {
      target.element.appendChild(wrapper);
    }
  }

  function checkDownloadButtonState() {
    const existing = document.getElementById('kp-dl-container');
    if (!isMainMediaPage()) {
      if (existing) existing.remove();
    } else {
      if (!existing) {
        createDownloadButton();
      }
      injectMainPageImdbBadge();
    }
  }

  function init() {
    initPosterHoverListeners();
    checkDownloadButtonState();

    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        checkDownloadButtonState();
      }, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
