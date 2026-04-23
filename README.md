# elemaudiors-devscope

DevTools panel for live `elemaudio-rs` debug scope events.

A scope for debugging signals compatible with Elementary.js and Elemaudiors.

This extension does not inspect arbitrary `NodeRepr_t` graphs after the fact.
It only renders signals that the page explicitly taps with `scope` or `frameScope`
and forwards through the page bridge.

## Current Status

- Custom DevTools panel is wired
- Mock sparkline fallback is wired
- Live page bridge is wired
- `elemaudio-rs` Preset Bank Synth demo is instrumented for real signals

## Build

```bash
npm install
npm run build
```

The extension bundle is written to `dist/`.

## Load In Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repo `dist/` directory

After that, open DevTools on a page that publishes `elemaudio.debug` messages.
The panel name is `elemaudio`.

## Bridge Contract

The extension listens for page messages with this envelope:

```js
window.postMessage({
  source: 'elemaudiors-devscope',
  type: 'elemaudio.debug',
  event: {
    schema: 'elemaudio.debug',
    version: 1,
    kind: 'scope',
    mode: 'stream',
    source: 'preset-synth:voice',
    timestampMs: performance.now(),
    channels: [[0, 0.2, -0.1]],
  },
}, '*')
```

The current `elemaudio-rs` web demos forward `scope` events through the shared
demo harness, so instrumented demos do not need custom bridge code per page.

## How To Use With `elemaudio-rs`

1. Add a named tap in the DSP graph:

```ts
const tapped = el.scope({ name: 'preset-synth:voice' }, voice)
const root = el.add(voice, el.mul(0, tapped))
```

For exact frame captures, use `frameScope` instead:

```ts
const frameTap = el.extra.frameScope(
  { name: 'preset-synth:activeScope', framelength: 8 },
  activeFrame,
)
```

2. Keep the tap alive in the rendered graph with `mul(0, tapped)`.

3. Open the page, then open DevTools and switch to the `elemaudio` panel.

4. Pick the signal name from the source selector.


## Notes

- The panel currently shows the first channel of each scope event as a sparkline.
- The raw event payload is shown below the plot.
- `frameScope` events are transported through the same bridge and rendered the
  same way for now.

## Next Likely Work

- Real tab/session labels in the panel
- Source grouping and search
- Better handling for multi-channel scope events
- Freeze-history comparison between successive events
