import './style.css'

const POLL_INTERVAL_MS = 250
const sources = new Map()
let selectedSource = 'sample:fshift:lower'
let frozen = false
let bridgeConnected = false
let lastSeenBySource = new Map()

function setStatus(text) {
  bridgeStatus.textContent = text
}

document.querySelector('#app').innerHTML = `
  <main class="panel-shell">
    <header class="panel-header">
      <div>
        <p class="eyebrow">DevTools Panel</p>
        <h1>elemaudiors-devscope</h1>
      </div>
      <div class="panel-action-row">
        <button id="reconnect" class="panel-button" type="button">Reconnect</button>
        <button id="freeze" class="panel-button" type="button">Freeze</button>
      </div>
    </header>
    <section class="panel-toolbar">
      <label class="toolbar-field">
        <span>Source</span>
        <select id="source-select"></select>
      </label>
      <div>
        <div class="toolbar-stats" id="stats"></div>
        <div class="toolbar-status" id="bridge-status">waiting for live page bridge</div>
      </div>
    </section>
    <section class="panel-plot-wrap">
      <canvas id="sparkplot" class="sparkplot" width="960" height="240"></canvas>
    </section>
    <section class="panel-log">
      <div class="panel-log-header">
        <span>Latest event</span>
        <span id="event-meta"></span>
      </div>
      <pre id="event-json" class="event-json"></pre>
    </section>
  </main>
`

const sparkplot = document.querySelector('#sparkplot')
const sourceSelect = document.querySelector('#source-select')
const stats = document.querySelector('#stats')
const bridgeStatus = document.querySelector('#bridge-status')
const eventMeta = document.querySelector('#event-meta')
const eventJson = document.querySelector('#event-json')
const freezeButton = document.querySelector('#freeze')
const reconnectButton = document.querySelector('#reconnect')

freezeButton.addEventListener('click', () => {
  frozen = !frozen
  freezeButton.textContent = frozen ? 'Resume' : 'Freeze'
})

reconnectButton.addEventListener('click', () => {
  requestReconnect()
})

sourceSelect.addEventListener('change', () => {
  selectedSource = sourceSelect.value
  renderSelectedSource()
})

function ensureSource(event) {
  if (!sources.has(event.source)) {
    sources.set(event.source, { latest: event, history: [] })
    const option = document.createElement('option')
    option.value = event.source
    option.textContent = event.source
    sourceSelect.append(option)

    if (sourceSelect.options.length === 1 || !sources.has(selectedSource)) {
      selectedSource = event.source
      sourceSelect.value = event.source
    }
  }

  return sources.get(event.source)
}

function toPlainNumberArray(value) {
  if (Array.isArray(value)) {
    return value.map((x) => Number(x) || 0)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map((x) => Number(x) || 0)
  }

  return []
}

function receiveDebugEvent(event) {
  if (frozen) return

  if (event.kind === 'lifecycle') {
    bridgeConnected = true
    setStatus('live page bridge connected')
    return
  }

  if (event.kind !== 'scope' || !Array.isArray(event.channels)) {
    return
  }

  const previousStamp = lastSeenBySource.get(event.source)
  const currentStamp = `${event.graphId}:${event.timestampMs}`
  if (previousStamp === currentStamp) {
    return
  }
  lastSeenBySource.set(event.source, currentStamp)

  const slot = ensureSource(event)
  slot.latest = event
  slot.history = toPlainNumberArray(event.channels[0])

  if (!sourceSelect.value || !sources.has(selectedSource)) {
    selectedSource = event.source
    sourceSelect.value = event.source
  }

  if (event.source === selectedSource || sourceSelect.options.length === 1) {
    renderSelectedSource()
  }
}

function activateLiveMode() {
  bridgeConnected = true
  setStatus('live page bridge connected')
}

function renderSelectedSource() {
  const slot = sources.get(selectedSource)
  if (!slot) return

  drawSparkplot(slot.history)

  const channel = toPlainNumberArray(slot.latest.channels?.[0])
  if (!channel.length) {
    stats.textContent = 'no channel data'
    eventMeta.textContent = `seq ${slot.latest.seq ?? '?'}  sr ${slot.latest.sampleRate ?? '?'}  n 0`
    eventJson.textContent = JSON.stringify(slot.latest, null, 2)
    return
  }

  const min = Math.min(...channel)
  const max = Math.max(...channel)
  const rms = Math.sqrt(channel.reduce((sum, x) => sum + x * x, 0) / Math.max(1, channel.length))

  stats.textContent = `min ${min.toFixed(3)}   max ${max.toFixed(3)}   rms ${rms.toFixed(3)}`
  eventMeta.textContent = `seq ${slot.latest.seq}  sr ${slot.latest.sampleRate}  n ${channel.length}`
  eventJson.textContent = JSON.stringify(slot.latest, null, 2)
}

function drawSparkplot(samples) {
  const ctx = sparkplot.getContext('2d')
  if (!ctx) return

  const width = sparkplot.width
  const height = sparkplot.height
  const mid = height / 2

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#0f1117'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(196, 181, 253, 0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.stroke()

  if (!samples.length) return

  ctx.strokeStyle = '#8b5cf6'
  ctx.lineWidth = 2
  ctx.beginPath()

  for (let i = 0; i < samples.length; i += 1) {
    const x = (i / Math.max(1, samples.length - 1)) * width
    const y = mid - samples[i] * (height * 0.42)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }

  ctx.stroke()
}

function requestReconnect() {
  if (!bridgeConnected) {
    setStatus('waiting for inspected page debug cache')
  }

  if (!sources.has(selectedSource) && sourceSelect.options.length > 0) {
    selectedSource = sourceSelect.options[0].value
    sourceSelect.value = selectedSource
  }

  chrome.devtools.inspectedWindow.eval(`
    (() => {
      const rootCache = window.__ELEMAUDIO_DEBUG_CACHE__;
      if (rootCache) {
        return { cache: rootCache, location: window.location.href };
      }

      for (const frame of Array.from(document.querySelectorAll('iframe'))) {
        try {
          const frameWindow = frame.contentWindow;
          const frameCache = frameWindow && frameWindow.__ELEMAUDIO_DEBUG_CACHE__;
          if (frameCache) {
            return {
              cache: frameCache,
              location: frameWindow.location.href,
            };
          }
        } catch {
          // Ignore cross-origin or inaccessible frames.
        }
      }

      return null;
    })()
  `, (result, exceptionInfo) => {
    if (exceptionInfo) {
      setStatus('could not read debug cache from inspected page')
      return
    }

    if (!result) {
      if (!bridgeConnected) {
        setStatus('inspected page has no debug cache yet')
      }
      return
    }

    try {
      const payload = typeof result === 'string' ? JSON.parse(result) : result
      if (!bridgeConnected && payload?.location) {
        setStatus(`reading debug cache from ${payload.location}`)
      }
      ingestCache(payload?.cache)
    } catch {
      setStatus(`debug cache payload was not valid JSON (${typeof result})`)
    }
  })
}

function ingestCache(cache) {
  if (!cache || typeof cache !== 'object') {
    return
  }

  if (cache.bridgeReady) {
    activateLiveMode()
  }

  const events = cache.eventsBySource
  if (!events || typeof events !== 'object') {
    return
  }

  for (const event of Object.values(events)) {
    receiveDebugEvent(event)
  }
}

window.setInterval(() => {
  requestReconnect()
}, POLL_INTERVAL_MS)

requestReconnect()
