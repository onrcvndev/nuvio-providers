var BASE_URL = "https://webdramaturkey2.com";
var PROVIDER_NAME = "CVN-WebDramaTurkey";
var TMDB_API_URL = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";
var USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
var MAX_PLAYER_DEPTH = 4;

function requestText(url, referer, options) {
  var requestOptions = Object.assign({}, options || {});
  requestOptions.method = requestOptions.method || "GET";
  requestOptions.headers = Object.assign({
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": USER_AGENT
  }, requestOptions.headers || {});
  if (referer) requestOptions.headers.Referer = referer;

  return fetch(url, requestOptions).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.text();
  });
}

function requestJson(url, headers) {
  return fetch(url, {
    method: "GET",
    headers: Object.assign({ Accept: "application/json", "User-Agent": USER_AGENT }, headers || {})
  }).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
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
    .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(Number(code)); });
}

function decodeEscapedSource(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u([0-9a-f]{4})/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/\\x([0-9a-f]{2})/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/\\\//g, "/");
}

function stripTags(value) {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  var text = String(value || "").toLowerCase();
  var from = "çğıöşüâîûéèêáàäíìóòöúùüñý’'";
  var to = "cgiosuaiueeeaaaiiooouuunyy  ";
  var index;

  for (index = 0; index < from.length; index += 1) {
    text = text.split(from.charAt(index)).join(to.charAt(index));
  }
  return text.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values) {
  var result = [];
  (values || []).forEach(function(value) {
    if (value && result.indexOf(value) === -1) result.push(value);
  });
  return result;
}

function originOf(url) {
  var match = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : BASE_URL;
}

