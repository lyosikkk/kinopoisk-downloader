/**
 * Kinopoisk Downloader - Background v106.0.0
 * Pure Title Filter (Genre & Year Stripper) + HD Kinopoisk UUID Resolver + Rating XML
 */

const globalDescriptionCache = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SEARCH_TORRENTS') {
    searchMovieTorrents(request.ruTitle, request.origTitle, request.year, request.isSeries)
      .then(results => sendResponse({ success: true, results }))
      .catch(err => {
        console.error('[Background] Search error:', err);
        sendResponse({ success: false, error: err.message, results: [] });
      });
    return true;
  }

  if (request.action === 'DOWNLOAD_TORRENT_FILE') {
    downloadRealTorrentFile(request.torrentUrl, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'FETCH_FILM_DESCRIPTION') {
    fetchFilmDescription(request.filmId, request.cardTitle, request.isSeries)
      .then(data => sendResponse({ success: Boolean(data), data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function cyrillicToTranslit(text) {
  if (!text) return '';
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
    'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
    'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
    'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
  };
  return text.toLowerCase().split('').map(ch => map[ch] || ch).join('');
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

function parseRatingValue(rObj) {
  if (!rObj) return '';
  if (typeof rObj === 'number' || typeof rObj === 'string') {
    const num = parseFloat(rObj);
    if (!isNaN(num) && num > 0 && num <= 10) return num.toFixed(1);
  }
  if (typeof rObj === 'object') {
    const candidate = rObj.kp || rObj.value || rObj.rating || rObj.ratingValue || rObj.filmCrypto?.rating || rObj.percentage || rObj.user;
    if (candidate) {
      const num = parseFloat(candidate);
      if (!isNaN(num) && num > 0 && num <= 10) return num.toFixed(1);
    }
  }
  return '';
}

async function fetchKinopoiskRatingXml(filmId) {
  if (!filmId || !/^\d+$/.test(String(filmId))) return null;
  try {
    const url = `https://rating.kinopoisk.ru/${filmId}.xml`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const text = await res.text();
      const kpMatch = text.match(/<kp_rating[^>]*>([\d\.]+)</i);
      const imdbMatch = text.match(/<imdb_rating[^>]*>([\d\.]+)</i);

      let kp = '';
      let imdb = '';

      if (kpMatch) {
        const num = parseFloat(kpMatch[1]);
        if (!isNaN(num) && num > 0) kp = num.toFixed(1);
      }
      if (imdbMatch) {
        const num = parseFloat(imdbMatch[1]);
        if (!isNaN(num) && num > 0) imdb = num.toFixed(1);
      }

      return { kp, imdb };
    }
  } catch (e) {}
  return null;
}

function parseIsoDuration(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str > 0 && str < 600 ? str : 0;
  const s = String(str).trim();

  if (/^\d+$/.test(s)) {
    const val = parseInt(s, 10);
    return val > 0 && val < 600 ? val : 0;
  }

  const match = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (match) {
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    if (hours > 0 || minutes > 0) {
      return hours * 60 + minutes;
    }
  }

  const hMatch = s.match(/(\d+)\s*ч/i);
  const mMatch = s.match(/(\d+)\s*мин/i);
  if (hMatch || mMatch) {
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const m = mMatch ? parseInt(mMatch[1], 10) : 0;
    return h * 60 + m;
  }

  return 0;
}

function getExactKinopoiskRuntimeFromHtml(html) {
  if (!html) return '';

  const vremyaMatch = html.match(/Время[\s\S]{1,400}?(\d{1,2}\s*ч\s*\d{1,2}\s*мин|\d{2,3}\s*мин)/i);
  if (vremyaMatch) {
    const str = vremyaMatch[1].trim();
    if (str.includes('ч')) {
      return str;
    }
    const mins = parseInt(str, 10);
    if (!isNaN(mins) && mins > 0) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
    }
  }

  const isoMatch = html.match(/itemprop="duration"[^>]*content="([^"]+)"/i) ||
                   html.match(/"duration":\s*"([^"]+)"/i);
  if (isoMatch) {
    const mins = parseIsoDuration(isoMatch[1]);
    if (mins > 0) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
    }
  }

  return '';
}

