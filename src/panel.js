import './style.css'

const POLL_INTERVAL_MS = 50
const sources = new Map()
let selectedSource = 'sample:fshift:lower'
let frozen = false
let bridgeConnected = false
let lastSeenBySource = new Map()
let sourceModes = new Map()
let sourceRanges = new Map()

function setStatus(text) {
  bridgeStatus.textContent = text
}

document.querySelector('#app').innerHTML = `
  <main class="panel-shell">
    <header class="panel-header">
      <div>
        <p class="eyebrow">elemaudiors devscope</p>
      </div>
      <div class="panel-action-row">
        <button id="reconnect" class="panel-button" type="button">Reconnect</button>
        <button id="freeze" class="panel-button" type="button">Freeze</button>
        <button id="mode-toggle" class="panel-button" 
        type="button" 
        title="Toggle display range for the selected source. Entering Adaptive resets tracked min/max.">Audio Range</button>
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
const modeToggleButton = document.querySelector('#mode-toggle')

freezeButton.addEventListener('click', () => {
  frozen = !frozen
  freezeButton.textContent = frozen ? 'Resume' : 'Freeze'
})

reconnectButton.addEventListener('click', () => {
  requestReconnect()
})

modeToggleButton.addEventListener('click', () => {
  toggleSelectedSourceMode()
})

sourceSelect.addEventListener('change', () => {
  selectedSource = sourceSelect.value
  syncModeToggleLabel()
  renderSelectedSource()
})

function ensureSource(event) {
  if (!sources.has(event.source)) {
    sources.set(event.source, { latest: event, history: [] })
    sourceModes.set(event.source, 'audio')
    sourceRanges.set(event.source, null)
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

  // Producer emits a monotonic seq per source. Same seq means same block,
  // so skip it to avoid re-running UI work for nothing.
  const previousSeq = lastSeenBySource.get(event.source)
  if (typeof event.seq === 'number' && previousSeq === event.seq) {
    return
  }
  if (typeof event.seq === 'number') {
    lastSeenBySource.set(event.source, event.seq)
  }

  const slot = ensureSource(event)
  slot.latest = event
  slot.history = toPlainNumberArray(event.channels[0])

  // Producer already tracks held min/max across the session for this source.
  // Mirror those into the panel state so the draw code keeps working even if
  // trackedMin/Max are briefly undefined on the very first event. Mode is
  // user-controlled now, so no auto-flip happens here.
  if (typeof event.trackedMin === 'number' && typeof event.trackedMax === 'number') {
    sourceRanges.set(event.source, { min: event.trackedMin, max: event.trackedMax })
  }

  if (!sourceSelect.value || !sources.has(selectedSource)) {
    selectedSource = event.source
    sourceSelect.value = event.source
    syncModeToggleLabel()
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
  const mode = sourceModes.get(selectedSource) ?? 'audio'
  if (!channel.length) {
    stats.textContent = `mode ${mode}   no channel data`
    eventMeta.textContent = `seq ${slot.latest.seq ?? '?'}  sr ${slot.latest.sampleRate ?? '?'}  n 0`
    eventJson.textContent = JSON.stringify(slot.latest, null, 2)
    return
  }

  // Prefer authoritative values from the producer. Fall back to block values
  // only if the event was emitted by an older page that predates trackedMin/Max.
  const fallbackMin = Math.min(...channel)
  const fallbackMax = Math.max(...channel)
  const trackedMin = typeof slot.latest.trackedMin === 'number' ? slot.latest.trackedMin : fallbackMin
  const trackedMax = typeof slot.latest.trackedMax === 'number' ? slot.latest.trackedMax : fallbackMax
  const rms = Math.sqrt(channel.reduce((sum, x) => sum + x * x, 0) / Math.max(1, channel.length))

  stats.textContent = `mode ${mode}   min ${trackedMin.toFixed(3)}   max ${trackedMax.toFixed(3)}   rms ${rms.toFixed(3)}`
  eventMeta.textContent = `seq ${slot.latest.seq ?? '?'}  sr ${slot.latest.sampleRate ?? '?'}  n ${channel.length}`
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

  const mode = sourceModes.get(selectedSource) ?? 'audio'
  let drawMin = -1
  let drawMax = 1

  if (mode === 'auto') {
    const range = sourceRanges.get(selectedSource)
    drawMin = range?.min ?? Math.min(...samples)
    drawMax = range?.max ?? Math.max(...samples)
    if (drawMin === drawMax) {
      drawMin -= 1
      drawMax += 1
    }
  }

  ctx.strokeStyle = '#8b5cf6'
  ctx.lineWidth = 2
  ctx.beginPath()

  for (let i = 0; i < samples.length; i += 1) {
    const x = (i / Math.max(1, samples.length - 1)) * width
    const normalized = mode === 'auto'
      ? ((samples[i] - drawMin) / (drawMax - drawMin)) * 2 - 1
      : Math.max(-1, Math.min(1, samples[i]))
    const y = mid - normalized * (height * 0.42)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }

  ctx.stroke()
}

function syncModeToggleLabel() {
  if (!modeToggleButton) return
  const mode = sourceModes.get(selectedSource) ?? 'audio'
  // Two-state toggle:
  //   audio    -> clamp display to normalized [-1, 1]
  //   adaptive -> plot against held tracked min/max
  modeToggleButton.textContent = mode === 'auto' ? 'Adaptive Range' : 'Audio Range'
  modeToggleButton.dataset.mode = mode
}

function requestProducerResetRange(source) {
  // Ask the producer (in the inspected page, possibly inside an iframe) to
  // clear its authoritative held min/max. If source is omitted the producer
  // resets every source. JSON.stringify is used so the source name survives
  // the eval round trip untouched.
  const argLiteral = typeof source === 'string' ? JSON.stringify(source) : ''
  chrome.devtools.inspectedWindow.eval(`
    (() => {
      const tryReset = (w) => {
        const cache = w && w.__ELEMAUDIO_DEBUG_CACHE__;
        if (cache && typeof cache.resetRange === 'function') {
          cache.resetRange(${argLiteral});
          return true;
        }
        return false;
      };

      if (tryReset(window)) return true;

      for (const frame of Array.from(document.querySelectorAll('iframe'))) {
        try {
          if (tryReset(frame.contentWindow)) return true;
        } catch {
          // cross-origin frames are skipped
        }
      }

      return false;
    })()
  `, () => {
    // Result intentionally ignored. The next poll tick will repopulate
    // tracked min/max from fresh audio blocks.
  })
}

function requestProducerClampRange(min, max, source) {
  // Force the producer's held tracked min/max to the given range. Used when
  // the panel pins a source to Audio [-1..1] mode so the next audio block
  // cannot expand the range back out.
  const minLiteral = Number(min)
  const maxLiteral = Number(max)
  if (!Number.isFinite(minLiteral) || !Number.isFinite(maxLiteral)) return
  const sourceLiteral = typeof source === 'string' ? `, ${JSON.stringify(source)}` : ''
  chrome.devtools.inspectedWindow.eval(`
    (() => {
      const tryClamp = (w) => {
        const cache = w && w.__ELEMAUDIO_DEBUG_CACHE__;
        if (cache && typeof cache.clampRange === 'function') {
          cache.clampRange(${minLiteral}, ${maxLiteral}${sourceLiteral});
          return true;
        }
        return false;
      };

      if (tryClamp(window)) return true;

      for (const frame of Array.from(document.querySelectorAll('iframe'))) {
        try {
          if (tryClamp(frame.contentWindow)) return true;
        } catch {
          // cross-origin frames are skipped
        }
      }

      return false;
    })()
  `, () => {
    // Panel reconciles its own state right after calling this, so the
    // eval result is intentionally ignored.
  })
}

function toggleSelectedSourceMode() {
  if (!selectedSource) return

  const currentMode = sourceModes.get(selectedSource) ?? 'audio'
  const nextMode = currentMode === 'auto' ? 'audio' : 'auto'
  sourceModes.set(selectedSource, nextMode)

  const slot = sources.get(selectedSource)

  if (nextMode === 'auto') {
    // Entering adaptive mode always resets tracked extremes so the range
    // re-seeds cleanly from whatever the signal is doing right now.
    sourceRanges.delete(selectedSource)
    lastSeenBySource.delete(selectedSource)

    if (slot?.latest) {
      slot.latest = { ...slot.latest, trackedMin: undefined, trackedMax: undefined }
    }

    requestProducerResetRange(selectedSource)
  } else {
    // Returning to Audio mode pins the source's tracked range to [-1, 1]
    // on both sides, then immediately polls the cache so the readout
    // reflects the clamp without waiting for the next 50ms tick.
    sourceRanges.set(selectedSource, { min: -1, max: 1 })
    lastSeenBySource.delete(selectedSource)

    if (slot?.latest) {
      slot.latest = { ...slot.latest, trackedMin: -1, trackedMax: 1 }
    }

    requestProducerClampRange(-1, 1, selectedSource)
    pollCache()
  }

  syncModeToggleLabel()
  renderSelectedSource()
}

function requestReconnect() {
  // User-intent reset: wipe all per-source modes and tracked ranges on both
  // the panel and the producer, then pull fresh state.
  sourceModes = new Map(Array.from(sources.keys(), (source) => [source, 'audio']))
  sourceRanges = new Map(Array.from(sources.keys(), (source) => [source, null]))
  lastSeenBySource = new Map()

  requestProducerResetRange(undefined)
  syncModeToggleLabel()

  pollCache()
}

function pollCache() {
  if (!bridgeConnected) {
    setStatus('waiting for inspected page debug cache')
  }

  if (!sources.has(selectedSource) && sourceSelect.options.length > 0) {
    selectedSource = sourceSelect.options[0].value
    sourceSelect.value = selectedSource
    syncModeToggleLabel()
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
  pollCache()
}, POLL_INTERVAL_MS)

syncModeToggleLabel()
pollCache()
