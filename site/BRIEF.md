# Shepherd launch direction

## Decision

Use **precise** as the base. Keep its dark product frame, clear install command, quiet typography, real screenshots and direct explanation. Make it warmer and more recognizably Shepherd with wool, sage and the app's own sheep. Tell the story in the order **plan → run → check → merge**.

The organizing idea is **a clear place in a long task**. A visitor should understand the tool before noticing the brand's joke. The screenshot is the main illustration; the sheep is the signature. The page and README must use the same introduction, command, example project, screenshots and boundaries.

This is a direction and copy handoff. The concepts remain experiments; this step does not implement the launch page or rewrite the README.

## Independent concept review

I served all three pages on port 5198 and opened their supplied screenshots and fresh full-page captures at 1440 and 390 pixels. I also clicked the product tabs and copy controls in precise and flock, flock's sheep, and live's copy control, and inspected live later in its animation. The browser access host was unavailable, so these observations use Shepherd's screenshot helper. Captures logged no page errors. Evidence is in [review/](review/). These are editorial judgments, not a measured five-second user study or a complete accessibility audit.

### Precise: the best foundation

- **Five-second clarity:** “Long tasks. Clear next steps.” is followed immediately by what the app does, where it runs, and Codex and Claude Code. The command and GitHub action are easy to find at both widths. The headline alone is broad; the explanatory sentence must stay visible beside it.
- **Engineer credibility and honesty:** the large real map, outline and checks are the strongest product evidence of the three. The screenshot tabs work; the mobile Checks view exposes the real command result. The local section distinguishes agent services from Shepherd. However, the feature prose does not explain that checks are optional, and “Linux works” is stronger than the agreed macOS-first support boundary. Fix those claims in final copy below.
- **Beauty and distinction:** excellent spacing, restrained chrome and consistent type let the app feel carefully made. The near-black palette, blue button and six-cell feature grid could belong to many developer products. The tiny sheep in the footer is the only memorable signature. Warm the palette and make the sheep recognizable without giving it the hero.
- **Phone:** the command stays intact and the layout stacks cleanly. The default map is a scrollable crop that loses the task context and rightmost work; the later tabs use scripted scroll offsets. This asks a visitor to explore before understanding. Default to the real phone outline, show complete images, and provide an explicit full-size map link. Replace the tall stack of six feature cards with four short workflow paragraphs.
- **Accessibility and weight:** a skip link, explicit focus styles, keyboard tab handling, polite copy feedback and reduced-motion CSS are good foundations. Many captions are only 8–11px; raise them. Essential content must not depend on cropped screenshot text. Static source and assets total about **900 KB**, including both local fonts and licenses, excluding review captures. Muted body text is approximately 8:1 against its background; that does not establish that every UI state passes AA.

### Flock: the strongest personality

- **Five-second clarity:** the supporting paragraph is accurate and the command is prominent. “Big plans. Little flock.” is memorable but does not tell a new visitor that this is a local coding-agent app. Two introductory paragraphs and the pasture compete for the same attention.
- **Engineer credibility and honesty:** the actual app and the statement that agents still contact their services are persuasive. “A confident agent isn’t a test suite” identifies the audience's pain well. The product is below a substantial illustration on desktop and even farther down on a phone; the mascot earns more immediate attention than the evidence. “Everyone knows where they’re going” also sounds more certain than software can promise.
- **Beauty and distinction:** the cream paper, forest ink, hand-drawn path and sheep have a cohesive, ownable voice. The yellow frame connects neatly to the app's Run button. But sheep, crook, sun, flowers, laptop, principles strip and pastoral headings repeat the metaphor until it becomes the subject. The header sheep and full illustrated sheep also differ from the existing app silhouette.
- **Phone:** the command fits and the default Outline tab is a much better first view than a cropped desktop map. The real 390px checks image is used after a click. The large pasture and extra ownership strip postpone the product; the full phone screenshot then adds considerable height. Keep the responsive image choice, shorten the route to it, and put the full-size action outside the image so it cannot cover the Run control.
- **Accessibility and weight:** skip navigation, keyboard tabs, focus styling, copy fallback, a named sheep button and reduced-motion rules are thoughtful. Main muted copy is approximately 5.8:1 on paper. Small annotations remain hard to read. The continuous sheep animation has no pause control and provides no essential information; make it static. Static source and assets total about **825 KB**, excluding review captures, with no font download.

