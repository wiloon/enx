# API Configuration Guide

The API server, website and Clerk instance an extension build talks to are
fixed when it is built. There is no runtime switch: the Options page only shows
what the build was made for.

## Build Target Table

**File**: `src/config/targets.ts`

One entry per deployment. `vite.config.ts` picks the entry from the Vite mode
(or `VITE_ENV`) at build time, applies any overrides, and stamps the result
into the generated `manifest.json` (`src/config/manifest.ts`) and into the
bundle, where `src/config/env.ts` reads it. Only the selected target ends up in
the bundle; a production package carries none of the development or homelab
values.

| Target        | Build command                           | API                          | UI                       |
| ------------- | --------------------------------------- | ---------------------------- | ------------------------ |
| `development` | `task build-dev`                        | `http://localhost:8091`      | `http://localhost:3000`  |
| `homelab`     | `task build`                            | `https://enx-api.wiloon.lab` | `https://enx.wiloon.lab` |
| `production`  | `task build-prod` / `task package-prod` | `https://api.catglish.com`   | `https://catglish.com`   |

## Overrides

Individual values can be overridden per build without editing the table:
`VITE_API_BASE_URL`, `VITE_FRONTEND_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`,
`VITE_CLERK_SYNC_HOST`, `VITE_ENX_UI_ORIGINS` and `VITE_CONTENT_SCRIPT_ORIGINS`
(both comma-separated). Set them in the environment or in a `.env` /
`.env.[mode]` file:

```bash
VITE_API_BASE_URL=http://192.168.50.71:8090 task build
```

`VITE_ENV` in `.env` forces a target regardless of the mode:

```bash
VITE_ENV=development
```

## Site Recognition

Each target also declares the sites the content script adapts to, and only the
selected target's lists reach the build:

- `uiOrigins`: enx-ui. Its pages get the content script, the Reader adapter
  (`/reader`, `/welcome`), the web -> extension channel
  (`externally_connectable`) and the `data-enx-extension` /
  `data-enx-learning` stamps on `<html>`. Matched by exact host, port included.
- `rssxOrigins`: the RSSX Reader (homelab and development only). These pages get
  the content script and the RSSX adapter, but no host permission and no
  external channel.
- `contentScriptOrigins`: generic sites that get the content script and a host
  permission but stay ordinary sites. Empty in every target; the E2E build sets
  it to the fixture server with `VITE_CONTENT_SCRIPT_ORIGINS`.

A production build therefore treats the homelab, localhost and RSSX hosts as
ordinary sites.

## Using a Local API

1. Start the local API server:

   ```bash
   cd enx-api
   task dev  # or task run
   ```

2. Build the extension against it, then reload it on `chrome://extensions`:

   ```bash
   cd enx-chrome
   task build-dev
   ```

To point a homelab build at another API server instead, rebuild with
`VITE_API_BASE_URL` (see Overrides).

## Verify the Current API Address

- **Console:** the background, popup and options pages log
  `[ENX Config] Environment: development, API: http://localhost:8091`.
- **Options page:** the "Current Environment" section shows the mode and the
  API server of this build.

## Frequently Asked Questions

### Q: Why does the extension still access the remote API after running `task dev`?

The build target, not Chrome Storage, decides the API server. Check that the
build you loaded is the one you expect (`dist-development` vs `dist-homelab`)
and that `.env` does not set `VITE_ENV` or `VITE_API_BASE_URL` to something
else. Then reload the extension on `chrome://extensions`.

A `apiBaseUrl` key left in `chrome.storage.local` by older versions is ignored.
