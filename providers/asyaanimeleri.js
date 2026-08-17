// @ts-nocheck
var PROVIDER_NAME = "CVN-AsyaAnimeleri";
var BASE_URL = "https://asyaanimeleri.top";
var TMDB_API_URL = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

function requestText(url, referer) {
  var headers = {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": USER_AGENT
  };
  if (referer) headers.Referer = referer;

  return fetch(url, { method: "GET", headers: headers }).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.text();
  });
}

function requestJson(url) {
  return fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": USER_AGENT }
  }).then(function(response) {
    if (!response.ok) throw new Error("TMDB HTTP " + response.status);
    return response.json();
  });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, function(_, code) {
      return String.fromCharCode(Number(code));
    });
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  var text = String(value || "").toLowerCase();
  var from = "çğıöşüâîûéèêáàäíìóòöúùüñý’'";
  var to = "cgiosuaiueeeaaaiiooouuunyy  ";
  var index;

  for (index = 0; index < from.length; index += 1) {
    text = text.split(from.charAt(index)).join(to.charAt(index) || " ");
  }

  return text.replace(/&[^;]+;/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values) {
  var result = [];
  values.forEach(function(value) {
    if (value && result.indexOf(value) === -1) result.push(value);
  });
  return result;
}

function absoluteUrl(value, baseUrl) {
  var url = decodeHtml(value).trim();
  var base = baseUrl || BASE_URL;
  var originMatch;

  if (!url) return "";
  if (url.indexOf("//") === 0) return "https:" + url;
  if (/^https?:\/\//i.test(url)) return url;

  originMatch = base.match(/^(https?:\/\/[^/]+)/i);
  if (url.charAt(0) === "/") return (originMatch ? originMatch[1] : BASE_URL) + url;
  return base.replace(/[^/]*$/, "") + url;
}

function originOf(url) {
  var match = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : "";
}

function resolveTmdbId(identifier, mediaType) {
  var value = String(identifier || "");
  if (!/^tt\d+$/i.test(value)) return Promise.resolve(value);

  var url = TMDB_API_URL + "/find/" + encodeURIComponent(value) + "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id";
  return requestJson(url).then(function(data) {
    var results = mediaType === "movie" ? data.movie_results : data.tv_results;
    if (!results || !results.length || !results[0].id) throw new Error("IMDb kimliği TMDB ile eşleştirilemedi");
    return String(results[0].id);
  });
}

function fetchMetadata(identifier, mediaType) {
  return resolveTmdbId(identifier, mediaType).then(function(tmdbId) {
    var type = mediaType === "movie" ? "movie" : "tv";
    var languages = ["tr-TR", "en-US", "ja-JP", "ko-KR", "zh-CN"];
    var titles = [];
    var year = null;
    var chain = Promise.resolve();

    languages.forEach(function(language) {
      chain = chain.then(function() {
        var url = TMDB_API_URL + "/" + type + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY + "&language=" + language;
        return requestJson(url).then(function(data) {
          if (data.title || data.name) titles.push(data.title || data.name);
          if (data.original_title || data.original_name) titles.push(data.original_title || data.original_name);
          if (!year) year = Number(String(data.release_date || data.first_air_date || "").slice(0, 4)) || null;
        }).catch(function() {});
      });
    });

    chain = chain.then(function() {
      var url = TMDB_API_URL + "/" + type + "/" + encodeURIComponent(String(tmdbId)) + "/alternative_titles?api_key=" + TMDB_API_KEY;
      return requestJson(url).then(function(data) {
        var alternatives = data.titles || data.results || [];
        alternatives.forEach(function(item) {
          if (item.title) titles.push(item.title);
        });
      }).catch(function() {});
    });

    return chain.then(function() {
      titles = unique(titles).filter(function(title) { return normalize(title).length > 1; });
      if (!titles.length) throw new Error("TMDB metadata bulunamadı");
      return { tmdbId: tmdbId, titles: titles, year: year, displayTitle: titles[0] };
    });
  });
}

function extractAnchors(html) {
  var anchors = [];
  var expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var match;

  while ((match = expression.exec(html))) {
    var hrefMatch = match[1].match(/href\s*=\s*["']([^"']+)["']/i);
    var titleMatch = match[1].match(/title\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    anchors.push({
      url: decodeHtml(hrefMatch[1]),
      title: stripTags(titleMatch ? titleMatch[1] : match[2]),
      text: stripTags(match[2])
    });
  }
  return anchors;
}

function slugTitle(url) {
  var match = String(url || "").match(/\/series\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).replace(/-/g, " ") : "";
}

function candidateScore(candidate, metadata, season) {
  var candidateTitle = normalize(candidate.title);
  var slug = normalize(slugTitle(candidate.url));
  var score = 0;
  var pageText = normalize(candidate.text);

  metadata.titles.forEach(function(title) {
    var target = normalize(title);
    if (!target) return;
    if ((candidateTitle && candidateTitle === target) || (slug && slug === target)) score = Math.max(score, 120);
    else if (candidateTitle && (candidateTitle.indexOf(target) !== -1 || target.indexOf(candidateTitle) !== -1)) score = Math.max(score, 85);
    else if (slug && (slug.indexOf(target) !== -1 || target.indexOf(slug) !== -1)) score = Math.max(score, 80);
    else {
      var targetWords = target.split(" ");
      var hits = 0;
      targetWords.forEach(function(word) {
        if (word.length > 1 && ((candidateTitle && candidateTitle.indexOf(word) !== -1) || (slug && slug.indexOf(word) !== -1))) hits += 1;
      });
      if (targetWords.length && hits / targetWords.length >= 0.7) score = Math.max(score, 55 + hits);
    }
  });

  if (metadata.year && new RegExp("(^|\\D)" + metadata.year + "(\\D|$)").test(candidate.text)) score += 8;
  if (season && Number(season) > 1) {
    var seasonPattern = new RegExp("(^| )" + Number(season) + " (sezon|season)( |$)");
    if (seasonPattern.test(candidateTitle + " " + slug + " " + pageText)) score += 30;
    else if (/(^| )\d+ (sezon|season)( |$)/.test(candidateTitle + " " + slug)) score -= 35;
  }
  return score;
}

function searchQueries(metadata, season) {
  var queries = [];
  metadata.titles.slice(0, 12).forEach(function(title) {
    if (season && Number(season) > 1) {
      queries.push(title + " " + Number(season) + ". Sezon");
      queries.push(title + " Season " + Number(season));
    }
    queries.push(title);
  });
  return unique(queries).slice(0, 16);
}

function searchSeries(metadata, season) {
  var queries = searchQueries(metadata, season);
  var candidates = [];
  var decisiveScore = season && Number(season) > 1 ? 150 : 120;

  function rankedCandidate() {
    candidates.forEach(function(candidate) {
      candidate.score = candidateScore(candidate, metadata, season);
    });
    candidates.sort(function(left, right) { return right.score - left.score; });
    return candidates.length ? candidates[0] : null;
  }

  function next(index) {
    var currentBest = rankedCandidate();
    if (currentBest && currentBest.score >= decisiveScore) return Promise.resolve(currentBest);
    if (index >= queries.length) return Promise.resolve(currentBest && currentBest.score >= 55 ? currentBest : null);

    return requestText(BASE_URL + "/?s=" + encodeURIComponent(queries[index]), BASE_URL + "/")
      .then(function(html) {
        extractAnchors(html).forEach(function(anchor) {
          if (!/\/series\/[^/?#]+\/?(?:[?#].*)?$/i.test(anchor.url)) return;
          var url = absoluteUrl(anchor.url, BASE_URL + "/");
          var exists = false;
          candidates.forEach(function(item) {
            if (item.url === url) exists = true;
          });
          if (!exists) candidates.push({ url: url, title: anchor.title, text: anchor.text });
        });
      })
      .catch(function() {})
      .then(function() { return next(index + 1); });
  }

  // Kesin başlık eşleşmesi yakalanınca gereksiz site aramalarını durdururuz.
  return next(0);
}

function episodeNumbers(anchor) {
  var value = decodeHtml((anchor.text || "") + " " + (anchor.title || "") + " " + (anchor.url || ""))
    .toLowerCase()
    .replace(/bölüm/g, "bolum")
    .replace(/[^a-z0-9.-]+/g, " ");
  var range = value.match(/(?:^|[ .-])(\d+)\s*-\s*(\d+)\s*\.?\s*(?:bolum|blm)(?: |[./-]|$)/i);
  var exactMatches = [];
  var expression = /(?:^|[ .-])(\d+)\s*\.?\s*(?:bolum|blm)(?: |[./-]|$)/gi;
  var match;

  if (range) return { start: Number(range[1]), end: Number(range[2]) };
  while ((match = expression.exec(value))) exactMatches.push(Number(match[1]));
  if (exactMatches.length) return { start: exactMatches[exactMatches.length - 1], end: exactMatches[exactMatches.length - 1] };
  return null;
}

function findEpisodeUrl(detailHtml, episode, metadata) {
  var target = Number(episode || 1);
  var matches = [];

  extractAnchors(detailHtml).forEach(function(anchor) {
    var numbers = episodeNumbers(anchor);
    if (!numbers || target < numbers.start || target > numbers.end) return;
    var score = numbers.start === target && numbers.end === target ? 100 : 70;
    var normalizedText = normalize(anchor.text + " " + anchor.title);
    metadata.titles.forEach(function(title) {
      var normalizedTitle = normalize(title);
      if (normalizedTitle && normalizedText.indexOf(normalizedTitle) !== -1) score += 15;
    });
    matches.push({ url: absoluteUrl(anchor.url, BASE_URL + "/"), score: score });
  });

  matches.sort(function(left, right) { return right.score - left.score; });
  return matches.length ? matches[0].url : "";
}

function decodeBase64(value) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var clean = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var output = "";
  var index = 0;

  while (index < clean.length) {
    var first = alphabet.indexOf(clean.charAt(index++));
    var second = alphabet.indexOf(clean.charAt(index++));
    var third = alphabet.indexOf(clean.charAt(index++));
    var fourth = alphabet.indexOf(clean.charAt(index++));
    var byte1 = (first << 2) | (second >> 4);
    var byte2 = ((second & 15) << 4) | (third >> 2);
    var byte3 = ((third & 3) << 6) | fourth;
    output += String.fromCharCode(byte1);
    if (third !== 64 && third !== -1) output += String.fromCharCode(byte2);
    if (fourth !== 64 && fourth !== -1) output += String.fromCharCode(byte3);
  }
  return output;
}

function extractPlayerReferences(html, pageUrl) {
  var references = [];
  var iframeExpression = /<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  var optionExpression = /<option\b[^>]*value\s*=\s*["']([A-Za-z0-9+/=]+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  var match;

  // Seçenek etiketlerini önce okuyarak aynı iframe için gerçek player adını koruruz.
  while ((match = optionExpression.exec(html))) {
    var decoded = decodeBase64(match[1]);
    var sourceMatch = decoded.match(/(?:src|data-src)\s*=\s*["']([^"']+)["']/i);
    if (sourceMatch) references.push({ url: absoluteUrl(sourceMatch[1], pageUrl), label: stripTags(match[2]) || "Player" });
  }

  while ((match = iframeExpression.exec(html))) {
    references.push({ url: absoluteUrl(match[1], pageUrl), label: "Player" });
  }

  var seen = [];
  return references.filter(function(reference) {
    if (!reference.url || seen.indexOf(reference.url) !== -1) return false;
    seen.push(reference.url);
    return true;
  }).slice(0, 10);
}

function decodeEscapedSource(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\x26/gi, "&")
    .replace(/\\x2f/gi, "/");
}

function qualityFromContext(source, position, url) {
  var before = source.slice(Math.max(0, position - 180), position);
  var match = before.match(/["']?(2160|1440|1080|720|480|360|240)[pP]?["']?\s*:\s*\{[^{}]{0,100}$/);
  if (!match) match = String(url).match(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240)[pP]?(?:[^0-9]|$)/);
  return match ? match[1] + "P" : "Auto";
}

function extractMediaUrls(source, baseUrl) {
  var decoded = decodeEscapedSource(source);
  var media = [];
  var expression = /https?:\/\/[^"'<>\s\\]+?(?:\.m3u8|\.mp4|\.m4v)(?:\?[^"'<>\s\\]*)?/gi;
  var match;

  while ((match = expression.exec(decoded))) {
    var url = match[0].replace(/[),;]+$/, "");
    if (/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(url)) continue;
    media.push({ url: absoluteUrl(url, baseUrl), quality: qualityFromContext(decoded, match.index, url) });
  }

  var uniqueMedia = [];
  media.forEach(function(item) {
    var exists = false;
    uniqueMedia.forEach(function(known) {
      if (known.url === item.url) exists = true;
    });
    if (!exists) uniqueMedia.push(item);
  });
  return uniqueMedia;
}

function resolvePlayer(reference, episodeUrl) {
  var direct = extractMediaUrls(reference.url, episodeUrl);
  if (direct.length) return Promise.resolve({ reference: reference, media: direct });

  return requestText(reference.url, episodeUrl).then(function(playerHtml) {
    return { reference: reference, media: extractMediaUrls(playerHtml, reference.url) };
  }).catch(function() {
    return { reference: reference, media: [] };
  });
}

function extractStreamsFromPage(html, pageUrl, displayTitle) {
  var references = extractPlayerReferences(html, pageUrl);
  var directMedia = extractMediaUrls(html, pageUrl);
  var streams = [];

  directMedia.forEach(function(media) {
    streams.push({
      name: PROVIDER_NAME + " - Direct",
      title: displayTitle + " - " + media.quality,
      url: media.url,
      quality: media.quality,
      headers: { Referer: pageUrl, Origin: originOf(pageUrl), "User-Agent": USER_AGENT }
    });
  });

  function resolveNext(index) {
    if (directMedia.length || index >= references.length) return Promise.resolve([]);
    return resolvePlayer(references[index], pageUrl).then(function(result) {
      return result.media.length ? [result] : resolveNext(index + 1);
    });
  }

  // İlk çalışan aynada durarak erişilemeyen yedek playerların Nuvio sonucunu geciktirmesini önleriz.
  return resolveNext(0).then(function(results) {
    results.forEach(function(result) {
      result.media.forEach(function(media) {
        streams.push({
          name: PROVIDER_NAME + " - " + result.reference.label,
          title: displayTitle + " - " + result.reference.label + " - " + media.quality,
          url: media.url,
          quality: media.quality,
          headers: { Referer: result.reference.url, Origin: originOf(result.reference.url), "User-Agent": USER_AGENT }
        });
      });
    });

    var seen = [];
    return streams.filter(function(stream) {
      if (!stream.url || seen.indexOf(stream.url) !== -1) return false;
      seen.push(stream.url);
      return true;
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var identifierParts = String(tmdbId || "").split(":");
  var identifier = identifierParts[0];

  // Nuvio/Stremio biçimindeki IMDb:sezon:bölüm girdisini doğrudan destekleriz.
  if (identifierParts.length >= 3) {
    season = Number(identifierParts[1]) || season;
    episode = Number(identifierParts[2]) || episode;
    mediaType = "tv";
  }
  if (mediaType !== "tv" && mediaType !== "movie") return Promise.resolve([]);

  var metadata;
  var candidate;
  return fetchMetadata(identifier, mediaType)
    .then(function(result) {
      metadata = result;
      return searchSeries(metadata, mediaType === "tv" ? season : null);
    })
    .then(function(result) {
      candidate = result;
      if (!candidate) throw new Error("AsyaAnimeleri eşleşmesi bulunamadı");
      return requestText(candidate.url, BASE_URL + "/");
    })
    .then(function(detailHtml) {
      var episodeUrl = findEpisodeUrl(detailHtml, mediaType === "tv" ? episode : 1, metadata);
      if (episodeUrl) {
        return requestText(episodeUrl, candidate.url).then(function(episodeHtml) {
          return extractStreamsFromPage(episodeHtml, episodeUrl, metadata.displayTitle + (mediaType === "tv" ? " S" + Number(season || 1) + "E" + Number(episode || 1) : ""));
        });
      }
      if (mediaType === "movie") return extractStreamsFromPage(detailHtml, candidate.url, metadata.displayTitle);
      throw new Error("Hedef bölüm bulunamadı");
    })
    .catch(function(error) {
      console.error("[" + PROVIDER_NAME + "] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
