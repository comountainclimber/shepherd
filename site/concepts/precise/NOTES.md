# Precise

A quiet, precise product page for developers who already use coding agents and want to know where a long task stands. The promise comes first: long tasks, clear next steps. The real app is the centerpiece, with a working screenshot switcher for the map, outline, and checks. A six-card feature grid connects those views to concrete behavior, followed by the local, open-source story and setup requirements.

The visual language borrows the care of desktop developer tools: locally bundled Geist type, near-black surfaces, thin borders, generous spacing, and a restrained blue install action. Green and blue echo the app's done and running states. The real sheep appears in the identity and on a small progress path near the final install command.

## Audience and decisions

- Developers using Codex, Claude Code, or Cursor who have lost their place in a long agent conversation.
- Installation and GitHub are the primary actions. Docs are available in the navigation and next to setup requirements.
- The screenshots are copied directly from `docs/screenshots/`; the Slice project is fictional demo data. No reconstructed product UI replaces the screenshots. Small feature illustrations are explanatory, not screenshots.
- The mobile map opens centered on the active steps and is horizontally and vertically scrollable. Outline and Checks switch to real mobile captures. Screenshot frames scroll to preserve all content without making the page jump when switching views.
- All fonts, icons, screenshots, styles, and scripts are local. External links navigate to GitHub only when followed. The placeholder repository URL is declared once in `script.js`.
- Copy buttons use the Clipboard API, report success through a live region, and select the command if clipboard access is denied. Tabs support arrow keys, Home, and End. Reduced motion removes transitions and smooth scrolling.

## What I would take from another direction

From a warmer, sheep-led direction, I would take a little more character in the transition between running and checking. Keep the real app and exact product language; try a single, restrained sheep animation along the progress path, respecting reduced motion. The product should still feel calm when the work is complicated.

## Run and verify

From the repository root:

```sh
npx vite site/concepts/precise --host 127.0.0.1 --port 5195 --strictPort
```

Open port 5195. Try both Copy buttons, all three screenshot tabs, keyboard tab navigation, and the screenshot scroll areas. Docs and GitHub point at the agreed `OWNER/shepherd` placeholder. The setup section states Node.js 22.12+, Git, signed-in Codex or Claude Code, and platform support.

Final full-page captures are in `shots/desktop-1440.png` and `shots/mobile-390.png`. The screenshot tabs and copy feedback were also visually reviewed.

Repository checks:

```sh
npx tsc -b && npx vitest run && npm run build
```
