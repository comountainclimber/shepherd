# Launch page

A static site. Serve this directory directly; no install or build is needed:

```sh
python3 -m http.server 5199 --bind 127.0.0.1 --directory site
```

Open `http://localhost:5199/`. All fonts, artwork, scripts and images are local. The real product screenshots are copied unchanged from `docs/screenshots/`; the page discloses their fictional Slice project and sample results. Font licenses are in `assets/fonts/`.

## Repository destination

`package.json` → `repository.url` is the source of truth. After replacing the repository owner there, refresh the checked-in HTML links with:

```sh
node site/scripts/sync-repository.mjs
```

The page's links also work without JavaScript. The Pages workflow refreshes them from the package automatically. It inserts the deployed Pages address into the Open Graph image URL and canonical metadata in the staged artifact, so the page needs no hard-coded public hostname.

## Social images

`social.html` is the self-contained source for both previews. They were captured with Shepherd's screenshot helper and copied directly, without resizing:

```sh
node "$SHEPHERD_LOOK" http://localhost:5199/social.html --width 1200 --height 630
node "$SHEPHERD_LOOK" http://localhost:5199/social.html --width 1280 --height 640
```

Copy the printed PNGs to `open-graph.png` and `github-social.png`, respectively. The repository owner can upload `github-social.png` under GitHub's repository social-preview settings. This step does not create a repository or change its settings.

## Verification

Open `http://localhost:5199/tests/` for the dependency-free browser checks. These exercise default and selected screenshot sources, alt text, full-size links, keyboard tabs, both clipboard outcomes, FAQ disclosures, local resource requests, 44px targets, narrow layouts, doubled text, no-script content and authored text/control contrast. A failed check also logs a page error. The clipboard cases use a stub; the native successful copy was separately clicked and captured.

```sh
node "$SHEPHERD_LOOK" http://localhost:5199/tests/ --width 1024 --height 1800 --full --wait 2500
npx tsc -b && npx vitest run && npm run build
```

Final evidence is in `shots/`: 1440px, 1024px and 390px page captures, the wide hero, copy feedback, product Checks, FAQ and browser-check results. The screenshot helper caps a full-page capture at 8000px. `launch-390.png` joins that capture with the overlapping footer capture at the original scale (1272px overlap, maximum channel difference 2/255); `launch-390-top.png` preserves the raw first capture. The complete image includes the footer. The browser access host was unavailable, so these captures use Shepherd's helper.

The complete page, after requesting every mobile and desktop screenshot variant, measured about 1.22 MB in browser resource body bytes, all same-origin. The staged Pages artifact, including both social images, is about 1.44 MB. The workflow fails if that artifact reaches 2 MB. Evidence and experiments are excluded from the published artifact.

## Pages

`.github/workflows/pages.yml` publishes on pushes to `main`, and supports a manual run. In repository settings, enable Actions and select **GitHub Actions** under **Pages → Build and deployment → Source**. Permit the workflow to deploy to the `github-pages` environment and allow `main` in that environment's deployment branch rules. The workflow comments repeat these requirements.

Only the static launch files are staged. Concepts, editorial review captures, final screenshots, verification scripts, tests, this document and the creative brief are excluded. The exact staging command was exercised locally, including metadata substitution, exclusions and the size check. Hosted deployment will happen only when the owner configures the repository and runs the workflow.
