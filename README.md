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
| `src/App.jsx` | The shell: tabs, routing, input sanitising, card order |
| `src/topologies/` | The catalogue. One module per category, plus `flow.js` (animation geometry), `family.js`, and `index.js`, which assembles them |
| `src/topologies/sim/` | Netlists for the topologies the simulator drives |
| `src/schematic/` | `parts.jsx` (the primitives and the registries they fill as they draw) and `sch.jsx` (32 schematics) |
| `src/ui/` | One file per surface: `Wave`, `FlowCard`, `Results`, `Fields`, `HeatCard`, `SpecCard`, `LossBar`, `PlayBar`, `marks` |
| `src/content/` | Cheat sheet, glossary, selector table |
| `src/engine/` | The circuit simulator — see below |
| `src/cycle.js` | One description of a switching cycle — the current, the capacitor, the polarity. Plain module: no React, no DOM, importable by the checks |
| `src/fields.js`, `src/format.js`, `src/hooks.js` | The input registry, number formatting, the reduced-motion hook |
| `src/tex.jsx` | Maths typesetting — parses the linear notation used in the data and emits LaTeX for KaTeX |
| `src/styles.js` | The stylesheet and the type system |
| `scripts/check-tex.mjs` | Walks every source file AND runs every `design()`, pushing the result through the parser; fails on anything that would fall back to plain text |
| `scripts/check-registry.mjs` | Asserts that every topology has all of its parts, in every registry |
| `scripts/probe.mjs` | Stresses the prose/maths splitter against every long string in the app |

**Everything under `src/topologies/`, `src/content/`, `src/fields.js` and
`src/format.js` is JSX-free**, so node imports it directly with no build step.
That is what lets the checks and the tests read the real data instead of
scraping it. Keep it that way.

## The simulator

`src/engine/` solves the circuit rather than describing it. A topology in
`src/topologies/sim/` supplies a netlist; `mna.js` compiles each switching
configuration into `ẋ = Ax + Bu` by modified nodal analysis; `linalg.js`
steps it with a matrix exponential, which is exact at any step size and
stable at any stiffness; `solver.js` locates diode events by bisection;
`limitcycle.js` finds the periodic steady state by shooting — measuring the
Jacobian of the period map and solving for the state that repeats, which
turns ~2900 periods of settling into about seven.

`adapter.js` is the seam. `engineFor(topo, spec, res)` returns a simulated
cycle where a topology has a netlist and the closed-form `buildCycle` cycle
where it does not, in the same shape, so no drawing surface knows which it
got. A topology without a netlist is not degraded — it is the app as it was.

Which devices conduct is **not** authored for simulated topologies. Commanded
switches come from a modulator; diodes conduct when the circuit forward-biases
them and stop when their own current reaches zero. Discontinuous conduction
emerges from that rather than being declared, and the sign that it has is an
interval where nothing conducts (`run.idle`), not a flat stretch at zero — a
real converter in DCM rings rather than sitting still.

Two things a netlist must respect: a switch node needs its own capacitance
(`C_oss`), or dead time drives it to tens of kilovolts because an inductor is
being forced into an open circuit; and a flyback secondary is **anti-phase**,
which is the whole difference between a flyback and a forward converter —
wired in phase it still converges, still regulates, and reads about 20 % high.

Converted so far: buck, sync buck, boost, buck-boost, flyback, Ćuk, SEPIC,
Zeta. Adding another means a netlist, a `sim: { … }` on the design result so
the simulation and the printed numbers cannot describe different converters,
and an entry in `test/sim-steady.test.mjs`.

