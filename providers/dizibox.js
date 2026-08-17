var BASE_URL = "https://www.dizibox.live";
var PROVIDER_NAME = "CVN-DiziBOX";
var TMDB_API_URL = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

function fetchWithTimeout(url, options, milliseconds) {
  var requestOptions = options || {};
  var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer;
  if (controller) requestOptions.signal = controller.signal;
  return new Promise(function(resolve, reject) {
    timer = setTimeout(function() {
      if (controller) controller.abort();
      reject(new Error("Network timeout for " + url));
    }, milliseconds);
    fetch(url, requestOptions).then(function(response) {
      clearTimeout(timer);
      resolve(response);
    }, function(error) {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function requestText(url, referer) {
  var headers = { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "User-Agent": USER_AGENT };
  if (referer) headers.Referer = referer;
  return fetchWithTimeout(url, { method: "GET", headers: headers }, 10000).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.text();
  });
}

function requestJson(url, headers) {
  var requestHeaders = headers || { Accept: "application/json", "User-Agent": USER_AGENT };
  return fetchWithTimeout(url, { method: "GET", headers: requestHeaders }, 10000).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.json();
  });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&#038;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ").replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(Number(code)); });
}

function decodeEscapedSource(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u([0-9a-f]{4})/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/\\x([0-9a-f]{2})/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/\\\//g, "/");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalize(value) {
  var text = String(value || "").toLowerCase();
  var from = "çğıöşüâîûéèêáàäíìóòöúùüñý’'";
  var to = "cgiosuaiueeeaaaiiooouuunyy  ";
  var index;
  for (index = 0; index < from.length; index += 1) text = text.split(from.charAt(index)).join(to.charAt(index));
  return text.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values) {
  var result = [];
  values.forEach(function(value) { if (value && result.indexOf(value) === -1) result.push(value); });
  return result;
}

function absoluteUrl(value, baseUrl) {
  var text = decodeEscapedSource(String(value || "").trim());
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/\//.test(text)) return "https:" + text;
  if (text.charAt(0) === "/") return BASE_URL + text;
  var base = String(baseUrl || BASE_URL).replace(/\/+$/, "");
  return base + "/" + text.replace(/^\/+/, "");
}

function originOf(url) {
  var match = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : BASE_URL;
}

function extractAnchors(html) {
  var anchors = [];
  var expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = expression.exec(String(html || "")))) {
    var href = match[1].match(/href\s*=\s*["']([^"']+)["']/i);
    var title = match[1].match(/title\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    anchors.push({ url: decodeHtml(href[1]), title: stripTags(title ? title[1] : ""), text: stripTags(match[2]) });
  }
  return anchors;
}

function qualityFromUrl(url) {
  var match = String(url || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i);
  return match ? match[1] + "P" : "Auto";
}

