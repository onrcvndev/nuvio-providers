# Nuvio Provider Development Guide

This comprehensive guide covers everything you need to know to build, debug, and publish streaming providers for the Nuvio app.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
   - [Setup](#setup)
   - [Architecture](#architecture)
3. [The Provider Template](#3-the-provider-template)
4. [Development Workflow](#4-development-workflow)
5. [The Build System](#5-the-build-system)
   - [Transpiling Async/Await](#transpiling-asyncawait)
   - [Watch Mode](#watch-mode)
6. [API Reference](#6-api-reference)
7. [Testing & Debugging](#7-testing--debugging)
8. [Publishing](#8-publishing)
9. [FAQ & Troubleshooting](#9-faq--troubleshooting)

---

## 1. Introduction

A **Nuvio Provider** is a JavaScript module responsible for finding video streams. When a user taps a movie in the app, the provider receives the media details (TMDB ID, title, etc.) and returns a list of playable URLs.

Providers run locally on the user's device. The Nuvio app uses the **Hermes** JavaScript engine.

Provider display names must start with `CVN-`. Keep internal IDs, filenames, and upstream plugin/API names unchanged.

**Crucial Limitation:** Hermes does not natively support `async/await` syntax inside dynamically loaded code (plugins).
**Our Solution:** We provide a build script that automatically transpiles your modern `async/await` code into generator functions that Hermes can execute safely.

**Also Important (Runtime Differences):** Local Node.js tests can pass even when the provider fails in-app.
The Nuvio runtime is React Native + Hermes, so many Node-specific APIs/modules are not available (for example Node built-ins like `crypto`, and some crypto libraries that assume a Node/browser environment such as `node-forge`).
If your provider uses encryption/decryption or heavy parsing dependencies, always test it in the Nuvio app (Plugin Tester) even if it works locally.

---

## 2. Getting Started

### Setup

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/tapframe/nuvio-providers.git
    cd nuvio-providers
    ```

2.  **Install Dependencies**
    This installs the build tools (`esbuild`) required for transpilation.
    ```bash
    npm install
    ```

### Architecture

-   **`providers/`**: The active source and runtime folder. Each provider is a standalone web scraper loaded directly by the app.
-   **`manifest.json`**: The provider registry. Every `scrapers[].filename` entry must point to a working `providers/<provider>.js` file.
-   **`build.js`**: The utility script used mostly to transpile single-file providers when `async/await` appears.
-   **`src/`**: Not used for active provider development in this repository. Do not add shared local helper modules for runtime providers.

---

## 3. The Provider Template

New providers should be created as standalone files in `providers/`. A provider file must fetch TMDB metadata, search the source website, scrape the selected detail or episode page, and return stream objects without importing other local files.

Provider files may use runtime-compatible packages such as `cheerio-without-node-native`, plus global `fetch` and `console`. They must not depend on external proxy `/search`, `/load_item`, or `/load_links` APIs.

---

## 4. Development Workflow

### Single-File Web Scrape Providers

All active provider logic lives in `providers/<provider>.js`.

1.  **Fetch TMDB metadata**
    Query multiple languages and keep title variants plus release year.
2.  **Search the source site**
    Use the site's own search URLs and scrape candidate links from HTML.
3.  **Score candidates**
    Compare normalized titles, year, media type, and for TV/anime the target season/episode.
4.  **Scrape detail or episode pages**
    Extract iframes, player scripts, direct HLS/MP4 URLs, and subtitle tracks.
5.  **Return Nuvio stream objects**
    Include `name`, `title`, `url`, `quality`, optional `headers`, and optional `subtitles`.

Use Promise chains in provider files. If a file contains `async/await`, run the transpiler before testing in the app.

Example:
    ```javascript
    // providers/myprovider.js
    function getStreams(tmdbId, mediaType, season, episode) {
      return getMetadata(tmdbId, mediaType)
        .then(function(metadata) {
          return searchSource(metadata, mediaType, season, episode);
        })
        .then(function(pageUrl) {
          return pageUrl ? extractStreams(pageUrl) : [];
        })
        .catch(function(error) {
          console.error("[CVN-MyProvider] Error:", error.message);
          return [];
        });
    }

    if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
    if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
    ```

---

## 5. The Build System

The `build.js` script is mainly used for **transpiling** single-file providers. It converts ES2017+ async/await into ES2016 generators when needed.

### Transpiling Async/Await (Single Files)

If you have a standalone file in `providers/` that uses `async/await`, you must transpile it.

Usage: `node build.js --transpile [filenames...]`

| Command | Description |
|---------|-------------|
| `node build.js --transpile` | Scans `providers/` for single files using async and transpiles them all. |
| `node build.js --transpile old-scraper` | Transpiles `providers/old-scraper.js` in-place. |
| `node build.js --transpile file1 file2` | Transpiles multiple specific files. |

**Note**: This overwrites the file with the transpiled version. Prefer Promise chains in `providers/` so the committed provider remains readable and Hermes-compatible.

### Watch Mode

Watch mode only applies to legacy `src/` builds and is not part of the active provider workflow.

```bash
npm run build:watch
```

### Minification

By default, builds keep code readable for debugging. You can enable minification to reduce file size.

Usage: `node build.js --minify [provider_names...]`

| Command | Description |
|---------|-------------|
| `node build.js --minify` | Builds **ALL** providers with minification. |
| `node build.js --minify vidlink` | Builds only `vidlink` provider, minified. |
| `node build.js --minify vidlink castle` | Builds multiple providers, all minified. |

#### Advantages of Minification

- **Smaller File Size**: ~50% reduction for providers with heavy dependencies (e.g., using `node-forge`, `cheerio`).
  - Example: A 1.0 MB unminified bundle becomes ~473 KB when minified.
- **Faster Load Time**: Smaller files load quicker in the Nuvio app and over network transfers.
- **Reduced Storage**: Less disk space consumed on user devices.
- **Production Ready**: Recommended for final releases.

#### Disadvantages of Minification

- **Hard to Debug**: Variable and function names are mangled (e.g., `getStreams()` → `u()`), making it difficult to troubleshoot errors from crash reports or logs.
- **Longer Build Time**: Minification adds a slight overhead to the build process.
- **Stack Traces Unreadable**: Error messages won't map back to original function names.

#### Recommendation

- **Development**: Use unminified builds (`node build.js`) for easier debugging.
- **Testing**: Test both minified and unminified versions before publishing.
- **Production/Release**: Use minified builds (`node build.js --minify`) for deployment to users.

---

## 6. API Reference

Your provider must export a `getStreams` function.

```javascript
/*
 * @param {string} tmdbId - The TMDB ID (e.g., "550")
 * @param {string} mediaType - "movie" or "tv"
 * @param {number} season - Season number (1-based), null for movies
 * @param {number} episode - Episode number (1-based), null for movies
 * @returns {Promise<Array>} - List of streams
 */
async function getStreams(tmdbId, mediaType, season, episode) { ... }
```

### Stream Object

```javascript
{
  "name": "CVN-MyProvider",        // Short identifier
  "title": "1080p Stream",         // Display name
  "url": "https://server.com/...", // Playable URL
  "quality": "1080p",              // 4K, 1080p, 720p, CAM
  "headers": {                     // (Optional)
    "User-Agent": "Key for playback",
    "Referer": "..."
  }
}
```

---

## 7. Testing & Debugging

While local Node.js scripts are useful for initial logic verification, providers must be tested within the Nuvio application to ensure compatibility with the Hermes engine and the app's runtime environment.

### 7.1. Local Logic Verification (Node.js)

Create a temporary test script (e.g., `test.js`) to verify your provider's scraping logic on your computer.

```javascript
const { getStreams } = require('./providers/myprovider.js');

async function run() {
    console.log("Fetching streams...");
    try {
        const streams = await getStreams('550', 'movie'); // Fight Club
        console.log(streams);
    } catch (e) {
        console.error(e);
    }
}
run();
```

Run it using:
```bash
node test.js
```

### 7.2. In-App Testing (Plugin Tester)

The **Plugin Tester** is a dedicated developer tool within the Nuvio app that allows you to load, run, and debug providers directly on your device interactively.

#### Prerequisites
1.  **Get the App**: You need the **debug version** of Nuvio.
    -   **Download**: Get the latest `debug.apk` from the **Releases** tab on GitHub.
    -   **Build**: Or run `npx expo run:android` / `npx expo run:ios` locally.
    > *Note: Production versions do not include the Plugin Tester.*

2.  Ensure your computer and mobile device are on the same Wi-Fi network.
3.  Start the local development server in this repository:
    ```bash
    npm start
    ```
    This serves your `providers/` directory and `manifest.json` over HTTP (e.g., `http://192.168.1.X:3000`).

#### Accessing the Plugin Tester
1.  Open the Nuvio application.
2.  Navigate to **Settings**.
3.  Scroll down to the **Developer Section** and select **Plugin Tester**.

#### Testing Individual Providers
The "Individual Plugin" tab is designed for rapid iteration on a single provider script.

> [!IMPORTANT]
> **Code Requirements:** You must use the standalone provider file from `providers/`.
> The app cannot execute provider code that imports other local project files. Keep runtime providers single-file and transpile only when a provider contains `async/await`.

1.  **Load Source**:
    -   **From URL**: Enter the direct URL to your provider file hosted by your local server (e.g., `http://192.168.1.5:3000/providers/myprovider.js`) and tap **Load**.
    -   **Direct Input**: Alternatively, paste your provider code directly into the code editor.
2.  **Parameters**: Set the test parameters (TMDB ID, Media Type, Season, Episode).
3.  **Run Test**: Tap the **Run Test** button.
4.  **View Results**:
    -   **Logs**: Check the "Logs" tab for `console.log` output and errors.
    -   **Results**: View the list of discovered streams in the "Results" tab.
    -   **Playback**: Tap the **Play** button on any stream result to verify that the URL is playable in the native player (KSPlayer on iOS, AndroidVideoPlayer on Android).

#### Testing Repositories
The "Repo Tester" tab allows you to validate an entire plugin repository manifest.

1.  Enter your local manifest URL (e.g., `http://192.168.1.5:3000/manifest.json`).
2.  Tap **Fetch Manifest** to load the list of available providers.
3.  Tap **Test All** to run a connectivity test on all enabled providers in the manifest, or test specific providers individually.

> [!NOTE]
> The Plugin Tester behaves exactly like the production app environment (Hermes), so if a provider works here, it will work for users.

---

## 8. Publishing

1.  **Prepare your provider**: Ensure `providers/myprovider.js` is up to date and transpiled if needed.
    ```bash
    node build.js --transpile myprovider.js
    ```
2.  **Update Manifest**: Add your provider entry to `manifest.json`.
3.  **Commit & Push**:
    ```bash
    git add .
    git commit -m "Add new provider"
    git push
    ```

Users can then use your raw GitHub repository URL to load the plugins in Nuvio.

---

## 9. FAQ & Troubleshooting

### Error: `SyntaxError: async functions are unsupported`
**Cause**: The app running on Hermes cannot execute `async function` directly in plugins.
**Fix**: You forgot to transpile the single-file provider.
- Run `node build.js --transpile myprovider.js`.

### Error: `fetch is not defined` (in local testing)
**Cause**: Node.js (before v18) doesn't have native `fetch`.
**Fix**: Use Node v18+, or our build environment handles this for the app. For local testing, ensure you are on a recent Node version.

### The app crashes when loading my provider
**Cause**: Syntax error or unhandled exception at the root level.
**Fix**: Check your `index.js`. Ensure you are not doing heavy work (like networking) at the top level. All logic must be inside `getStreams`.
