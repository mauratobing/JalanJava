import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const API_KEY = process.env.REACT_APP_OCM_KEY;

const VEHICLES = {
  'Hyundai Ioniq 5': { battery: 72.6, range: 385, consumption: 18.8 },
  'Hyundai Ioniq 6': { battery: 77.4, range: 429, consumption: 18.0 },
  'BYD Atto 3':      { battery: 60.5, range: 345, consumption: 17.5 },
  'BYD Seal':        { battery: 82.5, range: 460, consumption: 17.9 },
  'Wuling Air EV':   { battery: 26.7, range: 200, consumption: 13.4 },
  'Wuling BinguoEV': { battery: 37.9, range: 333, consumption: 11.4 },
  'Custom':          { battery: 60,   range: 300, consumption: 17.0 },
};

const CITIES = {
  'Jakarta':    [-6.2088, 106.8456],
  'Bandung':    [-6.9175, 107.6191],
  'Cirebon':    [-6.7063, 108.5570],
  'Semarang':   [-6.9667, 110.4167],
  'Yogyakarta': [-7.7956, 110.3695],
  'Solo':       [-7.5755, 110.8243],
  'Surabaya':   [-7.2575, 112.7521],
  'Malang':     [-7.9666, 112.6326],
};

const statusColor = { available: '#1D9E75', busy: '#BA7517', offline: '#E24B4A' };

const getHour = (d) => {
  if (d === 'now') return new Date().getHours();
  const t = d.split('T')[1]; if (!t) return 8;
  return parseInt(t.split(':')[0]);
};

const isWeekend = (d) => {
  if (d === 'now') { const day = new Date().getDay(); return day === 0 || day === 6; }
  return [0,6].includes(new Date(d).getDay());
};

const simulateStatus = (dep) => {
  const hour = getHour(dep); const weekend = isWeekend(dep);
  let busyChance = weekend ? (hour >= 9 && hour <= 20 ? 0.45 : 0.15) :
    hour >= 7 && hour <= 9 ? 0.5 : hour >= 17 && hour <= 19 ? 0.55 :
    hour >= 10 && hour <= 16 ? 0.3 : 0.1;
  const r = Math.random();
  if (r < 0.1) return 'offline';
  if (r < 0.1 + busyChance) return 'busy';
  return 'available';
};

const simulateQueue = (status, dep) => {
  if (status !== 'busy') return 0;
  const hour = getHour(dep);
  return ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19))
    ? Math.floor(Math.random() * 4) + 1 : Math.floor(Math.random() * 2) + 1;
};

const createIcon = (status) => L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${statusColor[status]};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});

const createStopIcon = (num, reserved) => L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:${reserved ? '#2563eb' : '#1a6b3a'};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)">${num}</div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
});

const createCityIcon = (label) => L.divIcon({
  className: '',
  html: `<div style="background:#1a6b3a;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3)">${label}</div>`,
  iconAnchor: [20, 10],
});

const createPositionIcon = (pulsing) => L.divIcon({
  className: '',
  html: pulsing
    ? `<div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid #fff;animation:pulse 1s infinite"></div>`
    : `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 3px rgba(37,99,235,0.3)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
});

const haversineKm = ([lat1, lon1], [lat2, lon2]) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const getRoutePoints = (coords, intervalKm = 40) => {
  const points = []; let acc = 0; points.push(coords[0]);
  for (let i = 1; i < coords.length; i++) {
    acc += haversineKm(coords[i-1], coords[i]);
    if (acc >= intervalKm) { points.push(coords[i]); acc = 0; }
  }
  if (points[points.length-1] !== coords[coords.length-1]) points.push(coords[coords.length-1]);
  return points;
};

const calcRoadDistances = (coords) => {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) dists.push(dists[i-1] + haversineKm(coords[i-1], coords[i]));
  return dists;
};

const calcChargeStops = (chargers, distanceKm, vehicle, startBatteryPct) => {
  const { battery, consumption } = vehicle;
  const RESERVE = 0.15; // keep 15% reserve
  let currentKwh = (startBatteryPct / 100) * battery;
  let totalChargeMins = 0, stops = [], kmCovered = 0;

  const usable = chargers
    .filter(c => c.status === 'available' && c.powerKw > 0)
    .sort((a, b) => a.distFromStart - b.distFromStart);

  while (kmCovered < distanceKm) {
    const remainingKm = distanceKm - kmCovered;
    const kwhToFinish = (remainingKm / 100) * consumption;

    // Can we finish from here? If yes, we're done
    if (currentKwh >= kwhToFinish + battery * RESERVE) break;

    // Find the furthest charger we can reach from current position
    const reachable = usable.filter(c => {
      if (c.distFromStart <= kmCovered) return false;
      const kwhNeeded = ((c.distFromStart - kmCovered) / 100) * consumption;
      return currentKwh >= kwhNeeded + battery * RESERVE;
    });

    if (reachable.length === 0) break; // no reachable chargers — can't complete route

    // Pick the furthest reachable charger — minimises number of stops
    const best = reachable[reachable.length - 1];
    const kwhToReach = ((best.distFromStart - kmCovered) / 100) * consumption;
    const kwhOnArrival = currentKwh - kwhToReach;
    const needed = Math.max(0, battery * 0.8 - kwhOnArrival);
    const mins = Math.round((needed / best.powerKw) * 60);

    totalChargeMins += mins;
    currentKwh = battery * 0.8;
    kmCovered = best.distFromStart;
    stops.push({ ...best, chargeMins: mins });
  }

  const remainingKwh = ((distanceKm - kmCovered) / 100) * consumption;
  const arriveKwh = Math.max(0, currentKwh - remainingKwh);
  return { totalChargeMins, stops, arrivePct: Math.round((arriveKwh / battery) * 100) };
};

const getDistanceAlongRoute = (coords, targetPos) => {
  let minDist = Infinity, closestIdx = 0;
  coords.forEach((pt, i) => { const d = haversineKm(pt, targetPos); if (d < minDist) { minDist = d; closestIdx = i; } });
  let dist = 0;
  for (let i = 1; i <= closestIdx; i++) dist += haversineKm(coords[i-1], coords[i]);
  return Math.round(dist);
};

const generateRef = () => `JJ-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*9000+1000)}`;
const JALAN_NAMES = ['Jalan Sudirman','Jalan Gatot Subroto','Jalan Tol Cipularang','Jalan Pantura','Jalan Daendels','Jalan Raya Kalimalang'];

const callClaude = async (prompt) => {
  const response = await fetch('http://localhost:3001/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await response.json();
  return data.content?.map(b => b.text || '').join('') || '';
};

const fetchClaudeReasoning = async (params) => {
  const { origin, destination, vehicle, batteryPct, distanceKm, drivingMins, totalChargers, availableCount, stops, arrivePct, departure, customSpecs } = params;
  const hour = getHour(departure); const weekend = isWeekend(departure);
  const timeLabel = departure === 'now' ? 'right now' : `at ${departure.replace('T',' ')}`;
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  const peak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 'peak hours' : 'off-peak hours';
  const text = await callClaude(`You are an EV trip planning assistant for Indonesia.