function addMedia(list, value, baseUrl) {
  var url = absoluteUrl(value, baseUrl);
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (!/(?:\.m3u8|\.mp4|\.m4v|\.webm|master\.txt)(?:[?#]|$)/i.test(url)) return;
  if (list.some(function(item) { return item.url === url; })) return;
  list.push({ url: url, quality: qualityFromUrl(url) });
}

function extractMediaUrls(source, baseUrl) {
  var text = decodeEscapedSource(source);
  var media = [];
  var match;
  var direct = text.match(/(?:https?:)?\/\/[^"'<>\s\\]+(?:\.m3u8|\.mp4|\.m4v|\.webm|master\.txt)(?:[?#][^"'<>\s\\]*)?/gi) || [];
  direct.forEach(function(url) { addMedia(media, url, baseUrl); });

  var assignments = /(?:contentUrl|file|src|url)\s*["']?\s*[:=]\s*["']([^"']+(?:\.m3u8|\.mp4|\.m4v|\.webm|master\.txt)(?:[?#][^"']*)?)["']/gi;
  while ((match = assignments.exec(text))) addMedia(media, match[1], baseUrl);
  return media;
}

function extractPlayerReferences(source, baseUrl) {
  var text = decodeEscapedSource(source);
  var references = [];
  var expression = /<(iframe|embed)\b([^>]*)>/gi;
  var match;
  while ((match = expression.exec(text))) {
    var urlMatch = match[2].match(/(?:src|data-src|data-url)\s*=\s*["']([^"']+)["']/i);
    if (!urlMatch) continue;
    var url = absoluteUrl(urlMatch[1], baseUrl);
    if (!url || /javascript:|about:blank/i.test(url)) continue;
    if (references.some(function(item) { return item.url === url; })) continue;
    references.push({ url: url, label: "Player" });
  }
  return references;
}

function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise(function(resolve) { setTimeout(function() { resolve(null); }, milliseconds); })
  ]);
}

function resolveTmdbId(identifier, mediaType) {
  if (/^\d+$/.test(String(identifier || ""))) return Promise.resolve(String(identifier));
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = TMDB_API_URL + "/find/" + encodeURIComponent(String(identifier || "")) + "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id";
  return requestJson(url).then(function(data) {
    var list = type === "movie" ? data.movie_results : data.tv_results;
    if (!list || !list.length) throw new Error("TMDB IMDb eşleşmesi bulunamadı");
    return String(list[0].id);
  });
}

function fetchMetadata(identifier, mediaType) {
  return resolveTmdbId(identifier, mediaType).then(function(tmdbId) {
    var type = mediaType === "movie" ? "movie" : "tv";
    var languages = ["tr-TR", "en-US", "ja-JP", "ko-KR", "zh-CN"];
    var urls = languages.map(function(language) {
      return TMDB_API_URL + "/" + type + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + language;
    });
    urls.push(TMDB_API_URL + "/" + type + "/" + encodeURIComponent(tmdbId) + "/alternative_titles?api_key=" + TMDB_API_KEY);
    return Promise.all(urls.map(function(url) { return requestJson(url).catch(function() { return null; }); })).then(function(dataList) {
      var titles = [];
      var year = null;
      var seasonEpisodeCounts = {};
      dataList.slice(0, languages.length).forEach(function(data) {
        if (!data) return;
        if (data.title || data.name) titles.push(data.title || data.name);
        if (data.original_title || data.original_name) titles.push(data.original_title || data.original_name);
        if (!year) year = Number(String(data.release_date || data.first_air_date || "").slice(0, 4)) || null;
        (data.seasons || []).forEach(function(item) {
          var season = Number(item.season_number);
          var count = Number(item.episode_count);
          if (season > 0 && count > 0) seasonEpisodeCounts[season] = count;
        });
      });
      var alternatives = dataList[languages.length];
      (alternatives && (alternatives.titles || alternatives.results) || []).forEach(function(item) { if (item.title) titles.push(item.title); });
      titles = unique(titles).filter(function(title) { return normalize(title).length > 1; });
      if (!titles.length) throw new Error("TMDB metadata bulunamadı");
      return { tmdbId: tmdbId, titles: titles, year: year, displayTitle: titles[0], seasonEpisodeCounts: seasonEpisodeCounts };
    });
  });
}

function searchQueries(metadata, mediaType, season) {
  var queries = [];
  metadata.titles.slice(0, 10).forEach(function(title) {
    if (mediaType === "tv" && season && Number(season) > 1) {
      queries.push(title + " " + Number(season) + ". Sezon");
      queries.push(title + " Season " + Number(season));
    }
    queries.push(title);
  });
  return unique(queries).slice(0, 14);
}

function cleanProviderTitle(value) {
  return stripTags(value)
    .replace(/\s*\(\d{4}\)\s*$/i, "")
    .replace(/\s+(?:izle|watch)\s*$/i, "")
    .replace(/\s*[-|:]+\s*$/, "")
    .trim();
}

function slugTitle(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function candidateScore(candidate, metadata, season) {
  var title = normalize(candidate.title);
  var slug = normalize(candidate.url.replace(/^https?:\/\/[^/]+\//i, "").replace(/\/$/, ""));
  var score = Number(candidate.searchScore || 0);
  metadata.titles.forEach(function(targetTitle) {
    var target = normalize(targetTitle);
    if (!target) return;
    if (title === target || slug === target) score = Math.max(score, 120);
    else if (title.indexOf(target) !== -1 || target.indexOf(title) !== -1) score = Math.max(score, 90);
    else if (slug.indexOf(target) !== -1 || target.indexOf(slug) !== -1) score = Math.max(score, 82);
  });
  if (metadata.year && new RegExp("(^|\\D)" + metadata.year + "(\\D|$)").test(candidate.text || "")) score += 8;
  if (season && Number(season) > 1 && new RegExp("(^| )" + Number(season) + " (sezon|season)( |$)", "i").test((candidate.title || "") + " " + (candidate.text || ""))) score += 25;
  return score;
}

function collectDiziboxCandidates(html, candidates) {
  extractAnchors(html).forEach(function(anchor) {
    if (!/\/diziler\/[^/?#]+\/?(?:[?#].*)?$/i.test(anchor.url)) return;
    var url = absoluteUrl(anchor.url, BASE_URL + "/");
    var title = cleanProviderTitle(anchor.title || anchor.text);
    if (!title || candidates.some(function(item) { return item.url === url; })) return;
    candidates.push({ url: url, title: title, text: anchor.text, searchScore: 70 });
  });
}

function rankCandidates(candidates, metadata, season) {
  candidates.forEach(function(candidate) { candidate.score = candidateScore(candidate, metadata, season); });
  candidates.sort(function(left, right) { return right.score - left.score; });
  return candidates.length && candidates[0].score >= 55 ? candidates[0] : null;
}

function directDiziboxCandidates(metadata) {
  var urls = [];
  metadata.titles.slice(0, 4).forEach(function(title) {
    var slug = slugTitle(title);
    [slug, slug + "-izle", slug + "-izle-hd", slug + "-izle-2", slug + "-hd"].forEach(function(suffix) {
      var url = BASE_URL + "/diziler/" + suffix + "/";
      if (urls.indexOf(url) === -1) urls.push(url);
    });
  });
  return urls;
}

function searchDirectDizibox(metadata, candidates) {
  return Promise.all(directDiziboxCandidates(metadata).map(function(url) {
    return withTimeout(requestText(url, BASE_URL + "/"), 8000).then(function(html) {
      if (!html || /<body[^>]*\bhome\b/i.test(html) || !/<h1\b/i.test(html)) return;
      var heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      var title = cleanProviderTitle(heading ? heading[1] : "");
      if (title && !candidates.some(function(item) { return item.url === url; })) candidates.push({ url: url, title: title, text: title, searchScore: 72 });
    }).catch(function() {});
  }));
}

function searchSeries(metadata, mediaType, season) {
  var candidates = [];
  return Promise.all(searchQueries(metadata, mediaType, season).map(function(query) {
    return withTimeout(requestText(BASE_URL + "/?s=" + encodeURIComponent(query), BASE_URL + "/"), 8000)
      .then(function(html) { if (html) collectDiziboxCandidates(html, candidates); })
      .catch(function() {});
  })).then(function() {
    var ranked = rankCandidates(candidates, metadata, season);
    if (ranked) return ranked;
    return searchDirectDizibox(metadata, candidates).then(function() { return rankCandidates(candidates, metadata, season); });
  });
}

function episodeMarker(value) {
  var text = normalize(value).replace(/\./g, " ");
  var match = text.match(/sezon\s*(\d{1,2})\s*bolum\s*(\d{1,3})/i);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  match = text.match(/s\s*(\d{1,2})\s*e\s*(\d{1,3})/i);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  match = text.match(/(\d{1,2})\s*sezon\s*(\d{1,3})\s*bolum/i);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}

function findEpisodeLink(html, season, episode) {
  var matches = [];
  extractAnchors(html).forEach(function(anchor) {
    var marker = episodeMarker(anchor.url) || episodeMarker(anchor.title + " " + anchor.text);
    if (!marker || marker.season !== Number(season) || marker.episode !== Number(episode)) return;
    if (/\/diziler\//i.test(anchor.url)) return;
    matches.push({ url: absoluteUrl(anchor.url, BASE_URL + "/"), marker: marker });
  });
  return matches.length ? matches[0].url : "";
}

function findSeasonPage(html, season) {
  var wanted = Number(season);
  var matches = extractAnchors(html).filter(function(anchor) {
    var text = normalize(anchor.url + " " + anchor.title + " " + anchor.text);
    return /\/dizi\//i.test(anchor.url) && new RegExp("(^|\\D)" + wanted + "\\s*sezon", "i").test(text);
  });
  return matches.length ? absoluteUrl(matches[0].url, BASE_URL + "/") : "";
}

function providerTitleFromPage(html, fallback) {
  var heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanProviderTitle(heading ? heading[1] : fallback) || fallback;
}

function resolvePlayer(reference, pageUrl) {
  var direct = extractMediaUrls(reference.url, pageUrl);
  if (direct.length) return Promise.resolve({ reference: reference, media: direct });
  var resolution = requestText(reference.url, pageUrl).then(function(playerHtml) {
    var media = extractMediaUrls(playerHtml, reference.url);
    var nested = extractPlayerReferences(playerHtml, reference.url);
    return Promise.all(nested.map(function(item) {
      return withTimeout(requestText(item.url, reference.url).then(function(nestedHtml) {
        return { reference: item, media: extractMediaUrls(nestedHtml, item.url) };
      }).catch(function() { return { reference: item, media: [] }; }), 7000);
    })).then(function(results) {
      results.forEach(function(result) { if (result) media = media.concat(result.media || []); });
      return { reference: reference, media: uniqueMedia(media) };
    });
  }).catch(function() { return { reference: reference, media: [] }; });
  return withTimeout(resolution, 8000).then(function(result) { return result || { reference: reference, media: [] }; });
}

function uniqueMedia(media) {
  var seen = [];
  return (media || []).filter(function(item) {
    if (!item || !item.url || seen.indexOf(item.url) !== -1) return false;
    seen.push(item.url);
    return true;
  });
}

function extractStreamsFromPage(html, pageUrl, displayTitle) {
  var streams = [];
  extractMediaUrls(html, pageUrl).forEach(function(media) {
    streams.push({ name: PROVIDER_NAME + " - Direct", title: displayTitle + " - Direct - " + media.quality, url: media.url, quality: media.quality, headers: { Referer: pageUrl, Origin: originOf(pageUrl), "User-Agent": USER_AGENT } });
  });
  var references = extractPlayerReferences(html, pageUrl);
  return Promise.all(references.map(function(reference) { return resolvePlayer(reference, pageUrl); })).then(function(results) {
    results.forEach(function(result) {
      (result.media || []).forEach(function(media) {
        streams.push({ name: PROVIDER_NAME + " - " + result.reference.label, title: displayTitle + " - " + result.reference.label + " - " + media.quality, url: media.url, quality: media.quality, headers: { Referer: result.reference.url, Origin: originOf(result.reference.url), "User-Agent": USER_AGENT } });
      });
    });
    return uniqueStreams(streams);
  });
}

function uniqueStreams(streams) {
  var seen = [];
  return streams.filter(function(stream) { if (!stream.url || seen.indexOf(stream.url) !== -1) return false; seen.push(stream.url); return true; });
}

function streamsForCandidate(candidate, metadata, mediaType, season, episode) {
  return requestText(candidate.url, BASE_URL + "/").then(function(detailHtml) {
    var providerTitle = providerTitleFromPage(detailHtml, candidate.title);
    if (mediaType === "movie") return extractStreamsFromPage(detailHtml, candidate.url, providerTitle);
    var seasonPage = findSeasonPage(detailHtml, season);
    var sourcePage = seasonPage || candidate.url;
    var pagePromise = seasonPage ? requestText(seasonPage, candidate.url) : Promise.resolve(detailHtml);
    return pagePromise.then(function(episodeListHtml) {
      var episodeUrl = findEpisodeLink(episodeListHtml, season, episode) || findEpisodeLink(detailHtml, season, episode);
      if (!episodeUrl) return null;
      return requestText(episodeUrl, sourcePage).then(function(episodeHtml) {
        var displayTitle = providerTitle + " S" + Number(season || 1) + "E" + Number(episode || 1);
        return extractStreamsFromPage(episodeHtml, episodeUrl, displayTitle);
      });
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var parts = String(tmdbId || "").split(":");
  var identifier = parts[0];
  if (parts.length >= 3) { season = Number(parts[1]) || season; episode = Number(parts[2]) || episode; mediaType = "tv"; }
  if (mediaType !== "tv") return Promise.resolve([]);
  return fetchMetadata(identifier, mediaType)
    .then(function(metadata) { return searchSeries(metadata, mediaType, season).then(function(candidate) { return { metadata: metadata, candidate: candidate }; }); })
    .then(function(result) {
      if (!result.candidate) throw new Error("DiziBOX eşleşmesi bulunamadı");
      return streamsForCandidate(result.candidate, result.metadata, mediaType, season, episode).then(function(streams) {
        return streams || [];
      });
    })
    .catch(function(error) { console.error("[" + PROVIDER_NAME + "] " + (error && error.message ? error.message : String(error))); return []; });
}

globalThis.getStreams = getStreams;
if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