function absoluteUrl(value, baseUrl) {
  var text = decodeEscapedSource(String(value || "").trim());
  if (!text || /^(?:javascript:|data:|#|about:blank)/i.test(text)) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/\//.test(text)) return "https:" + text;

  var base = String(baseUrl || BASE_URL).split("#")[0].split("?")[0];
  var prefix;
  if (text.charAt(0) === "/") return originOf(base) + text;
  if (/\/$/.test(base)) prefix = base;
  else prefix = base.slice(0, base.lastIndexOf("/") + 1);

  var combined = prefix + text.replace(/^\.\//, "");
  var protocolMatch = combined.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!protocolMatch) return combined;

  var root = protocolMatch[1];
  var path = protocolMatch[2] || "/";
  var parts = [];
  path.split("/").forEach(function(part) {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return root + "/" + parts.join("/");
}

function attributeValue(attributes, name) {
  var expression = new RegExp("\\b" + name + "\\s*=\\s*(?:[\\\"']([^\\\"']+)[\\\"']|([^\\s>]+))", "i");
  var match = String(attributes || "").match(expression);
  return match ? match[1] || match[2] : "";
}

function extractAnchors(html) {
  var anchors = [];
  var expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var match;
  var rank = 0;

  while ((match = expression.exec(String(html || "")))) {
    var href = attributeValue(match[1], "href");
    if (!href) continue;
    var title = stripTags(attributeValue(match[1], "title"));
    var text = stripTags(match[2]);
    anchors.push({
      url: decodeHtml(href),
      title: title,
      text: text,
      searchScore: normalize(title + " " + text) ? Math.max(55, 75 - rank++ * 3) : 0
    });
  }
  return anchors;
}

function contentKind(url) {
  var match = String(url || "").match(/^https?:\/\/[^/]+\/([^/]+)/i);
  return match ? match[1].toLowerCase() : "unknown";
}

function candidateTitle(candidate) {
  return normalize(stripTags(candidate && (candidate.title || candidate.text) || ""))
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .trim();
}

function slugTitle(url) {
  var match = String(url || "").match(/^https?:\/\/[^/]+\/(?:dizi|film|anime)\/([^/?#]+)/i);
  if (!match) return "";
  try {
    return normalize(decodeURIComponent(match[1]).replace(/-/g, " "));
  } catch (_) {
    return normalize(match[1].replace(/-/g, " "));
  }
}

function isCandidateUrl(url, type, category) {
  var match = String(url || "").match(/^https?:\/\/[^/]+\/(dizi|film|anime)\/([^/?#]+)\/?$/i);
  if (!match) return false;
  if (category === "animes") return true;
  if (type === "movie") return /^(film|anime)$/i.test(match[1]);
  return /^(dizi|anime)$/i.test(match[1]);
}

function extractSearchAnchors(html) {
  var result = [];
  var sections = ["series", "movies", "shows", "animes", "actors"];
  var source = String(html || "");

  sections.forEach(function(section, index) {
    var start = source.indexOf('id="' + section + '"');
    if (start < 0) return;
    var end = source.length;

    for (var next = index + 1; next < sections.length; next += 1) {
      var nextStart = source.indexOf('id="' + sections[next] + '"', start + 1);
      if (nextStart >= 0) {
        end = nextStart;
        break;
      }
    }

    extractAnchors(source.slice(start, end)).forEach(function(anchor) {
      anchor.category = section;
      result.push(anchor);
    });
  });

  return result.length ? result : extractAnchors(source);
}

function searchQueries(metadata) {
  var queries = [];
  var titles = metadata && metadata.titles ? metadata.titles : [];

  titles.forEach(function(title) {
    if (normalize(title).length <= 1) return;
    queries.push(title);

    // Kaynak araması uzun başlıklarda daralabildiği için anlamlı kelime varyantlarını da deniyoruz.
    var words = normalize(title).split(" ").filter(function(word) {
      return word.length > 1 && ["the", "a", "an"].indexOf(word) === -1;
    });
    if (words.length > 1) queries.push(words.slice(0, 3).join(" "));
    if (words.length > 2) queries.push(words.slice(0, 2).join(" "));
  });

  return unique(queries).slice(0, 12);
}

function candidateScore(candidate, metadata, type) {
  var score = Number(candidate.searchScore || 0);
  var matched = false;
  var candidateName = candidateTitle(candidate);
  var slug = slugTitle(candidate.url).replace(/\b(?:19|20)\d{2}\b/g, "").trim();
  var rawValue = normalize((candidate.title || "") + " " + (candidate.text || "") + " " + candidate.url);

  (metadata.titles || []).forEach(function(title) {
    var target = normalize(title).replace(/\b(?:19|20)\d{2}\b/g, "").trim();
    if (!target) return;

    if (candidateName === target || slug === target) {
      matched = true;
      score = Math.max(score, 120);
    } else if (candidateName.indexOf(target) !== -1 || target.indexOf(candidateName) !== -1) {
      matched = true;
      score = Math.max(score, 90);
    } else if (slug.indexOf(target) !== -1 || target.indexOf(slug) !== -1) {
      matched = true;
      score = Math.max(score, 85);
    } else {
      var words = target.split(" ");
      var hits = words.filter(function(word) {
        return word.length > 1 && rawValue.indexOf(word) !== -1;
      }).length;
      if (words.length && hits / words.length >= 0.7) {
        matched = true;
        score = Math.max(score, 55 + hits);
      }
    }
  });

  // Site araması eşleşme yokken popüler içerikleri de döndürebildiği için yalnızca skorla seçim yapmıyoruz.
  if (!matched) return 0;
  if (metadata.year && rawValue.indexOf(String(metadata.year)) !== -1) score += 8;
  if (candidate.kind === "anime") score += 1;
  if ((type === "tv" && candidate.kind === "dizi") || (type === "movie" && candidate.kind === "film")) score += 2;
  return score;
}

function rankCandidates(candidates, metadata, type) {
  (candidates || []).forEach(function(candidate) {
    candidate.score = candidateScore(candidate, metadata, type);
  });
  candidates.sort(function(left, right) { return right.score - left.score; });
  return candidates.length ? candidates[0] : null;
}

function resolveTmdbId(identifier, mediaType) {
  if (/^\d+$/.test(String(identifier || ""))) return Promise.resolve(String(identifier));

  var type = mediaType === "movie" ? "movie" : "tv";
  var url = TMDB_API_URL + "/find/" + encodeURIComponent(String(identifier || ""))
    + "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id";
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
      return TMDB_API_URL + "/" + type + "/" + encodeURIComponent(tmdbId)
        + "?api_key=" + TMDB_API_KEY + "&language=" + language;
    });
    urls.push(TMDB_API_URL + "/" + type + "/" + encodeURIComponent(tmdbId)
      + "/alternative_titles?api_key=" + TMDB_API_KEY);

    return Promise.all(urls.map(function(url) {
      return requestJson(url).catch(function() { return null; });
    })).then(function(dataList) {
      var titles = [];
      var year = null;

      dataList.slice(0, languages.length).forEach(function(data) {
        if (!data) return;
        if (data.title || data.name) titles.push(data.title || data.name);
        if (data.original_title || data.original_name) titles.push(data.original_title || data.original_name);
        if (!year) year = Number(String(data.release_date || data.first_air_date || "").slice(0, 4)) || null;
      });

      var alternatives = dataList[languages.length];
      (alternatives && (alternatives.titles || alternatives.results) || []).forEach(function(item) {
        if (item.title) titles.push(item.title);
      });
      titles = unique(titles).filter(function(title) { return normalize(title).length > 1; });
      if (!titles.length) throw new Error("TMDB metadata bulunamadı");

      return {
        tmdbId: tmdbId,
        titles: titles,
        year: year,
        displayTitle: titles[0]
      };
    });
  });
}

function searchSource(metadata, mediaType) {
  var queries = searchQueries(metadata);
  var candidates = [];

  function searchNext(index) {
    if (index >= queries.length) {
      var finalCandidate = rankCandidates(candidates, metadata, mediaType);
      return Promise.resolve(finalCandidate && finalCandidate.score >= 55 ? finalCandidate : null);
    }

    return requestText(BASE_URL + "/arama/" + encodeURIComponent(queries[index]), BASE_URL + "/")
      .then(function(html) {
        // Arama sayfası film, dizi ve anime bölümlerini birlikte döndürebildiği için kategoriyi koruyoruz.
        extractSearchAnchors(html).forEach(function(anchor) {
          var url = absoluteUrl(anchor.url, BASE_URL + "/");
          if (!isCandidateUrl(url, mediaType, anchor.category)) return;

          var candidate = {
            url: url,
            title: anchor.title || anchor.text,
            text: anchor.text,
            category: anchor.category,
            searchScore: anchor.searchScore || 0,
            kind: anchor.category === "animes" ? "anime" : contentKind(url)
          };
          var existing = candidates.filter(function(item) { return item.url === url; })[0];

          if (existing) {
            existing.title = existing.title || candidate.title;
            existing.text = existing.text || candidate.text;
            existing.searchScore = Math.max(existing.searchScore || 0, candidate.searchScore || 0);
          } else {
            candidates.push(candidate);
          }
        });

        var best = rankCandidates(candidates, metadata, mediaType);
        if (best && best.score >= 120) return best;
        return searchNext(index + 1);
      })
      .catch(function() {
        // Bir başlık varyantı erişilemezse diğer TMDB başlıklarıyla eşleştirmeyi sürdürüyoruz.
        return searchNext(index + 1);
      });
  }

  return searchNext(0);
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

function findEpisodeUrl(html, seriesUrl, season, episode) {
  var targetSeason = Number(season);
  var targetEpisode = Number(episode);
  var matches = [];

  extractAnchors(html).forEach(function(anchor) {
    var url = absoluteUrl(anchor.url, seriesUrl);
    var pathMatch = url.match(/\/(\d+)-sezon\/(\d+)-bolum\/?$/i);
    var value = normalize((anchor.title || "") + " " + (anchor.text || "") + " " + url);
    var marker = pathMatch
      ? { season: Number(pathMatch[1]), episode: Number(pathMatch[2]) }
      : episodeMarker(value);

    if (!marker || marker.season !== targetSeason || marker.episode !== targetEpisode) return;
    matches.push(url);
  });

  if (matches.length) return matches[0];

  // Sayfa bölüm bağlantısını listelemese bile sitenin kararlı URL şemasından hedef bölümü kuruyoruz.
  var baseMatch = String(seriesUrl || "").match(/^(https?:\/\/[^/]+\/(?:dizi|anime)\/[^/?#]+)/i);
  if (!baseMatch || !targetSeason || !targetEpisode) return "";
  return baseMatch[1] + "/" + targetSeason + "-sezon/" + targetEpisode + "-bolum";
}

function extractEmbedSources(html) {
  var sources = [];
  var expression = /<(?:button|a|div)\b([^>]*\b(?:data-embed|data-embed-id|data-player-id)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*)>([\s\S]*?)<\/(?:button|a|div)>/gi;
  var match;

  while ((match = expression.exec(String(html || "")))) {
    var id = decodeHtml(match[2] || match[3] || "").trim();
    if (!id || sources.some(function(source) { return source.id === id; })) continue;
    sources.push({ id: id, label: stripTags(match[4]) || "WebDramaTurkey" });
  }

  if (!sources.length) {
    var fallback = /\b(?:data-embed|data-embed-id|data-player-id)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi;
    while ((match = fallback.exec(String(html || "")))) {
      var fallbackId = decodeHtml(match[1] || match[2] || "").trim();
      if (fallbackId && !sources.some(function(source) { return source.id === fallbackId; })) {
        sources.push({ id: fallbackId, label: "WebDramaTurkey" });
      }
    }
  }
  return sources.slice(0, 12);
}

function extractIframeUrls(html, pageUrl) {
  var urls = [];
  var expression = /<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  var match;

  while ((match = expression.exec(String(html || "")))) {
    var url = absoluteUrl(decodeHtml(match[1]), pageUrl);
    if (url && urls.indexOf(url) === -1) urls.push(url);
  }
  return urls.slice(0, 10);
}

function qualityFromContext(source, position, url) {
  var before = String(source || "").slice(Math.max(0, position - 180), position);
  var match = before.match(/(?:["']?(2160|1440|1080|720|480|360|240)[pP]?["']?\s*:\s*\{)|(?:^|[\/_-])(2160|1440|1080|720|480|360|240)[pP](?:[\/_-]|$)/i);
  var value = match && (match[1] || match[2]);

  if (!value) {
    var urlMatch = String(url || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240)[pP]?(?:[^0-9]|$)/i);
    value = urlMatch && urlMatch[1];
  }
  return value ? value + "P" : "Auto";
}

function addMedia(media, rawUrl, baseUrl, source, position) {
  var cleaned = String(rawUrl || "").replace(/[),;]+$/, "");
  var url = absoluteUrl(cleaned, baseUrl);
  if (!url || !/^https?:\/\//i.test(url) || /^blob:/i.test(url)) return;
  if (/\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(url)) return;
  if (/(?:\/ads?\/|\/reklam|\/site\.webm(?:[?#]|$))/i.test(url)) return;
  if (media.some(function(item) { return item.url === url; })) return;
  media.push({ url: url, quality: qualityFromContext(source, position, url) });
}

function extractMediaUrls(source, baseUrl) {
  var text = decodeEscapedSource(unpackScripts(source));
  var media = [];
  var expression = /(?:https?:)?\/\/[^"'<>\s\\]+?\.(?:m3u8|m3u|mp4|mkv|m4v|webm|txt)(?:\?[^"'<>\s\\]*)?/gi;
  var relativeExpression = /["']((?:\/|\.\/|\.\.\/)[^"']+?\.(?:m3u8|m3u|mp4|mkv|m4v|webm|txt)(?:\?[^"']*)?)["']/gi;
  var match;

  try {
    text = decodeURIComponent(text);
  } catch (_) {}

  while ((match = expression.exec(text))) addMedia(media, match[0], baseUrl, text, match.index);
  while ((match = relativeExpression.exec(text))) addMedia(media, match[1], baseUrl, text, match.index);
  return media;
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
    if (!dictionary) break;

    var words = dictionary.value.split("|");
    var decoded = packed.value;
    for (var index = count - 1; index >= 0; index -= 1) {
      var token = packedToken(index, radix);
      var word = words[index] || token;
      if (word) decoded = decoded.replace(new RegExp("\\b" + token + "\\b", "g"), word);
    }
    output += "\n" + decoded;
    searchFrom = dictionary.next;
  }
  return output;
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

function streamHeaders(referer) {
  return {
    Referer: referer,
    Origin: originOf(referer),
    "User-Agent": USER_AGENT
  };
}

function createStream(displayTitle, sourceLabel, url, quality, headers) {
  return {
    name: PROVIDER_NAME + " - " + sourceLabel,
    title: displayTitle + " - " + sourceLabel + " - " + quality,
    url: url,
    quality: quality,
    headers: headers
  };
}

function hostLabel(url) {
  var match = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return match ? match[1] : "Player";
}

function providerDisplayTitle(candidate, fallback) {
  var value = candidate && (candidate.title || candidate.text) || fallback;
  return stripTags(value)
    .replace(/\s*\(\d{4}\)\s*$/i, "")
    .replace(/\s+(?:izle|watch)\s*$/i, "")
    .trim() || fallback;
}

function resolveDtpasnPlayer(url, referer, label) {
  var match = String(url || "").match(/^(https?:\/\/dtpasn\.asia)\/video\/([^/?#]+)/i);
  if (!match) return Promise.resolve(null);

  // dtpasn oynatıcının asıl medya adresini iframe HTML'i yerine kendi player endpoint'inden alıyoruz.
  var token = match[2];
  var endpoint = match[1] + "/player/index.php?data=" + encodeURIComponent(token) + "&do=getVideo";
  return requestText(endpoint, url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: "hash=" + encodeURIComponent(token) + "&r=" + encodeURIComponent(referer || "")
  }).then(function(response) {
    var data;
    try {
      data = JSON.parse(response);
    } catch (_) {
      data = null;
    }

    var preferredUrl = data && (data.securedLink || data.videoSource);
    var media = preferredUrl
      ? [{ url: absoluteUrl(preferredUrl, endpoint), quality: qualityFromContext(preferredUrl, 0, preferredUrl) }]
      : extractMediaUrls(response, endpoint);
    return media.length ? { embedUrl: url, label: label || hostLabel(url), media: media } : null;
  }).catch(function() { return null; });
}

function resolvePlayerUrl(url, referer, label, visited, depth) {
  return resolveDtpasnPlayer(url, referer, label).then(function(directResult) {
    if (directResult) return directResult;
    return requestText(url, referer).then(function(html) {
      return resolvePlayerHtml(html, url, referer, label, visited, depth);
    });
  }).catch(function() { return null; });
}

function resolvePlayerHtml(html, currentUrl, referer, label, visited, depth) {
  var media = extractMediaUrls(html, currentUrl);
  if (media.length) {
    return Promise.resolve({
      embedUrl: currentUrl,
      label: label || hostLabel(currentUrl),
      media: media
    });
  }
  if (depth >= MAX_PLAYER_DEPTH) return Promise.resolve(null);

  var seen = visited || [];
  var iframeUrls = extractIframeUrls(html, currentUrl).filter(function(url) {
    return seen.indexOf(url) === -1;
  });
  if (!iframeUrls.length) return Promise.resolve(null);

  var nextVisited = seen.concat([currentUrl]);
  var iframeReferer = currentUrl === BASE_URL + "/ajax/embed" ? referer : currentUrl;
  return Promise.all(iframeUrls.map(function(iframeUrl) {
    // İç içe player çağrılarında gerçek referer zincirini korumak CDN erişimini engelleyen kontrolleri aşar.
    return resolvePlayerUrl(iframeUrl, iframeReferer, label, nextVisited, depth + 1);
  })).then(function(results) {
    for (var index = 0; index < results.length; index += 1) {
      if (results[index]) return results[index];
    }
    return null;
  });
}

function resolveEmbed(embedId, pageUrl, label) {
  var ajaxUrl = BASE_URL + "/ajax/embed";
  return requestText(ajaxUrl, pageUrl, {
    method: "POST",
    headers: {
      Accept: "text/html, */*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: "id=" + encodeURIComponent(embedId)
  }).then(function(embedHtml) {
    return resolvePlayerHtml(embedHtml, ajaxUrl, pageUrl, label, [], 0);
  }).catch(function() { return null; });
}

function uniqueStreams(streams) {
  var seen = [];
  return (streams || []).filter(function(stream) {
    if (!stream || !stream.url || seen.indexOf(stream.url) !== -1) return false;
    seen.push(stream.url);
    return true;
  });
}

function extractStreamsFromPage(html, pageUrl, displayTitle) {
  var streams = [];
  extractMediaUrls(html, pageUrl).forEach(function(media) {
    streams.push(createStream(displayTitle, "Direct", media.url, media.quality, streamHeaders(pageUrl)));
  });

  var sources = extractEmbedSources(html);
  return Promise.all(sources.map(function(source) {
    return resolveEmbed(source.id, pageUrl, source.label);
  })).then(function(results) {
    results.forEach(function(result) {
      if (!result) return;
      (result.media || []).forEach(function(media) {
        streams.push(createStream(
          displayTitle,
          result.label || "WebDramaTurkey",
          media.url,
          media.quality,
          streamHeaders(result.embedUrl)
        ));
      });
    });
    return uniqueStreams(streams);
  });
}

function streamsForCandidate(candidate, metadata, mediaType, season, episode) {
  return requestText(candidate.url, BASE_URL + "/").then(function(detailHtml) {
    var providerTitle = providerDisplayTitle(candidate, metadata.displayTitle);
    if (mediaType === "movie") return extractStreamsFromPage(detailHtml, candidate.url, providerTitle);

    var episodeUrl = findEpisodeUrl(detailHtml, candidate.url, season, episode);
    if (!episodeUrl) return [];
    return requestText(episodeUrl, candidate.url).then(function(episodeHtml) {
      var displayTitle = providerTitle + " S" + Number(season || 1) + "E" + Number(episode || 1);
      return extractStreamsFromPage(episodeHtml, episodeUrl, displayTitle);
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var parts = String(tmdbId || "").split(":");
  var identifier = parts[0];
  if (parts.length >= 3) {
    season = Number(parts[1]) || season;
    episode = Number(parts[2]) || episode;
    mediaType = "tv";
  }
  if (mediaType !== "movie" && mediaType !== "tv") return Promise.resolve([]);

  // TMDB eşleşmesi ve kaynak sayfası başarısız olduğunda Nuvio diğer provider'lara devam edebilmelidir.
  return fetchMetadata(identifier, mediaType)
    .then(function(metadata) {
      return searchSource(metadata, mediaType).then(function(candidate) {
        return { metadata: metadata, candidate: candidate };
      });
    })
    .then(function(result) {
      if (!result.candidate) throw new Error("WebDramaTurkey eşleşmesi bulunamadı");
      return streamsForCandidate(result.candidate, result.metadata, mediaType, season, episode);
    })
    .then(function(streams) { return streams || []; })
    .catch(function(error) {
      console.error("[" + PROVIDER_NAME + "] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

globalThis.getStreams = getStreams;
if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
