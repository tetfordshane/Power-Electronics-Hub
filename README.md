# Power Stage

An interactive designer and reference for 32 power-electronics topologies —
buck through class DE, with animated operation figures, live design
calculators, loss budgets, an efficiency map and a switching-noise spectrum.

Every topology traces its own conducting path over its own schematic. There
used to be a generic "family figure" for the eight bridge-derived ones, with a
note admitting the drawing was not the circuit above it; that is gone, and
what it was good for — placing a converter among its relatives — is now one
sentence per topology in `FAMILY`.

```bash
npm install
npm run dev
```

## Layout

| File | What it holds |
|---|---|
| `src/PowerStage.jsx` | The app: topology data, design equations, schematics, figures, cards |
| `src/cycle.js` | One description of a switching cycle — the current, the capacitor, the polarity. Plain module: no React, no DOM, importable by the checks |
| `src/tex.jsx` | Maths typesetting — parses the linear notation used in the data and emits LaTeX for KaTeX |
| `src/styles.js` | The stylesheet and the type system |
| `scripts/check-tex.mjs` | Pushes every literal formula through the parser and fails on anything that would fall back to plain text |
| `scripts/probe.mjs` | Stresses the prose/maths splitter against every long string in the app |

## Conventions worth knowing before editing

**Element keys.** Figures re-run their draw functions on every animation
frame. `drawScope(prefix, fn)` gives each drawing surface its own key
namespace so React can diff instead of remounting. If you add a new drawing
surface, wrap it — without that, the CSS transitions silently stop working
and the animation gets choppy. Prefixes in use: `sc` schematic, `wv` waveform,
`pl` polarity, `db` devices, `cf` capacitor flow, `lc` line chart, `sp`
spectrum. They must not collide.

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

Ranges cannot see each other, though, and a minimum input above the maximum
input is inside both of them and still nonsense — it reached the design
functions and divided by a zero energy gap, or picked a duty from the wrong
corner. `ORDERED` lists the field groups that only mean anything in sequence
(`vinMin ≤ vinNom ≤ vinMax`, and so on) and `order()` restores it right after
the range clamp. Add a relational assumption to a design function and it
belongs there instead, once, rather than in thirty design functions.

`Fields` decides what to flag by comparing the box against the value `design()`
actually received, so it catches both kinds of rewrite and cannot drift out of
step with either.

**Infeasible operating points.** When a topology cannot reach the requested
conversion ratio, return `infeasible("why, and what to change")` rather than
letting a duty above 1 produce a negative inductance.

**Loss models.** A `loss:` array on the design result feeds both the loss
breakdown bar and the design-space heatmap. Every topology has one; keep it
that way when adding a topology, or both features vanish from that page.

Because the heat map reads the bar, a bar that double-counts becomes an
efficiency surface that is wrong everywhere. Where two loss mechanisms combine
in quadrature — the charge pump's two limits do — the bar has to apportion the
real total between them, not list both in full. Hard-switched topologies carry
`½·C_oss·V²·f_sw` and `Q_rr·V·f_sw` terms; `qrr` defaults to zero, which is the
honest value for a Schottky or a wide-bandgap diode and the wrong one for
silicon. Core loss is still absent everywhere.

**Output power.** The heat map divides by `outPower()`, which guesses from the
input fields. A design whose output voltage is a *result* rather than a
specification — a charge pump, a centre-tapped rectifier at `2·D·(V_sec − V_F)`
— must publish `pout` on its result, or its whole efficiency surface is
computed against the wrong denominator.

**Desktop only.** There are deliberately no width breakpoints. Don't add
responsive CSS speculatively: the last attempt put `overflow-x:auto` on the
KaTeX spans to stop a phone-width overflow, and that broke formula baselines
and put scrollbars through the results tables on the screen people actually
use. If narrow-screen support is ever wanted, do it as its own piece of work
and verify it on desktop afterwards.

**One cycle model.** `src/cycle.js` owns the shape of a switching cycle, and
everything that draws one reads it: the waveform panes, the animated
schematic's flow dashes, the arrows, the polarity marks, the capacitor
branches. It used to be three implementations, and they disagreed — a
flyback's dashes kept moving through the off-time, when no primary current
exists. If you need the current somewhere new, call `buildCycle`; do not
reconstruct it. `lookups()` is at module scope so a new polyline can be asked
the same three questions (value, slope, accumulated charge) as any other.

