# SweatSalt Companion App

Companion PWA for the SweatSalt heat-stress wearable. Shows a live
dashboard (mock sensor data for now — real BLE wired in at session 15)
with a themeable layout.

## Develop

```
npm install
npm run dev
```

Opens with live-reload. A "Edit theme" button appears in the bottom
corner — dev-only, gone entirely from the production build. Use it to
change colors, which sensor shows in which card, and card
order/visibility, with the dashboard updating live as you edit. Hit
"Save to theme.json" to write your changes to
`src/theme/theme.json` — that's the file that ships.

## Test

```
npm run test
```

## Build + deploy

```
npm run build
git add -A
git commit -m "your change"
git push
```

Pushing to `main` triggers the GitHub Actions workflow, which builds
and publishes to GitHub Pages at:

https://<your-github-username>.github.io/sweatsalt-app/

## Project structure

- `src/datasource/` — `DataSource` interface, `MockDataSource` (demo
  data), `BleDataSource` (real hardware, session 15)
- `src/theme/theme.json` — drives colors, layout, and which sensor
  shows in which card; edit it via the dev-only theme editor (see
  above) or by hand
- `src/dashboard/` — the dashboard UI and the placeholder heat-index
  formula
- `src/log/` — local IndexedDB log (14-day retention, for later
  debugging)
