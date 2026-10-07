# Perron-NS

> Live NS (Dutch Railways) departures for Even Realities G2.

Perron-NS turns the G2 lens into a glanceable clock and departure board. Journeys
are planned on the phone, where there is a keyboard, and the glasses show the
times, delays, platforms, and transfers for the trains you need. Live data comes
from the NS Reisinformatie API through a small proxy.

## Install

Scan with the **Even Realities app** on your phone, or open the listing on Even Hub:

[<img src="images/store-qr.png" alt="Install Perron-NS from Even Hub" width="180">](https://evenhub.evenrealities.com/landing?package_id=com.perron.ns)

**[evenhub.evenrealities.com → Perron-NS](https://evenhub.evenrealities.com/landing?package_id=com.perron.ns)**

## Features

- **Glanceable lens** — the current time stays in the top-left corner of every screen.
- **Live departure boards** — times, delays (`+N`), platforms, transfers,
  cancellations, and crowd forecasts, straight from NS.
- **Phone planner** — From/To with live station autocomplete, a **Favorites**
  list, and a **Plan again** history of recent routes.
- **Full stop list per train** — tap a train in a journey's detail to see every
  stop on its route, with boarding and disembarking stops marked and the stops
  outside your segment dimmed.
- **Phone and glasses mirroring** — the lens follows whatever the phone shows,
  while temple gestures move the lens locally.
- **Auto-refresh** — an open board re-fetches every 60 seconds, so cancellations
  and delays arrive without re-navigating.

## From planner to platform

The home screen shows the clock and up to three recent journeys. Tap a journey to
see its upcoming departures, then tap a time to open the full board: when and
where each train leaves and arrives, and which platform to board. Swipe to move
through the lists, and double-tap to step back a screen or exit from home.

| On the glasses | | |
|---|---|---|
| ![Route select on the lens](images/glasses-1-route-select.png) | ![Departures board on the lens](images/glasses-2-departures.png) | ![Journey detail on the lens](images/glasses-3-journey-detail.png) |

| On the phone | | |
|---|---|---|
| <img src="images/phone-1-planner.jpg" alt="Phone planner" width="220"> | <img src="images/phone-2-results.jpg" alt="Phone results" width="220"> | <img src="images/phone-3-journey-detail.jpg" alt="Phone journey detail" width="220"> |

## Documentation

[Project documentation](docs/README.md) covers the architecture, temple gestures,
local development, the NS proxy, and the tech stack.

See also the [privacy policy](PRIVACY.md), [release notes](RELEASE_NOTES.md), and
[changelog](CHANGELOG.md).

## Tests

With Node.js 20.17.0+, 22.13.0+, or 23.5.0+ installed, run:

```sh
npm ci
npm test
```

The Vitest suite runs in jsdom with fake clocks and mocked SDK and network
boundaries. It covers planner interactions, glasses gestures, storage, scheduled
refreshes, stop lists, time selection, localization, and failures. Coverage
requires 100% statements, branches, functions, and lines in each production
module: the phone and glasses app, NS client, localization, and Cloudflare proxy.
Only tests and TypeScript declaration files are excluded. The HTML report is
written to `coverage/index.html`, and CI runs the same gate before packaging. The
tests do not replace checking the app on real glasses.

## License

Copyright (c) 2026 JustinasLaunikonis.

Licensed under the [MIT License](LICENSE). The NS Reisinformatie API, Even
Realities SDKs, and other third-party dependencies retain their own terms.