That rule extends to statements about the cycle, not only drawings of it.
`isDCM` is exported and used both by `buildCycle` to pick the shape and by the
results panel to say so in words — for a long time only the buck admitted it
had fallen into discontinuous conduction, while every other converter redrew
itself as a discontinuous triangle with continuous-conduction equations stated
as fact beside it.

Its memo key comes from `cycleKey(wave)`, not from the wave object, whose
identity changes on every render. Add an input to a `wave` spec and `cycleKey`
picks it up automatically — that list fell behind once, and turning the
core-saturation control did nothing for a while as a result.

**Waveform panes are data.** `Wave` builds a list of pane descriptors — name,
unit, colour, height, the value range its axis covers, and its trace as a
polyline in cycle-relative time — then one layout pass stacks them and one
drawing pass draws them. To add a pane, add an entry. Do not reintroduce
hardcoded y coordinates; the reason the capacitor panes could be added at all
is that nothing outside the descriptor knows where a pane sits.

A pane's `unit` is a unit, optionally followed by ` · ` and the sign
convention a reader needs to make sense of the trace (`amps · + into C`). It
is not a subtitle. Labels are symbols throughout, including the fallbacks —
a spec that forgets `ilabel` gets `i`, not the word "current", because a
column reading *i_L, i_C, v_C, current* changes register for no reason.

**Bare panes.** A topology with no design-derived `wave` still gets a figure:
`FlowCard` builds a `{ bare: true, iShape }` spec from its `FLOW` entry and
`Wave` plots the current alone, scaled to its own peak. Fourteen topologies
had a moving schematic and nothing underneath it before this.

Bare mode deliberately draws less, and the omissions are the point: no switch-
node pane (a class-E drain rings and an LLC node is swung by its tank — a
square wave there would be invented), no `D·T` bracket (there is no duty
behind a supplied shape), and no capacitor pane. Scale reads `1.00×` of peak,
because a closure returns a shape and printing it as amps would be claiming a
measurement nothing computed.

Panes draw in layers, not pane by pane: all the gridlines, then the reference
lines, then the traces, then the scales. A trace has to sit over its
neighbour's furniture rather than under it.

**Output capacitor panes.** A design opts in by putting a `cap` object on its
`wave` spec. `kind` is the only real decision: `"buck"` where the output
inductor feeds the load continuously, `"boost"` where a rectifier delivers in
pulses and the capacitor carries the load alone in between — the latter also
needs `i0`/`i1`, the rectifier current at the start and end of its conduction
interval. Give `n` for interleaved phases and let the model derive the
cancellation rather than passing it the answer. Where the plotted winding is
not the one facing the output — a Ćuk plots its input inductor — pass that
winding's own `iavg` and `dI`.

Whatever you write has to balance its own charge, and `check-ripple.mjs`
asserts that it does for every topology. That single test is what catches a
wrong family, a rectifier current that does not average to the load, or a
missing phase count; none of those are visible in the drawing, which stays
perfectly smooth and belongs to a different converter.

**Pulses per period.** A push-pull, half-bridge, phase-shifted bridge or
centre-tapped rectifier delivers two power pulses per switching period, so its
output choke ramps up and back down twice. Those say `pulses: 2`.

`D` keeps meaning what it means everywhere else — the duty of *one* switch
measured against the whole period — because the on-time bracket, the `FLOW`
phase windows and every design equation read it. What `pulses` changes is the
interval that duty sits in: `buildCycle` builds one sub-interval with an
on-fraction of `D·P` and then tiles it, so discontinuous conduction, core
saturation and the mean restoration all work unchanged instead of needing a
second version each. A half-bridge at `D = 0.38` therefore spends 76 % of each
half-period charging its choke, which is why these ramps are far more lopsided
than a buck's.

`vbi: true` additionally makes the voltage pane bipolar, for a transformer
primary that genuinely swings both ways. Its mean is then zero — and that is
not decoration: a mean that is *not* zero is flux walking, which is what the
blocking capacitor in a half-bridge is for. A rectified node behind a centre
tap gets `pulses: 2` without `vbi`, because both its half-cycles arrive
positive and its mean is `2·D` × swing.

The ripple identity `ΔV = ΔI/(8·f·C)` is usually derived from a symmetric
triangle, but the positive lobe of `i_C` spans half the sub-period whatever
the duty, so it holds at any asymmetry — `check-cap.mjs` asserts that across
the duty range rather than trusting it.

**Polarity marks.** A `FLOW` entry opts in with `pol: [ax, ay, bx, by]`, where
A is the terminal the inductor's current *enters*. The sign comes from the
slope of the shared cycle model, so it cannot disagree with the trace. Because
it depends on d*i*/d*t* and not on *i*, it stays correct where a synchronous
rectifier's current runs backwards at light load.

