# elemaudiors-devscope

DevTools panel for live `elemaudiors` or `elementary.js` signal node debugging.

This extension allows to inspect arbitrary `NodeRepr_t` signals from a live graph.
It only renders signals that the page explicitly taps and forwards through a page-side bridge.

## Current Status

- Custom DevTools panel is wired
- Live page bridge contract is documented

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

After that, open DevTools on a page that publishes `window.__ELEMAUDIO_DEBUG_CACHE__`.
The panel name is `elemaudiors`.

## Bridge Example

The current panel reads `window.__ELEMAUDIO_DEBUG_CACHE__` from the inspected page.
See `bridge-example.js` in this repo for the minimal page-side contract.

## How To Use With `elemaudiors` and `elementary.js`

1. Add a named tap in the DSP graph:

```ts
const tapped = el.scope({ name: 'preset-synth:voice' }, voice)
const root = el.add(voice, el.mul(0, tapped))
```

2. Keep the tap alive in the rendered graph with `mul(0, tapped)`.

3. Open the page, then open DevTools and switch to the `elemaudiors` panel.

4. Pick the signal name from the source selector.


## Notes

- The panel currently shows the first channel of each scope event as a sparkline.
- The raw event payload is shown below the plot.
- `el.extra.frameScope` events,  extended scopes for frame-synched programming in `elemaudiors` (not available in `Elementary.js`) ,  are transported through the same bridge and rendered the same way.