That entry records what the design's ΔI actually refers to, because it is not
the same quantity everywhere: `"own"` where the design sizes L for the plotted
winding at this operating point, `"sum"` where ΔI is the summed winding ripple
(a SEPIC's two windings both ripple and the switch sees the total), `"corner"`
where L is sized at an input corner and drawn at nominal so only the output
voltage is worth asserting. Guessing wrong there fails honestly or passes by
luck, and both are worse than saying which it is.

Wire a new one against the textbook ratio before trusting anything else —
every error so far has been wiring, and every one of them produced a
converter that ran, settled, and regulated to a plausible wrong number.

### Transients

`runTransient(topo, spec, res, fromRun)` applies new parameters to the state a
previous run left the converter in and integrates until it repeats. The
**load step** control on the figure is the way in: `res` is passed through
untouched so every component stays as designed and only the load resistance
moves. Editing `I_out` instead asks `design()` to re-size the inductor, which
is a different converter — `isPerturbation()` refuses that case rather than
animating a settle between two unrelated designs.

Two resolutions on purpose. The settle runs at 96 sub-steps because all it
has to resolve is the envelope; each period the reader actually sees is
re-solved at 512 from its own recorded state. A boost takes ~1,160 periods to
recover and the whole thing costs under 100 ms.

The current pane's axis freezes across a settle (`spanI`). Letting it scale
per period grows the axis underneath a climbing current, and the waveform
appears not to move.

### Saturating cores

`lsag` bends the simulated ramp too. Same model as `cycle.js` —
`L(i) = L₀/(1 + κ(i/I_ref)²)`, `κ = s/(1−s)` — so the two cannot describe
different magnetics. A netlist opts in with `sat` and `iref` on an `L`.

A current-dependent inductance is not linear, and every configuration above
`solver.js` assumes linearity, so it is made piecewise linear: the winding
current is bucketed, each bucket takes the inductance at its own level, and
the configuration key carries the bucket alongside the conduction state.
Crossing a boundary is then just another configuration change. Buckets are
spaced by √i so they crowd where L is moving fastest, and they are compiled
lazily — a fine grid costs only the handful a run actually visits.

**The two models disagree here, deliberately.** `cycle.js` bends a ramp whose
endpoints are already fixed: it preserves ΔI exactly and restores the mean,
showing the shape against a ripple the design equations chose. The simulator
has no endpoints to preserve — it is handed a falling inductance and
integrates what follows, so the ripple grows. That is what really happens: a
part quoted at "−20 % at 12 A" ripples more than its nameplate inductance
predicts, and the ideal equation cannot tell you so. `sim-saturation.test.mjs`
asserts the disagreement, so it stays a known difference rather than getting
quietly "fixed" by making the simulator preserve a ripple it has no reason to.

Two consequences worth knowing. Piecewise linearity puts a floor under the
convergence residual — the fixed point can sit astride a bucket boundary —
so `converge` stops when the residual stops improving rather than grinding
out its whole budget, and the adapter accepts up to 1e-4. And past about
70 % roll-off some converters have no clean periodic solution at fixed duty;
those fall back to the closed form, which the missing "simulated" badge says.

A test that isolates one effect must turn the others off: `lsag: 0` belongs
in any comparison against a constant-inductance formula, next to `vf: 0` and
the rest.

### The capacitor pane follows the current above it

A buck-family output capacitor sees `i_L − I_out`, so its pane is a
restatement of the trace above it — and it was being restated from the
closed-form ramp while the trace came from the simulator. With a linear core
the two agreed closely enough to hide it; with a saturating one they do not.
`simView` now rebuilds the capacitor with the same `buildCap` — its charge
balance, its ESR term, its exact quadratics — handed the simulated polyline.
Two things it must be given: the simulated mean as `Io`, because a capacitor
carries no net charge over a period and the nameplate load is not the mean
the converter actually delivers; and nothing for `iavg`/`dI`, which is what
makes `buildCap` read the polyline instead of rebuilding a ramp from scalars.
A pulse-fed (`boost`) output still comes from the design's rectifier
currents, because that capacitor is not fed by the plotted winding at all.

`simFacts(topo, spec, res)` is how that reaches the reader: the results panel
carries a **measured ·** note when the simulated ripple exceeds the ΔV budget
C_out was sized for, with both figures and the reason. It is styled in copper
rather than the warning red, because it is not reporting a fault — it is
reporting that the ideal figure above it was optimistic. A buck at its
defaults draws 1.24× its budget; a *synchronous* buck draws 1.03×, because
there is no diode drop on its freewheel path. Both come from the same engine
the figure uses — `engineFor` memoises on the operating point **and** the
components, so the panel and the figure share one run.

**`check-ripple` changes meaning for those five.** Its budget assertion asks
whether the model is self-consistent — a closed-form capacitor fed the ripple
its own design equations assumed cannot miss the budget those equations sized
it against. A simulated one is fed the ripple the circuit really produces,
which is larger, and a buck at its defaults draws 37 mV against a 30 mV
budget. That is not a fault in the drawing; it is the design being told its
capacitor is undersized, so it is reported rather than failed. Keep that
distinction if you touch check 3.

## Conventions worth knowing before editing

**Opacity on anything drawn per frame.** Set it inline
(`style={{opacity: …}}`), never as an SVG `opacity` attribute and never
through a CSS transition. A stylesheet rule outranks a presentation
attribute, so an attribute is silently ignored wherever a rule sets the same
property; and a transition on an element that is redrawn sixty times a second
restarts before it travels anywhere, holding the value near where it started.
Both faults hid for a long time — the diode's blocking bar stayed struck
through while the device conducted, and every flow arrowhead rendered at full
strength so the end-fades that stop arrows popping did nothing. Neither is
visible in the code, which reads correctly in each place separately. Check it
with `getComputedStyle(el).opacity` at several scrub positions.

**Element keys.** Figures re-run their draw functions on every animation
frame. `drawScope(prefix, fn)` gives each drawing surface its own key
namespace so React can diff instead of remounting. If you add a new drawing
surface, wrap it — without that, the CSS transitions silently stop working
and the animation gets choppy. Prefixes in use: `sc` schematic, `wv` waveform,
`pl` polarity, `db` devices, `cf` capacitor flow, `mf` fields lens, `lc` line
chart, `hm` heatmap, `sp` spectrum. They must not collide.

**Do not name anything `Math`.** A hoisted `function Math` shadows the global
`Math` object for the whole module. The math component is `TeXSpan`.

**`--ghost` is a stroke colour, `--ghosttxt` is an ink.** They look almost
alike and they are not interchangeable. `--ghost` reads at 2.6:1 on the page
background, which is what the marks on a switched-off device want and what no
run of words can afford; the rail's result count was live-region text nobody
could read. Anything made of letters that should recede uses `--ghosttxt`,
which clears 4.5:1 on all three card surfaces.

**A drawing says what it is.** Every `role="img"` carries an `aria-label` — the
role without a name hides the contents from a screen reader and then declines
to say what was hidden, which is strictly worse than leaving the role off. The
32 schematics are argument-less thunks, so `SV` takes a `label` and the two
callers (the static card in `App.jsx`, the animated figure in `FlowCard.jsx`)
clone the element to pass the topology's name in.

**Sparklines come from the CycleView, never from a second pass over the
data.** `Spark` takes a polyline the cycle model already emits — `cyc.pts`,
the output capacitor's `vTot` against its `iC` timebase, `inCap.pts` — so the
shapes beside the numbers cannot drift away from the shapes in the figure. A
topology with no `wave` shows no strip at all rather than an empty box, and a
topology whose cycle has no capacitor model simply shows fewer rows. The
component is deliberately not wrapped in `.sch`: that class paints the 22px
dotted grid, which at this size is a texture rather than a grid.

**Worked examples are loadable, and their values are raw strings.**
`src/content/examples.js` is keyed by the six topology `CATS`, and each
example's `go.over` is a patch over that topology's defaults in exactly the
shape `mkRaw()` produces — strings, not numbers — so loading one goes through
the same parse-clamp-order path a typed entry does and cannot put the bench in
a state a reader could not have reached themselves. Loading an example starts
from defaults rather than `carryOver`: an example is a specific job, and
inheriting a half-finished design into it answers a question nobody asked.
`check-registry` checks both directions — every category has an example, every
example points at a real topology, every `over` key is a field that topology
displays, in range. What it cannot check is whether the prose is *true* of the
page it loads; when you add one, run its numbers and read the result, because
a worked example that promises a warning the page does not emit is worse than
no example at all.

**A dense grid takes one tab stop, not one per cell.** The design-space map
is 308 cells; making each focusable would be 308 stops to cross one card. The
surface itself is focusable and the arrows move a cursor inside it — the
bargain a spreadsheet makes. Escape leaves, blur clears, and the keyboard
cursor is state of its own: a mouse leaving must not carry the keyboard's
position away with it.

**Announced, not shown.** `.vh` is for text that exists so a screen reader has
something to read where the sighted reader has a drawing. Put the live region
beside the figure rather than on the tooltip — a live tooltip reads out every
cell a mouse crosses, which is not a reading of the map so much as a denial of
service on it.

**An eyebrow that is a card's only title is a heading.** Write it as
`<h3 className="eyebrow">`; the class carries the look either way. An eyebrow
sitting above a real `h2` or `h3` — the category over a topology name — is a
kicker and stays a `<span>`, because it labels the heading rather than being
one.

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
`polyPoints`, `polySegs`, `arrowsAt`, `coilSplice`, and the EMC loop helpers
`closeLoop`/`pointInLoop`/`splitByLoop` — live in `src/flowgeo.js`, a plain
module like `cycle.js`, so `check-flow.mjs` asserts against the code the
figures draw with. `Lh`/`Lv` record every winding they draw into `COILS`
while `FlowCard` renders the schematic; `coilSplice` then reroutes each flow
path over the arcs of any coil it runs straight through, which is what makes
the current visibly climb through a winding instead of sliding under it on
the chord. `Cv`/`Ch` record capacitors into `CAPS` and `Core` (used by `Xf`,
`XfCT`, and any hand-drawn transformer) records core bars into `CORES` the
same way, for the fields lens. Never hand-list a component's extent anywhere
— the registries are derived from the drawing precisely so the two cannot
drift.

**The lenses claim only what the model computed.** The fields lens drives
each mark from a real quantity: a winding's field from the conducting flow
current (or the plotted current, for the pol-marked inductor), a modelled
capacitor's field from its charge integral, a core's flux from the FLOW
entry's declared `flux:` — `"mag"` (the flow current is the magnetising
story: flybacks), `"vs"` (the volt-second integral of the shared node
description, alternating sign so the core cannot walk: bridges and centre
taps), a supplied `{ shape }` (the forward's store/reset/idle triangle), or
`"static"` (presence at a fixed faint opacity, claiming no waveform: tanks
and bare-mode transformers — `"vs"` degrades to this when there is no wave).
A coil on a `dim` branch gets the same static treatment: its current is real
but uncomputed. The EMC lens times its flares and node rings off the
phase-window starts — the switching instants — sized by the commutated
current, so a DCM edge is honestly quiet, and the hot/cold split of the
copper is geometric (`splitByLoop`, cut on the raw path, spliced per piece,
dash offset carried across the cut by the piece's own arc length).

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

`npm run check` runs every gate that needs no browser: typesetting, the
registry, the cycle model, the capacitor model, the flow geometry, and the
tests. Start there.

The dev server plus a browser is still the real test — on port **5273**, not
Vite's default; `PS_PORT` overrides it and `scripts/lib/env.mjs` is what the
browser-driven scripts read. Beyond that:

- `npm test` — the numeric harness. `test/golden/design.json` pins all 32
  design functions at four operating points each, to 1e-9 relative; a change
  of one part in ten million fails. If a diff is intended, read it, then
  regenerate with `node scripts/gen-golden.mjs` **in the same commit**.
  Alongside it: the matrix kernel, the MNA compiler against hand-derived
  state equations, and the simulator against the closed forms.
- `node scripts/check-registry.mjs` — every topology has a schematic, a FLOW
  entry, a family line, fields that exist, and a `design()` that runs at its
  own defaults without printing a NaN, a blank or a negative watt. The
  catalogue is assembled from parallel registries that cannot see each other,
  and this is the only thing that looks across them.
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

- `node scripts/record-animation.mjs <topology> <seconds> [emc|fld] [--perturb]` then
  `node scripts/analyse-frames.mjs` — captures the cursor rake, the arrow
  field (including the fields lens's circulation marks), the EMC rings, the
  dash offset and each device's on/off state per frame, then reports the
  continuity metrics. The optional third argument clicks that lens before
  sampling. The metric that matters: nothing may *appear* at an opacity you
  could see. Anything entering or leaving has to dissolve, so a mark that was
  not there on the previous frame must be faint.

  `--perturb[=2x|=0.5x]` steps the load a third of the way in, so a settle
  gets measured and not only a steady loop. Run it after touching anything
  the transient draws — its first run found arrows appearing at 0.92.

  Two details of the metric are load-bearing. It judges only frames whose
  mark COUNT grew, because a nearest-neighbour radius cannot tell a mark that
  appeared from one that merely moved fast, and a capacitor chevron sprinting
  through its zero crossing covers three times the ground a flow arrow does.
  And it reads opacity from the inline style as well as the attribute: for a
  while it was blind to the very fade it exists to police.

**A dissolve is a duration.** Written as a fraction of a cycle, or as a
distance along a path, it keeps its size and loses its time the moment the
figure plays faster — the commutation cross-fade, the arrow end fade and the
transient's own advance each made that mistake, and at the six times speed a
settle plays at, a twelve-millisecond fade is under one frame on a 60 Hz
display. Anything that fades scales with `rateMul` (`spd` × the transient
rush), and the transient advances on the phase wrap rather than on a timer of
its own, so the phase and the drawn period can never land in different
renders.
- `node scripts/handoff-filmstrip.mjs <topology>` — a strip of live frames
  through a hand-off, with the rake's positions and opacities beside each one.
  Use this to look at the result; the metrics only say whether to.
- `node scripts/wrap-filmstrip.mjs <topology> both` — the same idea driven by
  the scrub control instead, which is deterministic and can be aimed exactly.
  Note that scrubbing pauses the clock, and the edge dissolves are only
  active while playing, so this strip cannot show them.
