# Social Media Denoiser

A Chrome (Manifest V3) extension that limits social media to 45 minutes a day without ever blocking it. Each use is a short session of 2 to 5 minutes, chosen at random, followed by a cooldown. Images and video fail and stall more often as the day's budget runs down. All state stays in `chrome.storage.local`.

## Develop

```sh
npm install
npm test              # unit tests for the curve, sessions, settings rules, domains, disable penalty
npm run typecheck
npm run build         # → dist/, load unpacked at chrome://extensions
npm run build:fast    # one budget "minute" = one second, for running a whole day end to end
```

`npm run release` builds with the uninstall page URL (`docs/uninstall/`, served by GitHub Pages) and zips `dist/` into `denoise.zip` for the Chrome Web Store. A plain `npm run build` opens no uninstall page.

## How it works

| Piece | File |
| --- | --- |
| Active-time tracking, sessions, midnight reset, disable penalty | `src/background/index.ts`, `session.ts` |
| Degradation curve (band interpolation, in-session ramp, cooldown = next band) | `src/shared/curve.ts` |
| Tighten-now / loosen-tomorrow settings rules | `src/shared/settings.ts` |
| Image/background/poster degradation, autoplay suppression | `src/content/isolated.ts` |
| Video segment delays and failures (fetch/XHR) | `src/content/main-world.ts` |
| Near-total blocking past the cap (declarativeNetRequest) | `src/background/dnr.ts` |

Hard lock via Chrome policy: see [docs/SETUP.md](docs/SETUP.md).
