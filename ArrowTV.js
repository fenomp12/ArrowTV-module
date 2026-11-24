/*
 * ArrowTV (arrowtv.net) — Sora / Shirox module — v1.2.0
 * Movies + TV shows. One standalone JavaScript file; no proxy, key or dependencies.
 *
 * Search, details and episodes come from arrowtv.net's own API/pages.
 * Streams come from the sources ArrowTV's player (player.cinezo.live) uses:
 *   Jennifer 4K (punkflix.net) — adaptive HLS up to 4K, multi-audio + subtitles
 *   Sadie (Hindi), Berlin (proxy1.flikhub.net), Scarlet (proxy.yenime.net)
 * Works without setTimeout (Sora's JavaScriptCore).
 */
var AR_BASE = 'https://arrowtv.net';
var AR_PLAYER = 'https://player.cinezo.live';
var AR_IMG = 'https://image.tmdb.org/t/p/w500';
var AR_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var AR_PLAYER_HEADERS = { 'User-Agent': AR_UA, Referer: AR_PLAYER + '/', Origin: AR_PLAYER };

// Small in-memory cache of in-flight/finished requests, so details + episodes
// share one page download and a prefetched stream is reused when you press play.
var arCacheStore = {};
function arCached(key, ttlMs, make) {
    var now = Date.now(), c = arCacheStore[key];
    if (c && c.expires > now) return c.promise;
    var promise = make();
    arCacheStore[key] = { promise: promise, expires: now + ttlMs };
    promise.catch(function () { if (arCacheStore[key] && arCacheStore[key].promise === promise) delete arCacheStore[key]; });
    return promise;
}
function arPage(type, id) {
    return arCached('page:' + type + ':' + id, 10 * 60 * 1000, function () { return arGet(AR_BASE + '/' + type + '/' + id); });
}
function arLog(stage, error) {
    if (typeof console !== 'undefined' && typeof console.log === 'function')
        console.log('[ArrowTV 1.2.0] ' + stage + ': ' + String(error && error.message || error));
}
async function soraFetch(url, options) {
    options = options || {};
    if (typeof fetchv2 === 'function') {
        try { return await fetchv2(url, options.headers || {}, options.method || 'GET', options.body || null); }
        catch (e) { if (typeof fetch !== 'function') throw e; }
    }
    if (typeof fetch === 'function') return await fetch(url, options);
    throw new Error('No supported HTTP bridge.');
}
async function arGet(url, headers) {
    var response = await soraFetch(url, { headers: Object.assign({ 'User-Agent': AR_UA, Referer: AR_BASE + '/', Accept: '*/*' }, headers || {}) });
    if (!response) throw new Error('Empty HTTP response.');
    if (response.error) throw new Error(String(response.error));
    if (Number(response.status) >= 400) throw new Error('HTTP ' + response.status + ' from ' + String(url).split('?')[0]);
    var text = typeof response === 'string' ? response : typeof response.text === 'function' ? await response.text() : typeof response.text === 'string' ? response.text : typeof response.body === 'string' ? response.body : response._data;
    if (typeof text !== 'string' || !text.length) throw new Error('Empty response body.');
    if (/<title>\s*Just a moment|cf-chl-/i.test(text)) throw new Error('Host requires Cloudflare verification.');
    return text;
}
async function arJson(url, headers) { return JSON.parse(await arGet(url, headers)); }
function arText(v) {
    return String(v === undefined || v === null ? '' : v)
        .replace(/&#x([\da-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
        .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}
// The Next.js pages embed data as JSON inside a JS string: strip one level of escaping.
function arUnescape(s) { return String(s).replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }

/* ---------- ids ----------
 * movie:   https://arrowtv.net/movie/550
 * show:    https://arrowtv.net/tv/1396
 * episode: https://arrowtv.net/watch/tv/1396?season=1&episode=1
 */
function arParse(url) {
    url = String(url || '');
    var m = url.match(/\/(movie|tv)\/(\d+)/i);
    if (!m) throw new Error('Invalid ArrowTV URL: ' + url);
    var s = url.match(/[?&]season=(\d+)/), e = url.match(/[?&]episode=(\d+)/);
    return { type: m[1].toLowerCase(), id: m[2], season: s ? parseInt(s[1], 10) : null, episode: e ? parseInt(e[1], 10) : null };
}

/* ---------- search ---------- */
async function searchResults(keyword) {
    try {
        keyword = String(keyword || '').trim(); if (!keyword) return JSON.stringify([]);
        var data = await arJson(AR_BASE + '/api/search?q=' + encodeURIComponent(keyword));
        var list = Array.isArray(data) ? data : (data.results || []);
        var rows = list.filter(function (r) {
            return (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path;
        }).map(function (r) {
            var year = String(r.release_date || r.first_air_date || '').slice(0, 4);
            return {
                title: (r.title || r.name || 'Untitled') + (year ? ' (' + year + ')' : '') + (r.media_type === 'tv' ? ' [TV]' : ''),
                image: AR_IMG + r.poster_path,
                href: AR_BASE + '/' + r.media_type + '/' + r.id
            };
        });
        arLog('search', rows.length + ' results for ' + keyword);
        return JSON.stringify(rows);
    } catch (e) { arLog('search', e); return JSON.stringify([]); }
}

/* ---------- details ---------- */
async function extractDetails(url) {
    try {
        var p = arParse(url);
        if (p.type === 'movie') arPrefetch(p); // warm the stream while the user reads
        var html = await arPage(p.type, p.id);
        var desc = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        var page = arUnescape(html);
        var genres = page.match(/"genres":\[((?:"[^"]*",?)*)\]/);
        genres = genres ? (genres[1].match(/"([^"]*)"/g) || []).map(function (g) { return g.slice(1, -1); }).join(', ') : '';
        var years = page.match(/"years":"([^"]*)"/), release = page.match(/"releaseDate":"([^"]*)"/);
        var runtime = page.match(/"runtimeMin":(\d+)/) || page.match(/"runtime":(\d+)/);
        var seasons = p.type === 'tv' ? page.match(/"seasonsCount":([1-9]\d*)/) : null;
        var extra = [genres, runtime ? runtime[1] + ' min' : '', seasons ? seasons[1] + ' season' + (seasons[1] === '1' ? '' : 's') : '']
            .filter(function (v) { return v; }).join(' • ');
        return JSON.stringify([{
            description: desc ? arText(desc[1]) : 'N/A',
            aliases: extra || 'N/A',
            airdate: (years && years[1]) || (release && release[1]) || 'N/A'
        }]);
    } catch (e) { arLog('details', e); return JSON.stringify([{ description: 'N/A', aliases: 'N/A', airdate: 'N/A' }]); }
}

/* ---------- episodes ---------- */
function arSeasons(html) {
    var page = arUnescape(html), i = page.indexOf('"seasons":['), out = [];
    if (i < 0) return out;
    var depth = 0, j = i + '"seasons":'.length, end = j;
    for (; end < page.length; end++) { // find the matching closing bracket
        var c = page.charAt(end);
        if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) break; }
    }
    var block = page.slice(j, end + 1), re = /\{[^{}]*?"episode_count":(\d+)[^{}]*?"season_number":(\d+)[^{}]*\}/g, m;
    while ((m = re.exec(block))) {
        var count = parseInt(m[1], 10), n = parseInt(m[2], 10);
        if (n > 0 && count > 0 && out.indexOf(n) < 0) out.push(n);
    }
    return out.sort(function (a, b) { return a - b; });
}
async function extractEpisodes(url) {
    try {
        var p = arParse(url);
        if (p.type === 'movie') { arPrefetch(p); return JSON.stringify([{ href: AR_BASE + '/movie/' + p.id, number: 1, title: 'Movie' }]); }
        var seasons = arSeasons(await arPage('tv', p.id));
        if (!seasons.length) seasons = [1];
        var lists = await Promise.all(seasons.map(function (n) {
            return arJson(AR_BASE + '/api/tv-episodes?id=' + p.id + '&season=' + n).catch(function () { return { episodes: [] }; });
        }));
        var today = new Date().toISOString().slice(0, 10), rows = [];
        lists.forEach(function (season, i) {
            (season.episodes || []).forEach(function (ep) {
                if (ep.air_date && ep.air_date > today) return; // not aired yet
                rows.push({
                    href: AR_BASE + '/watch/tv/' + p.id + '?season=' + seasons[i] + '&episode=' + ep.episode_number,
                    number: rows.length + 1,
                    title: 'S' + seasons[i] + 'E' + ep.episode_number + (ep.name ? ' - ' + ep.name : '')
                });
            });
        });
        arLog('episodes', rows.length + ' episodes');
        return JSON.stringify(rows);
    } catch (e) { arLog('episodes', e); return JSON.stringify([]); }
}

/* ---------- streams ---------- */
function arSourceUrl(id, p) {
    var tv = p.type === 'tv';
    if (id === 'jennifer') return tv ? 'https://punkflix.net/tv/' + p.id + '/' + p.season + '/' + p.episode + '.json' : 'https://punkflix.net/movie/' + p.id + '.json';
    if (id === 'scarlet') return tv ? 'https://proxy.yenime.net/tv?id=' + p.id + '&season=' + p.season + '&episode=' + p.episode + '&mode=json&sources=scarlet'
        : 'https://proxy.yenime.net/movie?id=' + p.id + '&mode=json&sources=scarlet';
    return tv ? 'https://proxy1.flikhub.net/tv?id=' + p.id + '&season=' + p.season + '&episode=' + p.episode + '&mode=json&sources=' + id + '&hevc=1'
        : 'https://proxy1.flikhub.net/movie?id=' + p.id + '&mode=json&sources=' + id + '&hevc=1';
}
function arPlayable(url, type) {
    // AVPlayer plays HLS and MP4, not DASH (.mpd).
    return /^https?:\/\//i.test(url || '') && !/\.mpd(\?|$)/i.test(url) && String(type || 'hls').toLowerCase() !== 'dash';
}
async function arJennifer(p) {
    var j = await arJson(arSourceUrl('jennifer', p), AR_PLAYER_HEADERS);
    var url = j.stream && (j.stream.hls || j.stream.original);
    if (!arPlayable(url)) return null;
    // label by width: widescreen films are e.g. 1920x800 (still 1080p) or 3840x1600 (4K)
    var wh = j.quality && j.quality.resolution ? String(j.quality.resolution).split('x') : [];
    var w = parseInt(wh[0], 10) || 0, h = parseInt(wh[1], 10) || 0;
    var q = w >= 3000 ? '4K' : w >= 1800 ? '1080p' : w >= 1200 ? '720p' : h ? h + 'p' : 'Auto';
    var subs = (j.subtitles || []).filter(function (s) { return /^https?:\/\//i.test(s.url || ''); });
    var en = subs.filter(function (s) { return /^en/i.test(s.language || '') && !/sdh/i.test(s.title || ''); })[0] || subs.filter(function (s) { return /^en/i.test(s.language || ''); })[0];
    return { streams: [{ title: 'Jennifer · ' + q + ' · Auto quality', streamUrl: url, headers: AR_PLAYER_HEADERS }], subtitle: en ? en.url : '' };
}
async function arProxySource(id, label, p) {
    var j = await arJson(arSourceUrl(id, p), AR_PLAYER_HEADERS);
    var list = j.source ? [j.source] : (j.sources || []);
    var streams = [];
    list.forEach(function (s) {
        if (!s) return;
        var url = s.url || s.file;
        if (!arPlayable(url, s.type)) return;
        streams.push({ title: label + (s.quality ? ' · ' + s.quality : ''), streamUrl: url, headers: AR_PLAYER_HEADERS });
    });
    return streams.length ? { streams: streams, subtitle: '' } : null;
}
// Source requests are cached (links stay valid for hours), so a stream that was
// prefetched — or the same episode opened again — resolves instantly.
var AR_STREAM_TTL = 30 * 60 * 1000;
function arKey(p) { return p.type + ':' + p.id + ':' + (p.season || 0) + ':' + (p.episode || 0); }
function arJenniferCached(p) {
    return arCached('jennifer:' + arKey(p), AR_STREAM_TTL, function () { return arJennifer(p); });
}
function arSadieCached(p) {
    return arCached('sadie:' + arKey(p), AR_STREAM_TTL, function () { return arProxySource('sadie', 'Sadie (Hindi)', p); });
}
// External subtitles (the same list ArrowTV's player shows): dozens of languages, ~0.2 s.
// The first language found in AR_SUB_LANGS becomes the default subtitle.
var AR_SUB_LANGS = ['Portuguese', 'Brazilian', 'English'];
function arSubsCached(p) {
    var path = p.type === 'tv' ? 'tv/' + p.id + '/' + p.season + '/' + p.episode : 'movie/' + p.id;
    return arCached('subs:' + arKey(p), AR_STREAM_TTL, function () {
        return arJson('https://proxy1.flikhub.net/subtitles/' + path, AR_PLAYER_HEADERS).then(function (list) {
            return (Array.isArray(list) ? list : []).filter(function (s) { return s && /^https?:\/\//i.test(s.file || s.url || ''); })
                .map(function (s) { return { title: String(s.label || 'Subtitles'), url: s.file || s.url }; });
        });
    });
}
function arPickSub(list) {
    for (var i = 0; i < AR_SUB_LANGS.length; i++) {
        var lang = AR_SUB_LANGS[i].toLowerCase();
        for (var j = 0; j < list.length; j++) {
            var t = list[j].title.toLowerCase();
            if (t === lang || t.indexOf(lang + ' ') === 0) return list[j];
        }
    }
    return null;
}
function arPrefetch(p) {
    try {
        arJenniferCached(p).catch(function () {}); arSadieCached(p).catch(function () {}); arSubsCached(p).catch(function () {});
    } catch (e) { /* ignore */ }
}
function arSafe(promise, label) {
    return promise.then(function (r) { return r; }, function (e) { arLog('source ' + label, e); return null; });
}
async function extractStreamUrl(url) {
    try {
        var p = arParse(url);
        if (p.type === 'tv' && (!p.season || !p.episode)) throw new Error('An episode URL is required.');
        // Jennifer (~0.25 s) and Sadie run in parallel. Return as soon as Jennifer
        // answers; Sadie is added only if it is already in, so it never slows playback.
        var sadieResult, sadieDone = false;
        var sadie = arSafe(arSadieCached(p), 'sadie').then(function (r) { sadieResult = r; sadieDone = true; return r; });
        var subsPromise = arSafe(arSubsCached(p), 'subtitles'); // in parallel, usually faster than Jennifer
        var jennifer = await arSafe(arJenniferCached(p), 'jennifer');
        var results = [jennifer];
        if (!jennifer) results.push(await sadie); // main source failed: wait for Sadie
        else if (sadieDone) results.push(sadieResult);
        if (!jennifer && !results[1]) {
            // last resort: the rarely-available extra servers
            results = results.concat(await Promise.all([
                arSafe(arProxySource('berlin', 'Berlin', p), 'berlin'),
                arSafe(arProxySource('scarlet', 'Scarlet', p), 'scarlet')
            ]));
        }
        var streams = [], subtitle = '';
        results.forEach(function (r) {
            if (!r) return;
            streams = streams.concat(r.streams);
            if (!subtitle && r.subtitle) subtitle = r.subtitle;
        });
        if (!streams.length) throw new Error('No source returned a stream.');
        arLog('stream', streams.length + ' streams');
        var subs = (await subsPromise) || [];
        var picked = arPickSub(subs);
        if (picked) subtitle = picked.url; // preferred language beats the source's own English track
        var result = { streams: streams };
        if (subtitle) { result.subtitle = subtitle; result.subtitles = [subtitle]; }
        if (subs.length) result.allSubtitles = subs.map(function (s) { return { title: s.title, url: s.url }; });
        return JSON.stringify(result);
    } catch (e) { arLog('stream', e); return JSON.stringify({ streams: [] }); }
}
