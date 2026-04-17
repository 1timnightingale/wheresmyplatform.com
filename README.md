# Where's My Platform? 🚂

This project is a dynamic web application that presents live platform reporting status for UK train stations across an interactive map. It is designed to track whether stations are providing public platform numbers proactively, or if they artificially hide platform numbers internally until boarding time.

The code heavily relied on the work by David Wheatley at <https://wheresmyplatform.com>.

This project is designed specifically to be embedded onto platforms like the **Next Trains** website via an iframe, though it functions independently as a standalone service.

## 🏗 System Architecture

The architecture is split into three core elements: a backend data aggregator (`datacollector`), an edge data layer (`Cloudflare KV`), and a front-end service (`worker`).

### 1. Data Collector (`/datacollector`)
A standalone Node.js script responsible for polling and calculating real-time metrics. 
- It maintains a list of over 2,500 valid UK train stations (`uk_stations.json`).
- It concurrently queries the **National Rail Data (Darwin) API** in structured throughput batches.
- It parses train metrics, calculating public transparency (% of trains with publicly known platforms vs explicitly hidden platforms).
- It formats this aggregated data into a lightweight JSON payload and pushes it remotely to a Cloudflare KV store via the Cloudflare REST API.
- *Ideally runs as a scheduled CRON job.*

### 2. Cloudflare KV Store (Middle Tier)
Because we track ~2,500 stations concurrently, serving standard database queries dynamically on map-load would be slow and expensive. 
Instead, we use Cloudflare Worker's **Key-Value (KV) Store**. The data collector dumps the pre-calculated, global JSON state directly into edge memory. This ensures that frontend users fetching map data across the UK will receive millisecond read times without pinging any backend databases or overloading the Rail API.

### 3. Cloudflare Worker & Frontend (`/worker`)
A Cloudflare Worker execution environment mapping to our edge URL. The worker effectively handles two things:
1. **API Endpoints:** 
   - `GET /api/stations-state`: Retrieves the live, precalculated `uk_stations_state` JSON from KV and serves it rapidly with Cache-Control headers to the map frontend.
   - `GET /api/config`: Injects sensitive dynamic config (such as the iframe breakout URI `FRAME_REDIRECT_URL`).
2. **Serving Static Web Assets:** Through Wrangler's `[assets]`, the worker serves the static frontend inside `/worker/html`. The front-end leverages **MapLibre GL JS** to draw an interactive WebGL UK map and dynamically plots the station coordinates, fetching the KV JSON and rendering customized, hoverable data popups.

## 🔐 Configuration & Security

The repository is built strictly respecting environment security. Personal API keys, cloud tokens, and environment parameters are explicitly `.gitignore`'d and provided individually:

- **Data Collector Config:** A `.env` file should live in `/datacollector` to fuel the CRON job:
  ```env
  RAIL_DATA_API_KEY=your_rail_api_token
  CF_ACCOUNT_ID=your_cloudflare_account_id
  CF_NAMESPACE_ID=your_cloudflare_kv_namespace_id
  CF_API_TOKEN=your_cloudflare_rest_token
  ```
- **Worker Config:** When deploying the worker, use the Cloudflare Dashboard (or `wrangler secret put VAR_NAME`) to provide **Encrypted Secrets**. If developing locally, provide these in `/worker/.dev.vars`:
  ```env
  # Security restriction URL: If the site is viewed directly outside its iframe, it triggers a redirect here
  FRAME_REDIRECT_URL="https://<INSERT YOUR URL HERE>"
  ```
  *(Note: Cloudflare `wrangler deploy` expects `FRAME_REDIRECT_URL` to be explicitly added as a secret, otherwise it may inadvertently purge standard text dashboard variables).*

## 🚀 Running Locally

1. Ensure the `.env` and `.dev.vars` files are populated with your credentials.
2. In `/datacollector`, run `node index.js` manually to prime the Cloudflare KV cache with live data.
3. In `/worker`, run `yarn dev` (or `npm run dev`) to spawn the Wrangler local preview. 
4. Navigate to the local viewport URL to view the map pulling your edge KV data!
