# Playful flock

## The idea

**Big plans. Little flock.** Shepherd turns a long, wandering agent conversation into a plan you can see. A small flock travels a winding path through Plan, Run and Check. The shepherd’s crook, apricot bandanas and sheep-in-a-laptop illustration give it a recognizable visual language without turning the product into a toy.

Warm paper, forest green, butter yellow, generous space and system typography keep it friendly and fast. The jokes are small: “A confident agent isn’t a test suite.” The practical information stays direct: this is a free, open-source local app for Codex and Claude Code, and the install command is immediately available.

## Who it is for

Developers who already use coding agents and have lost track of a long task. The page leads with orientation, then shows evidence: real map, outline and checks screenshots from the fictional Slice demo. Projects, tasks, steps, Done when, the timeline and merge requests are described using the product’s own vocabulary.

## Interaction and accessibility

- Both install buttons copy `npx shepherd-agents` and announce the result. If clipboard access is unavailable, the command is selected for manual copying.
- Three keyboard-accessible tabs switch real product screenshots. Arrow keys, Home and End work. Full-size images open locally in a new tab.
- Phones initially show the real mobile outline so the product text stays readable; desktop initially shows the map. Checks also uses its mobile screenshot on narrow screens.
- Click the large hero sheep for a small greeting. Sheep motion is subtle and disabled under `prefers-reduced-motion`.
- Semantic landmarks, a skip link, visible focus outlines, accessible names and contrasting text colors are included.
- SVG illustrations are drawn specifically for this concept. Fonts are system fonts. There are no third-party fonts, scripts, analytics, embeds or runtime requests to other sites.
- GitHub and docs use one repository URL in `script.js`. Replace `OWNER` there when the repository exists. This concept does not publish or create anything.

## What I would borrow from another direction

From a more technical, diagram-led concept, I would borrow a focused view of step dependencies and the handoff into a merge request. The flock earns attention; showing exactly how work and check evidence travel between steps would earn more engineer confidence. I would keep that detail below the first product preview, preserving the clear opening.

## Run and review

From the repository root:

```sh
npx vite site/concepts/flock --host 127.0.0.1 --port 5196 --strictPort
```

Open `http://localhost:5196/`. No build is needed for this concept.

Final full-page captures are `shots/desktop.png` (1440 wide) and `shots/mobile.png` (390 wide). They were captured with `$SHEPHERD_LOOK` after visual refinement. Desktop is 1440 × 3526; mobile is 390 × 4110. Chrome was attempted first; its browser host was unavailable. The copy feedback, sheep greeting, screenshot tabs and keyboard tab navigation were also reviewed through Shepherd captures. The page reported no browser errors.

The screenshot assets are unmodified copies from `docs/screenshots/`. The entire concept, including final review captures, is under 2 MB. Review captures are not downloaded by the page.

Repository verification:

```sh
npx tsc -b && npx vitest run && npm run build
```

Validation completed: TypeScript passed; 273 tests passed, 3 skipped; production build passed. The existing app bundle size warning remains. The measured body-text, muted-text, step-number and button color pairs meet AA contrast (4.70:1 or higher).