Trip: ${origin} to ${destination}
Departure: ${timeLabel} (${weekend?'weekend':'weekday'}, ${period}, ${peak})
Vehicle: ${vehicle} — ${customSpecs.battery}kWh, ${customSpecs.range}km range, ${customSpecs.consumption}kWh/100km
Battery: ${batteryPct}%, Distance: ${distanceKm}km, Drive time: ${Math.floor(drivingMins/60)}h ${drivingMins%60}m
Chargers: ${totalChargers} found, ${availableCount} available, ${stops.length} stops recommended, arrive with ${arrivePct}%
Format exactly:
SUMMARY: [one sentence max 20 words]
DETAIL: [3-4 sentences: battery sufficiency, timing concerns, one recommendation]`);
  const s = text.match(/SUMMARY:\s*(.+)/); const d = text.match(/DETAIL:\s*([\s\S]+)/);
  return { summary: s?.[1]?.trim() || 'Route planned.', detail: d?.[1]?.trim() || 'Check availability before departing.' };
};

const fetchRerouteReasoning = async (affected, newStop, origin, destination) => {
  return await callClaude(`EV navigation assistant. Stop went ${affected.status} mid-journey.
Original: ${affected.name} (${affected.distFromStart}km) — now ${affected.status}
Alternative: ${newStop.name} (${newStop.distFromStart}km) — ${newStop.power}
Route: ${origin} to ${destination}
2 sentences: what happened, why new stop is good. Be direct.`);
};

const fetchChargersAndRecalc = async (coords, vehicle, currentBatteryPct, departure, distanceKm) => {
  const fetchPoints = getRoutePoints(coords, 40);
  const results = await Promise.all(
    fetchPoints.map(([lat, lng]) =>
      fetch(`https://api.openchargemap.io/v3/poi/?output=json&countrycode=ID&latitude=${lat}&longitude=${lng}&distance=8&distanceunit=km&maxresults=10&key=${API_KEY}`)
        .then(r => r.json()).catch(() => [])
    )
  );
  const seen = new Set();
  const merged = results.flat().filter(c => { if (!c.ID||seen.has(c.ID)) return false; seen.add(c.ID); return true; });
  const filtered = merged.filter(c => coords.some(pt => haversineKm([c.AddressInfo.Latitude, c.AddressInfo.Longitude], pt) <= 8));
  const mapped = filtered.map(c => {
    const status = simulateStatus(departure); const queue = simulateQueue(status, departure);
    return {
      id: c.ID, name: c.AddressInfo.Title,
      position: [c.AddressInfo.Latitude, c.AddressInfo.Longitude],
      status, queue,
      powerKw: c.Connections?.[0]?.PowerKW || 0,
      power: c.Connections?.[0]?.PowerKW ? `${c.Connections[0].PowerKW} kW` : 'Unknown',
      operator: c.OperatorInfo?.Title || 'Unknown',
      address: c.AddressInfo.AddressLine1 || '',
      distFromStart: getDistanceAlongRoute(coords, [c.AddressInfo.Latitude, c.AddressInfo.Longitude]),
    };
  }).sort((a,b) => a.distFromStart - b.distFromStart);
  const { totalChargeMins, stops, arrivePct } = calcChargeStops(mapped, distanceKm, vehicle, currentBatteryPct);
  return { chargers: mapped, stops, totalChargeMins, arrivePct };
};

function MapInteractionTracker({ onUserInteract }) {
  useMapEvents({ dragstart: () => onUserInteract(), zoomstart: () => onUserInteract() });
  return null;
}

function MapController({ routeCoords, flyToPosition, onFlyComplete, followPosition, currentPosition }) {
  const map = useMap();
  useEffect(() => {
    if (flyToPosition) { map.flyTo(flyToPosition, 14, { duration: 1 }); onFlyComplete(); }
  }, [flyToPosition, map, onFlyComplete]);
  useEffect(() => {
    if (routeCoords.length > 0 && !followPosition) map.fitBounds(L.latLngBounds(routeCoords), { padding: [40,40] });
  }, [routeCoords, map, followPosition]);
  useEffect(() => {
    if (followPosition && currentPosition) map.setView(currentPosition, 15, { animate: true, duration: 0.4 });
  }, [followPosition, currentPosition, map]);
  return null;
}

function ResetZoomControl({ routeCoords, journeyStarted, currentPosition, onRecentre }) {
  const map = useMap();
  const handleReset = () => {
    if (journeyStarted && currentPosition) { map.setView(currentPosition, 15, { animate: true, duration: 0.5 }); onRecentre(); }
    else if (routeCoords.length > 0) map.fitBounds(L.latLngBounds(routeCoords), { padding: [40,40] });
    else map.setView([-7.0, 109.0], 7);
  };
  return <div className="reset-zoom-btn" title={journeyStarted ? 'Re-centre' : 'Reset zoom'} onClick={handleReset}>{journeyStarted ? '◎' : '⊙'}</div>;
}

