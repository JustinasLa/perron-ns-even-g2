const NS_BASE = "https://gateway.apiportal.ns.nl/reisinformatie-api/api";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy Policy — Perron-NS</title>
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 20px;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #232323; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 20px; margin-top: 32px; }
  h3 { font-size: 17px; margin-top: 24px; }
  .updated { color: #7B7B7B; margin-top: 0; }
  code { background: #F6F6F6; padding: 1px 5px; border-radius: 4px; }
  a { color: #1a6dff; }
  hr { border: 0; border-top: 1px solid #E4E4E4; margin: 32px 0; }
</style>
</head>
<body>
<h1>Privacy Policy — Perron-NS</h1>
<p class="updated"><strong>Last updated: 3 October 2026</strong></p>

<p>Perron-NS ("the app") is a journey planner for Dutch Railways (NS) services,
built for Even Realities G2 glasses and the Even Hub platform. This policy
explains what data the app handles, why, and who it is shared with.</p>

<p>The app has <strong>no user accounts, no advertising, no analytics, and no
tracking.</strong> It does not sell personal data. Its storage and
travel-information requests are described below.</p>

<h2>Data stored through Even Hub</h2>
<p>The app saves the following through <strong>Even Hub's host-backed storage</strong>
APIs (<code>getLocalStorage</code> and <code>setLocalStorage</code>):</p>
<ul>
  <li><strong>Favorite locations</strong> — stations you choose to save,
  including any custom label and icon you set.</li>
  <li><strong>Recent journeys</strong> — the "Plan again" history of from/to
  routes you have planned.</li>
  <li><strong>Language preference</strong> — your selected English or Dutch
  interface language.</li>
</ul>
<p>Even Hub manages this storage. Saved favorites and recent journeys are not
uploaded as collections to our proxy. Selected station codes and language are
used in travel-information requests as described below.</p>

<h2>Data sent over the network</h2>
<p>At startup, the app requests the station list. Successful downloads are cached
for the app session; failed downloads can be retried on later user actions.
Station autocomplete runs locally against that list; the text you type is not
sent to the proxy or NS.</p>
<p>For live travel information, the app sends the following request fields to
our backend proxy, which forwards them to NS:</p>
<ul>
  <li><strong>Departure boards and disruptions:</strong> your selected station
  code (<code>station</code> for departures, or in the disruptions request path).</li>
  <li><strong>Journey planning:</strong> origin and destination station codes
  (<code>fromStation</code>, <code>toStation</code>), response language
  (<code>lang</code>), <code>dateTime</code> when you choose a specific time or use
  arrival mode (including "now"), and <code>searchForArrival</code> for arrival
  searches.</li>
  <li><strong>Train stop lists:</strong> train number (<code>train</code>),
  departure time (<code>dateTime</code>) when available, and response language
  (<code>lang</code>).</li>
</ul>
<p>These fields are used to retrieve departures, disruptions, journey options,
and train stop lists.</p>

<h3>Why the app needs network access</h3>
<p>The app declares a single <strong>network</strong> permission. It is used
to fetch Dutch Railways (NS) station, departure, disruption, journey-planning,
and train-stop data through the backend described below.</p>

<h2>Third parties</h2>
<p>Travel-information requests reach NS through the proxy that we operate.
Even Hub also handles the app's saved settings:</p>
<ul>
  <li><strong>Backend proxy:</strong>
  <code>https://perron-ns-proxy.justinasla.workers.dev</code>. Operated by us
  and hosted on Cloudflare Workers. It forwards your requests to the NS
  Reisinformatie API and attaches the NS API key on the server side (the key is
  never included in the app). The worker code does not write request contents
  to persistent storage. Cloudflare hosts the proxy and may process requests
  and metadata, including IP addresses, according to its own policy. See
  <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy
  policy</a>.</li>
  <li><strong>NS Reisinformatie API</strong>
  (<code>gateway.apiportal.ns.nl</code>), operated by Nederlandse Spoorwegen
  (NS). It receives the station codes, journey time and arrival-search options,
  language, and train-number fields described above, where present, to return
  matching travel information. NS processes these requests under its own
  <a href="https://www.ns.nl/en/privacy">privacy policy</a>.</li>
  <li><strong>Even Hub host:</strong> handles saved favorites, recent journeys,
  and language preferences through its storage APIs. Platform storage handling
  is controlled by Even Hub.</li>
</ul>

<h2>Data retention</h2>
<ul>
  <li>Favorites, recent journeys, and language preferences are maintained using
  Even Hub's host-backed storage. The app requests updates when you delete
  saved items or change language; platform retention and deletion are
  controlled by Even Hub.</li>
  <li>The worker code contains no request-content storage. Retention of
  requests or metadata processed by Cloudflare and NS is governed by those
  providers' policies.</li>
</ul>

<h2>Children</h2>
<p>The app is a general-audience travel tool and is not directed at children. It
does not knowingly collect personal information from children.</p>

<h2>Changes to this policy</h2>
<p>If this policy changes, the "Last updated" date above will change and the
revised policy will be published at this same location.</p>

<h2>Contact</h2>
<p>Questions about this policy or your data:<br />
<strong>Justinas Launikonis</strong> — justinas.launikonis@student.nhlstenden.com</p>
</body>
</html>`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/privacy" || url.pathname === "/privacy/") {
      return new Response(PRIVACY_HTML, {
        status: 200,
        headers: {
          ...CORS,
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    const target = NS_BASE + url.pathname + url.search;

    let nsResp;
    let body;
    try {
      nsResp = await fetch(target, {
        headers: { "Ocp-Apim-Subscription-Key": env.NS_API_KEY },
      });
      body = await nsResp.text();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Upstream fetch failed", detail: String(e) }),
        { status: 502, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } },
      );
    }

    return new Response(body, {
      status: nsResp.status,
      headers: {
        ...CORS,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  },
};
