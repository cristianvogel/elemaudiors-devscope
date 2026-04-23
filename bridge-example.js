// Minimal page-side bridge for elemaudiors-devscope.
//
// This is the contract the DevTools panel reads from the inspected page:
// - window.__ELEMAUDIO_DEBUG_CACHE__.bridgeReady
// - window.__ELEMAUDIO_DEBUG_CACHE__.updatedAt
// - window.__ELEMAUDIO_DEBUG_CACHE__.eventsBySource
// - window.__ELEMAUDIO_DEBUG_CACHE__.resetRange(source?)
// - window.__ELEMAUDIO_DEBUG_CACHE__.clampRange(min, max, source?)

const devtoolsScopeCache = new Map()
const devtoolsScopeRanges = new Map()
const devtoolsScopePinned = new Set()
const devtoolsScopeSeq = new Map()

function syncDevtoolsCacheToWindow() {
  window.__ELEMAUDIO_DEBUG_CACHE__ = {
    bridgeReady: true,
    updatedAt: performance.now(),
    eventsBySource: Object.fromEntries(devtoolsScopeCache.entries()),
    resetRange,
    clampRange,
  }
}

function resetRange(source) {
  if (typeof source === 'string' && source.length > 0) {
    devtoolsScopeRanges.delete(source)
    devtoolsScopePinned.delete(source)
    const cached = devtoolsScopeCache.get(source)
    if (cached) {
      devtoolsScopeCache.set(source, { ...cached, trackedMin: undefined, trackedMax: undefined })
    }
    syncDevtoolsCacheToWindow()
    return
  }

  devtoolsScopeRanges.clear()
  devtoolsScopePinned.clear()
  for (const [key, cached] of devtoolsScopeCache.entries()) {
    devtoolsScopeCache.set(key, { ...cached, trackedMin: undefined, trackedMax: undefined })
  }
  syncDevtoolsCacheToWindow()
}

function clampRange(min, max, source) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return

  const apply = (key) => {
    devtoolsScopeRanges.set(key, { min, max })
    devtoolsScopePinned.add(key)
    const cached = devtoolsScopeCache.get(key)
    if (cached) {
      devtoolsScopeCache.set(key, { ...cached, trackedMin: min, trackedMax: max })
    }
  }

  if (typeof source === 'string' && source.length > 0) {
    apply(source)
  } else {
    for (const key of devtoolsScopeCache.keys()) apply(key)
  }

  syncDevtoolsCacheToWindow()
}

export function pushScopeEvent(event) {
  if (!event || typeof event.source !== 'string' || !Array.isArray(event.channels)) return

  const currentSeq = (devtoolsScopeSeq.get(event.source) ?? 0) + 1
  devtoolsScopeSeq.set(event.source, currentSeq)

  const firstChannel = event.channels[0]
  let blockMin = Number.POSITIVE_INFINITY
  let blockMax = Number.NEGATIVE_INFINITY
  if (Array.isArray(firstChannel)) {
    for (const value of firstChannel) {
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      if (n < blockMin) blockMin = n
      if (n > blockMax) blockMax = n
    }
  }

  const held = devtoolsScopeRanges.get(event.source)
  const pinned = devtoolsScopePinned.has(event.source)
  let trackedMin = held?.min
  let trackedMax = held?.max

  if (pinned && held) {
    trackedMin = held.min
    trackedMax = held.max
  } else if (Number.isFinite(blockMin) && Number.isFinite(blockMax)) {
    const nextMin = held ? Math.min(held.min, blockMin) : blockMin
    const nextMax = held ? Math.max(held.max, blockMax) : blockMax
    trackedMin = Math.min(nextMin, -1)
    trackedMax = Math.max(nextMax, 1)
    devtoolsScopeRanges.set(event.source, { min: trackedMin, max: trackedMax })
  }

  devtoolsScopeCache.set(event.source, {
    schema: 'elemaudio.debug',
    version: 1,
    kind: 'scope',
    mode: 'stream',
    sessionId: location.pathname,
    graphId: `${location.pathname}:${event.source}`,
    source: event.source,
    seq: currentSeq,
    sampleRate: event.sampleRate,
    channelCount: Array.isArray(event.channels) ? event.channels.length : 0,
    channels: event.channels,
    trackedMin,
    trackedMax,
    blockMin: Number.isFinite(blockMin) ? blockMin : undefined,
    blockMax: Number.isFinite(blockMax) ? blockMax : undefined,
  })

  syncDevtoolsCacheToWindow()
}

syncDevtoolsCacheToWindow()
