# Nuvio Providers

A collection of streaming providers for the Nuvio app. Providers are JavaScript modules that fetch streams from various sources.

📖 **[Read the Comprehensive Developer Guide](DOCUMENTATION.md)**

## Quick Start

### Using in Nuvio App

1. Open **Nuvio** > **Settings** > **Plugins**
2. Add this repository URL:
   ```
   https://raw.githubusercontent.com/onrcvndev/nuvio-providers/refs/heads/main/manifest.json
   ```
3. Refresh and enable the providers you want
4. **Developer Mode**: To test local changes, run `npm start` on your computer.
   > ⚠️ **Important:** You must use the **development build** of Nuvio (`npx expo run:android` or `npx expo run:ios`). Some providers may work locally but fail in React Native.
   - Go to **Settings** > **Developer** > **Plugin Tester** in the app.
   - Enter your local server URL (e.g., `http://192.168.1.5:3000/manifest.json`).
   - You can also test individual provider URLs here.

---

## Project Structure

```
nuvio-providers/
├── providers/              # Active single-file web scrape providers
│   ├── asyaanimeleri.js    # AsyaAnimeleri web scraper
│   ├── dizibox.js           # DiziBOX web scraper
│   └── hdfilmcehennemi.js   # HDFilmCehennemi web scraper
│
├── manifest.json           # Provider registry
├── build.js                # Build script
└── package.json
```

---

## Development

Active providers in this repository are single JavaScript files directly under `providers/`. Each file web-scrapes its source site directly; external proxy APIs are not part of the active provider flow.

**Important:** The app's JavaScript engine (Hermes) has limitations with `async/await` in dynamic code.
- **Recommended**: Use Promise chains (`.then()`).
- **Alternative**: Use `async/await` and run the transpiler command (see below).

**Example (Promise Chains):**
```javascript
// providers/myprovider.js

function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[MyProvider] Fetching ${mediaType} ${tmdbId}`);
  
  return fetch(`https://api.example.com/streams/${tmdbId}`)
    .then(response => response.json())
    .then(data => {
      return data.streams.map(s => ({
        name: "CVN-MyProvider",
        title: s.title,
        url: s.url,
        quality: s.quality
      }));
    })
    .catch(error => {
      console.error('[MyProvider] Error:', error.message);
      return [];
    });
}

module.exports = { getStreams };
```

To register the provider, add it to `manifest.json`:
```json
{
  "id": "myprovider",
  "name": "CVN-My Provider",
  "filename": "providers/myprovider.js",
  "supportedTypes": ["movie", "tv"],
  "enabled": true
}
```

Provider display names must start with `CVN-` in both `manifest.json` and returned stream `name` values.

---

## Building

### Transpile Single-File Providers
If you wrote a single-file provider using `async/await`, you must transpile it for compatibility.

```bash
# Transpile specific file
node build.js --transpile myprovider.js

# Transpile all applicable files in providers/
node build.js --transpile
```

### Watch Mode
Automatically rebuilds when files change.
```bash
npm run build:watch
```

---

## Testing

Create a test script to identify issues before loading into the app.

```javascript
// test-myprovider.js
const { getStreams } = require('./providers/myprovider.js');

async function test() {
  console.log('Testing...');
  const streams = await getStreams('872585', 'movie'); // Oppenheimer ID
  console.log('Streams found:', streams.length);
}

test();
```

Run with Node.js:
```bash
node test-myprovider.js
```

---

## Stream Object Format

Providers must return an array of stream objects:

```javascript
{
  name: "CVN-Provider Name",       // Provider identifier
  title: "1080p Stream",           // Stream description
  url: "https://...",              // Direct stream URL (m3u8, mp4, mkv)
  quality: "1080p",                // Quality label
  size: "2.5 GB",                  // Optional file size
  headers: {                       // Optional headers for playback
    "Referer": "https://source.com",
    "User-Agent": "Mozilla/5.0..."
  }
}
```

---

## Available Modules

Providers have access to these modules via `require()`:

| Module | Usage |
|--------|-------|
| `cheerio-without-node-native` | HTML parsing |
| `crypto-js` | Encryption/decryption |
| `axios` | HTTP requests |

Native `fetch` and `console` are also available globally.

---

## Manifest Options

The `manifest.json` file controls provider settings.

```json
{
  "id": "unique-id",
  "name": "Display Name",
  "description": "Short description",
  "version": "1.0.0",
  "author": "Your Name",
  "supportedTypes": ["movie", "tv"],
  "filename": "providers/file.js",
  "enabled": true,
  "logo": "https://url/to/logo.png",
  "contentLanguage": ["en", "hi"],
  "formats": ["mkv", "mp4"],
  "limited": false,
  "disabledPlatforms": ["ios"],
  "supportsExternalPlayer": true
}
```

---

## Contributing

1. **Fork the repository**
2. **Create a branch**: `git checkout -b add-myprovider`
3. **Develop and test**
4. **Build**: `node build.js myprovider`
5. **Commit**: `git commit -m "Add MyProvider"`
6. **Push and PR**

---

## License

This project is licensed under the **GNU General Public License v3.0**.

---

## Disclaimer

- **No content is hosted by this repository.**
- Providers fetch publicly available content from third-party websites.
- Users are responsible for compliance with local laws.
- For DMCA concerns, contact the actual content hosts.