async function fetchTrueImdbRating(imdbId, origTitle = '', cardTitle = '', year = '', fallbackImdb = '') {
  let targetId = imdbId;

  if (!targetId) {
    const candidates = [
      origTitle,
      cyrillicToTranslit(cardTitle),
      cardTitle
    ].filter(Boolean);

    for (const rawQ of candidates) {
      if (targetId) break;
      try {
        const q = rawQ.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (q && q.length >= 2) {
          const firstChar = q.charAt(0);
          const sugUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(q)}.json`;
          
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1200);
          
          const sugRes = await fetch(sugUrl, { signal: controller.signal });
          clearTimeout(timer);

          if (sugRes.ok) {
            const sugData = await sugRes.json();
            if (sugData && Array.isArray(sugData.d) && sugData.d.length > 0) {
              let match = null;
              if (year) {
                const targetY = parseInt(year, 10);
                match = sugData.d.find(item => item.id && item.id.startsWith('tt') && item.y && Math.abs(item.y - targetY) <= 1);
              }
              if (!match) {
                match = sugData.d.find(item => item.id && item.id.startsWith('tt'));
              }
              if (match) targetId = match.id;
            }
          }
        }
      } catch (e) {}
    }
  }

  if (targetId) {
    try {
      const imdbUrl = `https://www.imdb.com/title/${targetId}/`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);

      const res = await fetch(imdbUrl, {
        signal: controller.signal,
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timer);

      if (res.ok) {
        const html = await res.text();
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
        if (jsonLdMatch) {
          try {
            const ldData = JSON.parse(jsonLdMatch[1]);
            const ratingVal = ldData?.aggregateRating?.ratingValue;
            if (ratingVal) {
              const num = parseFloat(ratingVal);
              if (!isNaN(num) && num > 0 && num <= 10) {
                return num.toFixed(1);
              }
            }
          } catch (e) {}
        }

        const ratingMatch = html.match(/"ratingValue":\s*"?([\d\.]+)"?/i) || html.match(/aggregateRating[\s\S]{1,100}?([\d\.]+)/i);
        if (ratingMatch) {
          const num = parseFloat(ratingMatch[1]);
          if (!isNaN(num) && num > 0 && num <= 10) {
            return num.toFixed(1);
          }
        }
      }
    } catch (e) {}
  }

  return fallbackImdb ? parseRatingValue(fallbackImdb) : '';
}

function deepFindImdbId(obj) {
  if (!obj || typeof obj !== 'object') return '';

  if (typeof obj.imdbId === 'string' && obj.imdbId.startsWith('tt')) return obj.imdbId;
  if (typeof obj.externalId?.imdb === 'string' && obj.externalId.imdb.startsWith('tt')) return obj.externalId.imdb;
  if (typeof obj.filmCrypto?.imdbId === 'string' && obj.filmCrypto.imdbId.startsWith('tt')) return obj.filmCrypto.imdbId;

  for (const k of Object.keys(obj)) {
    if (k.toLowerCase().includes('imdb') && typeof obj[k] === 'string' && obj[k].startsWith('tt')) {
      return obj[k];
    }
  }

  return '';
}

function deepFindFallbackImdbRating(obj) {
  if (!obj || typeof obj !== 'object') return '';

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

function formatRuntimeText(durationInput, seasonsCount, isSeries) {
  if (isSeries) {
    let s = seasonsCount ? parseInt(seasonsCount, 10) : 1;
    if (isNaN(s) || s < 1) s = 1;

    let sWord = 'сезонов';
    const mod100 = s % 100;
    const mod10 = s % 10;
    if (mod100 >= 11 && mod100 <= 19) sWord = 'сезонов';
    else if (mod10 === 1) sWord = 'сезон';
    else if (mod10 >= 2 && mod10 <= 4) sWord = 'сезона';
    return `${s} ${sWord}`;
  }

  if (typeof durationInput === 'string' && durationInput.includes('мин')) {
    return durationInput;
  }

  const m = parseIsoDuration(durationInput);
  if (m && m > 0) {
    if (m >= 60) {
      const hours = Math.floor(m / 60);
      const remMin = m % 60;
      return remMin > 0 ? `${hours} ч ${remMin} мин` : `${hours} ч`;
    } else {
      return `${m} мин`;
    }
  }

  return '';
}

function findKinopoiskMediaData(obj, targetId, targetTitle = '', hintIsSeries = false) {
  if (!obj || typeof obj !== 'object') return null;

  const currentId = obj.id || obj.filmId || obj.movieId || obj.contentId || obj.uuid || obj.kpId;
  const isMatchId = currentId && (String(currentId) === String(targetId) || String(obj.kpId) === String(targetId));

  const rawShortDesc = obj.topText || obj.shortDescription || obj.socialArgument || obj.shortSynopsis;
  const rawSynopsis = obj.synopsis || obj.description || obj.annotation;
  const rawTitle = obj.title || obj.name || obj.ruName || obj.russianTitle || obj.originalTitle;
  const origTitle = obj.originalTitle || obj.englishTitle || '';

  const cleanRawTitle = rawTitle ? cleanTitleString(rawTitle) : '';

  if (isMatchId) {
    if (rawTitle && (rawShortDesc || rawSynopsis)) {
      const year = obj.year || (obj.releaseDate ? String(obj.releaseDate).substring(0, 4) : '');
      const rating = parseRatingValue(obj.rating) || parseRatingValue(obj.userRating) || parseRatingValue(obj.ratingValue);
      
      const imdbId = deepFindImdbId(obj);
      const fallbackImdb = deepFindFallbackImdbRating(obj);

      let seasonsCount = obj.seasonsCount || obj.totalSeasons || obj.seasonsInfo?.seasonsCount;
      if (!seasonsCount && Array.isArray(obj.seasons)) {
        seasonsCount = obj.seasons.length;
      }

      const descToUse = rawShortDesc ? extractSmartSynopsis(rawShortDesc) : extractSmartSynopsis(rawSynopsis);

      if (descToUse || cleanRawTitle) {
        return {
          filmId: String(targetId),
          imdbId,
          fallbackImdb,
          origTitle,
          title: cleanRawTitle,
          year: year ? String(year) : '',
          rating,
          ratingImdb: '',
          runtimeText: '',
          description: descToUse || ''
        };
      }
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findKinopoiskMediaData(item, targetId, targetTitle, hintIsSeries);
      if (res) return res;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key === 'navigation' || key === 'user' || key === 'session' || key === 'auth') continue;
      const res = findKinopoiskMediaData(obj[key], targetId, targetTitle, hintIsSeries);
      if (res) return res;
    }
  }

  return null;
}

async function fetchFullHtmlStream(url, signal) {
  try {
    const res = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: {
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9'
      }
    });

    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function fetchFilmDescription(filmId, cardTitle = '', hintIsSeries = false) {
  if (!filmId) return null;

  const safeFilmId = String(filmId);

  if (globalDescriptionCache[safeFilmId] && globalDescriptionCache[safeFilmId].ratingImdb) {
    return globalDescriptionCache[safeFilmId];
  }

  // 1. Instantly fetch Kinopoisk Rating XML API if numeric ID
  const xmlData = await fetchKinopoiskRatingXml(safeFilmId);

  const isUuid = safeFilmId.length > 15 || safeFilmId.includes('-');
  const targetUrl = isUuid 
    ? `https://hd.kinopoisk.ru/film/${safeFilmId}`
    : (hintIsSeries ? `https://www.kinopoisk.ru/series/${safeFilmId}/` : `https://www.kinopoisk.ru/film/${safeFilmId}/`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const html = await fetchFullHtmlStream(targetUrl, controller.signal);
    clearTimeout(timeoutId);

    let finalImdbRating = xmlData?.imdb || '';

    if (html && html.length > 200) {
      let found = null;
      let imdbId = '';
      let fallbackImdb = xmlData?.imdb || '';

      const ttMatches = Array.from(html.matchAll(/tt\d{7,8}/gi));
      if (ttMatches.length > 0) {
        imdbId = ttMatches[0][0];
      }

      const kpImdbMatch = html.match(/IMDb:\s*([\d\.]+)/i) || html.match(/"imdb":\s*([\d\.]+)/i) || html.match(/"ratingImdb":\s*"?([\d\.]+)"?/i);
      if (kpImdbMatch && !fallbackImdb) fallbackImdb = kpImdbMatch[1];

      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          found = findKinopoiskMediaData(nextData?.props?.pageProps, safeFilmId, cardTitle, hintIsSeries);
          if (found && found.imdbId) imdbId = found.imdbId;
          if (found && found.fallbackImdb && !fallbackImdb) fallbackImdb = found.fallbackImdb;
        } catch (e) {}
      }

      let origTitle = found?.origTitle || '';
      if (!origTitle) {
        const origMatch = html.match(/class="[^"]*originalTitle[^"]*"[^>]*>([^<]+)</i);
        if (origMatch) origTitle = origMatch[1].trim();
      }

      const exactHtmlRuntime = getExactKinopoiskRuntimeFromHtml(html);

      let seasonsCount = null;
      const seasonsMatch = html.match(/(\d+)\s*сезон/i) || html.match(/"seasonsCount":\s*(\d+)/i);
      if (seasonsMatch) seasonsCount = seasonsMatch[1];

      const runtimeText = formatRuntimeText(exactHtmlRuntime, seasonsCount, hintIsSeries || Boolean(seasonsCount));

      if (!finalImdbRating) {
        const liveImdb = await fetchTrueImdbRating(imdbId, origTitle, cardTitle, found?.year, fallbackImdb);
        finalImdbRating = liveImdb || parseRatingValue(fallbackImdb);
      }

      if (found) {
        found.filmId = safeFilmId;
        found.ratingImdb = finalImdbRating;
        if (runtimeText) {
          found.runtimeText = runtimeText;
        }
        globalDescriptionCache[safeFilmId] = found;
        return found;
      }

      // HTML Regex fallback
      let shortDesc = '';
      let title = cardTitle ? cleanTitleString(cardTitle) : '';
      let year = '';
      let rating = xmlData?.kp || '';

      const topTextMatch = html.match(/class="[^"]*topText[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                           html.match(/class="[^"]*socialArgument[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                           html.match(/class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
                           html.match(/data-tid="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                           html.match(/meta\s+name="description"\s+content="([^"]+)"/i);
      if (topTextMatch) {
        shortDesc = extractSmartSynopsis(topTextMatch[1].replace(/<[^>]+>/g, ''));
      }

      if (!rating) {
        const ratingMatch = html.match(/"ratingValue":\s*"?([\d\.]+)"?/i) ||
                            html.match(/property="video:rating"\s+content="([\d\.]+)"/i) ||
                            html.match(/"rating":\s*\{[^}]*"kp":\s*([\d\.]+)/i);
        if (ratingMatch) {
          const numR = parseFloat(ratingMatch[1]);
          if (!isNaN(numR) && numR > 0) rating = numR.toFixed(1);
        }
      }

      const yearMatch = html.match(/<a href="\/lists\/movies\/year\/(\d{4})\/"/i) ||
                        html.match(/(\d{4})\s*г\./i);
      if (yearMatch) year = yearMatch[1];

      const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitle && !title) {
        title = cleanTitleString(ogTitle[1].split('(')[0]);
      }

      if (shortDesc || title) {
        const result = {
          filmId: safeFilmId,
          title: title || 'Кинопоиск',
          year: year ? String(year) : '',
          rating,
          ratingImdb: finalImdbRating,
          runtimeText: runtimeText || '',
          description: shortDesc || ''
        };
        globalDescriptionCache[safeFilmId] = result;
        return result;
      }
    }

    if (xmlData && (xmlData.imdb || xmlData.kp)) {
      const result = {
        filmId: safeFilmId,
        title: cardTitle ? cleanTitleString(cardTitle) : 'Кинопоиск',
        year: '',
        rating: xmlData.kp,
        ratingImdb: xmlData.imdb,
        runtimeText: '',
        description: ''
      };
      globalDescriptionCache[safeFilmId] = result;
      return result;
    }
  } catch (e) {}

  return null;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function downloadRealTorrentFile(rawUrl, filename) {
  const safeFilename = (filename || 'movie.torrent').replace(/[/\\?%*:|"<>]/g, '_');
  console.log('[Background v106.0] Fetching pure .torrent file:', rawUrl);

  const downloadTargets = [
    rawUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`
  ];

  for (const target of downloadTargets) {
    try {
      const res = await fetch(target);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer && buffer.byteLength > 100) {
          const base64 = arrayBufferToBase64(buffer);
          const dataUrl = `data:application/x-bittorrent;base64,${base64}`;

          await chrome.downloads.download({
            url: dataUrl,
            filename: safeFilename,
            saveAs: false
          });

          return;
        }
      }
    } catch (e) {}
  }

  throw new Error('Не удалось скачать .torrent файл');
}

const UNIVERSAL_JUNK_KEYWORDS = [
  'OST', 'SOUNDTRACK', 'MP3', 'FLAC', 'LOSSLESS', 'ДИСКОГРАФИЯ',
  'МУЗЫКА', 'КЛИП', 'CONCERT', 'КОНЦЕРТ', 'TRAILER', 'ТРЕЙЛЕР', 'ALBUM', 'АЛЬБОМ',
  'ДОПОЛНИТЕЛЬНЫЕ МАТЕРИАЛЫ', 'ДОП. МАТЕРИАЛЫ', 'BONUS', 'BONUSES', 'MAKING OF', 'EXTRAS'
];

const TORRENT_TECH_TAGS = new Set([
  'bdrip', 'webrip', 'web-dl', 'webdl', 'hdtv', 'hdtvrip', 'dvdrip', 'dvd', 'remux', 'satrip', 'tvrip',
  '1080p', '720p', '2160p', '4k', 'uhd', 'hevc', 'x264', 'x265', 'h264', 'h265', 'hdr', 'hdr10', 'dovi',
  'dub', 'mvo', 'avo', 'dubbing', 'lostfilm', 'hdrezka', 'redheadsound', 'rhs', 'exkinoray', 'generalfilm',
  'сезон', 'сезоны', 'серия', 'серии', 'серий', 'complete'
]);

function sanitizeString(str) {
  if (!str) return '';
  return str
    .replace(/[\u00a0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectQuality(title) {
  const t = title.toUpperCase();

  if (t.includes('2160P') || t.includes('4K') || t.includes('UHD') || t.includes('3840X2160')) {
    return '4K';
  }
  if (t.includes('1080P') || t.includes('FULLHD') || t.includes('1080I') || t.includes('1920X1080')) {
    return '1080p';
  }
  if (t.includes('720P') || t.includes('1280X720') || t.includes('HDTV')) {
    return '720p';
  }
  if (t.includes('576P') || t.includes('576I') || t.includes('720X576') || t.includes('DVDRIP') || t.includes('DVD5') || t.includes('DVD9') || t.includes('DVD')) {
    return '576p';
  }
  if (t.includes('480P') || t.includes('480I') || t.includes('640X480') || t.includes('704X480') || t.includes('SATRIP') || t.includes('TVRIP')) {
    return '480p';
  }

  return '1080p';
}

function detectAudioStudio(title) {
  const t = title.toUpperCase();

  if (t.includes('ГОБЛИН') || t.includes('ПУЧКОВ')) return { tag: 'AVO', name: 'Гоблин' };
  if (t.includes('СЕРБИН')) return { tag: 'AVO', name: 'Юрий Сербин' };
  if (t.includes('ГАВРИЛОВ')) return { tag: 'AVO', name: 'Андрей Гаврилов' };
  if (t.includes('ЖИВОВ')) return { tag: 'AVO', name: 'Юрий Живов' };
  if (t.includes('ВОЛОДАРСКИЙ')) return { tag: 'AVO', name: 'Леонид Володарский' };
  if (t.includes('МИХАЛЕВ') || t.includes('МИХАЛЁВ')) return { tag: 'AVO', name: 'Алексей Михалев' };
  if (t.includes('ГОРЧАКОВ')) return { tag: 'AVO', name: 'Василий Горчаков' };

  if (t.includes('КУБИК В КУБЕ')) return { tag: 'MVO', name: 'Кубик в кубе' };
  if (t.includes('LOSTFILM')) return { tag: 'MVO', name: 'LostFilm' };
  if (t.includes('HDREZKA')) return { tag: 'MVO', name: 'HDRezka' };
  if (t.includes('RED HEAD SOUND') || t.includes('RHS')) return { tag: 'MVO', name: 'Red Head Sound' };

  if (/\bA\d?\b/.test(title) && (title.includes('|') || title.includes('['))) {
    if (title.includes(' A ') || title.includes(', A') || title.includes('| A')) {
      return { tag: 'AVO', name: 'Авторский (AVO)' };
    }
  }

  if (/\bP\d?\b/.test(title) && (title.includes('|') || title.includes('['))) {
    if (title.includes(' P ') || title.includes(', P') || title.includes('| P') || title.includes(' P2')) {
      return { tag: 'MVO', name: 'Многоголосый (MVO)' };
    }
  }

  if (t.includes('ДУБЛЯЖ') || t.includes('ДУБЛИРОВАН') || t.includes('ITUNES') || t.includes('ПИФАГОР') || t.includes('НЕВАФИЛЬМ')) {
    return { tag: 'DUB', name: 'Дубляж' };
  }
  if (t.includes('AVO') || t.includes('ОДНОГОЛОС')) {
    return { tag: 'AVO', name: 'Авторский' };
  }
  if (t.includes('MVO') || t.includes('МНОГОГОЛОС')) {
    return { tag: 'MVO', name: 'Многоголосый' };
  }

  return { tag: 'DUB', name: 'Профессиональный' };
}

function detectSeason(title) {
  const upper = title.toUpperCase();
  
  const seasonRangeMatch = upper.match(/СЕЗОН[Ы]?\s*(\d+)\s*[-–—]\s*(\d+)/) || 
                           upper.match(/(\d+)\s*[-–—]\s*(\d+)\s*СЕЗОН/) || 
                           upper.match(/S(\d+)\s*[-–—]\s*S?(\d+)/);
  if (seasonRangeMatch) {
    const from = parseInt(seasonRangeMatch[1], 10);
    const to = parseInt(seasonRangeMatch[2], 10);
    if (from !== to) {
      return {
        type: 'RANGE',
        from,
        to,
        label: `Сезоны ${from}-${to}`
      };
    }
  }

  const singleSeasonMatch = upper.match(/СЕЗОН\s*(\d+)/) || 
                            upper.match(/(\d+)\s*СЕЗОН/) || 
                            upper.match(/\bS(\d{1,2})\b/) || 
                            upper.match(/\[(\d{1,2})X\d{1,2}/);
  if (singleSeasonMatch) {
    const sNum = parseInt(singleSeasonMatch[1], 10);
    return {
      type: 'SINGLE',
      season: sNum,
      label: `Сезон ${sNum}`
    };
  }

  if (upper.includes('ВСЕ СЕЗОНЫ') || upper.includes('ПОЛНЫЙ СЕРИАЛ')) {
    return {
      type: 'ALL_PACK',
      label: 'Полный сериал'
    };
  }

  return null;
}

function detectEpisodes(title) {
  const upper = title.toUpperCase();

  const epRangeMatch = upper.match(/\[\d{1,2}X(\d{1,2})\s*[-–—]\s*(\d{1,2})/i) ||
                       upper.match(/СЕРИИ\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})/i) ||
                       upper.match(/E(\d{1,2})\s*[-–—]\s*E?(\d{1,2})/i) ||
                       upper.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*СЕРИИ/i);
  if (epRangeMatch) {
    const from = parseInt(epRangeMatch[1], 10);
    const to = parseInt(epRangeMatch[2], 10);
    return {
      type: 'RANGE',
      from,
      to,
      label: `Серии ${from}-${to}`
    };
  }

  const singleEpMatch = upper.match(/\bE(\d{1,2})\b/) || upper.match(/СЕРИЯ\s*(\d{1,2})/) || upper.match(/(\d{1,2})\s*СЕРИЯ/);
  if (singleEpMatch) {
    const epNum = parseInt(singleEpMatch[1], 10);
    return {
      type: 'SINGLE',
      episode: epNum,
      label: `${epNum} серия`
    };
  }

  if (upper.includes('ПОЛНЫЙ СЕЗОН') || /\b\d+\s+ИЗ\s+\d+\s+СЕРИ/i.test(upper) || /\bВСЕ\s+СЕРИИ\b/i.test(upper)) {
    return {
      type: 'FULL_SEASON',
      label: 'Все серии сезона'
    };
  }

  return null;
}

function isJunk(title) {
  const upper = title.toUpperCase();
  return UNIVERSAL_JUNK_KEYWORDS.some(word => upper.includes(word));
}

function isMediaTypeMatching(torrentTitle, seasonData, episodeData, isSeriesOnPage) {
  const isTorrentSeries = Boolean(
    seasonData || 
    episodeData || 
    /\[s\d+/i.test(torrentTitle) || 
    /\bs\d{1,2}e\d{1,2}\b/i.test(torrentTitle) || 
    /\b\d+\s*сезон/i.test(torrentTitle) || 
    /сезон\s*\d+/i.test(torrentTitle) || 
    /\bсериал\b/i.test(torrentTitle) ||
    /\[\d{1,2}x\d{1,2}/i.test(torrentTitle)
  );

  const isTorrentMovie = Boolean(
    /\bфильм\b/i.test(torrentTitle) || 
    /\bmovie\b/i.test(torrentTitle)
  );

  if (isSeriesOnPage) {
    if (isTorrentMovie && !isTorrentSeries) {
      return false;
    }
    if (!isTorrentSeries) {
      return false;
    }
  } else {
    if (isTorrentSeries) {
      return false;
    }
  }

  return true;
}

function isYearCompatible(title, targetYearStr, isSeries) {
  if (!targetYearStr) return true;
  const targetY = parseInt(targetYearStr, 10);
  if (isNaN(targetY)) return true;

  const yearMatches = Array.from(title.matchAll(/\b(19\d\d|20\d\d)\b/g)).map(m => parseInt(m[1], 10));
  if (yearMatches.length === 0) return true;

  if (!isSeries) {
    const matchesYear = yearMatches.some(y => Math.abs(y - targetY) <= 1);
    if (!matchesYear) return false;
  } else {
    const matchesYear = yearMatches.some(y => y >= targetY - 1);
    if (!matchesYear) return false;
  }

  return true;
}

function isUniversalMovieMatch(title, ruTitle, origTitle, isSeries) {
  if (!title || !ruTitle) return false;

  const t = title.toLowerCase().trim();
  const ruClean = ruTitle.toLowerCase().trim();
  const origClean = origTitle ? origTitle.toLowerCase().trim() : '';

  const checkMatch = (fullTitle, target) => {
    if (!target) return false;
    if (!fullTitle.startsWith(target)) return false;

    const remainder = fullTitle.substring(target.length).trim();
    if (!remainder) return true;

    const firstChar = remainder.charAt(0);
    if (/[\/(\[\-:;.,|]/.test(firstChar)) {
      return true;
    }

    const cleanPrefix = remainder.split(/[\/(\[\-:;.,|]/)[0].trim();
    if (!cleanPrefix) return true;

    const words = cleanPrefix.split(/\s+/);

    if (words.length === 1 && /^\d{1,2}$/.test(words[0])) {
      return true;
    }

    for (const w of words) {
      if (/^\d{1,2}$/.test(w)) continue;
      if (/^s\d{1,2}$/i.test(w)) continue;
      if (/^e\d{1,2}$/i.test(w)) continue;
      if (TORRENT_TECH_TAGS.has(w)) continue;

      return false;
    }

    return true;
  };

  return checkMatch(t, ruClean) || checkMatch(t, origClean);
}

function encodeWin1251(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x0410 && code <= 0x044F) {
      const winCode = code - 0x0410 + 0xC0;
      result += '%' + winCode.toString(16).toUpperCase();
    } else if (code === 0x0401) {
      result += '%A8';
    } else if (code === 0x0451) {
      result += '%B8';
    } else {
      result += encodeURIComponent(str[i]);
    }
  }
  return result;
}

function smartDecode(buffer, contentType = '') {
  const utf8Text = new TextDecoder('utf-8').decode(buffer);
  if (/Р[µРsРrР]/.test(utf8Text)) {
    try {
      return new TextDecoder('windows-1251').decode(buffer);
    } catch (e) {}
  }
  if (contentType.toLowerCase().includes('windows-1251') || contentType.toLowerCase().includes('cp1251')) {
    try {
      return new TextDecoder('windows-1251').decode(buffer);
    } catch (e) {}
  }
  return utf8Text;
}

async function fetchUrlFast(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const buffer = await res.arrayBuffer();
      const html = smartDecode(buffer, contentType);
      
      if (html && html.length > 200 && (html.includes('<tr') || html.includes('magnet:') || html.includes('torrent') || html.includes('title'))) {
        return html;
      }
    }
  } catch (e) {}
  return null;
}

async function fetchRutorFast(query) {
  if (!query) return [];
  const encQ = encodeURIComponent(query);
  const winEncoded = encodeWin1251(query);

  const targets = [
    `http://new-rutor.org/search/${encQ}/`,
    `https://rutor.info/search/${encQ}/`,
    `https://rutor.is/search/${encQ}/`,
    `https://rutor.info/search/0/0/000/0/${winEncoded}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`http://new-rutor.org/search/${encQ}/`)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://rutor.info/search/${encQ}/`)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(`http://new-rutor.org/search/${encQ}/`)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(`https://rutor.info/search/${encQ}/`)}`
  ];

  const responses = await Promise.allSettled(targets.map(url => fetchUrlFast(url)));
  
  let html = null;
  for (const r of responses) {
    if (r.status === 'fulfilled' && r.value) {
      html = r.value;
      break;
    }
  }

  if (!html) return [];

  const results = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = trRegex.exec(html)) !== null) {
    const tr = match[1];
    if (!tr.includes('/torrent/')) continue;

    const titleMatch = tr.match(/<a href="\/torrent\/(\d+)[^"]*">([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const torrentId = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    const torrentUrl = `https://rutor.info/download/${torrentId}`;

    const sizeMatch = tr.match(/<td[^>]*>([\d\.\s]+(?:&nbsp;|\s)*[KMGT]B|[\d\.\s]+(?:&nbsp;|\s)*[KMGT]Б)<\/td>/i);
    const size = sizeMatch ? sizeMatch[1].replace(/&nbsp;/g, ' ').trim() : 'N/A';

    let seeds = 0;
    let leechs = 0;

    const tdMatches = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
    if (tdMatches.length >= 2) {
      const lastTd = tdMatches[tdMatches.length - 1][1];
      const nums = lastTd.match(/\d+/g);
      if (nums && nums.length >= 1) {
        seeds = parseInt(nums[0], 10);
        if (nums.length >= 2) leechs = parseInt(nums[1], 10);
      }
    }

    if (seeds === 0) {
      const seedsMatch = tr.match(/<span class="green"[^>]*>[\s\S]*?(\d+)[\s\S]*?<\/span>/i) || tr.match(/alt="S"[^>]*>\s*(\d+)/i);
      if (seedsMatch) seeds = parseInt(seedsMatch[1], 10);
    }

    if (title && torrentUrl) {
      results.push({
        title,
        size,
        seeds,
        leechs,
        torrentUrl,
        tracker: 'Rutor',
        quality: detectQuality(title)
      });
    }
  }

  return results;
}

async function fetchTorlookFast(query) {
  if (!query) return [];
  const encQuery = encodeURIComponent(query);
  
  const targets = [
    `https://torlook.info/${encQuery}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://torlook.info/${encQuery}`)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(`https://torlook.info/${encQuery}`)}`
  ];

  const responses = await Promise.allSettled(targets.map(url => fetchUrlFast(url)));
  let html = null;
  for (const r of responses) {
    if (r.status === 'fulfilled' && r.value) {
      html = r.value;
      break;
    }
  }

  if (!html) return [];

  const results = [];
  const blocks = html.split(/<div class="webResult|<tr/i);

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    const titleMatch = block.match(/class="title"[^>]*>([^<]+)</i) || 
                       block.match(/<a[^>]*title="([^"]+)"/i) || 
                       block.match(/<h3>([^<]+)<\/h3>/i);
    if (!titleMatch) continue;

    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

    const torrentMatch = block.match(/href="([^"]+\.torrent[^"]*)"/i) || block.match(/href="(magnet:\?[^"]+)"/i);
    const torrentUrl = torrentMatch ? torrentMatch[1] : '';

    const sizeMatch = block.match(/class="size">([^<]+)</i) || block.match(/([\d\.]+\s*(?:GB|MB|TB|ГБ|МБ|ТБ))/i);
    const size = sizeMatch ? sizeMatch[1].trim() : 'N/A';

    const seedsMatch = block.match(/class="seed">[\s\S]*?(\d+)/i) || block.match(/S:\s*(\d+)/i) || block.match(/green">(\d+)</i);
    const seeds = seedsMatch ? parseInt(seedsMatch[1], 10) : 0;

    const leechMatch = block.match(/class="leech">[\s\S]*?(\d+)/i) || block.match(/L:\s*(\d+)/i) || block.match(/red">(\d+)</i);
    const leechs = leechMatch ? parseInt(leechMatch[1], 10) : 0;

    if (title) {
      results.push({
        title,
        size,
        seeds,
        leechs,
        torrentUrl: torrentUrl || `https://rutor.info/search/0/0/000/0/${encodeURIComponent(title)}`,
        tracker: 'Torlook',
        quality: detectQuality(title)
      });
    }
  }

  return results;
}

