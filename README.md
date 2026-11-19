# JalanJava ⚡🚗

An AI trip assistant for EV drivers in Java, Indonesia. Not just a route planner: it plans the trip around your car and battery, then keeps adapting when things go wrong.

<img width="1470" height="956" alt="Screenshot 2026-11-19 at 15 42 51" src="https://github.com/user-attachments/assets/f3973e03-ac3b-462a-b13c-aedf571ac7c1" />
<img width="1470" height="956" alt="Screenshot 2026-11-19 at 15 44 48" src="https://github.com/user-attachments/assets/c9461780-0377-4390-8c14-58016941ec93" />

[![Route planning and AI analysis](https://github.com/user-attachments/assets/f3973e03-ac3b-462a-b13c-aedf571ac7c1)](https://github.com/mauratobing/JalanJava/releases/tag/v1.0.0))
[![Traffic disruption and rerouting](https://github.com/user-attachments/assets/c9461780-0377-4390-8c14-58016941ec93)](https://github.com/mauratobing/JalanJava/releases/tag/v1.0.0)

▶ [Watch the demo video](https://github.com/mauratobing/JalanJava/releases/tag/v1.0.0)

## What it does
- Plans routes between 8 Java cities (OSRM) and recommends the minimum number of charging stops for your EV (6 presets or custom battery/consumption)
- Shows real charger locations from OpenChargeMap along the route
- Claude-powered trip analysis and an in-app chat assistant
- Journey simulation with live battery %, distance to next charger and live stats
- Handles disruptions mid-trip: traffic, accidents/news, and charger outages. The AI proposes an alternative and you confirm before anything changes
- Simulated charger reservations with confirmation
- Night mode

## Important: what is simulated
- Charger **availability, queues and reservations are simulated**. OpenChargeMap is a static directory and does not provide live status.
- Traffic, accidents, news and outages are simulated events.
- Battery % and distances during the journey are estimates. This is a prototype to explore how an AI assistant could support EV travel, not a production navigation tool.
- Not affiliated with PLN or any charging operator.

## Setup
Requires Node.js 18+.

```bash
git clone https://github.com/YOUR_USERNAME/jalanjava.git
cd jalanjava
npm install
cp .env.example .env     # then edit .env and add your two keys
```

Run the AI proxy and the app in **two separate terminals**:

```bash
# terminal 1
node server.js
# terminal 2
npm start
```

Open http://localhost:3000.

## API keys
| Key | Where from | Used by |
|---|---|---|
| `REACT_APP_OCM_KEY` | openchargemap.org/site/develop/api | browser (public OCM key, low risk) |
| `ANTHROPIC_API_KEY` | console.anthropic.com | `server.js` only |

The Anthropic key stays on the proxy server and is never shipped to the browser. Do not rename it with a `REACT_APP_` prefix, as those variables get bundled into the public JavaScript.

## Tech
React, react-leaflet, OSRM, OpenChargeMap, Express proxy, Anthropic Messages API.
