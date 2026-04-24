let updateInterval = null
const darkMode = window.matchMedia('(prefers-color-scheme: dark)')

function getMapStyle() {
  return darkMode.matches 
    ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' 
    : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
}

const map = new maplibregl.Map({
  container: 'map',
  style: getMapStyle(),
  center: [-2.9, 54.5], // Center of UK
  zoom: 5,
  attributionControl: false,
}).addControl(
  new maplibregl.AttributionControl({
    customAttribution: ['© OpenStreetMap contributors'],
  }),
)

// Add Zoom & Rotation Buttons to the map (Top Right by default)
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

// Handle Open/Close Toggle for the Glass Panel
document.getElementById('panelToggle').addEventListener('click', () => {
  document.getElementById('infoPanel').classList.toggle('collapsed')
})

darkMode.addEventListener('change', () => {
  map.setStyle(getMapStyle())
  map.once('styledata', () => {
    setUpUpdater()
  })
})

function fitBounds() {
  const isMobile = window.innerWidth <= 768
  // Bounding box for the UK
  map.fitBounds(
    [
      [-10.5, 49.8], // Southwest
      [2.0, 59.5]    // Northeast
    ],
    {
      padding: { 
        top: 50, 
        bottom: isMobile ? (window.innerHeight * 0.45) : 50, 
        left: isMobile ? 50 : 420, 
        right: 50 
      },
      animate: false,
    }
  )
}

map.once('load', fitBounds)
window.addEventListener('resize', () => { setTimeout(fitBounds, 100) })

let stationDataGeoJson = {
  type: 'FeatureCollection',
  features: []
}

let popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  className: 'premium-popup',
  offset: [0, -10]
})

async function updatePlatformingData(abortController) {
  try {
    const resp = await fetch('/api/stations-state', { signal: abortController.signal })
    if (!resp.ok) {
      document.querySelector('#map').classList.remove('loading')
      return
    }
    const data = await resp.json()

    if (abortController.signal.aborted) {
      return
    }

    const features = data.stations.map(stn => {
      let colorStatus = 'gray'
      if (typeof stn.platformedPercentage === 'number' && !isNaN(stn.platformedPercentage)) {
        if (stn.platformedPercentage >= 80) colorStatus = 'green'
        else if (stn.platformedPercentage >= 35) colorStatus = 'yellow'
        else colorStatus = 'red'
      }

      let timeStr;
      if (stn.lastUpdated) {
        const date = new Date(stn.lastUpdated);
        timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (data.timestamp) {
        // Fallback to top-level timestamp if transition still happening
        const date = new Date(data.timestamp);
        timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        const now = new Date();
        timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [stn.lon, stn.lat]
        },
        properties: {
          id: stn.crs,
          name: stn.name,
          pct: stn.platformedPercentage,
          total: stn.totalServices,
          platformed: stn.platformedServices,
          hidden: stn.hiddenServices || 0,
          status: colorStatus,
          lastUpdated: timeStr
        }
      }
    })

    features.sort((a, b) => {
      const aVal = (typeof a.properties.pct === 'number' && !isNaN(a.properties.pct)) ? a.properties.pct : Infinity;
      const bVal = (typeof b.properties.pct === 'number' && !isNaN(b.properties.pct)) ? b.properties.pct : Infinity;
      return bVal - aVal;
    })

    stationDataGeoJson.features = features

    const source = map.getSource('stations')
    if (source) {
      source.setData(stationDataGeoJson)
    } else {
      map.addSource('stations', {
        type: 'geojson',
        data: stationDataGeoJson
      })

      // We use two layers: one for the core dot, one for a subtle outer blur/glow
      map.addLayer({
        id: 'stations-glow-layer',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 8,
            10, 16,
            15, 24
          ],
          'circle-color': [
            'match',
            ['get', 'status'],
            'green', '#2ecc71',
            'yellow', '#f1c40f',
            'red', '#e74c3c',
            '#7f8c8d'
          ],
          'circle-blur': 1,
          'circle-opacity': 0.4
        }
      })

      map.addLayer({
        id: 'stations-layer',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 4,
            10, 8,
            15, 12
          ],
          'circle-color': [
            'match',
            ['get', 'status'],
            'green', '#2ecc71',
            'yellow', '#f1c40f',
            'red', '#e74c3c',
            '#7f8c8d'
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'match',
            ['get', 'status'],
            'green', 'rgba(46, 204, 113, 0.4)',
            'yellow', 'rgba(241, 196, 15, 0.4)',
            'red', 'rgba(231, 76, 60, 0.4)',
            'rgba(127, 140, 141, 0.4)'
          ],
          'circle-stroke-opacity': 1
        }
      })
      
      map.on('mouseenter', 'stations-layer', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'stations-layer', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('click', 'stations-layer', (e) => {
        const props = e.features[0].properties
        const coordinates = e.features[0].geometry.coordinates.slice()
        
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360
        }

        const hasPct = typeof props.pct === 'number' && !isNaN(props.pct)
        const pctText = hasPct ? `${props.pct}%` : 'N/A'
        
        const html = `
          <div class="popup-header">${props.name}</div>
          <div class="popup-body">
            <div class="popup-stat large status-${props.status}">
              <span>Publicly Provided:</span>
              <span>${pctText}</span>
            </div>
            ${hasPct || props.total > 0 ? `
            <div class="popup-stat">
              <span>Publicly Boarding:</span>
              <span>${props.platformed || 0} / ${props.total || 0}</span>
            </div>
            ${props.hidden > 0 ? `
            <div class="popup-stat" style="color: var(--yellow);">
              <span>Artificially Hidden:</span>
              <span>${props.hidden} services</span>
            </div>` : ''}
            ` : ''}
            <div class="popup-stat" style="margin-top: 10px; opacity: 0.6; font-size: 0.85rem;">
              <span>Last Checked:</span>
              <span>${props.lastUpdated}</span>
            </div>
          </div>
        `

        popup.setLngLat(coordinates).setHTML(html).addTo(map)
      })
    }

    document.querySelector('#map').classList.remove('loading')

  } catch (error) {
    if (error.name === 'AbortError') return
    console.error('Error fetching platforming data:', error)
    document.querySelector('#map').classList.remove('loading')
  }
}

function setUpUpdater() {
  let ac = null
  function performUpdate() {
    if (ac) ac.abort()
    ac = new AbortController()
    updatePlatformingData(ac)
  }

  if (updateInterval) {
    clearInterval(updateInterval)
  }

  updateInterval = setInterval(performUpdate, 60000)
  performUpdate()
}

map.on('load', () => {
  setUpUpdater()
})