### Live: the clearest narrative, the weakest proof

- **Five-second clarity:** “Big agent work. In sight.” and the nearby Codex/Claude Code paragraph make a strong compact introduction. Plan, run, check and merge give the page a clear reading order. It should explicitly call Shepherd an app.
- **Engineer credibility and honesty:** the hero resembles a working interface, but it is HTML illustration with fixed status text, looping progress and opacity changes. It does not actually demonstrate a step failing, receiving a verdict and succeeding. “Caught drift · retrying” stays written on the card. The visible page does not label this as a simulation, and it can imply automatic checking is always on. The real screenshots arrive much later and are much smaller than the invented interface. Do not use this hero for launch.
- **Beauty and distinction:** the paper/green palette, italic headline and restrained layout are attractive; the four-part story is easy to scan. The hero's tilted window and soft shadows feel more like a product rendering than the app. It also introduces another sheep design. Keep the story, not this additional interface or identity.
- **Phone:** the miniature reflows impressively and its short card labels stay legible. The actual desktop screenshots are simply shrunk to phone width, so the detailed checks cannot be read. The four workflow columns become two narrow columns; use one readable column instead. The first mobile full-page capture ended in the closing heading because the lazy images had no intrinsic dimensions; after bringing the images into view and capturing again, the footer was present. Reserve image space explicitly.
- **Accessibility and weight:** it respects reduced motion but has no pause control for its repeating 12-second animation, no skip link or authored focus treatment, and no live announcement of copy success. Some 9–10px status text is particularly weak: “Up next” is about 3.6:1 on white. Static source and assets total about **394 KB**, excluding captures. Low weight is a virtue, but does not make the illustrated claims trustworthy.

### Exactly what to carry forward

1. **From precise:** the page skeleton, Geist and Geist Mono, restrained dark framing, install-command treatment, screenshot-first hierarchy, keyboard product-view controls, copy feedback and local/open-source facts. Keep its tagline. Remove the fake extra window title bar and screenshot status counters: the real screenshot already supplies that context. Replace the six-card grid with the four-part story below.
2. **From flock:** wool and green warmth, the plainspoken concern behind “done deserves a check,” the 390px image sources, the Outline default on a phone, and one small sheep/path moment at the closing command. Use the app's side-facing sheep as the single shared mascot; do not reuse the front-facing sheep, bandana, landscape, yellow screenshot surround, pet button, multiple pastoral slogans or principles strip.
3. **From live:** exactly the order **Plan it. Run it. Check it. Merge it.** and its separation of working from checking and handing off. Express this with real product images and text. Do not take the simulated hero, italic serif, looping state changes, extra sheep or green screenshot gallery.

## Shared launch identity

**Name:** Shepherd. Use title case in prose and navigation. The package is `shepherd-agents`; it installs the `shepherd` command. Do not rename the app to match the package.

**Tagline:** Long tasks. Clear next steps.

**One-line pitch:** Shepherd is a free, open-source app that runs on your machine to plan, run and check long coding-agent work with Codex and Claude Code.

**Audience question:** “Where exactly am I in this big agent task?” Answer it with the outline, map, timeline and checks, rather than promises about autonomous development.

**Voice:** a calm developer explaining a useful tool to another developer. Short sentences, concrete verbs, second person. Warm enough to have a sheep; precise enough to say what a check actually establishes. One quiet sheep reference at the end is enough. No “AI workforce,” “orchestration platform,” “10×,” guaranteed correctness, invented testimonials, customer logos, usage counts, star counts or claims that a demo run happened. Cursor is an editor the audience may use, not a third agent Shepherd runs. Use the product's terms: projects, tasks, steps, the outline, the map, checks, Done when, the timeline and merge requests.

