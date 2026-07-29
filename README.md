# Power Stage

An interactive designer and reference for 30 power-electronics topologies —
buck through class DE, with animated operation figures, live design
calculators, loss budgets, an efficiency map and a switching-noise spectrum.

```bash
npm install
npm run dev
```

## Layout

| File | What it holds |
|---|---|
| `src/PowerStage.jsx` | The app: topology data, design equations, schematics, figures, cards |
| `src/tex.jsx` | Maths typesetting — parses the linear notation used in the data and emits LaTeX for KaTeX |
| `src/styles.js` | The stylesheet and the type system |
| `scripts/check-tex.mjs` | Pushes every literal formula through the parser and fails on anything that would fall back to plain text |
| `scripts/probe.mjs` | Stresses the prose/maths splitter against every long string in the app |

## Conventions worth knowing before editing

**Element keys.** Figures re-run their draw functions on every animation
frame. `drawScope(prefix, fn)` gives each drawing surface its own key
namespace so React can diff instead of remounting. If you add a new drawing
surface, wrap it — without that, the CSS transitions silently stop working
and the animation gets choppy.

**Do not name anything `Math`.** A hoisted `function Math` shadows the global
`Math` object for the whole module. The math component is `TeXSpan`.

**Formula notation.** Write formulas the way the existing data does —
`C_out = ΔI_L/(8·f_sw·ΔV)`, `R_DS(on)`, `√(L_r/C_r)`. The parser handles
subscripts, real fractions, radicals, Greek and units. Run
`node scripts/check-tex.mjs` after adding any; it exits non-zero if a string
would fall back to plain text.

**Input bounds.** Every entry in `FIELDS` carries `mn`/`mx`. The App clamps
against them before any `design()` runs, so design functions may assume
finite, positive, in-range inputs. A value the clamp had to rewrite is
flagged red in its input box.

**Infeasible operating points.** When a topology cannot reach the requested
conversion ratio, return `infeasible("why, and what to change")` rather than
letting a duty above 1 produce a negative inductance.

**Loss models.** A `loss:` array on the design result feeds both the loss
breakdown bar and the design-space heatmap. Every topology has one; keep it
that way when adding a topology, or both features vanish from that page.

**Desktop only.** There are deliberately no width breakpoints. Don't add
responsive CSS speculatively: the last attempt put `overflow-x:auto` on the
KaTeX spans to stop a phone-width overflow, and that broke formula baselines
and put scrollbars through the results tables on the screen people actually
use. If narrow-screen support is ever wanted, do it as its own piece of work
and verify it on desktop afterwards.

**Grid tracks.** Use `minmax(0, 1fr)`, never bare `1fr`. This is not
narrow-screen support — the automatic minimum of `1fr` is the track's
max-content width, so one wide results table will push the layout past its
own container at any window size, including a half-screen desktop window.

## Verifying a change

The dev server plus a browser is the real test. Beyond that:

- `node scripts/check-tex.mjs` — every formula still typesets
- `npm run build` — production build succeeds
- Walk the 30 topologies and watch the console; the design panel should never
  show an em-dash, a NaN, or a negative component value
- Numbers here are first-pass estimates from idealised models. If you change
  an equation, check it by hand at the defaults before trusting the display.
