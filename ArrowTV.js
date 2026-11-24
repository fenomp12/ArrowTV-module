/*
 * ArrowTV (arrowtv.net) — Sora / Shirox module — v1.0.0
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

function arLog(stage, error) {
    if (typeof console !== 'undefined' && typeof console.log === 'function')
        console.log('[ArrowTV 1.0.0] ' + stage + ': ' + String(error && error.message || error));
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
        var html = await arGet(AR_BASE + '/' + p.type + '/' + p.id);
        var desc = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        var page = arUnescape(html);
        var genres = page.match(/"genres":\[((?:"[^"]*",?)*)\]/);
        genres = genres ? (genres[1].match(/"([^"]*)"/g) || []).map(function (g) { return g.slice(1, -1); }).join(', ') : '';
        var years = page.match(/"years":"([^"]*)"/), release = page.match(/"releaseDate":"([^"]*)"/);
        var runtime = page.match(/"runtimeMin":(\d+)/) || page.match(/"runtime":(\d+)/);
        var seasons = page.match(/"seasonsCount":(\d+)/);
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
        if (p.type === 'movie') return JSON.stringify([{ href: AR_BASE + '/movie/' + p.id, number: 1, title: 'Movie' }]);
        var seasons = arSeasons(await arGet(AR_BASE + '/tv/' + p.id));
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
    var res = j.quality && j.quality.resolution ? parseInt(String(j.quality.resolution).split('x')[1], 10) : 0;
    var q = res >= 1500 ? '4K' : res >= 1000 ? '1080p' : res ? res + 'p' : 'Auto';
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
// Like Promise.all but returns once Jennifer (the main source) and all but one
// of the others are in — no timers needed, a hung source can't block playback.
function arGather(promises) {
    return new Promise(function (resolve) {
        var results = new Array(promises.length), done = 0, finished = false, n = promises.length, mainDone = false;
        function check() {
            if (finished) return;
            var mainOk = mainDone && results[0];
            if (done === n || (mainOk && done >= n - 1)) { finished = true; resolve(results); }
        }
        promises.forEach(function (pr, i) {
            pr.then(function (r) { results[i] = r; }, function (e) { results[i] = null; arLog('source ' + i, e); })
              .then(function () { if (i === 0) mainDone = true; done++; check(); });
        });
    });
}
async function extractStreamUrl(url) {
    try {
        var p = arParse(url);
        if (p.type === 'tv' && (!p.season || !p.episode)) throw new Error('An episode URL is required.');
        var results = await arGather([
            arJennifer(p),
            arProxySource('sadie', 'Sadie (Hindi)', p),
            arProxySource('berlin', 'Berlin', p),
            arProxySource('scarlet', 'Scarlet', p)
        ]);
        var streams = [], subtitle = '';
        results.forEach(function (r) {
            if (!r) return;
            streams = streams.concat(r.streams);
            if (!subtitle && r.subtitle) subtitle = r.subtitle;
        });
        if (!streams.length) throw new Error('No source returned a stream.');
        arLog('stream', streams.length + ' streams');
        var result = { streams: streams };
        if (subtitle) { result.subtitle = subtitle; result.subtitles = [subtitle]; }
        return JSON.stringify(result);
    } catch (e) { arLog('stream', e); return JSON.stringify({ streams: [] }); }
}