function App() {
  const [chargers, setChargers]               = useState([]);
  const [origin, setOrigin]                   = useState('Jakarta');
  const [destination, setDestination]         = useState('Bandung');
  const [vehicle, setVehicle]                 = useState('Hyundai Ioniq 5');
  const [customSpecs, setCustomSpecs]         = useState(VEHICLES['Hyundai Ioniq 5']);
  const [showCustom, setShowCustom]           = useState(false);
  const [batteryPct, setBatteryPct]           = useState(80);
  const [departure, setDeparture]             = useState('now');
  const [routeCoords, setRouteCoords]         = useState([]);
  const [altRouteCoords, setAltRouteCoords]   = useState([]);
  const [roadDists, setRoadDists]             = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [aiLoading, setAiLoading]             = useState(false);
  const [stats, setStats]                     = useState(null);
  const [stops, setStops]                     = useState([]);
  const [aiReasoning, setAiReasoning]         = useState(null);
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [error, setError]                     = useState('');
  const [flyToPosition, setFlyToPosition]     = useState(null);
  const [nightMode, setNightMode]             = useState(false);
  const [journeyStarted, setJourneyStarted]   = useState(false);
  const [journeyPaused, setJourneyPaused]     = useState(false);
  const [journeyFinished, setJourneyFinished] = useState(false);
  const [navSteps, setNavSteps]               = useState([]);
  const [currentStepIdx, setCurrentStepIdx]   = useState(0);
  const [positionIdx, setPositionIdx]         = useState(0);
  const [followPosition, setFollowPosition]   = useState(false);
  const [elapsedSecs, setElapsedSecs]         = useState(0);
  const [distToNextStop, setDistToNextStop]   = useState(null);
  const [arrivedAtStop, setArrivedAtStop]     = useState(null);
  const [reservations, setReservations]       = useState({});
  const [bookingModal, setBookingModal]       = useState(null);
  const [bookingConfirmed, setBookingConfirmed] = useState(null);
  const [rerouteAlert, setRerouteAlert]       = useState(null);
  const [rerouteLoading, setRerouteLoading]   = useState(false);
  const [rebookModal, setRebookModal]         = useState(null);
  const [newsAlert, setNewsAlert]             = useState(null);
  const [chatMessages, setChatMessages]       = useState([]);
  const [chatInput, setChatInput]             = useState('');
  const [chatLoading, setChatLoading]         = useState(false);
  const [chatMinimised, setChatMinimised]     = useState(false);
  const [routePlanned, setRoutePlanned]       = useState(false);
  const [showAiPopup, setShowAiPopup]         = useState(false);
  const [aiPopupText, setAiPopupText]         = useState('');
  const [aiPopupDone, setAiPopupDone]         = useState(false);
  const [trafficActive, setTrafficActive]     = useState(false);
  const [trafficTriggered, setTrafficTriggered] = useState(false);
  const [trafficJalan, setTrafficJalan]       = useState('');
  const [reroutingTraffic, setReroutingTraffic] = useState(false);
  const [canResume, setCanResume]             = useState(false);
  const [isRerouted, setIsRerouted]           = useState(false);

  // Battery tracking — using refs so they never cause re-renders
  // currentBatteryRef = battery % at last "reset point" (start or after charging)
  // distAtLastReset = total road distance covered at last reset point
  const currentBatteryRef = useRef(80);
  const distAtLastReset   = useRef(0);
  const totalDistCovered  = useRef(0);
  const justChargedRef    = useRef(0);

  const markerRefs      = useRef({});
  const pollRef         = useRef(null);
  const animRef         = useRef(null);
  const timerRef        = useRef(null);
  const typeRef         = useRef(null);
  const trafficRef      = useRef(null);
  const visitedStops    = useRef(new Set());
  const currentPosRef   = useRef(null);

  // Derive live battery from refs — no state needed
  const getLiveBattery = useCallback(() => {
    const distSinceCharge = totalDistCovered.current - distAtLastReset.current;
    const kwhUsed = (distSinceCharge / 100) * customSpecs.consumption;
    const currentKwh = (currentBatteryRef.current / 100) * customSpecs.battery - kwhUsed;
    return Math.max(5, Math.round((currentKwh / customSpecs.battery) * 100));
  }, [customSpecs]);

  // Force re-render when battery needs to update visually
  const [batteryDisplay, setBatteryDisplay] = useState(80);

  const handleVehicleChange = (v) => { setVehicle(v); if (v !== 'Custom') setCustomSpecs(VEHICLES[v]); };
  const handleSpecChange = (f, v) => { setCustomSpecs(p => ({ ...p, [f]: parseFloat(v)||0 })); if (vehicle !== 'Custom') setVehicle('Custom'); };
  const handleStopClick = (stop) => {
    setFlyToPosition(stop.position);
    setTimeout(() => { const m = markerRefs.current[`stop-${stop.id}`]; if (m) m.openPopup(); }, 1100);
  };

  const fmtTime = (mins) => { const h = Math.floor(mins/60), m = mins%60; return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const fmtSecs = (s) => { const m = Math.floor(s/60), sec = s%60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; };

  const resetAll = useCallback(() => {
    setChargers([]); setRouteCoords([]); setAltRouteCoords([]); setRoadDists([]);
    setStats(null); setStops([]); setAiReasoning(null); setSidebarOpen(false);
    setJourneyStarted(false); setJourneyPaused(false); setNavSteps([]);
    setCurrentStepIdx(0); setPositionIdx(0); setFollowPosition(false);
    setElapsedSecs(0); setDistToNextStop(null); setArrivedAtStop(null);
    setJourneyFinished(false); setReservations({}); setRerouteAlert(null);
    setRebookModal(null); setNewsAlert(null); setChatMessages([]);
    setShowAiPopup(false); setRoutePlanned(false); setBookingConfirmed(null);
    setError(''); setFlyToPosition(null); setTrafficActive(false);
    setTrafficTriggered(false); setTrafficJalan(''); setReroutingTraffic(false);
    setCanResume(false); setIsRerouted(false);
    currentBatteryRef.current = batteryPct;
    distAtLastReset.current = 0;
    totalDistCovered.current = 0;
    setBatteryDisplay(batteryPct);
    clearInterval(pollRef.current); clearInterval(animRef.current);
    clearInterval(timerRef.current); clearInterval(typeRef.current);
    clearTimeout(trafficRef.current);
    visitedStops.current = new Set(); currentPosRef.current = null;
    justChargedRef.current = 0;
  }, [batteryPct]);

  const startTypewriter = useCallback((text) => {
    setAiPopupText(''); setAiPopupDone(false); setShowAiPopup(true);
    let i = 0; clearInterval(typeRef.current);
    typeRef.current = setInterval(() => {
      if (i >= text.length) { clearInterval(typeRef.current); setAiPopupDone(true); return; }
      const char = text[i]; setAiPopupText(prev => prev + char); i++;
    }, 30);
  }, []);

  const planRoute = useCallback(async () => {
    if (origin === destination) { setError('Origin and destination cannot be the same.'); return; }
    resetAll(); setLoading(true); setAiLoading(true);
    try {
      const [oLat, oLng] = CITIES[origin];
      const [dLat, dLng] = CITIES[destination];
      const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`);
      const osrmData = await osrmRes.json();
      if (!osrmData.routes?.length) { setError('Could not find a route.'); setLoading(false); setAiLoading(false); return; }
      const coords = osrmData.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const distanceKm = Math.round(osrmData.routes[0].distance / 1000);
      const drivingMins = Math.round(osrmData.routes[0].duration / 60);
      const steps = osrmData.routes[0].legs[0].steps.map(s => ({
        instruction: s.maneuver.instruction || `Continue on ${s.name || 'road'}`,
        name: s.name || '', distance: Math.round(s.distance),
      }));
      setNavSteps(steps); setRouteCoords(coords); setRoadDists(calcRoadDistances(coords));
      const { chargers: mapped, stops: calcStops, totalChargeMins, arrivePct } = await fetchChargersAndRecalc(coords, customSpecs, batteryPct, departure, distanceKm);
      setChargers(mapped);
      const numbered = calcStops.map((s,i) => ({ ...s, stopNum: i+1 }));
      setStops(numbered);
      setStats({ distanceKm, drivingMins, totalChargers: mapped.length, availableCount: mapped.filter(c=>c.status==='available').length, totalChargeMins, stopCount: calcStops.length, totalMins: drivingMins+totalChargeMins, arrivePct });
      setSidebarOpen(true); setRoutePlanned(true); setLoading(false);
      const reasoning = await fetchClaudeReasoning({ origin, destination, vehicle, batteryPct, distanceKm, drivingMins, totalChargers: mapped.length, availableCount: mapped.filter(c=>c.status==='available').length, stops: calcStops, arrivePct, departure, customSpecs });
      setAiReasoning(reasoning); setAiLoading(false);
      startTypewriter(`${reasoning.summary}\n\n${reasoning.detail}`);
    } catch(e) { console.error(e); setError('Something went wrong.'); setLoading(false); setAiLoading(false); }
  }, [origin, destination, customSpecs, batteryPct, departure, resetAll, startTypewriter]);

  useEffect(() => { planRoute(); }, []);

  // Journey animation
  useEffect(() => {
    if (!journeyStarted || journeyPaused || trafficActive || routeCoords.length === 0) return;
    const totalDist = stats?.distanceKm || 150;
    const targetSecs = Math.max(60, Math.min(180, totalDist * 0.4));
    const stepsPerTick = Math.max(1, Math.floor(routeCoords.length / targetSecs));
    animRef.current = setInterval(() => {
      setPositionIdx(p => {
        const next = Math.min(p + stepsPerTick, routeCoords.length - 1);
        if (next >= routeCoords.length - 1) { clearInterval(animRef.current); setJourneyFinished(true); setFollowPosition(false); }
        currentPosRef.current = routeCoords[next];
        // Update total distance covered using roadDists
        if (roadDists[next] !== undefined) {
          totalDistCovered.current = distAtLastReset.current + roadDists[next];
        }
        // Update battery display — skip for 3 ticks after charging
        if (justChargedRef.current > 0) {
          justChargedRef.current -= 1;
        } else {
          const live = getLiveBattery();
          setBatteryDisplay(live);
        }
        return next;
      });
      setCurrentStepIdx(p => Math.min(p + 1, navSteps.length - 1));
    }, 1000);
    return () => clearInterval(animRef.current);
  }, [journeyStarted, journeyPaused, trafficActive, routeCoords, navSteps, stats, roadDists, getLiveBattery]);

  // Traffic trigger
  useEffect(() => {
    if (!journeyStarted || trafficTriggered) return;
    const delay = (Math.floor(Math.random() * 21) + 20) * 1000;
    trafficRef.current = setTimeout(() => {
      const jalan = JALAN_NAMES[Math.floor(Math.random() * JALAN_NAMES.length)];
      setTrafficJalan(jalan); setTrafficActive(true); setTrafficTriggered(true);
      setJourneyPaused(true); setChatMinimised(false);
      setChatMessages(prev => [...prev, { role: 'ai', text: `🚦 Heavy traffic detected on ${jalan}! Your route is affected. Type "find alternative route" and I'll suggest a new path.` }]);
    }, delay);
    return () => clearTimeout(trafficRef.current);
  }, [journeyStarted, trafficTriggered]);

  // Timer
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!journeyStarted || journeyPaused || journeyFinished || trafficActive) return;
    timerRef.current = setInterval(() => setElapsedSecs(p => p + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [journeyStarted, journeyPaused, journeyFinished, trafficActive]);

  // Live distance to next stop + arrival — physical proximity detection
  useEffect(() => {
    if (!journeyStarted || !routeCoords[positionIdx]) return;
    const currentPos = routeCoords[positionIdx];
    const currentRoadDist = distAtLastReset.current + (roadDists[positionIdx] || 0);

    const nextStop = stops.find(s => !visitedStops.current.has(s.id));
    if (nextStop) {
      const physicalDist = haversineKm(currentPos, nextStop.position);
      const roadDistToStop = Math.max(0, nextStop.distFromStart - currentRoadDist);
      setDistToNextStop({ stop: nextStop, km: Math.round(Math.min(physicalDist, roadDistToStop) * 10) / 10 });

      if (physicalDist <= 25 && !visitedStops.current.has(nextStop.id) && positionIdx > 5) {
        visitedStops.current.add(nextStop.id);
        setArrivedAtStop(nextStop);
        setStops(prev => prev.map(s => s.id === nextStop.id ? { ...s, arrived: true } : s));
        const syncedTotal = distAtLastReset.current + (roadDists[positionIdx] || 0);
        totalDistCovered.current = syncedTotal;
        currentBatteryRef.current = 80;
        distAtLastReset.current = syncedTotal;
        justChargedRef.current = 3;
        setTimeout(() => setBatteryDisplay(80), 100);
        setTimeout(() => setArrivedAtStop(null), 6000);
      }
    } else { setDistToNextStop(null); }
    setStats(prev => prev ? { ...prev, stopCount: stops.filter(s => !visitedStops.current.has(s.id)).length } : prev);
  }, [positionIdx, journeyStarted, stops, routeCoords, roadDists]);


  // Polling
  useEffect(() => {
    if (!journeyStarted) return;
    pollRef.current = setInterval(() => {
      setChargers(prev => prev.map(c => ({ ...c, status: Math.random() < 0.05 ? (Math.random() < 0.5 ? 'busy' : 'offline') : c.status, queue: c.status === 'busy' ? simulateQueue('busy', departure) : 0 })));
    }, 60000);
    return () => clearInterval(pollRef.current);
  }, [journeyStarted, departure]);

  // Traffic reroute — keeps total distance offset so battery doesn't reset
  const rerouteForTraffic = useCallback(async () => {
    if (!currentPosRef.current) return;
    setReroutingTraffic(true);
    const [cLat, cLng] = currentPosRef.current;
    const [dLat, dLng] = CITIES[destination];
    const offsetLat = cLat + (Math.random() - 0.5) * 0.05;
    const offsetLng = cLng + (Math.random() - 0.5) * 0.05;
    try {
      const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${cLng},${cLat};${offsetLng},${offsetLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`);
      const osrmData = await osrmRes.json();
      if (!osrmData.routes?.length) { setReroutingTraffic(false); return; }
      const newCoords = osrmData.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const newDistKm = Math.round(osrmData.routes[0].distance / 1000);
      const newDriveMins = Math.round(osrmData.routes[0].duration / 60);
      const newSteps = osrmData.routes[0].legs.flatMap(l => l.steps.map(s => ({ instruction: s.maneuver.instruction || `Continue on ${s.name || 'road'}`, name: s.name || '', distance: Math.round(s.distance) })));

      // Capture live battery BEFORE resetting refs
      const liveBattery = getLiveBattery();
      currentBatteryRef.current = liveBattery;
      distAtLastReset.current = 0;
      totalDistCovered.current = 0;

      setAltRouteCoords(routeCoords);
      setRouteCoords(newCoords);
      setRoadDists(calcRoadDistances(newCoords));
      setNavSteps(newSteps); setCurrentStepIdx(0); setPositionIdx(0);
      const { chargers: newChargers, stops: newStops, totalChargeMins, arrivePct } = await fetchChargersAndRecalc(newCoords, customSpecs, liveBattery, departure, newDistKm);
      setChargers(newChargers);
      const numbered = newStops.map((s,i) => ({ ...s, stopNum: i+1 }));
      setStops(numbered);
      setStats({ distanceKm: newDistKm, drivingMins: newDriveMins, totalChargers: newChargers.length, availableCount: newChargers.filter(c=>c.status==='available').length, totalChargeMins, stopCount: newStops.length, totalMins: newDriveMins+totalChargeMins, arrivePct });
      visitedStops.current = new Set();
      setIsRerouted(true); setReroutingTraffic(false); setCanResume(true);
      setChatMessages(prev => [...prev, { role: 'ai', text: `✅ Alternative route found! New distance: ${newDistKm}km, drive time: ${Math.floor(newDriveMins/60)}h ${newDriveMins%60}m, arriving with ~${arrivePct}% battery. Current battery: ${liveBattery}%. ${numbered.length} charging stop${numbered.length!==1?'s':''} along new route. Click Resume Journey when ready.` }]);
    } catch(e) { console.error(e); setReroutingTraffic(false); setChatMessages(prev => [...prev, { role: 'ai', text: 'Could not find alternative route. Please try again.' }]); }
  }, [destination, customSpecs, departure, routeCoords, getLiveBattery]);

  const simulateOutage = useCallback(async () => {
    if (stops.length === 0) return;
    const target = stops.find(s => !visitedStops.current.has(s.id));
    if (!target) { setChatMessages(prev => [...prev, { role: 'ai', text: 'No upcoming charging stops to simulate an outage for.' }]); return; }
    const newStatus = Math.random() < 0.5 ? 'busy' : 'offline';
    setChargers(prev => prev.map(c => c.id === target.id ? { ...c, status: newStatus, queue: newStatus === 'busy' ? 3 : 0 } : c));
    setStops(prev => prev.map(s => s.id === target.id ? { ...s, status: newStatus } : s));
    const alt = chargers.find(c => c.id !== target.id && c.status === 'available' && c.powerKw > 0 && !visitedStops.current.has(c.id));
    if (!alt) { setChatMessages(prev => [...prev, { role: 'ai', text: 'No alternative chargers available nearby.' }]); return; }
    setRerouteLoading(true);
    const message = await fetchRerouteReasoning({ ...target, status: newStatus }, alt, origin, destination);
    setRerouteLoading(false);
    setRerouteAlert({ affectedStop: { ...target, status: newStatus }, newStop: alt, message: message.trim() });
  }, [stops, chargers, origin, destination]);

  const simulateNews = useCallback(() => {
    const jalan = JALAN_NAMES[Math.floor(Math.random() * JALAN_NAMES.length)];
    setNewsAlert({ jalan, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) });
  }, []);

  const confirmReroute = useCallback(() => {
    if (!rerouteAlert) return;
    const { affectedStop, newStop } = rerouteAlert;
    setStops(prev => { const idx = prev.findIndex(s => s.id === affectedStop.id); if (idx === -1) return prev; const u = [...prev]; u[idx] = { ...newStop, stopNum: affectedStop.stopNum, chargeMins: affectedStop.chargeMins }; return u; });
    setRerouteAlert(null);
    if (reservations[affectedStop.id]) setRebookModal({ oldStop: affectedStop, newStop });
  }, [rerouteAlert, reservations]);

  const confirmRebook = useCallback(() => {
    if (!rebookModal) return;
    const ref = generateRef();
    setReservations(prev => { const u = { ...prev }; delete u[rebookModal.oldStop.id]; u[rebookModal.newStop.id] = { ref, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) }; return u; });
    setRebookModal(null);
  }, [rebookModal]);

  const openBookingModal = (stop) => {
    const estArrival = new Date(Date.now() + (stop.distFromStart / 80) * 3600000);
    setBookingModal({ stop, estimatedArrival: estArrival.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) });
  };

  const confirmBooking = () => {
    if (!bookingModal) return;
    const ref = generateRef();
    setReservations(prev => ({ ...prev, [bookingModal.stop.id]: { ref, time: bookingModal.estimatedArrival } }));
    setBookingConfirmed({ ref, stopName: bookingModal.stop.name });
    setBookingModal(null);
    setTimeout(() => setBookingConfirmed(null), 5000);
  };

  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput(''); setChatLoading(true);
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    const trafficKeywords = ['traffic', 'alternative', 'reroute', 'stuck', 'jam', 'accident', 'delay', 'different route', 'another route', 'find route'];
    const isTrafficRequest = trafficKeywords.some(k => userMsg.toLowerCase().includes(k));
    if (isTrafficRequest && trafficActive && !reroutingTraffic) {
      setChatMessages(prev => [...prev, { role: 'ai', text: '🔄 Finding the best alternative route from your current position...' }]);
      setChatLoading(false);
      await rerouteForTraffic();
    } else {
      const context = `JalanJava AI. Trip: ${origin} to ${destination}. Vehicle: ${vehicle} (${customSpecs.battery}kWh). Current battery: ${batteryDisplay}%. ${stats ? `${stats.distanceKm}km total, ${stops.length} stops planned.` : ''} Answer in 2-3 sentences.`;
      const reply = await callClaude(`${context}\nUser: ${userMsg}`);
      setChatMessages(prev => [...prev, { role: 'ai', text: reply }]);
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, origin, destination, vehicle, customSpecs, batteryDisplay, stats, stops, trafficActive, reroutingTraffic, rerouteForTraffic]);

  const resumeJourney = () => { setTrafficActive(false); setJourneyPaused(false); setCanResume(false); setAltRouteCoords([]); };

  const isNow = departure === 'now';
  const minDateTime = new Date().toISOString().slice(0, 16);
  const currentRoadDist = distAtLastReset.current + (roadDists[positionIdx] || 0);

  return (
    <div className={`app-wrapper ${nightMode ? 'night' : ''}`}>
      <div className="topbar">
        <div className="logo">jalan<span>java</span></div>
        <div className="controls">
          <select value={origin} onChange={e => setOrigin(e.target.value)}>{Object.keys(CITIES).map(c => <option key={c}>{c}</option>)}</select>
          <span className="arrow">→</span>
          <select value={destination} onChange={e => setDestination(e.target.value)}>{Object.keys(CITIES).map(c => <option key={c}>{c}</option>)}</select>
          <div className="divider-v" />
          <select value={vehicle} onChange={e => handleVehicleChange(e.target.value)}>{Object.keys(VEHICLES).map(v => <option key={v}>{v}</option>)}</select>
          <button className="customise-btn" onClick={() => setShowCustom(p => !p)}>{showCustom ? 'Hide ▲' : 'Customise ▼'}</button>
          <div className="battery-input">
            <span>🔋</span>
            <input type="number" min="5" max="100" value={batteryPct} onChange={e => setBatteryPct(Number(e.target.value))} />
            <span className="pct">%</span>
          </div>
          <div className="divider-v" />
          <div className="departure-input">
            <span>🕐</span>
            <select value={isNow ? 'now' : 'custom'} onChange={e => { if (e.target.value === 'now') setDeparture('now'); else setDeparture(minDateTime); }}>
              <option value="now">Depart now</option>
              <option value="custom">Choose date & time</option>
            </select>
            {!isNow && <input type="datetime-local" value={departure} min={minDateTime} onChange={e => setDeparture(e.target.value)} />}
          </div>
          <div className="divider-v" />
          <button className={`night-btn ${nightMode ? 'active' : ''}`} onClick={() => setNightMode(p => !p)}>{nightMode ? '☀️' : '🌙'}</button>
          {routePlanned && <button className="reset-btn" onClick={resetAll}>↺ Reset</button>}
          <button onClick={planRoute} disabled={loading}>{loading ? 'Loading...' : 'Plan route'}</button>
        </div>
        {showCustom && (
          <div className="custom-specs">
            <div className="spec-field"><label>Battery (kWh)</label><input type="number" value={customSpecs.battery} onChange={e => handleSpecChange('battery', e.target.value)} /></div>
            <div className="spec-field"><label>Range (km)</label><input type="number" value={customSpecs.range} onChange={e => handleSpecChange('range', e.target.value)} /></div>
            <div className="spec-field"><label>Consumption (kWh/100km)</label><input type="number" value={customSpecs.consumption} onChange={e => handleSpecChange('consumption', e.target.value)} /></div>
            <span className="spec-note">{vehicle !== 'Custom' ? `Specs for ${vehicle}` : 'Custom specs'}</span>
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {trafficActive && (
        <div className="alert-banner traffic-banner">
          <div className="alert-icon">🚦</div>
          <div className="alert-body">
            <div className="alert-title">Heavy traffic detected — journey paused</div>
            <div className="alert-msg">Congestion on <strong>{trafficJalan}</strong>. Your route is affected.</div>
            <div className="alert-sub">{reroutingTraffic ? '🔄 Finding alternative route...' : canResume ? '✅ Alternative route ready. Review updated stats and click Resume.' : 'Use the chat below to request an alternative route.'}</div>
          </div>
          {canResume && <div className="alert-actions"><button className="alert-confirm" onClick={resumeJourney}>▶ Resume Journey</button></div>}
        </div>
      )}

      {rerouteAlert && (
        <div className="alert-banner reroute-banner">
          <div className="alert-icon">⚠️</div>
          <div className="alert-body">
            <div className="alert-title">Charging stop unavailable</div>
            <div className="alert-msg"><strong>Stop {rerouteAlert.affectedStop.stopNum} — {rerouteAlert.affectedStop.name}</strong> is now {rerouteAlert.affectedStop.status}.</div>
            {rerouteLoading ? <div className="alert-sub">AI finding best alternative...</div> : <div className="alert-sub">{rerouteAlert.message}</div>}
            <div className="alert-new">New stop: <strong>{rerouteAlert.newStop.name}</strong> · {rerouteAlert.newStop.power} · {rerouteAlert.newStop.distFromStart}km</div>
          </div>
          <div className="alert-actions">
            <button className="alert-confirm" onClick={confirmReroute}>Reroute now</button>
            <button className="alert-dismiss" onClick={() => setRerouteAlert(null)}>Keep original</button>
          </div>
        </div>
      )}

      {newsAlert && (
        <div className="alert-banner news-banner">
          <div className="alert-icon">📰</div>
          <div className="alert-body">
            <div className="alert-title">Traffic incident reported</div>
            <div className="alert-msg">Accident on <strong>{newsAlert.jalan}</strong> at {newsAlert.time}.</div>
            <div className="alert-sub">Would you like to find an alternative charging stop?</div>
          </div>
          <div className="alert-actions">
            <button className="alert-confirm" onClick={() => { simulateOutage(); setNewsAlert(null); }}>Find alternative</button>
            <button className="alert-dismiss" onClick={() => setNewsAlert(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {arrivedAtStop && (
        <div className="alert-banner arrival-banner">
          <div className="alert-icon">⚡</div>
          <div className="alert-body">
            <div className="alert-title">Arrived at charging stop</div>
            <div className="alert-msg"><strong>{arrivedAtStop.name}</strong> — {arrivedAtStop.power}</div>
            <div className="alert-sub">Est. charge time: ~{arrivedAtStop.chargeMins} min. Battery charged to 80%.</div>
          </div>
          <div className="alert-actions"><button className="alert-confirm" onClick={() => setArrivedAtStop(null)}>Got it</button></div>
        </div>
      )}

      {journeyFinished && (
        <div className="alert-banner finish-banner">
          <div className="alert-icon">🏁</div>
          <div className="alert-body">
            <div className="alert-title">You have arrived!</div>
            <div className="alert-msg">Welcome to <strong>{destination}</strong>.</div>
            <div className="alert-sub">Total time: {fmtSecs(elapsedSecs)} · {stats?.distanceKm}km · Final battery: {batteryDisplay}%</div>
          </div>
          <div className="alert-actions"><button className="alert-confirm" onClick={() => setJourneyFinished(false)}>Done</button></div>
        </div>
      )}

      {bookingConfirmed && (
        <div className="alert-banner booking-banner">
          <div className="alert-icon">✅</div>
          <div className="alert-body">
            <div className="alert-title">Reservation confirmed</div>
            <div className="alert-msg"><strong>{bookingConfirmed.stopName}</strong></div>
            <div className="alert-sub">Ref: {bookingConfirmed.ref} · Confirmation sent to your email.</div>
          </div>
          <div className="alert-actions"><button className="alert-confirm" onClick={() => setBookingConfirmed(null)}>Done</button></div>
        </div>
      )}

      {(aiReasoning || aiLoading) && !rerouteAlert && !newsAlert && !trafficActive && (
        <div className={`ai-summary-bar ${aiLoading && !aiReasoning ? 'ai-loading' : ''}`}>
          <span className="ai-label">AI</span>
          {aiReasoning ? aiReasoning.summary : 'Analysing your trip...'}
        </div>
      )}

      <div className="main-body">
        <div className="map-wrapper">
          <MapContainer center={[-7.0, 109.0]} zoom={7} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution='&copy; OpenStreetMap' url={nightMode ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} />
            <MapInteractionTracker onUserInteract={() => { if (journeyStarted && !flyToPosition) setFollowPosition(false); }} />
            <MapController routeCoords={routeCoords} flyToPosition={flyToPosition} onFlyComplete={() => setFlyToPosition(null)} followPosition={followPosition} currentPosition={routeCoords[positionIdx]} />
            <ResetZoomControl routeCoords={routeCoords} journeyStarted={journeyStarted} currentPosition={routeCoords[positionIdx]} onRecentre={() => setFollowPosition(true)} />
            {altRouteCoords.length > 0 && <Polyline positions={altRouteCoords} color="#aaa" weight={3} dashArray="6 4" opacity={0.5} />}
            {routeCoords.length > 0 && <Polyline positions={routeCoords} color={isRerouted ? '#2563eb' : nightMode ? '#4ade80' : '#1a6b3a'} weight={4} />}
            {routeCoords.length > 0 && <><Marker position={CITIES[origin]} icon={createCityIcon(origin)} /><Marker position={CITIES[destination]} icon={createCityIcon(destination)} /></>}
            {journeyStarted && routeCoords[positionIdx] && <Marker position={routeCoords[positionIdx]} icon={createPositionIcon(trafficActive)} />}
            {chargers.map(c => (
              <Marker key={c.id} position={c.position} icon={createIcon(c.status)} ref={el => { if (el) markerRefs.current[c.id] = el; }}>
                <Popup><strong>{c.name}</strong><br />{c.address && <>{c.address}<br /></>}Power: {c.power}<br />Status: <span style={{color:statusColor[c.status]}}>{c.status}</span>{c.queue > 0 && <><br />Queue: {c.queue} waiting</>}</Popup>
              </Marker>
            ))}
            {stops.map(s => (
              <Marker key={`stop-${s.id}`} position={s.position} icon={createStopIcon(s.stopNum, !!reservations[s.id])} ref={el => { if (el) markerRefs.current[`stop-${s.id}`] = el; }}>
                <Popup><strong>Stop {s.stopNum}: {s.name}</strong><br />Power: {s.power}<br />Est. charge: {s.chargeMins} min{reservations[s.id] && <><br /><span style={{color:'#2563eb'}}>🔒 {reservations[s.id].ref}</span></>}</Popup>
              </Marker>
            ))}
          </MapContainer>

          {journeyStarted && navSteps[currentStepIdx] && (
            <div className="nav-instruction">
              <div className="nav-icon">{trafficActive ? '🚦' : '▶'}</div>
              <div>
                <div className="nav-step">{trafficActive ? `Traffic on ${trafficJalan}` : navSteps[currentStepIdx].instruction}</div>
                <div className="nav-road">{trafficActive ? 'Journey paused — use chat to reroute' : `${navSteps[currentStepIdx].name} · ${navSteps[currentStepIdx].distance}m`}</div>
              </div>
            </div>
          )}

          {journeyStarted && (
            <div className="journey-hud">
              <div className="hud-item"><span className="hud-val">{fmtSecs(elapsedSecs)}</span><span className="hud-lbl">elapsed</span></div>
              <div className="hud-divider" />
              <div className="hud-item"><span className="hud-val">{Math.round(currentRoadDist * 10) / 10} km</span><span className="hud-lbl">progressed</span></div>
              <div className="hud-divider" />
              <div className="hud-item">
                <span className="hud-val" style={{color: batteryDisplay <= 15 ? '#ef4444' : batteryDisplay <= 20 ? '#f59e0b' : '#4ade80'}}>{batteryDisplay}%</span>
                <span className="hud-lbl">battery</span>
              </div>
              {distToNextStop && <><div className="hud-divider" /><div className="hud-item"><span className="hud-val">{distToNextStop.km} km</span><span className="hud-lbl">to Stop {distToNextStop.stop.stopNum}</span></div></>}
              {isRerouted && <><div className="hud-divider" /><div className="hud-item"><span className="hud-val" style={{color:'#60a5fa'}}>REROUTED</span><span className="hud-lbl">new route</span></div></>}
            </div>
          )}
        </div>

        {sidebarOpen && (
          <div className="sidebar">
            <div className="sidebar-header">
              <span>{stops.filter(s => !visitedStops.current.has(s.id)).length} stop{stops.filter(s=>!visitedStops.current.has(s.id)).length!==1?'s':''} remaining</span>
              <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)}>−</button>
            </div>

            {journeyStarted && (
              <div className="nav-steps-panel">
                <div className="sidebar-section-label">Directions</div>
                {navSteps.map((step, i) => (
                  <div key={i} className={`nav-step-item ${i === currentStepIdx ? 'nav-step-active' : i < currentStepIdx ? 'nav-step-done' : ''}`}>
                    <span className="nav-step-num">{i+1}</span>
                    <div><div className="nav-step-text">{step.instruction}</div>{step.name && <div className="nav-step-road">{step.name} · {step.distance}m</div>}</div>
                  </div>
                ))}
              </div>
            )}

            {!journeyStarted && (aiReasoning ? (
              <div className="ai-detail"><div className="ai-detail-label">AI Analysis</div><p>{aiReasoning.detail}</p></div>
            ) : aiLoading ? (
              <div className="ai-detail ai-detail-loading"><div className="ai-detail-label">AI Analysis</div><p>Generating...</p></div>
            ) : null)}

            {stops.length === 0 ? (
              <div className="no-stops"><p>✅ No stops needed!</p><p>Battery sufficient for this route.</p></div>
            ) : stops.map((s, i) => (
              <div key={s.id} className={`stop-card ${s.arrived ? 'stop-visited' : ''}`} onClick={() => handleStopClick(s)}>
                <div className="stop-header">
                  <span className="stop-badge" style={{background: s.arrived ? '#888' : reservations[s.id] ? '#2563eb' : '#1a6b3a'}}>
                    {s.arrived ? '✓' : reservations[s.id] ? '🔒' : ''} Stop {s.stopNum}
                  </span>
                  <span className="stop-dist">{s.distFromStart}km{i>0&&` · ${s.distFromStart-stops[i-1].distFromStart}km from prev`}</span>
                </div>
                <div className="stop-name">{s.name}</div>
                <div className="stop-meta">
                  <span className="meta-item">⚡ {s.power}</span>
                  <span className="meta-item">⏱ ~{s.chargeMins} min</span>
                  <span className="meta-item" style={{color:statusColor[s.status]}}>● {s.status==='available'?'Available':s.status==='busy'?`Busy · ${s.queue} in queue`:'Offline'}</span>
                </div>
                {reservations[s.id] ? (
                  <div className="reservation-badge">🔒 {reservations[s.id].ref} · est. {reservations[s.id].time}</div>
                ) : s.status === 'available' && !s.arrived && (
                  <button className="reserve-btn" onClick={e => { e.stopPropagation(); openBookingModal(s); }}>Reserve slot</button>
                )}
              </div>
            ))}

            {chargers.filter(c => !stops.find(s => s.id===c.id)).length > 0 && (
              <>
                <div className="sidebar-section-label">Other chargers along route</div>
                {chargers.filter(c => !stops.find(s => s.id===c.id)).map(c => (
                  <div key={c.id} className="charger-card" onClick={() => handleStopClick(c)}>
                    <div className="charger-name">{c.name}</div>
                    <div className="stop-meta">
                      <span className="meta-item">⚡ {c.power}</span>
                      <span className="meta-item" style={{color:statusColor[c.status]}}>● {c.status==='available'?'Available':c.status==='busy'?`Busy · ${c.queue} in queue`:'Offline'}</span>
                      <span className="meta-item">{c.distFromStart}km</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="sidebar-footer">
              {!journeyStarted ? (
                <button className="start-journey-btn" onClick={() => { setJourneyStarted(true); setFollowPosition(true); if (routeCoords.length > 0) setFlyToPosition(routeCoords[0]); }}>🚗 Start Journey</button>
              ) : (
                <div className="journey-active">
                  <div className="journey-status">{trafficActive ? '🚦 Journey paused — traffic' : '🟢 Journey in progress'}</div>
                  {canResume && <button className="resume-btn" onClick={resumeJourney}>▶ Resume Journey</button>}
                  {!trafficActive && (
                    <div className="journey-btns">
                      <button className="pause-btn" onClick={() => setJourneyPaused(p => !p)}>{journeyPaused ? '▶ Resume' : '⏸ Pause'}</button>
                      <button className="simulate-btn" onClick={simulateOutage}>⚡ Outage</button>
                      <button className="simulate-btn" onClick={simulateNews}>📰 News</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!sidebarOpen && routeCoords.length > 0 && <button className="sidebar-show-btn" onClick={() => setSidebarOpen(true)}>◀ Route</button>}
      </div>

      {stats && (
        <div className="stats-bar">
          <div className="stat"><div className="stat-val">{stats.distanceKm} km</div><div className="stat-lbl">Total distance</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{fmtTime(stats.drivingMins)}</div><div className="stat-lbl">Drive time</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{stats.totalChargers}</div><div className="stat-lbl">Chargers found</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{stats.availableCount}</div><div className="stat-lbl">Available</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{stops.filter(s=>!visitedStops.current.has(s.id)).length}</div><div className="stat-lbl">Stops remaining</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{fmtTime(stats.totalChargeMins)}</div><div className="stat-lbl">Charge time</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{fmtTime(stats.totalMins)}</div><div className="stat-lbl">Total time</div></div>
          <div className="divider" />
          <div className="stat"><div className="stat-val">{stats.arrivePct}%</div><div className="stat-lbl">Arrive with</div></div>
        </div>
      )}

      {routePlanned && (
        <div className={`chat-bar ${chatMinimised ? 'chat-minimised' : ''}`}>
          <div className="chat-header">
            <span className="chat-title">💬 JalanJava Assistant {trafficActive && <span className="chat-traffic-badge">🚦 Traffic mode</span>}</span>
            <button className="chat-toggle" onClick={() => setChatMinimised(p => !p)}>{chatMinimised ? '▲' : '▼'}</button>
          </div>
          {!chatMinimised && (
            <>
              <div className="chat-messages">
                {chatMessages.length === 0 && <div className="chat-placeholder">Ask anything — e.g. "I'm in unexpected traffic, find me an alternative route"</div>}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.role}`}>
                    {m.role === 'ai' && <span className="chat-ai-label">AI</span>}
                    <div>
                      <span className="chat-text">{m.text}</span>
                      {m.isAction && <button className="chat-action-btn" onClick={m.action}>View alternative →</button>}
                    </div>
                  </div>
                ))}
                {chatLoading && <div className="chat-msg ai"><span className="chat-ai-label">AI</span><span className="chat-text">Thinking...</span></div>}
              </div>
              <div className="chat-input-row">
                <input className="chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder={trafficActive ? "e.g. Find me an alternative route..." : "Ask anything about your trip..."} />
                <button className="chat-send" onClick={sendChat} disabled={chatLoading}>Send</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="footer">
        <div className="legend">
          <span className="dot" style={{background:'#1D9E75'}} /> Available
          <span className="dot" style={{background:'#BA7517'}} /> Busy
          <span className="dot" style={{background:'#E24B4A'}} /> Offline
          {isRerouted && <><span className="dot" style={{background:'#2563eb'}} /> New route <span className="dot" style={{background:'#aaa'}} /> Original</>}
          {loading && <span className="loading-text">Loading...</span>}
        </div>
        {!isNow && <div className="disclaimer">⚠️ Availability is predictive. Journey speed is simulated.</div>}
      </div>

      {showAiPopup && (
        <div className="ai-popup-overlay">
          <div className="ai-popup">
            <div className="ai-popup-header"><span className="ai-label">AI Analysis</span></div>
            <div className="ai-popup-body">{aiPopupText}{!aiPopupDone && <span className="cursor">|</span>}</div>
            {aiPopupDone && <button className="ai-popup-done" onClick={() => setShowAiPopup(false)}>Done →</button>}
          </div>
        </div>
      )}

      {bookingModal && (
        <div className="modal-overlay" onClick={() => setBookingModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Reserve charging slot</div>
            <div className="modal-body">
              <div className="modal-row"><span>Location</span><strong>{bookingModal.stop.name}</strong></div>
              <div className="modal-row"><span>Est. arrival</span><strong>{bookingModal.estimatedArrival}</strong></div>
              <div className="modal-row"><span>Charger</span><strong>{bookingModal.stop.power}</strong></div>
              <div className="modal-row"><span>Est. charge</span><strong>~{bookingModal.stop.chargeMins} min</strong></div>
              <div className="modal-note">In production this connects to the operator booking API via OCPI.</div>
            </div>
            <div className="modal-actions">
              <button className="modal-confirm" onClick={confirmBooking}>Confirm reservation</button>
              <button className="modal-cancel" onClick={() => setBookingModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {rebookModal && (
        <div className="modal-overlay" onClick={() => setRebookModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">⚡ Rebook charging slot?</div>
            <div className="modal-body">
              <p style={{fontSize:'13px',color:'#555',marginBottom:'12px'}}>Your reservation at <strong>{rebookModal.oldStop.name}</strong> has been cancelled.</p>
              <div className="modal-row"><span>New location</span><strong>{rebookModal.newStop.name}</strong></div>
              <div className="modal-row"><span>Charger</span><strong>{rebookModal.newStop.power}</strong></div>
              <div className="modal-note">Would you like to reserve a slot at the new stop?</div>
            </div>
            <div className="modal-actions">
              <button className="modal-confirm" onClick={confirmRebook}>Yes, rebook</button>
              <button className="modal-cancel" onClick={() => setRebookModal(null)}>No thanks</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