## Final page order and copy

Quoted text below is the final visible copy. Layout notes are instructions, not additional marketing prose. Do not add another slogan between sections.

### 0. Navigation

Sheep and **Shepherd** at the left. Links: **How it works**, **Docs**, **GitHub**. How it works targets section 3. Docs goes to the repository README. On phones retain Docs and GitHub; the workflow link can be omitted. Include **Skip to content** as the keyboard skip link.

### 1. Hero

Eyebrow: **Local app · Free and open source**

Headline, with a deliberate break after the first sentence:

> Long tasks.
> Clear next steps.

Body, exactly the shared pitch:

> Shepherd is a free, open-source app that runs on your machine to plan, run and check long coding-agent work with Codex and Claude Code.

Primary action: selectable `npx shepherd-agents` with a **Copy** button. Accessible button name: **Copy install command**. Success label: **Copied**. Polite status: **Copied. Paste it into your terminal.** If clipboard access fails: **Select and copy: npx shepherd-agents**. Select the command for manual copying and leave it visible. Copy only the command, without `$`, comments or whitespace.

Secondary action: **Star on GitHub**. Small setup link: **Setup requirements** → section 5.

Requirements immediately beneath the command, not hidden in the footer:

> macOS first · Node.js 22.12+ · Git
> Codex or Claude Code installed and signed in.

Keep the command within the first 600 vertical pixels at 390px wide. Do not put a mascot scene between the explanation and the product. At 1440px, the real screenshot should begin within the first 800px.

### 2. The product, immediately after the hero

Headline:

> Know where the work stands.

Body:

> See what's done, what's running and what needs you. Open a step for its instructions, progress and checks.

Persistent, visible disclosure beside the image:

> Real app. Fictional Slice project. Run notes and results are sample data.

Three controls: **The map**, **The outline**, **Checks**. Default to The map above 600px and The outline at 600px and below. Respect the visitor's selection after that; do not rotate tabs automatically.

Captions for each view:

- Map: **Eight steps. Four done, two running, review and a merge request still ahead.**
- Outline: **The plan stays visible, one step at a time.**
- Checks: **A command result and a separate review against the step.**

Image action: **Open full-size screenshot**. Keep it outside the picture. It opens the matching source image, including the mobile image on phones. Also provide **Open the full map** on phones, linking to the desktop map. No scrollable image window or preselected crop; images expand to their natural aspect ratio.

The phone outline capture shows the task and outline, not the open Done when inspector. Do not caption it as though that inspector is present.

### 3. How it works

Headline:

> A plan you can follow through.

Intro:

> Keep projects organized into tasks, and tasks into steps. Give each step a clear request, someone to do it and a way to check the result.

Use four ordered paragraphs, not six equal cards. At wide widths they can form a compact four-column row; on phones they form one column. Show the timeline image after these paragraphs, followed by the checks image and its explanation. Product evidence should be larger than decorative diagrams.

**01 / Plan it.**

> Write steps in the outline, or let Codex draft them from your goal. Assign each step to Codex, Claude Code or yourself. Add Done when items so the request has a clear finish.

**02 / Run it.**

> The map shows which steps wait and which can run side by side. Each task has its own branch and folder. The timeline records progress notes, commands, checks and changed files so you can pick up where you left off.

**03 / Check it.**

> An agent saying “done” is a starting point. Add a command check, ask Codex to check the work against the step, or ask to review it yourself. Read the results before moving on.

**04 / Merge it.**

> Accepted steps collect in the task's branch. Add an “Open a merge request” step to prepare the handoff. Review the changes before bringing the task into its base branch.

Timeline image caption:

> Pick up the thread in the timeline: notes, commands and changed files, in order.

Checks image headline:

> Give “done” a definition.

Checks image caption:

> The command passed. Codex also reviewed the work against this step's four Done when items.

Explanation beneath that image:

> Checks are optional. “Check the work against this step” uses a separate Codex run, even when Claude Code wrote the code. Agent progress marks and check results are different things. A passing check is evidence to review, not a guarantee that the work is correct.

