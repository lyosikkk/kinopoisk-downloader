/**
 * Background Service Worker for Kinopoisk Downloader v69.0.0
 * Strict Media Type Separation (Series vs Movie Isolation)
 */

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
});

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
  console.log('[Background v69.0] Fetching pure .torrent file:', rawUrl);

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
  'сезон', 'сезоны', 'серия', 'серии', 'серий', 'из', 'complete'
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

  if (upper.includes('ВСЕ СЕЗОНЫ') || upper.includes('ПОЛНЫЙ СЕРИАЛ') || upper.includes('ВСЕ СЕРИИ')) {
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

  const singleEpMatch = upper.match(/E(\d{1,2})\b/) || upper.match(/СЕРИЯ\s*(\d{1,2})/) || upper.match(/(\d{1,2})\s*СЕРИЯ/);
  if (singleEpMatch) {
    const epNum = parseInt(singleEpMatch[1], 10);
    return {
      type: 'SINGLE',
      episode: epNum,
      label: `${epNum} серия`
    };
  }

  if (upper.includes('ПОЛНЫЙ СЕЗОН') || upper.includes('ИЗ ') || upper.includes('СЕРИИ')) {
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

// Разграничение фильмов и сериалов
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
    // На странице СЕРИАЛА: показывать только сериалы!
    if (isTorrentMovie && !isTorrentSeries) {
      return false;
    }
    if (!isTorrentSeries) {
      return false;
    }
  } else {
    // На странице ФИЛЬМА: показывать только фильмы (без сезонов и серий)!
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

    // Разграничение типа контента (сериал на странице сериала, фильм на странице фильма)
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

  console.log(`[Universal Search v69.0] Total alive found for "${cleanRu}" (isSeries=${isSeries}): ${unique.length}`);

  return unique;
}
