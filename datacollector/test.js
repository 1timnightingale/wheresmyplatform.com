import 'dotenv/config';
const RAIL_DATA_API_KEY = process.env.RAIL_DATA_API_KEY;

async function run() {
    const q = new URLSearchParams({ numRows: '149', timeWindow: '120', services: 'P' });
    const resp = await fetch(
      `https://api1.raildata.org.uk/1010-live-departure-board---staff-version1_0/LDBSVWS/api/20220120/GetDepartureBoardByCRS/EUS?${q}`,
      { headers: { 'x-apikey': RAIL_DATA_API_KEY } }
    );
    const data = await resp.json();
    const svc = data.trainServices.find(s => Object.keys(s).some(k => k.toLowerCase().includes('hidden') || k.toLowerCase().includes('suppress'))) || data.trainServices[0];
    console.log(JSON.stringify(svc, null, 2));
}
run();