Put this explanation next to the evidence, not only in a FAQ. Link **How checks work** to the README's optional-checks documentation. Do not animate a universal drift detector or imply that writing Done when items automatically enables work checks.

### 4. Local and open source

Headline:

> Your machine. Your agents. Your work.

Body:

> Shepherd runs the real Codex and Claude Code with your own logins, repositories, connectors and skills.
>
> Nothing goes to a Shepherd server: there is no hosted Shepherd service. No Shepherd account, hosted database or telemetry. Your agents, connectors, commands and git remotes can still contact services using your own configuration.
>
> Shepherd is free and open source under the MIT license. Agent usage follows your provider's plan.

Link: **Explore the source**.

No new illustration is needed here. A small local-machine icon is sufficient. “No server” means no hosted service; Shepherd does start a local process and opens its interface in your browser. Do not imply offline agents, free model usage, or a security boundary around agent actions.

### 5. Start

Headline:

> Give your next big task a clear path.

Body:

> Start Shepherd, choose a project and write your first steps.

Repeat the same command and copy interaction: `npx shepherd-agents`.

Requirements, visible by default:

> Requires Node.js 22.12+, Git, and Codex or Claude Code installed and signed in. Drafting steps and checking work against a step require Codex.
>
> macOS first. Linux should work where no Mac-only feature is needed; those features are unavailable there. Windows is not supported yet.
>
> Shepherd opens in your browser. Keep its terminal running while you work.

Links: **Read the setup docs** and **Star on GitHub**.

One small sheep resting along a simple step path above this block. No invented task status or endlessly walking flock. Optional quiet line under the links:

> A little structure. A lot less herding.

### 6. Footer

Sheep mark with **Shepherd**. Links: **GitHub**, **Docs**, **Contributing**, **License**.

Copyright:

> MIT · © The Shepherd authors

## Art direction and shared assets

### Colors

The base remains dark. Use flat fills and structural borders, with no colored glow behind the app. The warmth is in the wool/sage colors and language, not a second illustrated landscape.

- **Field `#101412`:** page background; dark text on wool buttons.
- **Surface `#181E1A`:** command and product surrounds.
- **Wool `#F3F0E5`:** primary text, wordmark on dark, primary copy-button fill.
- **Muted `#ABB7AE`:** supporting text on Field, about 8.9:1 contrast.
- **Sage `#98C4A2`:** links, focus and small accents on Field, about 9.5:1.
- **Amber `#E3B875`:** a rare human-attention cue, never a second general accent.
- **Line `#39473E`:** decorative separators only. Controls needing a visible boundary use `#708775` and a visible focus ring.
- **Forest `#243E34`:** wordmark and outline on light backgrounds. On Wool it is about 10.1:1. Do not use Forest as body text on Field.

Wool against Field is about 16.3:1. These are calculated token pairs, not blanket approval of every combination. Keep real screenshot colors unchanged. Status always has a word or icon as well as color. README uses GitHub's native foreground/background, with the appropriate logo variant.

### Type and spacing

Use the supplied **Geist** variable font for page text and **Geist Mono** for commands and small workflow numbers. These are the local Latin subsets already used by precise. Shared files and their SIL Open Font licenses are in [../docs/brand/fonts/](../docs/brand/fonts/). Self-host them; no remote fonts. Use `font-display: swap` and system sans/monospace fallbacks. Keep body text at 16–18px with 1.6 line height, headings around 72px desktop / 44px phone, and captions at least 14px. The install command may be 13px at narrow widths to preserve the exact command. Avoid all-caps 8px decoration.

Max content width 1160px. Use roughly 80px between desktop sections and 48px on phones, with 20px phone gutters. Headline weight 550–600; body 400–450. Tighten heading tracking moderately, never until letters touch. The wordmark is supplied as fixed vector outlines; do not retype it or require a viewer to have a font installed. GitHub README keeps native Markdown type.

### Logo and mascot