**Capacitor flow.** A `FLOW` entry animates a capacitor branch with
`capFlow: [{ d, src }]`, where `d` is drawn in the direction positive current
travels *into* the capacitor and `src` is `"out"` (the design's own `cap`
spec) or `"in"` (the input capacitor, which the model derives from the switch
current — no new input fields).

The dashes ride on `qAt`, the charge integral, not on time. That is what makes
this work: the integral rises while the capacitor charges and falls while it
discharges, so the dashes and arrowheads reverse by themselves at the zero
crossing, with no sign test in the drawing. It also returns to where it
started after one period, because the model already enforces charge balance —
so the animation loops seamlessly for the same reason the physics does. The
reversal lands exactly where `|i_C|` is smallest and the marks are faintest,
so it is never seen happening.

Sign conventions are the trap here. Current into the capacitor is positive
everywhere, including the input cap, where KCL gives `i_Cin = I_in − i_sw` —
*negative* while the switch conducts, because the capacitor is emptying itself
into a switch the source alone cannot feed. Getting that backwards draws a
capacitor charging hardest exactly when it is being drained, which is the
opposite of the lesson. Measure it rather than reasoning about it: scrub the
figure and check the arrows turn where the `i_C` pane crosses zero.

**Flow geometry and the coil registry.** The overlay's path maths —
`polyPoints`, `polySegs`, `arrowsAt`, `coilSplice` — live in `src/flowgeo.js`,
a plain module like `cycle.js`, so `check-flow.mjs` asserts against the code
the figures draw with. `Lh`/`Lv` record every winding they draw into `COILS`
while `FlowCard` renders the schematic; `coilSplice` then reroutes each flow
path over the arcs of any coil it runs straight through, which is what makes
the current visibly climb through a winding instead of sliding under it on
the chord. Never hand-list an inductor's extent anywhere — the registry is
derived from the drawing precisely so the two cannot drift.

Two numbers in that file are load-bearing. Arrow spacing is exactly 120
because one switching period advances the dash travel by 240 and the belt's
phase is `travel mod spacing`: a spacing that divides 240 makes the
period-boundary wrap land every arrow on another's slot, where the old
per-path spacing teleported the whole field by up to 29 px. The dash pattern
(`7 13`) and the capacitor dash (`5 11`) divide 240 for the same reason.

**Commutations cross-fade, numerically.** Near a phase boundary FlowCard
renders both phases at once, keyed by phase index so React mounts and
unmounts routes rather than morphing a path's `d`. A path string present in
both phases draws once at full opacity — shared copper must not dip. All of
these opacities (and the DCM rest floor, and the glow breathing) are computed
per frame; the `transition:none` rule on the flow classes in `styles.js`
stands, and the blend is a cubic ease-in-out because the narrowest windows
span three or four frames and the first rendered sample must still be faint.

**Text that changes as the animation runs** goes through `Swap`, which renders
every alternative into one grid cell and hides all but one by `visibility`.
The box then keeps the height of its tallest option. Without it, phase notes
of two and four lines made the waveform below them jump twice a cycle — the
figure you are reading moving because of the caption beside it.

**The glossary.** `TERMS` is a list of `[name, pattern, definition]`, and each
topology page shows the entries whose pattern matches its own prose. Nothing
is maintained per topology: write an interval note that mentions dead time and
the definition appears by itself. Keep the patterns tight — a term that
matches too eagerly defines something the page never discussed, which is worse
than leaving it out.

**Grid tracks.** Use `minmax(0, 1fr)`, never bare `1fr`. This is not
narrow-screen support — the automatic minimum of `1fr` is the track's
max-content width, so one wide results table will push the layout past its
own container at any window size, including a half-screen desktop window.

## Verifying a change

The dev server plus a browser is the real test. Beyond that:

- `node scripts/check-tex.mjs` — every formula still typesets
- `npm run build` — production build succeeds
- `node scripts/sweep.mjs` — walks all 32 topologies with the dev server up
  and reports console errors, text escaping its viewBox, overlapping labels,
  and the cursor rake's spacing. Replaces doing that walk by hand.

  Run from a git worktree it also reports a handful of 403s on KaTeX's font
  files. That is `node_modules` resolving outside the worktree root, where
  Vite's `server.fs.allow` will not serve it — a dev-server artifact of the
  worktree, not a fault in the page, and the production build bundles those
  fonts normally. Check the message before chasing it.

### Checking the physics

