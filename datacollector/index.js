import 'dotenv/config';
import fs from 'fs';

const RAIL_DATA_API_KEY = process.env.RAIL_DATA_API_KEY;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_NAMESPACE_ID = process.env.CF_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

// 1. Load the brand new comprehensive list of ~2600 UK stations!
const rawStations = JSON.parse(fs.readFileSync('./uk_stations.json', 'utf8'));

// Format them to exactly match our internal requirements
const StationsToCheck = rawStations
  .filter(s => s.crsCode) // ensure it's a valid station with a CRS
  .map(s => ({
    crs: s.crsCode,
    name: s.stationName,
    lat: s.lat,
    lon: s.long,
    tocFilter: null,
    // Provide a standard timeWindow in minutes to look ahead
    timeWindow: 120
  }));

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

// A helper function to process a single single station
async function processStation(s) {
  try {
    let nownow = Date.now();
    if ((fmt.formatToParts(new Date(nownow)).find(p => p.type === 'hour')?.value ?? '99') < '06') {
      nownow -= 9 * 60 * 60 * 1000;
    }

    const now = new Date(nownow - s.timeWindow * 60 * 1000);
    const londonTime = fmt.formatToParts(now);
    const nowStr = `${londonTime.find(p => p.type === 'year')?.value}${londonTime.find(p => p.type === 'month')?.value}${londonTime.find(p => p.type === 'day')?.value}T${londonTime.find(p => p.type === 'hour')?.value}${londonTime.find(p => p.type === 'minute')?.value}${londonTime.find(p => p.type === 'second')?.value}`;

    const query = new URLSearchParams({ numRows: '149', timeWindow: s.timeWindow.toString(), services: 'P' });
    if (s.tocFilter) query.append('filterTOC', s.tocFilter);

    const resp = await fetch(
      `https://api1.raildata.org.uk/1010-live-departure-board---staff-version1_0/LDBSVWS/api/20220120/GetDepartureBoardByCRS/${s.crs}/${nowStr}?${query}`,
      { headers: { 'x-apikey': RAIL_DATA_API_KEY } }
    );

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const meaningfulServices = (data?.trainServices || []).filter((svc) => !svc.isCancelled && svc.atd);
    
    // Calculate how many platforms were broadcast to the public openly
    const publicPlatformed = meaningfulServices.filter((svc) => 
      !!svc.platform && 
      !svc.platformIsHidden && 
      !svc.platformsAreHidden && 
      !svc.isPlatformSuppressed
    );
    
    // Calculate how many platforms were given a number but explicitly hidden from the API output
    const hiddenPlatformed = meaningfulServices.filter((svc) => 
      !!svc.platform && 
      (svc.platformIsHidden || svc.platformsAreHidden || svc.isPlatformSuppressed)
    );

    // Grade the station ONLY on public transparency
    const platformedPercentage = meaningfulServices.length > 0 
      ? Math.round((publicPlatformed.length * 100) / meaningfulServices.length) 
      : null;

    return {
      ...s,
      platformedPercentage,
      totalServices: meaningfulServices.length,
      platformedServices: publicPlatformed.length,
      hiddenServices: hiddenPlatformed.length,
      lastUpdated: new Date().toISOString(),
    };
  } catch (e) {
    if (e.message.includes('HTTP 429')) console.log(`   [Rate Limited] Retrying ${s.crs} later...`);
    return { ...s, platformedPercentage: null, totalServices: 0, platformedServices: 0, failed: true, lastUpdated: new Date().toISOString() };
  }
}

async function main() {
  console.log(`Starting data collection for ALL ${StationsToCheck.length} UK stations...`);

  const results = [];

  // ==========================================
  // BATCHING ALGORITHM
  // We process 30 stations concurrently at a time.
  // This is highly polite to the RailData servers (prevents massive spikes)
  // but still allows us to blast through 2,500 stations in just a few minutes!
  // ==========================================
  const BATCH_SIZE = 15;

  for (let i = 0; i < StationsToCheck.length; i += BATCH_SIZE) {
    const batch = StationsToCheck.slice(i, i + BATCH_SIZE);

    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(StationsToCheck.length / BATCH_SIZE)}...`);

    // Fire all 30 requests in this batch at the exact same time
    const batchPromises = batch.map(s => processStation(s));

    // Wait for all 30 to finish returning data before moving to the next batch
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Pause for 1 second between batches to guarantee we don't accidentally trip RailData's DDoS protection
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Filter out the failed ones if you want, or just log them
  const successes = results.filter(r => !r.failed);
  console.log(`\nAll batches complete! Successfully fetched ${successes.length}/${results.length} stations.`);

  // 2. We push stringified results straight to Cloudflare KV remotely
  console.log("Updating Cloudflare KV Store globally...");

  if (!CF_ACCOUNT_ID || !CF_NAMESPACE_ID || !CF_API_TOKEN) {
    console.log("No Cloudflare credentials found in .env. Skipping KV push.");
    return;
  }

  const cfResp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/uk_stations_state`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(successes)
    }
  );

  if (cfResp.ok) {
    console.log("✅ Successfully updated edge Cloudflare KV store cache!");
  } else {
    console.error("❌ Failed to update Cloudflare KV:", await cfResp.text());
  }
}

main().catch(console.error);
