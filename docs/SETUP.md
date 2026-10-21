# Setup

The extension works by itself. Locking it with Chrome policy is optional. With the lock, it can't be disabled or removed from `chrome://extensions`, and incognito, guest windows and new profiles are turned off.

The person installing the lock is the person it restrains. The goal is to make bypassing it cost something in the moment, not to make it impossible.

## 1. Publish to the Chrome Web Store

On Windows machines that aren't joined to a domain, and on unmanaged Macs, Chrome only force-installs extensions from the Web Store. A public or unlisted listing both work.

1. `npm run release` builds `dist/` and zips it into `denoise.zip`.
2. Upload it in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) as Public or Unlisted; either works for the policy lock.
3. Note the extension ID (32 letters, a–p) once the listing is published.

The uninstall page (`docs/uninstall/`) and privacy policy (`docs/privacy/`) are served by GitHub Pages from the `docs/` folder.

## 2. Install the policy

In each policy file under `docs/policy/`, replace `EXTENSION_ID` with the ID from step 1. Then restart Chrome and check `chrome://policy`.

### Windows

Double-click `windows.reg` and accept the prompt, which needs admin rights. If the machine already force-installs another extension under value `"1"`, change the value name to an unused number first.

To remove the lock, import `windows-remove.reg`.

### macOS

Double-click `macos.mobileconfig`. Then open **System Settings → General → Device Management**, select the profile and choose **Install**.

To remove the lock, select the profile on the same screen and press **−**.

### Linux

```sh
sudo mkdir -p /etc/opt/chrome/policies/managed
sudo cp linux.json /etc/opt/chrome/policies/managed/denoise.json
```

For Chromium, use `/etc/chromium/policies/managed/` instead.

To remove the lock, delete the file.

## 3. Without the lock

These always apply:

- **Disabling counts as using.** If the extension is turned off while Chrome is running, that time is charged to today's budget when it comes back. Re-enabling never gives spent time back.
- **Loosening waits until tomorrow.** A bigger budget, a removed site, a new exempt path or a softer curve takes effect at the next local midnight. Tightening applies immediately.
- **Uninstalling** opens a page showing today's usage.
- **Incognito**: the popup warns until **Allow in Incognito** is turned on for the extension.

## Known gaps

- **Other browsers** on the same machine aren't covered.
- **Disable detection is a heuristic.** If Chrome is closed while the extension is disabled, and the extension is re-enabled in a later Chrome session, the closed time is charged too.
- **Media drawn on canvas or WebGL** isn't degraded.
- **Video detection uses per-site URL patterns** (`src/content/main-world.ts`), which may need updating when sites change their CDNs.
- **Developer tools show the blocking.** Past the cap, blocked requests appear as `ERR_BLOCKED_BY_CLIENT` in DevTools. Pages themselves only show ordinary broken media.