These import `src/cycle.js` directly, so they need no browser and no dev
server. They are assertions about the model, not snapshots of it, and they run
in under a second — there is no reason not to run them.

- `node scripts/check-flow.mjs` — the animated overlay against the schematic
  under it, for all 32 topologies: every winding carries dashes in some phase
  (or is on the reviewed never-animated list), the pol-marked inductor
  carries them in **every** phase, no opaque polarity disc sits within 11 px
  of a drawn path, `coilSplice` preserves endpoints and adds exactly the arc
  length it should, and the overlay's inset still matches the schematic's
  border + padding. `--report` lists never-animated coils instead of failing,
  for reviewing a new topology.
- `node scripts/check-cycle.mjs` — the properties the drawing depends on: the
  mean equals `I_avg`, `ΔI` is exact, discontinuous conduction carries the
  right average and meets the continuous case exactly at the boundary, a
  synchronous rectifier reverses instead of clamping, a flyback's flow current
  is the secondary's during the off-time.
- `node scripts/check-cap.mjs` — the capacitor model against the closed forms
  the design tables already print: `ΔI/(8·f·C)` for a continuously-fed output,
  `I_out·D/(f·C)` for a pulse-fed one, ESR raising the ripple by `ΔI·ESR`,
  interleaving cancelling it, `ΔQ/C` equalling the drawn swing, and the
  quadratic Béziers reproducing the closed form exactly rather than closely.
- `node scripts/check-ripple.mjs` — needs the dev server. Walks every topology
  and checks that the `cap` spec its design function hands over balanced its
  own charge, that the charge term fits the `ΔV` budget `C_out` was sized
  against, and that the trace closes on itself. This is the one that catches a
  hand-derived spec belonging to the wrong converter.

  It also asserts which topologies are *expected* to have no capacitor pane,
  via `NO_PANE` — the bare-mode set. Add a `wave` spec to something on that
  list and it must gain a `cap` spec with it and come off the list, in the
  same commit, or the check quietly stops covering it. A bare pane cannot
  carry a capacitor: there are no amps behind a shape, and the ones that do
  have an output capacitor ripple at a frequency the figure does not span —
  a PFC bulk cap swings at twice the *line* frequency, hundreds of switching
  periods wide, so drawing it on a switching-period axis would be a different
  waveform wearing this one's axis.

### Refactoring the drawing without changing the drawing

`node scripts/trace-snapshot.mjs .anim/before.json`, make the change, then
`node scripts/trace-snapshot.mjs .anim/after.json` and
`node scripts/trace-diff.mjs .anim/before.json .anim/after.json`.

The diff parses the coordinates out and compares them with a tolerance, so
rounding a number to three decimals is not reported as movement — and it
separates "the shape changed" from "the geometry moved" from "a pane
appeared", because those want very different reactions. Two near-identical
sawtooths cannot be told apart by eye, and the pane refactor was only safe
because this said all sixteen were unmoved to within a hundredth of a pixel.

`node scripts/wave-cases.mjs` renders the waveform under named input cases —
ideal against saturating against discontinuous — side by side, driving each
case through the real inputs and reading the values back, so a case that
silently failed to apply cannot pass as one that legitimately looks unchanged.
- Walk the 32 topologies and watch the console; the design panel should never
  show an em-dash, a NaN, or a negative component value
- Numbers here are first-pass estimates from idealised models. If you change
  an equation, check it by hand at the defaults before trusting the display.

### Measuring the animation

Smoothness cannot be judged by reading the code, and it cannot be judged in a
backgrounded browser tab either — `requestAnimationFrame` is suspended there,
so the figure simply does not advance. These drive their own headless
Chromium, which does composite:

- `node scripts/record-animation.mjs <topology> <seconds>` then
  `node scripts/analyse-frames.mjs` — captures the cursor rake, the arrow
  field, the dash offset and each device's on/off state per frame, then
  reports the continuity metrics. The one that matters: nothing may *appear*
  at an opacity you could see. Anything entering or leaving has to dissolve,
  so a mark with no near predecessor on the previous frame must be faint.
- `node scripts/handoff-filmstrip.mjs <topology>` — a strip of live frames
  through a hand-off, with the rake's positions and opacities beside each one.
  Use this to look at the result; the metrics only say whether to.
- `node scripts/wrap-filmstrip.mjs <topology> both` — the same idea driven by
  the scrub control instead, which is deterministic and can be aimed exactly.
  Note that scrubbing pauses the clock, and the edge dissolves are only
  active while playing, so this strip cannot show them.
