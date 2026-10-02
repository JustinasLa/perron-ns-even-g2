# Privacy Policy — Perron-NS

**Last updated: 3 October 2026**

Perron-NS ("the app") is a journey planner for Dutch Railways (NS) services,
built for Even Realities G2 glasses and the Even Hub platform. This policy
explains what data the app handles, why, and who it is shared with.

The app has **no user accounts, no advertising, no analytics, and no tracking.**
It does not sell personal data. Its storage and travel-information requests
are described below.

## Data stored through Even Hub

The app saves the following through **Even Hub's host-backed storage** APIs
(`getLocalStorage` and `setLocalStorage`):

- **Favorite locations** — stations you choose to save, including any custom
  label and icon you set.
- **Recent journeys** — the "Plan again" history of from/to routes you have
  planned.
- **Language preference** — your selected English or Dutch interface language.

Even Hub manages this storage. Saved favorites and recent journeys are not
uploaded as collections to our proxy. Selected station codes and language are
used in travel-information requests as described below.

## Data sent over the network

At startup, the app downloads the station list once. Station autocomplete runs
locally against that list; the text you type is not sent to the proxy or NS.

For live travel information, the app sends the following request fields to our
backend proxy, which forwards them to NS:

- **Departure boards and disruptions:** your selected station code (`station`
  for departures, or in the disruptions request path).
- **Journey planning:** origin and destination station codes (`fromStation`,
  `toStation`), response language (`lang`), and, when you choose a specific
  time, `dateTime` and `searchForArrival` for arrival searches.
- **Train stop lists:** train number (`train`), departure time (`dateTime`)
  when available, and response language (`lang`).

These fields are used to retrieve departures, disruptions, journey options,
and train stop lists.

### Why the app needs network access

The app declares a single **network** permission. It is used to fetch Dutch
Railways (NS) station, departure, disruption, journey-planning, and train-stop
data through the backend described below.

## Third parties

Travel-information requests reach NS through the proxy that we operate.
Even Hub also handles the app's saved settings:

- **Backend proxy:** `https://perron-ns-proxy.justinasla.workers.dev`
  Operated by us and hosted on Cloudflare Workers. It forwards your requests to
  the NS Reisinformatie API and attaches the NS API key on the server side (the
  key is never included in the app). The worker code does not write request
  contents to persistent storage. Cloudflare hosts the proxy and may process
  requests and metadata, including IP addresses, according to its own policy.
  See Cloudflare's privacy
  policy: https://www.cloudflare.com/privacypolicy/

- **NS Reisinformatie API** (`gateway.apiportal.ns.nl`), operated by
  Nederlandse Spoorwegen (NS). It receives the station codes, journey time and
  arrival-search options, language, and train-number fields described above,
  where present, to return matching travel information. NS processes these
  requests under its own privacy policy: https://www.ns.nl/en/privacy

- **Even Hub host:** handles saved favorites, recent journeys, and language
  preferences through its storage APIs. Platform storage handling is
  controlled by Even Hub.

## Data retention

- Favorites, recent journeys, and language preferences are maintained using
  Even Hub's host-backed storage. The app requests updates when you delete
  saved items or change language; platform retention and deletion are
  controlled by Even Hub.
- The worker code contains no request-content storage. Retention of requests
  or metadata processed by Cloudflare and NS is governed by those providers'
  policies.

## Children

The app is a general-audience travel tool and is not directed at children. It
does not knowingly collect personal information from children.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the
revised policy will be published at the same location as this document.

## Contact

Questions about this policy or your data:

**Justinas Launikonis** — justinas.launikonis@student.nhlstenden.com
