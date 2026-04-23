import './style.css'

document.querySelector('#app').innerHTML = `
  <main class="landing-shell">
    <section class="landing-card">
      <p class="eyebrow">Extension Scaffold</p>
      <h1>elemaudiors-devscope</h1>
      <p class="lead">
        Browser DevTools panel for elemaudio-rs debug scope events.
      </p>
      <div class="checklist">
        <div class="check-item"><code>public/manifest.json</code> defines the extension</div>
        <div class="check-item"><code>devtools.html</code> registers the custom panel</div>
        <div class="check-item"><code>panel.html</code> renders a mock sparkline inspector</div>
      </div>
      <div class="cta-row">
        <a class="panel-button" href="/panel.html">Open panel preview</a>
      </div>
    </section>
  </main>
`
