/**
 * Kinopoisk Downloader - Content Script v75.0.0
 * Instant Local SSR Cache Scanner with topText priority
 */

(function () {
  'use strict';

  console.log('[Kinopoisk Downloader] Active v75.0.0');

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

  // --- Hover Tooltip Feature ---
  let tooltipEl = null;
  let hoverTimer = null;
  let currentHoverFilmId = null;
  const descriptionCache = {};

  function cleanTitleString(str) {
    if (!str) return '';
    return str
      .replace(/^["'«»“”„\s]+|["'«»“”„\s]+$/g, '')
      .replace(/&quot;/g, '')
      .replace(/&laquo;/g, '')
      .replace(/&raquo;/g, '')
      .trim();
  }

  // Instant local scanner of page's own __NEXT_DATA__
  function scanPageNextDataCache() {
    const scriptEl = document.getElementById('__NEXT_DATA__');
    if (!scriptEl) return;

    try {
      const data = JSON.parse(scriptEl.textContent);
      
      const scanObj = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        const id = obj.id || obj.filmId || obj.movieId;
        const shortDesc = obj.topText || obj.shortDescription || obj.synopsis || obj.slogan;
        const rawTitle = obj.title || obj.name || obj.ruName || obj.russianTitle;

        if (id && rawTitle && shortDesc) {
          const year = obj.year || (obj.releaseDate ? String(obj.releaseDate).substring(0, 4) : '');
          let rating = '';
          const r = obj.rating?.filmCrypto?.rating || obj.rating?.rating || obj.ratingValue || obj.rating;
          if (r) {
            const numR = parseFloat(r);
            if (!isNaN(numR) && numR > 0) rating = numR.toFixed(1);
          }

          descriptionCache[String(id)] = {
            filmId: String(id),
            title: cleanTitleString(rawTitle),
            year: year ? String(year) : '',
            rating,
            description: shortDesc.trim()
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
        <div class="kp-dl-tooltip-rating"></div>
      </div>
      <div class="kp-dl-tooltip-meta">
        <span class="kp-dl-tooltip-year"></span>
      </div>
      <div class="kp-dl-tooltip-desc"></div>
    `;
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

  function hideTooltip() {
    if (hoverTimer) clearTimeout(hoverTimer);
    currentHoverFilmId = null;
    if (tooltipEl) {
      tooltipEl.classList.remove('visible');
    }
  }

  function showTooltipData(data, targetEl) {
    if (!tooltipEl || !data) return;

    const titleEl = tooltipEl.querySelector('.kp-dl-tooltip-title');
    const ratingEl = tooltipEl.querySelector('.kp-dl-tooltip-rating');
    const yearEl = tooltipEl.querySelector('.kp-dl-tooltip-year');
    const descEl = tooltipEl.querySelector('.kp-dl-tooltip-desc');

    if (titleEl) titleEl.innerText = cleanTitleString(data.title) || 'Без названия';

    if (ratingEl) {
      if (data.rating) {
        const numRating = parseFloat(data.rating);
        if (!isNaN(numRating) && numRating > 0) {
          const roundedRating = numRating.toFixed(1);
          ratingEl.innerText = roundedRating;
          ratingEl.style.display = 'inline-block';
          if (numRating >= 7.5) ratingEl.style.background = '#3bb33b';
          else if (numRating >= 6.0) ratingEl.style.background = '#777777';
          else ratingEl.style.background = '#e65050';
        } else {
          ratingEl.style.display = 'none';
        }
      } else {
        ratingEl.style.display = 'none';
      }
    }

    if (yearEl) yearEl.innerText = data.year ? `${data.year} г.` : '';
    if (descEl) descEl.innerText = data.description || 'Краткое описание отсутствует.';

    positionTooltip(targetEl);
    tooltipEl.classList.add('visible');
  }

  function initPosterHoverListeners() {
    scanPageNextDataCache();
    createTooltipElement();

    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest('a[href*="/film/"], a[href*="/series/"]');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/(film|series)\/(\d+)/);
      if (!match) return;

      const filmId = match[2];

      if (location.pathname.includes(`/film/${filmId}/`) || location.pathname.includes(`/series/${filmId}/`)) {
        const h1 = document.querySelector('h1');
        if (h1 && h1.parentElement && h1.parentElement.contains(link)) return;
      }

      currentHoverFilmId = filmId;
      clearTimeout(hoverTimer);

      const isCached = Boolean(descriptionCache[filmId]);
      const delayMs = isCached ? 50 : 180;

      hoverTimer = setTimeout(() => {
        if (currentHoverFilmId !== filmId) return;

        if (descriptionCache[filmId]) {
          showTooltipData(descriptionCache[filmId], link);
        } else {
          showTooltipData({
            title: 'Загрузка...',
            description: 'Получение краткого описания...'
          }, link);

          chrome.runtime.sendMessage({
            action: 'FETCH_FILM_DESCRIPTION',
            filmId: filmId
          }, (res) => {
            if (res && res.success && res.data) {
              descriptionCache[filmId] = res.data;
              if (currentHoverFilmId === filmId) {
                showTooltipData(res.data, link);
              }
            } else {
              if (currentHoverFilmId === filmId) {
                showTooltipData({
                  title: 'Описание не найдено',
                  description: 'Не удалось загрузить краткое описание.'
                }, link);
              }
            }
          });
        }
      }, delayMs);
    });

    document.addEventListener('mouseout', (e) => {
      const link = e.target.closest('a[href*="/film/"], a[href*="/series/"]');
      if (link) {
        hideTooltip();
      }
    });

    window.addEventListener('scroll', () => {
      hideTooltip();
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

    console.log('[Kinopoisk Downloader v75.0] Searching torrents:', filmData);

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
    if (!location.pathname.includes('/film/') && !location.pathname.includes('/series/')) return;
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

  function init() {
    initPosterHoverListeners();
    createDownloadButton();

    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!document.getElementById('kp-dl-container')) {
          createDownloadButton();
        }
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