Canonical files are in [../docs/brand/](../docs/brand/):

- `logo.svg`: Forest wordmark for light surfaces, with sheep badge.
- `logo-dark.svg`: Wool wordmark for dark surfaces, with the same sheep badge.
- `mark.svg`: square sheep badge for favicon, small repository use and compact navigation.
- `mascot.svg`: transparent sheep for larger illustrations.
- `tokens.css`: shared palette and font declarations for the site builder.
- `README.md`: asset usage, provenance and accessibility guidance.

The sheep keeps the app's side-facing silhouette: five overlapping wool circles, two visible legs, oval head, tilted ear and one eye. Wool and sage add warmth; a fine Forest outline keeps it recognizable on light paper. Do not introduce a second mascot, clothing, a crook or faces for each agent provider. It is a guide along the map, not a claim that agents are obedient or correct.

Use the badge at 24px or larger; lockup at 144px or larger. Give a lockup at least half a badge's width of clear space. Use the mascot at 48–96px in the closing path; do not enlarge it into a second hero. Keep SVG proportions and colors. Never tint, redraw, stretch, rotate the lockup or attach provider logos to the sheep. Decorative instances have empty alt text; a standalone home logo has accessible name “Shepherd”. Do not announce the same word twice beside visible brand text.

For launch, the mascot is static. If motion is added later, a single brief walk may respond to a deliberate action; the content must remain understandable at rest, and reduced motion disables the walk. No continuous decoration, hover-only content or fake running indicator.

## Screenshot plan

Use files from [../docs/screenshots/](../docs/screenshots/) as the single source, not derivatives from a concept. All depict the fictional Slice project with seeded sample results, as documented in that directory. Do not represent a passing sample result as launch validation or a customer run. Keep the same example throughout both launch surfaces.

1. **Product explorer, The map:** `task-map-desktop.png` (1440 × 1000). Default desktop hero evidence. Alt: “Shepherd's Slice task map, with eight connected steps: four done, two running, and review and a merge request waiting.” On phones offer it at full size through the explicit map link rather than forcing a crop.
2. **Product explorer, The outline:** `task-outline-desktop.png` (1440 × 1500) and `task-outline-mobile.png` (390 × 1000) at 600px and below. Default phone evidence. Desktop alt: “The outline beside Handle payment retries, with two of four Done when items marked met.” Mobile alt: “Slice's task outline: eight steps, four done, two running and two waiting.” These are different real app views, so update alt text with the selected source.
3. **Product explorer, Checks, and the checks explanation:** `step-checks-desktop.png` (1440 × 1200), paired with `step-checks-mobile.png` (390 × 1300). Alt: “Build the Apple Pay button: twelve tests passed and a separate Codex review marked four Done when items met.” This section can reuse the same file without a duplicate download. Keep the command and verdicts visible, not clipped to the green Passed badge.
4. **After the four workflow paragraphs:** `step-output-desktop.png` (1440 × 1250), paired with `step-output-mobile.png` (390 × 1400). Alt: “Handle payment retries: the timeline records progress notes, Done when marks and a completed command; the step is still running.” This shows activity is not the same as completion.
5. **Merge paragraph:** no new screenshot. The map already contains the pending merge request step. Do not invent a GitHub merge request screenshot. Mention the handoff in text.

Use full-width responsive images with explicit dimensions/aspect ratios, no CSS zoom, skew or decorative crops. Keep images intact, with captions outside. Lazy-load below-fold images while reserving their space; eager-load the first chosen product image. Provide adjacent text for the important facts so essential meaning does not depend on reading screenshot pixels. Do not load both mobile and desktop image sources unnecessarily. Avoid duplicating the map below every feature. The remaining screenshots belong in docs, not a ten-image launch gallery.

## README: the same launch, adapted to GitHub

Keep a single `# Shepherd` heading for text search and accessibility. Put the light/dark SVG lockup beside or immediately above it at about 260px wide, using a `<picture>` with GitHub's color-scheme selection and `logo.svg` as the fallback. Use `alt=""` when the adjacent heading already names Shepherd. Then use this exact introduction:

> **Long tasks. Clear next steps.**
>
> Shepherd is a free, open-source app that runs on your machine to plan, run and check long coding-agent work with Codex and Claude Code.
>
> See what's done, what's running and what needs you. Keep the plan, progress and checks with the task.

Place a **Start Shepherd** heading and the fenced `sh` command `npx shepherd-agents` immediately after that introduction, before any large image. GitHub supplies its own code-copy button. Follow it with the same requirements from page section 5, including the Codex-only drafting/work-check boundary and platform limits. Preserve the useful existing setup details about the local address, terminal lifecycle and authenticated token; do not bury the one-command start inside them.

Then use this order:

1. **See the work:** `task-map-desktop.png`, full width, with the same visible sample-data disclosure and map caption as the page. Use a `<picture>` source for `task-outline-mobile.png` at 600px and below; describe both views in the fallback image alt. Do not rely on tabs, CSS, JavaScript or a screenshot carousel in Markdown.
2. **How it works:** the same four Plan it / Run it / Check it / Merge it paragraphs from section 3. Add the same timeline image and its caption using the mobile/desktop sources above.
3. **Give “done” a definition:** the same checks image, caption and optional-check explanation. Keep the existing detailed Optional checks reference and stable links to it; editing marketing prose must not erase operational limits such as retries or the meaning of “can't tell”.
4. **Your machine. Your agents. Your work.** Reuse section 4 verbatim. Link to `SECURITY.md` for the trust model. Preserve clear warnings about commands running with the user's permissions and keeping the token address private in the setup/security documentation.
5. **Documentation**, **Contributing**, **License:** link existing useful setup, usage and implementation reference material, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and `LICENSE`. Keep the detailed current documentation as reference, using a clear contents list or collapsible details where needed. Close the license section with **MIT · © The Shepherd authors**.

Use the same static mascot only once near the README's closing links, if it adds clarity. No decorative badge wall, GIF, fake star counter, colored headings, pricing, sign-up, waitlist or demo booking. GitHub already has the star control; the README need not tell a visitor to star it in every section.

Read the repository destination from `package.json` → `repository.url`. Resolve that value once into the site's configuration during implementation; link components must share it. Docs appends `#readme`; contributing and license links target the repository's existing files. The public owner is not assigned yet. Do not invent it or add more independently maintained placeholder URLs. Relative README links should remain relative. Nothing in this handoff authorizes publishing or contacting services.

## Implementation acceptance

- At 1440px and 390px, a new visitor can see that this is a free local app for Codex/Claude Code, find the command immediately, and reach GitHub or setup docs without hunting. Also check 320px, keyboard navigation and 200% text zoom.
- Use one H1 and a logical heading order. Keep visible focus, a skip link and at least 44px touch targets for copy, tabs and navigation. Implement proper tab keyboard semantics if retaining the explorer. Without JavaScript, the pitch, command, first screenshot and all useful links still work; the command remains selectable.
- Verify copy success and blocked-clipboard fallback, tab click/arrow/Home/End behavior, full-size image links, correct image sources and alt text on both widths, and all repository/docs links. Do not navigate to a placeholder repository as though it already exists.
- Check text contrast at AA (4.5:1 for normal text, 3:1 for large text) and needed control/focus boundaries at 3:1. No meaning conveyed by color alone. Test reduced motion. The launch story needs no animation.
- Keep all page code, SVGs, fonts and screenshot resources requested across the complete page below **1.5 MB**, comfortably under 2 MB. The seven screenshot sources above total about 1.12 MB before fonts; do not add videos, GIFs, analytics, icon libraries or remote font requests. Review evidence captures are not shipped page assets. Measure transferred resources in the final implementation instead of claiming a source-size estimate is a network measurement.
- Reserve image dimensions and ensure a fresh full-page capture includes the footer after lazy loading. Open every image used, preserve neutral sample data, and inspect wide/narrow screenshots after the meaningful clicks. Automated tests alone do not establish visual quality.
