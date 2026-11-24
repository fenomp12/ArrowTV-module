# ArrowTV module for Sora

Movies and TV shows from [arrowtv.net](https://arrowtv.net), up to 4K.

Add this manifest URL in Sora (Modules → +):

```
https://raw.githubusercontent.com/fenomp12/ArrowTV-module/main/ArrowTVManifest.json
```

## How it works

- **Search / details / episodes** use arrowtv.net's own API and pages.
- **Streams** come from the same sources ArrowTV's player uses:
  - **Jennifer** (punkflix.net): adaptive HLS with 1080p and 4K, English/Hindi audio and subtitles.
  - **Sadie (Hindi)**, **Berlin**, **Scarlet**: extra servers when available.
