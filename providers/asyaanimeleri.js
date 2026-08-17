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
    var seasonEpisodeCounts = {};
    var chain = Promise.resolve();

    languages.forEach(function(language) {
      chain = chain.then(function() {
        var url = TMDB_API_URL + "/" + type + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY + "&language=" + language;
        return requestJson(url).then(function(data) {
          if (data.title || data.name) titles.push(data.title || data.name);
          if (data.original_title || data.original_name) titles.push(data.original_title || data.original_name);
          if (!year) year = Number(String(data.release_date || data.first_air_date || "").slice(0, 4)) || null;
          (data.seasons || []).forEach(function(item) {
            var seasonNumber = Number(item.season_number);
            var episodeCount = Number(item.episode_count);
            if (seasonNumber > 0 && episodeCount > 0) seasonEpisodeCounts[seasonNumber] = episodeCount;
          });
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
      return { tmdbId: tmdbId, titles: titles, year: year, displayTitle: titles[0], seasonEpisodeCounts: seasonEpisodeCounts };
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
  var searchScore = Number(candidate.searchScore || 0);
  var titleScore = 0;
  var pageText = normalize(candidate.text);

  metadata.titles.forEach(function(title) {
    var target = normalize(title);
    if (!target) return;
    if ((candidateTitle && candidateTitle === target) || (slug && slug === target)) titleScore = Math.max(titleScore, 120);
    else if (candidateTitle && (candidateTitle.indexOf(target) !== -1 || target.indexOf(candidateTitle) !== -1)) titleScore = Math.max(titleScore, 85);
    else if (slug && (slug.indexOf(target) !== -1 || target.indexOf(slug) !== -1)) titleScore = Math.max(titleScore, 80);
    else {
      var targetWords = target.split(" ");
      var hits = 0;
      targetWords.forEach(function(word) {
        if (word.length > 1 && ((candidateTitle && candidateTitle.indexOf(word) !== -1) || (slug && slug.indexOf(word) !== -1))) hits += 1;
      });
      if (targetWords.length && hits / targetWords.length >= 0.7) titleScore = Math.max(titleScore, 55 + hits);
    }
  });

  if (metadata.year && titleScore > 0 && new RegExp("(^|\\D)" + metadata.year + "(\\D|$)").test(candidate.text)) titleScore += 8;
  if (season && Number(season) > 1 && titleScore >= 55) {
    var seasonPattern = new RegExp("(^| )" + Number(season) + " (sezon|season)( |$)");
    if (seasonPattern.test(candidateTitle + " " + slug + " " + pageText)) titleScore += 30;
    else if (/(^| )\d+ (sezon|season)( |$)/.test(candidateTitle + " " + slug)) titleScore -= 35;
  }
  return Math.max(searchScore, titleScore);
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
        var resultsStart = html.search(/<div[^>]+class=["'][^"']*listupd/i);
        var resultsEnd = resultsStart >= 0 ? html.indexOf('<div id="sidebar', resultsStart) : -1;
        var resultsHtml = resultsStart >= 0 && resultsEnd > resultsStart ? html.slice(resultsStart, resultsEnd) : "";
        var meaningfulRank = 0;

        // Sidebar önerilerini değil yalnızca gerçek WordPress arama sonuçlarını değerlendiririz.
        extractAnchors(resultsHtml).forEach(function(anchor) {
          if (!/\/series\/[^/?#]+\/?(?:[?#].*)?$/i.test(anchor.url)) return;
          var url = absoluteUrl(anchor.url, BASE_URL + "/");
          var existing = null;
          var hasText = Boolean(normalize(anchor.title + " " + anchor.text));
          var searchScore = hasText ? Math.max(55, 70 - meaningfulRank * 5) : 0;
          if (hasText) meaningfulRank += 1;

          candidates.forEach(function(item) {
            if (item.url === url) existing = item;
          });
          if (existing) {
            if (!existing.title && anchor.title) existing.title = anchor.title;
            if (!existing.text && anchor.text) existing.text = anchor.text;
            existing.searchScore = Math.max(existing.searchScore || 0, searchScore);
          } else {
            candidates.push({ url: url, title: anchor.title, text: anchor.text, searchScore: searchScore });
          }
        });
      })
      .catch(function() {})
      .then(function() { return next(index + 1); });
  }

  // Kesin başlık eşleşmesi yakalanınca gereksiz site aramalarını durdururuz.
  return next(0);
}

function candidateMatchesSeason(candidate, season) {
  if (!candidate || !season || Number(season) <= 1) return false;
  var value = normalize((candidate.title || "") + " " + (candidate.text || "") + " " + slugTitle(candidate.url));
  return new RegExp("(^| )" + Number(season) + " (sezon|season)( |$)").test(value);
}

function absoluteEpisodeNumber(metadata, season, episode) {
  var targetSeason = Number(season || 1);
  var absolute = Number(episode || 1);
  var current;

  if (targetSeason <= 1) return absolute;
  for (current = 1; current < targetSeason; current += 1) {
    var count = Number(metadata.seasonEpisodeCounts && metadata.seasonEpisodeCounts[current]);
    if (!count) return 0;
    absolute += count;
  }
  return absolute;
}

function findSeasonEpisodeUrl(detailHtml, season, episode, metadata) {
  var targetSeason = Number(season || 1);
  var targetEpisode = Number(episode || 1);
  var matches = [];

  extractAnchors(detailHtml).forEach(function(anchor) {
    var value = normalize((anchor.text || "") + " " + (anchor.title || "") + " " + (anchor.url || ""));
    var seasonPattern = new RegExp("(^| )" + targetSeason + " (sezon|season)( |$)");
    var episodePattern = new RegExp("(^| )" + targetEpisode + " (bolum|blm)( |$)");
    if (!seasonPattern.test(value) || !episodePattern.test(value)) return;

    var score = 120;
    metadata.titles.forEach(function(title) {
      var normalizedTitle = normalize(title);
      if (normalizedTitle && value.indexOf(normalizedTitle) !== -1) score += 10;
    });
    matches.push({ url: absoluteUrl(anchor.url, BASE_URL + "/"), score: score });
  });

  matches.sort(function(left, right) { return right.score - left.score; });
  return matches.length ? matches[0].url : "";
}

function episodeNumbers(anchor) {
  var displayValue = decodeHtml((anchor.text || "") + " " + (anchor.title || ""))
    .toLowerCase()
    .replace(/bölüm/g, "bolum")
    .replace(/[^a-z0-9.-]+/g, " ")
    .trim();
  var leadingRange = displayValue.match(/^(\d+)\s*-\s*(\d+)(?: |$)/);
  var leadingExact = displayValue.match(/^(\d+)(?: |$)/);
  var value = decodeHtml((anchor.text || "") + " " + (anchor.title || "") + " " + (anchor.url || ""))
    .toLowerCase()
    .replace(/bölüm/g, "bolum")
    .replace(/[^a-z0-9.-]+/g, " ");
  var range = value.match(/(?:^|[ .-])(\d+)\s*-\s*(\d+)\s*\.?\s*(?:bolum|blm)(?: |[./-]|$)/i);
  var exactMatches = [];
  var expression = /(?:^|[ .-])(\d+)\s*\.?\s*(?:bolum|blm)(?: |[./-]|$)/gi;
  var match;

  // Birleşik seri sayfalarında kartın başındaki sayı mutlak bölüm numarasıdır.
  if (leadingRange) return { start: Number(leadingRange[1]), end: Number(leadingRange[2]) };
  if (leadingExact) return { start: Number(leadingExact[1]), end: Number(leadingExact[1]) };
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

function readPackedString(source, start) {
  var quote = source.charAt(start);
  var index = start + 1;
  var value = "";

  while (index < source.length) {
    var character = source.charAt(index++);
    if (character === quote) return { value: value, next: index };
    if (character !== "\\") {
      value += character;
      continue;
    }

    var escaped = source.charAt(index++);
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "\t";
    else if (escaped === "x") {
      value += String.fromCharCode(parseInt(source.substr(index, 2), 16));
      index += 2;
    } else if (escaped === "u") {
      value += String.fromCharCode(parseInt(source.substr(index, 4), 16));
      index += 4;
    } else value += escaped;
  }
  return { value: value, next: source.length };
}

function packedToken(value, radix) {
  var token = "";
  var number = Number(value);
  if (number >= radix) token += packedToken(Math.floor(number / radix), radix);
  number %= radix;
  token += number > 35 ? String.fromCharCode(number + 29) : number.toString(36);
  return token;
}

function unpackScripts(source) {
  var text = String(source || "");
  var output = text;
  var marker = "eval(function(p,a,c,k,e,d){";
  var searchFrom = 0;
  var start;

  while ((start = text.indexOf(marker, searchFrom)) !== -1) {
    var argsStart = text.indexOf("}(" , start + marker.length);
    if (argsStart === -1) break;
    var packed = readPackedString(text, argsStart + 2);
    if (!packed || packed.next >= text.length) break;

    var cursor = packed.next;
    while (/\s/.test(text.charAt(cursor))) cursor += 1;
    if (text.charAt(cursor) === ",") cursor += 1;
    while (/\s/.test(text.charAt(cursor))) cursor += 1;
    var radixEnd = text.indexOf(",", cursor);
    if (radixEnd === -1) break;
    var radix = Number(text.slice(cursor, radixEnd));
    cursor = radixEnd + 1;
    while (/\s/.test(text.charAt(cursor))) cursor += 1;
    var countEnd = text.indexOf(",", cursor);
    if (countEnd === -1) break;
    var count = Number(text.slice(cursor, countEnd));
    cursor = countEnd + 1;
    while (/\s/.test(text.charAt(cursor))) cursor += 1;
    var dictionary = readPackedString(text, cursor);
    if (!dictionary || text.substr(dictionary.next, 12).indexOf(".split") === -1) break;

    var words = dictionary.value.split("|");
    var decoded = packed.value;
    var index;
    for (index = count - 1; index >= 0; index -= 1) {
      var token = packedToken(index, radix);
      var word = words[index] || token;
      if (!word) continue;
      decoded = decoded.replace(new RegExp("\\b" + token + "\\b", "g"), word);
    }
    output += "\n" + decoded;
    searchFrom = dictionary.next;
  }
  return output;
}

function extractGoogleDriveMedia(source) {
  var text = decodeEscapedSource(source);
  var idMatch = text.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/i) || text.match(/name=["']id["'][^>]*value=["']([A-Za-z0-9_-]+)["']/i);
  var downloadMatch = text.match(/https?:\/\/drive\.usercontent\.google\.com\/(?:uc|download)[^"'<>\s]*/i);
  var uuidMatch = text.match(/name=["']uuid["'][^>]*value=["']([^"']+)["']/i);
  var url = downloadMatch ? downloadMatch[0].replace(/&amp;/gi, "&") : "";

  if (!url && idMatch) url = "https://drive.usercontent.google.com/download?id=" + idMatch[1] + "&export=download";
  if (url && idMatch && url.indexOf("id=") === -1) url += (url.indexOf("?") === -1 ? "?" : "&") + "id=" + idMatch[1];
  if (!url) return [];
  if (uuidMatch && url.indexOf("confirm=") === -1) url += "&confirm=t&uuid=" + encodeURIComponent(uuidMatch[1]);
  return [{ url: url, quality: "Auto" }];
}

function decodeEscapedSource(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u([0-9a-f]{4})/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/\\x([0-9a-f]{2})/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/\\\//g, "/");
}

function qualityFromContext(source, position, url) {
  var before = source.slice(Math.max(0, position - 180), position);
  var match = before.match(/["']?(2160|1440|1080|720|480|360|240)[pP]?["']?\s*:\s*\{[^{}]{0,100}$/);
  if (!match) match = String(url).match(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240)[pP]?(?:[^0-9]|$)/);
  return match ? match[1] + "P" : "Auto";
}

function extractMediaUrls(source, baseUrl) {
  var unpacked = unpackScripts(source);
  var decoded = decodeEscapedSource(unpacked);
  var media = extractGoogleDriveMedia(decoded);
  var expression = /(?:https?:)?\/\/[^"'<>\s\\]+?(?:\.(?:m3u8|mp4|m4v|webm))(?:\?[^"'<>\s\\]*)?/gi;
  var relativeExpression = /["']((?:\/|\.\/|\.\.\/)[^"']+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^"']*)?)["']/gi;
  var match;

  try {
    decoded = decodeURIComponent(decoded);
  } catch (_) {}

  while ((match = expression.exec(decoded))) {
    var url = match[0].replace(/[),;]+$/, "");
    if (/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(url)) continue;
    media.push({ url: absoluteUrl(url, baseUrl), quality: qualityFromContext(decoded, match.index, url) });
  }

  while ((match = relativeExpression.exec(decoded))) {
    media.push({ url: absoluteUrl(match[1], baseUrl), quality: qualityFromContext(decoded, match.index, match[1]) });
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

function resolveGoogleDriveMedia(source, pageUrl) {
  var initial = extractGoogleDriveMedia(source);
  if (!initial.length) return Promise.resolve([]);

  return Promise.all(initial.map(function(item) {
    return fetch(item.url, {
      method: "GET",
      headers: { Accept: "text/html,video/*,*/*;q=0.8", "User-Agent": USER_AGENT, Referer: pageUrl }
    }).then(function(response) {
      var contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (/video\//i.test(contentType) || /mpegurl|octet-stream/i.test(contentType)) return item;
      return response.text().then(function(downloadPage) {
        var confirmed = extractGoogleDriveMedia(downloadPage);
        return confirmed.length ? confirmed[0] : item;
      });
    }).catch(function() {
      return item;
    });
  }));
}

function resolveVipMedia(referenceUrl, episodeUrl) {
  var match = String(referenceUrl || "").match(/^https?:\/\/([^/]*asyaanimeleri\.pw)\/video\/([A-Za-z0-9_-]+)/i);
  if (!match) return Promise.resolve([]);

  var host = "https://" + match[1];
  var id = match[2];
  var endpoint = host + "/player/index.php?data=" + encodeURIComponent(id) + "&do=getVideo";
  var body = "hash=" + encodeURIComponent(id) + "&r=" + encodeURIComponent(episodeUrl || referenceUrl);

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      Referer: referenceUrl,
      Origin: host
    },
    body: body
  }).then(function(response) {
    if (!response.ok) throw new Error("VIP HTTP " + response.status);
    return response.json();
  }).then(function(data) {
    var media = [];
    if (data && data.securedLink) media.push({ url: data.securedLink, quality: "Auto" });
    if (data && data.videoSource && /\.(?:m3u8|mp4|m4v)(?:\?|$)/i.test(data.videoSource)) media.push({ url: data.videoSource, quality: "Auto" });
    return media;
  }).catch(function() {
    return [];
  });
}

function resolvePlayer(reference, episodeUrl) {
  var direct = extractMediaUrls(reference.url, episodeUrl);
  var isGoogleDrive = /drive\.google\.com\/file\/d\//i.test(reference.url);

  // Asya VIP iframe'i kendi AJAX endpointinden imzalı HLS kök linki üretir.
  return resolveVipMedia(reference.url, episodeUrl).then(function(vipMedia) {
    if (vipMedia.length) return { reference: reference, media: vipMedia };
    if (direct.length && !isGoogleDrive) return { reference: reference, media: direct };

    return requestText(reference.url, episodeUrl).then(function(playerHtml) {
      if (isGoogleDrive) {
        return resolveGoogleDriveMedia(playerHtml, reference.url).then(function(googleMedia) {
          return { reference: reference, media: googleMedia.length ? googleMedia : direct };
        });
      }
      var media = extractMediaUrls(playerHtml, reference.url);
      return { reference: reference, media: media.length ? media : direct };
    }).catch(function() {
      return { reference: reference, media: direct };
    });
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

  // Tüm player aynalarını paralel deneyerek Nuvio'ya birden fazla kaynak sunarız.
  return Promise.all(references.map(function(reference) {
    return resolvePlayer(reference, pageUrl);
  })).then(function(results) {
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

function episodeUrlForPage(detailHtml, candidate, metadata, mediaType, season, episode) {
  if (mediaType === "movie") return findEpisodeUrl(detailHtml, 1, metadata);

  var targetSeason = Number(season || 1);
  var targetEpisode = Number(episode || 1);
  if (targetSeason > 1) {
    var seasonEpisodeUrl = findSeasonEpisodeUrl(detailHtml, targetSeason, targetEpisode, metadata);
    if (seasonEpisodeUrl) return seasonEpisodeUrl;

    if (candidateMatchesSeason(candidate, targetSeason)) {
      var localEpisodeUrl = findEpisodeUrl(detailHtml, targetEpisode, metadata);
      if (localEpisodeUrl) return localEpisodeUrl;
    }

    var absoluteEpisode = absoluteEpisodeNumber(metadata, targetSeason, targetEpisode);
    if (absoluteEpisode) {
      var absoluteEpisodeUrl = findEpisodeUrl(detailHtml, absoluteEpisode, metadata);
      if (absoluteEpisodeUrl) return absoluteEpisodeUrl;
    }
  }

  return findEpisodeUrl(detailHtml, targetEpisode, metadata);
}

function providerDisplayTitle(candidate, fallback) {
  var value = candidate && (candidate.title || candidate.text) || fallback;
  return stripTags(value)
    .replace(/\s*\(\d{4}\)\s*$/i, "")
    .replace(/\s+(?:izle|watch)\s*$/i, "")
    .trim() || fallback;
}

function streamsForCandidate(candidate, metadata, mediaType, season, episode) {
  return requestText(candidate.url, BASE_URL + "/").then(function(detailHtml) {
    var displayName = providerDisplayTitle(candidate, metadata.displayTitle);
    var episodeUrl = episodeUrlForPage(detailHtml, candidate, metadata, mediaType, season, episode);
    var displayTitle = displayName + (mediaType === "tv" ? " S" + Number(season || 1) + "E" + Number(episode || 1) : "");

    if (episodeUrl) {
      return requestText(episodeUrl, candidate.url).then(function(episodeHtml) {
        return extractStreamsFromPage(episodeHtml, episodeUrl, displayTitle);
      });
    }
    if (mediaType === "movie") return extractStreamsFromPage(detailHtml, candidate.url, displayTitle);
    return null;
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
      return streamsForCandidate(candidate, metadata, mediaType, season, episode);
    })
    .then(function(streams) {
      if (streams !== null) return streams;
      if (mediaType !== "tv" || Number(season || 1) <= 1) throw new Error("Hedef bölüm bulunamadı");

      // Sezon sayfası bulunamadığında birleşik seri sayfasını mutlak bölüm numarasıyla deneriz.
      return searchSeries(metadata, null).then(function(genericCandidate) {
        if (!genericCandidate) throw new Error("Birleşik seri sayfası bulunamadı");
        if (genericCandidate.url === candidate.url) throw new Error("Hedef bölüm bulunamadı");
        return streamsForCandidate(genericCandidate, metadata, mediaType, season, episode).then(function(fallbackStreams) {
          if (fallbackStreams === null) throw new Error("Birleşik seride hedef bölüm bulunamadı");
          return fallbackStreams;
        });
      });
    })
    .catch(function(error) {
      console.error("[" + PROVIDER_NAME + "] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
