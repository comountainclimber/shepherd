# Direction review evidence

These are fresh captures of the unchanged concepts served from this worktree on port 5198, plus a temporary specimen used to inspect the new brand assets. The specimen was removed after review; it was not a launch page implementation.

The browser tool reported that its access host was unavailable. Every capture here used `SHEPHERD_LOOK`, was copied immediately into this directory, and was opened for visual inspection. The helper reported no page errors. The written assessment is in [BRIEF.md](../BRIEF.md).

## Full pages

- Precise: [1440px](precise-1440.png), [390px](precise-390.png).
- Flock: [1440px](flock-1440.png), [390px](flock-390.png).
- Live: [1440px](live-1440.png), [390px](live-390.png).
- Shared SVGs, local type and palette on light/dark surfaces: [1440px](brand-1440.png), [390px](brand-390.png).

Live's [first mobile capture](live-initial-390.png) ends at the closing heading. The lazy images have no declared dimensions. The complete mobile capture above was taken after clicking the second product image to bring it into view and waiting 500ms, then capturing the full page. This observation is included in the brief's implementation requirements.

## Interactions

- Precise: [desktop Checks](precise-checks-1440.png), [phone Outline](precise-outline-390.png), [phone Checks](precise-checks-390.png), [copy feedback](precise-copy-390.png).
- Flock: [phone Checks](flock-checks-390.png), [sheep greeting](flock-pet-390.png), [copy feedback](flock-copy-390.png).
- Live: [copy feedback](live-copy-390.png), [hero after 6.5 seconds](live-later-1440.png). Its CSS animation changes progress, position and opacity; the status copy itself stays fixed.

These images verify rendered states and visible feedback. They do not establish keyboard behavior, screen-reader output, clipboard contents, real agent execution or a complete accessibility audit. The brief also draws on reading each concept's HTML, CSS and JavaScript, the app's sheep geometry, setup and check documentation, and the original product screenshots.

## Reproduce the concept views

From the repository root, with dependencies installed:

```sh
npx vite site --host 127.0.0.1 --port 5198 --strictPort
```

In another terminal:

```sh
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/precise/ --width 1440 --full
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/precise/ --width 390 --full
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/precise/ --width 390 --click '#tab-checks'
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/flock/ --width 1440 --full
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/flock/ --width 390 --full
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/flock/ --width 390 --click '.pet'
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/live/ --width 1440 --full
node "$SHEPHERD_LOOK" http://localhost:5198/concepts/live/ --width 390 --click '.screen:nth-child(2) img' --wait 500 --full
```

Copy each resulting PNG immediately if keeping it, since the helper retains only the latest captures for the step. Product screenshots in `docs/screenshots/` and these review captures are separate: the final page must not load this evidence directory.
