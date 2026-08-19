var BASE_URL = "https://www.dizibox.live";
var PROVIDER_NAME = "CVN-DiziBOX";
var TMDB_API_URL = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
var DIZIBOX_COOKIE = "LockUser=true; isTrustedUser=true; dbxu=1743289650198";
var MAX_PROXY_ATTEMPTS = 3;
var CRYPTO_JS;

function getCryptoJs() {
  if (CRYPTO_JS !== undefined) return CRYPTO_JS;
  CRYPTO_JS = null;
  try {
    if (typeof require === "function") CRYPTO_JS = require("crypto-js");
  } catch (error) {}
  if (!CRYPTO_JS && typeof globalThis !== "undefined" && globalThis.CryptoJS) CRYPTO_JS = globalThis.CryptoJS;
  return CRYPTO_JS;
}
// Güvenilir browser-capable proxy varsa bu şablona veya globalThis.CVN_DIZIBOX_PROXY_URL değerine yazılır.
var PROXY_URL_TEMPLATE = "";

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

function isCloudflareChallenge(html) {
  var text = String(html || "");
  // DiziBOX'un normal JavaScript'inde challenge-platform metni de bulunabiliyor; tek başına proxy fallback tetiklememeli.
  return /<title[^>]*>\s*(?:just a moment|attention required)|cf-chl-[a-z-]+|__cf_chl_|<form[^>]+(?:id|class)=["'][^"']*challenge|checking your browser|cf-turnstile/i.test(text);
}

function proxyTemplate() {
  if (PROXY_URL_TEMPLATE) return PROXY_URL_TEMPLATE;
  if (typeof globalThis === "undefined") return "";
  return globalThis.CVN_DIZIBOX_PROXY_URL || globalThis.DIZIBOX_PROXY_URL || "";
}

function proxyUrls(targetUrl) {
  var configured = proxyTemplate();
  var urls = [];
  if (configured) {
    urls.push(configured
      .replace(/\{encoded_url\}|\{url\}/gi, encodeURIComponent(targetUrl))
      .replace(/\{raw_url\}/gi, targetUrl));
    if (urls[0] === configured) urls[0] = configured + encodeURIComponent(targetUrl);
  }

  // Yapılandırılmış browser-capable proxy önceliklidir; public fallback'ler yalnızca son çare olarak kullanılır.
  urls.push("https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl));
  urls.push("https://r.jina.ai/http://" + targetUrl.replace(/^https?:\/\//i, ""));
  urls.push("https://corsproxy.io/?url=" + encodeURIComponent(targetUrl));
  return unique(urls).slice(0, MAX_PROXY_ATTEMPTS);
}

function isProxyEligibleError(error) {
  return /Cloudflare|challenge|timeout|HTTP (403|429|503)|fetch failed|network/i.test(error && error.message ? error.message : String(error));
}

function isProxyFailureBody(html) {
  return /warning:\s*target url returned error|proxy(?:_|\s)error|target url is unavailable|request failed/i.test(String(html || ""));
}

function requestViaProxy(url, referer) {
  var urls = proxyUrls(url);
  var headers = {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": USER_AGENT
  };
  if (referer) headers.Referer = referer;
  if (isDiziboxUrl(url)) headers.Cookie = DIZIBOX_COOKIE;

  function next(index) {
    if (index >= urls.length) return Promise.reject(new Error("DiziBOX proxy fallback başarısız"));
    return fetchWithTimeout(urls[index], { method: "GET", headers: headers }, 10000)
      .then(function(response) {
        if (!response.ok) throw new Error("Proxy HTTP " + response.status);
        return response.text();
      })
      .then(function(html) {
        if (!html || isCloudflareChallenge(html) || isProxyFailureBody(html)) throw new Error("Proxy geçersiz yanıt");
        return html;
      })
      .catch(function() { return next(index + 1); });
  }

  return next(0);
}

function requestText(url, referer) {
  var headers = { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "User-Agent": USER_AGENT };
  if (referer) headers.Referer = referer;
  // DiziBOX player'ları bu çerezlerle açıldığı için kaynak isteklerinde aynı oturumu koruyoruz.
  if (isDiziboxUrl(url)) headers.Cookie = DIZIBOX_COOKIE;
  return fetchWithTimeout(url, { method: "GET", headers: headers }, 12000).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.text();
  }).then(function(html) {
    // Cloudflare'ın tarayıcı challenge'ı Hermes fetch ile çözülemez; proxy yalnızca bu durumda devreye girer.
    if (isCloudflareChallenge(html)) throw new Error("DiziBOX Cloudflare challenge");
    return html;
  }).catch(function(error) {
    if (!isProxyEligibleError(error)) throw error;
    return requestViaProxy(url, referer);
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
    .replace(/\\["']/g, function(value) { return value.charAt(1); })
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
  if (text.charAt(0) === "/") return originOf(baseUrl || BASE_URL) + text;
  var base = String(baseUrl || BASE_URL).replace(/\/+$/, "");
  return base + "/" + text.replace(/^\/+/, "");
}

function originOf(url) {
  var match = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : BASE_URL;
}

function isDiziboxUrl(url) {
  return /^(?:https?:\/\/)?(?:[^/]+\.)?dizibox\./i.test(String(url || ""));
}

function extractAnchors(html) {
  var anchors = [];
  var source = String(html || "");
  var expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = expression.exec(source))) {
    var href = match[1].match(/href\s*=\s*["']([^"']+)["']/i);
    var title = match[1].match(/title\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    anchors.push({ url: decodeHtml(href[1]), title: stripTags(title ? title[1] : ""), text: stripTags(match[2]) });
  }

  // Bazı proxy'ler HTML yerine Markdown döndürür; aday linkleri bu formatta da kaybetmiyoruz.
  var markdown = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  while ((match = markdown.exec(source))) {
    var markdownUrl = decodeHtml(match[2]);
    if (anchors.some(function(anchor) { return anchor.url === markdownUrl; })) continue;
    anchors.push({ url: markdownUrl, title: stripTags(match[1]), text: stripTags(match[1]) });
  }
  return anchors;
}

function qualityFromUrl(url) {
  var match = String(url || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i);
  return match ? match[1] + "P" : "Auto";
}

function addMedia(list, value, baseUrl, allowUnknown) {
  var url = absoluteUrl(value, baseUrl);
  var knownMedia = /(?:\.m3u8|\.mp4|\.m4v|\.webm|master\.txt)(?:[?#]|$)/i.test(url);
  if (!url || !/^https?:\/\//i.test(url) || (!knownMedia && !allowUnknown)) return;
  if (!knownMedia && /\/player\/|\.php(?:[?#]|$)/i.test(url)) return;
  if (list.some(function(item) { return item.url === url; })) return;
  list.push({ url: url, quality: qualityFromUrl(url) });
}

function extractMediaUrls(source, baseUrl, allowUnknown) {
  var text = decodeEscapedSource(source);
  var media = [];
  var match;
  var direct = text.match(/(?:https?:)?\/\/[^"'<>\s\\]+(?:\.m3u8|\.mp4|\.m4v|\.webm|master\.txt)(?:[?#][^"'<>\s\\]*)?/gi) || [];
  direct.forEach(function(url) { addMedia(media, url, baseUrl, false); });

  var assignments = /(?:contentUrl|file|src|url)\s*["']?\s*[:=]\s*["']([^"']+(?:\.m3u8|\.mp4|\.m4v|\.webm|master\.txt)(?:[?#][^"']*)?)["']/gi;
  while ((match = assignments.exec(text))) addMedia(media, match[1], baseUrl, false);

  // King player dosyası uzantısız bir playlist URL'si döndürebildiği için file alanını ayrıca kabul ediyoruz.
  if (allowUnknown) {
    var fileAssignments = /\bfile\s*:\s*["']([^"']+)["']/gi;
    while ((match = fileAssignments.exec(text))) addMedia(media, match[1], baseUrl, true);
  }
  return media;
}

function playerLabel(url) {
  if (/\/player\/king\/king\.php/i.test(url)) return "King";
  if (/\/player\/moly\/moly\.php/i.test(url)) return "Moly";
  if (/\/player\/haydi\.php/i.test(url)) return "Haydi";
  return "Player";
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
    references.push({ url: url, label: playerLabel(url) });
  }
  return references;
}

function firstPlayerUrl(source, baseUrl) {
  var text = String(source || "");
  var playerBlock = text.match(/<div\b[^>]*\bid\s*=\s*["']Player["'][^>]*>[\s\S]*?<\/div>/i);
  var references = extractPlayerReferences(playerBlock ? playerBlock[0] : text, baseUrl);
  return references.length ? references[0].url : "";
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
  var slug = normalize(candidate.url.replace(/^https?:\/\/[^/]+\//i, "").replace(/^dizi(?:ler)?\//i, "").replace(/\/$/, ""));
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
    // Eski diziler Lost gibi /dizi/, yeni kayıtlar ise /diziler/ altında yayınlanabiliyor.
    if (!/\/dizi(?:ler)?\/[^/?#]+\/?(?:[?#].*)?$/i.test(anchor.url)) return;
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
    // DiziBOX eski katalogda /dizi/slug, yeni katalogda /diziler/slug biçimlerini birlikte kullanıyor.
    [
      BASE_URL + "/dizi/" + slug + "/",
      BASE_URL + "/diziler/" + slug + "/",
      BASE_URL + "/diziler/" + slug + "-izle/",
      BASE_URL + "/diziler/" + slug + "-izle-hd/",
      BASE_URL + "/diziler/" + slug + "-izle-2/",
      BASE_URL + "/diziler/" + slug + "-hd/"
    ].forEach(function(url) {
      if (urls.indexOf(url) === -1) urls.push(url);
    });
  });
  return urls;
}

function searchDirectDizibox(metadata, candidates) {
  var urls = directDiziboxCandidates(metadata);

  function tryNext(index) {
    if (index >= urls.length) return Promise.resolve();
    var url = urls[index];
    // Büyük arşiv sayfalarını paralel istemek erişim korumasını tetikliyor; ilk geçerli slug'da duruyoruz.
    return withTimeout(requestText(url, BASE_URL + "/"), 15000).then(function(html) {
      if (!html || /<body[^>]*\bhome\b/i.test(html) || !/<h1\b/i.test(html)) return tryNext(index + 1);
      var heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      var title = cleanProviderTitle(heading ? heading[1] : "");
      if (title && !candidates.some(function(item) { return item.url === url; })) {
        candidates.push({ url: url, title: title, text: title, searchScore: 72 });
        return;
      }
      return tryNext(index + 1);
    }).catch(function() { return tryNext(index + 1); });
  }

  return tryNext(0);
}

function searchSeries(metadata, mediaType, season) {
  var candidates = [];
  // Büyük DiziBOX HTML'i paralel indirilirse timeout ve rate-limit oluştuğu için sorguları sırayla yürütüyoruz.
  var queries = searchQueries(metadata, mediaType, season).slice(0, 3);

  function searchNext(index) {
    if (index >= queries.length) return Promise.resolve();
    var query = queries[index];
    return withTimeout(requestText(BASE_URL + "/?s=" + encodeURIComponent(query), BASE_URL + "/"), 15000)
      .then(function(html) { if (html) collectDiziboxCandidates(html, candidates); })
      .catch(function() {})
      .then(function() {
        return rankCandidates(candidates, metadata, season) || searchNext(index + 1);
      });
  }

  return searchNext(0).then(function() {
    var ranked = rankCandidates(candidates, metadata, season);
    if (ranked) return ranked;

    // Arama endpointi koruma altında olduğunda bilinen slug varyantlarını son doğrudan fallback olarak deniyoruz.
    return searchDirectDizibox(metadata, candidates).then(function() {
      return rankCandidates(candidates, metadata, season);
    });
  });
}

function episodeMarker(value) {
  var text = normalize(value).replace(/\./g, " ");
  var match = text.match(/(?:sezon|season)\s*(\d{1,2})\s*(?:bolum|episode)\s*(\d{1,3})/i);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  match = text.match(/s\s*(\d{1,2})\s*e\s*(\d{1,3})/i);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  match = text.match(/(\d{1,2})\s*(?:sezon|season)\s*(\d{1,3})\s*(?:bolum|episode)/i);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}

function findEpisodeLink(html, season, episode) {
  var matches = [];
  var scopes = String(html || "").match(/<article\b[^>]*\bgrid-box\b[^>]*>[\s\S]*?<\/article>/gi) || [String(html || "")];
  scopes.forEach(function(scope) {
    extractAnchors(scope).forEach(function(anchor) {
      var marker = episodeMarker(anchor.title + " " + anchor.text) || episodeMarker(anchor.url);
      if (!marker || marker.season !== Number(season) || marker.episode !== Number(episode)) return;
      matches.push({ url: absoluteUrl(anchor.url, BASE_URL + "/"), marker: marker });
    });
  });
  return matches.length ? matches[0].url : "";
}

function seasonMarker(value) {
  var text = normalize(value).replace(/\./g, " ");
  var match = text.match(/(\d{1,2})\s*(?:sezon|season)/i);
  if (match) return Number(match[1]);
  match = text.match(/(?:sezon|season)\s*(\d{1,2})/i);
  return match ? Number(match[1]) : null;
}

function findSeasonPage(html, season) {
  var wanted = Number(season);
  var matches = extractAnchors(html).filter(function(anchor) {
    if (!/\/dizi(?:ler)?\//i.test(anchor.url)) return false;
    return seasonMarker(anchor.url + " " + anchor.title + " " + anchor.text) === wanted;
  });
  return matches.length ? absoluteUrl(matches[0].url, BASE_URL + "/") : "";
}

function providerTitleFromPage(html, fallback) {
  var heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanProviderTitle(heading ? heading[1] : fallback) || fallback;
}

function mediaWithReferer(media, referer) {
  return (media || []).map(function(item) {
    if (!item) return item;
    if (!item.referer) item.referer = referer;
    return item;
  });
}

function decryptCryptoJs(ciphertext, password) {
  var crypto = getCryptoJs();
  if (!crypto || !crypto.AES || !crypto.enc || !crypto.enc.Utf8) throw new Error("crypto-js kullanılamıyor");
  var decrypted = crypto.AES.decrypt(String(ciphertext), String(password)).toString(crypto.enc.Utf8);
  if (!decrypted) throw new Error("DiziBOX AES verisi çözülemedi");
  return decrypted;
}

function decodeBase64Utf8(value) {
  var crypto = getCryptoJs();
  if (!crypto || !crypto.enc || !crypto.enc.Base64 || !crypto.enc.Utf8) throw new Error("crypto-js Base64 çözümleyicisi kullanılamıyor");
  return crypto.enc.Utf8.stringify(crypto.enc.Base64.parse(String(value || "").replace(/\s/g, "")));
}

function decodeUri(value) {
  var text = decodeEscapedSource(value).replace(/\+/g, " ");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function decodeUnescapeDocument(html) {
  var match = String(html || "").match(/unescape\s*\(\s*["']([\s\S]*?)["']\s*\)/i);
  if (!match) return String(html || "");
  try {
    return decodeBase64Utf8(decodeUri(match[1]));
  } catch (error) {
    return String(html || "");
  }
}

function resolveKingPlayer(reference, pageUrl) {
  var kingUrl = reference.url.replace(/king\.php\?v=/i, "king.php?wmode=opaque&v=");
  return requestText(kingUrl, pageUrl).then(function(kingHtml) {
    var subFrame = firstPlayerUrl(kingHtml, kingUrl);
    if (!subFrame) throw new Error("DiziBOX King iframe bulunamadı");
    return requestText(subFrame, BASE_URL + "/").then(function(playerHtml) {
      var cryptoCall = String(playerHtml || "").match(/CryptoJS\.AES\.decrypt\s*\(\s*["']([\s\S]*?)["']\s*,\s*["']([\s\S]*?)["']\s*\)/i);
      if (!cryptoCall) throw new Error("DiziBOX King AES verisi bulunamadı");
      var decryptedHtml = decryptCryptoJs(decodeEscapedSource(cryptoCall[1]), decodeEscapedSource(cryptoCall[2]));
      var media = extractMediaUrls(decryptedHtml, subFrame, true);
      if (!media.length) throw new Error("DiziBOX King medya URL'si bulunamadı");
      media.forEach(function(item) {
        // Referans implementasyonu King playlist'i kendi URL'siyle oynatıyor.
        item.referer = item.url;
        if (item.quality === "Auto") item.quality = "4K";
      });
      return { reference: reference, media: media };
    });
  }).catch(function(error) {
    console.error("[" + PROVIDER_NAME + "] King player: " + (error && error.message ? error.message : String(error)));
    return { reference: reference, media: [] };
  });
}

function resolveEncodedPlayer(reference, pageUrl) {
  var encodedUrl = reference.url;
  if (/\/player\/moly\/moly\.php/i.test(encodedUrl)) encodedUrl = encodedUrl.replace(/moly\.php\?h=/i, "moly.php?wmode=opaque&h=");
  if (/\/player\/haydi\.php/i.test(encodedUrl)) encodedUrl = encodedUrl.replace(/haydi\.php\?v=/i, "haydi.php?wmode=opaque&v=");

  return requestText(encodedUrl, pageUrl).then(function(playerHtml) {
    var decodedHtml = decodeUnescapeDocument(playerHtml);
    var subFrame = firstPlayerUrl(decodedHtml, encodedUrl);
    if (!subFrame) throw new Error(reference.label + " iframe bulunamadı");
    return resolvePlayer({ url: subFrame, label: reference.label }, BASE_URL + "/").then(function(result) {
      result.reference = reference;
      return result;
    });
  }).catch(function(error) {
    console.error("[" + PROVIDER_NAME + "] " + reference.label + " player: " + (error && error.message ? error.message : String(error)));
    return { reference: reference, media: [] };
  });
}

function resolveGenericPlayer(reference, pageUrl) {
  var direct = mediaWithReferer(extractMediaUrls(reference.url, pageUrl, false), reference.url);
  if (direct.length) return Promise.resolve({ reference: reference, media: direct });
  var resolution = requestText(reference.url, pageUrl).then(function(playerHtml) {
    var media = mediaWithReferer(extractMediaUrls(playerHtml, reference.url, false), reference.url);
    var nested = extractPlayerReferences(playerHtml, reference.url);
    return Promise.all(nested.map(function(item) {
      return withTimeout(requestText(item.url, reference.url).then(function(nestedHtml) {
        return { reference: item, media: mediaWithReferer(extractMediaUrls(nestedHtml, item.url, false), item.url) };
      }).catch(function() { return { reference: item, media: [] }; }), 7000);
    })).then(function(results) {
      results.forEach(function(result) { if (result) media = media.concat(result.media || []); });
      return { reference: reference, media: uniqueMedia(media) };
    });
  }).catch(function() { return { reference: reference, media: [] }; });
  return withTimeout(resolution, 8000).then(function(result) { return result || { reference: reference, media: [] }; });
}

function resolvePlayer(reference, pageUrl) {
  // DiziBOX'un üç player'ı farklı katmanda veri sakladığı için her biri kendi çözümleme akışına gider.
  if (/\/player\/king\/king\.php/i.test(reference.url)) return resolveKingPlayer(reference, pageUrl);
  if (/\/player\/(?:moly\/moly|haydi)\.php/i.test(reference.url)) return resolveEncodedPlayer(reference, pageUrl);
  return resolveGenericPlayer(reference, pageUrl);
}

function uniqueMedia(media) {
  var seen = [];
  return (media || []).filter(function(item) {
    if (!item || !item.url || seen.indexOf(item.url) !== -1) return false;
    seen.push(item.url);
    return true;
  });
}

function playbackHeaders(mediaUrl, referer) {
  return {
    Referer: referer || mediaUrl,
    Origin: originOf(mediaUrl),
    "User-Agent": USER_AGENT
  };
}

function extractStreamsFromPage(html, pageUrl, displayTitle) {
  var streams = [];
  extractMediaUrls(html, pageUrl, false).forEach(function(media) {
    streams.push({ name: PROVIDER_NAME + " - Direct", title: displayTitle + " - Direct - " + media.quality, url: media.url, quality: media.quality, headers: playbackHeaders(media.url, pageUrl) });
  });
  var videoArea = String(html || "").match(/<div\b[^>]*\bid\s*=\s*["']video-area["'][^>]*>[\s\S]*?<\/div>/i);
  var references = extractPlayerReferences(videoArea ? videoArea[0] : html, pageUrl);
  return Promise.all(references.map(function(reference) { return resolvePlayer(reference, pageUrl); })).then(function(results) {
    results.forEach(function(result) {
      (result.media || []).forEach(function(media) {
        var referer = media.referer || result.referer || result.reference.url;
        streams.push({ name: PROVIDER_NAME + " - " + result.reference.label, title: displayTitle + " - " + result.reference.label + " - " + media.quality, url: media.url, quality: media.quality, headers: playbackHeaders(media.url, referer) });
      });
    });
    return uniqueStreams(streams);
  });
}

function extractVideoOptionUrls(html, baseUrl) {
  var urls = [];
  var expression = /<option\b([^>]*)>/gi;
  var match;
  while ((match = expression.exec(String(html || "")))) {
    var valueMatch = match[1].match(/\bvalue\s*=\s*["']([^"']+)["']/i);
    if (!valueMatch || /^(?:#|javascript:|0$)/i.test(valueMatch[1])) continue;
    var url = absoluteUrl(valueMatch[1], baseUrl);
    if (!url || urls.indexOf(url) !== -1) continue;
    urls.push(url);
  }
  return urls;
}

function extractEpisodeStreams(html, pageUrl, displayTitle) {
  var pages = [{ html: html, url: pageUrl }];
  var optionUrls = extractVideoOptionUrls(html, pageUrl);
  // Toolbar seçenekleri farklı dil/kalite player'larını taşıdığı için ana iframe'e ek olarak taranır.
  return Promise.all(optionUrls.map(function(url) {
    return requestText(url, pageUrl).then(function(optionHtml) {
      return { html: optionHtml, url: url };
    }).catch(function() { return null; });
  })).then(function(alternativePages) {
    alternativePages.forEach(function(page) { if (page) pages.push(page); });
    return Promise.all(pages.map(function(page) {
      return extractStreamsFromPage(page.html, page.url, displayTitle);
    }));
  }).then(function(streamLists) {
    var streams = [];
    streamLists.forEach(function(list) { streams = streams.concat(list || []); });
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
        return extractEpisodeStreams(episodeHtml, episodeUrl, displayTitle);
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

if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