async function searchMovieTorrents(ruTitle, origTitle, year, isSeries) {
  const cleanRu = sanitizeString(ruTitle);
  const cleanOrig = sanitizeString(origTitle);
  const cleanYear = year ? String(year).trim() : '';

  const queries = [cleanRu];
  if (cleanRu && isSeries && !cleanRu.toLowerCase().includes('сериал')) {
    queries.push(`${cleanRu} сериал`);
  } else if (cleanRu && !isSeries) {
    queries.push(`${cleanRu} ${cleanYear}`.trim());
    if (cleanOrig && cleanOrig.toLowerCase() !== cleanRu.toLowerCase()) {
      queries.push(cleanOrig);
      queries.push(`${cleanOrig} ${cleanYear}`.trim());
    }
  }

  const rawResults = [];

  for (const q of queries) {
    if (!q || q.length < 2) continue;

    const [rutorRes, torlookRes] = await Promise.allSettled([
      fetchRutorFast(q),
      fetchTorlookFast(q)
    ]);

    if (rutorRes.status === 'fulfilled' && Array.isArray(rutorRes.value)) {
      rawResults.push(...rutorRes.value);
    }
    if (torlookRes.status === 'fulfilled' && Array.isArray(torlookRes.value)) {
      rawResults.push(...torlookRes.value);
    }
  }

  const filtered = rawResults.filter(item => {
    if (!item.title || item.title.length < 3) return false;
    if (isJunk(item.title)) return false;

    item.seasonData = detectSeason(item.title);
    item.episodeData = detectEpisodes(item.title);

    if (!isMediaTypeMatching(item.title, item.seasonData, item.episodeData, isSeries)) return false;
    if (!isUniversalMovieMatch(item.title, cleanRu, cleanOrig, isSeries)) return false;
    if (!isYearCompatible(item.title, cleanYear, isSeries)) return false;
    
    if (item.seeds === 0) return false;

    const audioInfo = detectAudioStudio(item.title);
    item.audioTag = audioInfo.tag;
    item.audioName = audioInfo.name;

    return true;
  });

  const unique = [];
  const seenKeys = new Set();
  for (const item of filtered) {
    const key = item.torrentUrl ? item.torrentUrl.toLowerCase() : item.title.toLowerCase().replace(/\s+/g, '');
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      unique.push(item);
    }
  }

  unique.sort((a, b) => b.seeds - a.seeds);

  console.log(`[Universal Search v106.0] Total alive found for "${cleanRu}" (isSeries=${isSeries}): ${unique.length}`);

  return unique;
}
