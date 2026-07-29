/* =====================================================================
   POWER STAGE — stylesheet

   Type system
   -----------
   Three voices, each with one job:
     · Inter          — everything you read as language: prose, labels,
                        headings, buttons, captions.
     · JetBrains Mono — everything you read as a quantity: values, units,
                        readouts, code-like tokens. Tabular figures on, so
                        columns of numbers line up on the decimal.
     · KaTeX          — mathematics only. Its Computer Modern faces are the
                        reference for typeset maths and need no help.

   The original sheet set almost every label in uppercase monospace, which
   reads as a terminal rather than as an instrument. Mono is now reserved
   for quantities; anything that is words is set in Inter with real weight
   and colour hierarchy instead of tracked-out capitals.
   ===================================================================== */

export const CSS = `
.ps *{box-sizing:border-box}
.ps{
  /* surfaces */
  --bg:#0C1017; --surf:#121A24; --surf2:#16202C; --surf3:#1A2634;
  --line:#22303F; --line2:#2C3D50; --line3:#3A4E66;
  /* ink */
  --txt:#E6EDF5; --dim:#94A7BC; --faint:#61748A; --ghost:#455670;
  /* accents */
  --cu:#E3A85C; --cy:#5AD1DE; --gn:#6FD39B; --rd:#F0796C; --vi:#A88BF0;
  --cu-dim:#9C7238; --gn-dim:#3E7F5C;

  /* type scale — a fifth-ish ratio, rounded to whole pixels */
  --t-micro:10.5px; --t-fine:11.5px; --t-small:12.5px; --t-body:13.5px;
  --t-lead:15px;    --t-h3:15.5px;   --t-h2:22px;      --t-display:30px;

  /* families */
  --ui:"Inter Variable","Inter","Segoe UI",system-ui,-apple-system,sans-serif;
  --num:"JetBrains Mono Variable","JetBrains Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;

  /* rhythm */
  --gap:14px; --pad:18px; --radius:4px;

  background:var(--bg); color:var(--txt); min-height:100vh;
  font-family:var(--ui);
  font-size:var(--t-body); line-height:1.6; padding:0 0 72px;
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  font-feature-settings:"kern" 1,"liga" 1,"calt" 1;
  text-rendering:optimizeLegibility;
}
.ps .mono,.ps .num{font-family:var(--num); font-variant-numeric:tabular-nums; font-feature-settings:"tnum" 1,"zero" 1}

/* ---------------------------------------------------------------- eyebrow */
.ps .eyebrow{
  font-family:var(--ui); font-size:var(--t-micro); font-weight:600;
  letter-spacing:.13em; text-transform:uppercase; color:var(--faint);
  font-feature-settings:"cpsp" 1;
}

/* ----------------------------------------------------------------- header */
.ps .hdr{
  border-bottom:1px solid var(--line); padding:20px 22px 0;
  position:sticky; top:0; background:linear-gradient(180deg,#0C1017 72%,rgba(12,16,23,.88));
  z-index:20; backdrop-filter:blur(8px);
}
.ps .brand{display:flex; align-items:baseline; gap:14px; flex-wrap:wrap}
.ps .brand h1{
  margin:0; font-size:19px; font-weight:650; letter-spacing:.01em;
  font-family:var(--ui); text-transform:uppercase;
}
.ps .brand h1 b{color:var(--cu); font-weight:650}
.ps .brand span{color:var(--faint); font-size:var(--t-small); letter-spacing:0}
.ps .tabs{display:flex; gap:4px; margin-top:16px; flex-wrap:wrap}
.ps .tab{
  background:none; border:0; border-bottom:2px solid transparent; color:var(--dim);
  padding:9px 14px; cursor:pointer; font-size:var(--t-small); font-weight:500;
  letter-spacing:.01em; font-family:var(--ui); border-radius:3px 3px 0 0;
  transition:color .15s, border-color .15s, background .15s;
}
.ps .tab:hover{color:var(--txt); background:rgba(255,255,255,.028)}
.ps .tab.on{color:var(--cu); border-bottom-color:var(--cu); font-weight:600}
.ps .tab:focus-visible,.ps button:focus-visible,.ps input:focus-visible,.ps a:focus-visible{
  outline:2px solid var(--cu); outline-offset:2px; border-radius:3px;
}

/* ---------------------------------------------------------------- layout */
.ps .wrap{padding:20px 22px; max-width:1440px; margin:0 auto}
.ps .layout{display:grid; grid-template-columns:244px minmax(0,1fr); gap:20px; align-items:start}
.ps .rail{
  border:1px solid var(--line); background:var(--surf); border-radius:var(--radius);
  position:sticky; top:124px; max-height:calc(100vh - 148px); overflow:auto;
}
.ps .railsearch{position:relative}
.ps .rail input{
  width:100%; background:var(--surf2); border:0; border-bottom:1px solid var(--line);
  color:var(--txt); padding:11px 30px 11px 13px; font-size:var(--t-small); outline:none;
  font-family:var(--ui); border-radius:var(--radius) var(--radius) 0 0;
}
.ps .rail input::placeholder{color:var(--ghost)}
.ps .rail input:focus{border-bottom-color:var(--cu); background:var(--surf3)}
.ps .railclear{
  position:absolute; right:6px; top:50%; transform:translateY(-50%);
  background:none; border:0; color:var(--faint); cursor:pointer; font-size:15px;
  line-height:1; padding:4px 6px; border-radius:3px;
}
.ps .railclear:hover{color:var(--txt); background:var(--surf3)}
.ps .railcount{
  display:block; padding:7px 13px 0; font-size:var(--t-micro); color:var(--ghost);
  letter-spacing:.02em;
}
.ps .rgrp{padding:12px 10px 4px}
.ps .ritem{
  display:block; width:100%; text-align:left; background:none; border:0; cursor:pointer;
  color:var(--dim); padding:6px 10px; font-size:var(--t-small); font-family:var(--ui);
  border-left:2px solid transparent; border-radius:0 3px 3px 0; line-height:1.45;
  transition:color .12s, background .12s;
}
.ps .ritem:hover{color:var(--txt); background:var(--surf2)}
.ps .ritem.on{color:var(--txt); background:var(--surf2); border-left-color:var(--cu); font-weight:600}

/* ----------------------------------------------------------------- cards */
.ps .card{
  border:1px solid var(--line); background:var(--surf); border-radius:var(--radius);
  padding:18px 20px; margin-bottom:var(--gap);
}
.ps .card > .eyebrow{display:block; margin-bottom:12px}
.ps h2{
  margin:0 0 6px; font-size:var(--t-h2); font-weight:650; letter-spacing:-.018em;
  line-height:1.25; color:var(--txt);
}
.ps h3{
  margin:0 0 10px; font-size:var(--t-h3); font-weight:600; letter-spacing:-.008em;
  color:var(--txt); line-height:1.35;
}
.ps p{margin:0 0 11px; color:var(--dim); max-width:74ch}
.ps .lede{font-size:var(--t-lead); line-height:1.55; color:var(--dim)}

/* ----------------------------------------------------------------- chips */
.ps .chips{display:flex; gap:7px; flex-wrap:wrap; margin:12px 0 0}
.ps .chip{
  font-family:var(--ui); font-size:var(--t-fine); font-weight:500; letter-spacing:.01em;
  border:1px solid var(--line2); color:var(--dim); padding:3px 10px; border-radius:99px;
}
.ps .chip.cu{border-color:#5A431F; color:var(--cu); background:#1B140A}
.ps .chip.cy{border-color:#1E4B52; color:var(--cy); background:#0B1E21}
.ps .chip.vi{border-color:#3B2E5E; color:var(--vi); background:#150F24}

/* ------------------------------------------------------------- schematic */
.ps .sch{
  background:var(--surf2); border:1px solid var(--line); border-radius:3px; padding:8px;
  background-image:linear-gradient(rgba(255,255,255,.026) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(255,255,255,.026) 1px,transparent 1px);
  background-size:22px 22px;
}
.ps .grid2{display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px}
.ps .grid3{display:grid; grid-template-columns:repeat(auto-fit,minmax(232px,1fr)); gap:16px}

/* ---------------------------------------------------------------- inputs */
.ps .fields{display:grid; grid-template-columns:repeat(auto-fit,minmax(136px,1fr)); gap:11px}
.ps .fld label{display:block; margin-bottom:4px; font-size:var(--t-fine); color:var(--dim)}
.ps .fld input{
  width:100%; background:var(--bg); border:1px solid var(--line); color:var(--txt);
  padding:8px 9px; font-size:var(--t-body); border-radius:3px; outline:none;
  font-family:var(--num); font-variant-numeric:tabular-nums;
  transition:border-color .12s, background .12s;
}
.ps .fld input:focus{border-color:var(--cu); background:var(--surf3)}
.ps .fld input.bad{border-color:var(--rd); background:#1A1110}
.ps .fld .u{color:var(--faint); font-family:var(--num); font-size:var(--t-micro)}

/* ---------------------------------------------------------------- tables */
.ps table{width:100%; border-collapse:collapse; font-size:var(--t-small)}
.ps td,.ps th{padding:7px 9px; text-align:left; border-bottom:1px solid var(--line);
  vertical-align:top}
.ps th{
  color:var(--faint); font-weight:600; font-size:var(--t-micro); letter-spacing:.11em;
  text-transform:uppercase; font-family:var(--ui); white-space:nowrap;
}
.ps tr:last-child td{border-bottom:0}
.ps tbody tr{transition:background .12s}
.ps tbody tr:hover{background:rgba(255,255,255,.022)}
.ps td.k{color:var(--dim); width:46%; font-family:var(--ui)}
.ps td.v{
  font-family:var(--num); color:var(--txt); font-weight:500; text-align:right;
  font-variant-numeric:tabular-nums; white-space:nowrap;
}
.ps td.n{color:var(--faint); font-size:var(--t-fine); font-family:var(--ui);
  font-weight:400; letter-spacing:0}
.ps td.v .n{text-align:right; margin-top:3px; white-space:normal; line-height:1.4}
.ps th.r,.ps td.r{text-align:right}

/* ------------------------------------------------ animated operation figure */
.ps .fig{position:relative}
.ps .fig svg path,.ps .fig svg line,.ps .fig svg circle,.ps .fig svg rect,.ps .fig svg text{
  transition:stroke .2s ease, fill .2s ease, opacity .2s ease, stroke-width .2s ease;
}
.ps .fig .hot path,.ps .fig .hot line{stroke:var(--cu) !important}
.ps .fig .hot path[fill]{fill:var(--cu)}
.ps .fig .hot text{fill:var(--cu) !important}
.ps .fig .cold path,.ps .fig .cold line{stroke:#31435A !important; opacity:.85}
.ps .fig .cold path[fill]{fill:#31435A}
.ps .fig .cold text{fill:#4C5F73 !important}
.ps .fig .lever{transition:all .22s cubic-bezier(.34,1.56,.64,1)}
/* The flow paths are redrawn every frame — their dash offset and width are
   the animation. Easing them would make the current lag the waveform and
   smear the wrap at the end of the cycle. */
.ps .fig .flow,.ps .fig .flowp,.ps .fig .flowglow,.ps .fig .flowdim,
.ps .fig .dflow,.ps .hmgrid rect{transition:none !important}
.ps .flow{
  fill:none; stroke:var(--cu); stroke-width:2.8; stroke-linecap:round;
  stroke-dasharray:3 15; opacity:.95; pointer-events:none;
}
.ps .flow.b{stroke:var(--cy)}
.ps .cap{
  font-size:var(--t-body); line-height:1.62; color:var(--dim); margin:12px 0 0;
  min-height:40px; border-left:2px solid var(--line2); padding-left:13px; max-width:82ch;
}
.ps .cap b{
  color:var(--cu); font-family:var(--ui); font-size:var(--t-fine); font-weight:650;
  letter-spacing:.06em; text-transform:uppercase;
}

/* --------------------------------------------------------- control bars */
.ps .ctl,.ps .flowctl{display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin:14px 0 0}
.ps .flowctl{margin:10px 0 13px}
.ps .ctl button,.ps .flowctl button{
  font-family:var(--ui); font-size:var(--t-fine); font-weight:500; letter-spacing:.01em;
  background:var(--surf2); color:var(--dim); border:1px solid var(--line);
  border-radius:3px; padding:6px 12px; cursor:pointer;
  transition:color .13s, border-color .13s, background .13s;
}
.ps .ctl button:hover,.ps .flowctl button:hover{color:var(--txt); border-color:var(--line2)}
.ps .ctl button.on,.ps .flowctl button.on{
  background:var(--cu); border-color:var(--cu); color:#0C1017; font-weight:600;
}
.ps .ctl .sp,.ps .flowctl .sp{flex:0 0 10px}
.ps .ctl button[aria-pressed="true"]{box-shadow:0 0 0 1px rgba(227,168,92,.28)}

/* --------------------------------------------------------------- equations */
.ps .eq{
  border-left:2px solid var(--cu); padding:2px 0 4px 16px; margin:0 0 17px;
  color:var(--txt); overflow-x:auto; overflow-y:hidden;
}
.ps .eq:last-child{margin-bottom:0}
.ps .eq .src{
  display:block; font-family:var(--ui); font-style:normal; font-size:var(--t-micro);
  font-weight:600; letter-spacing:.11em; color:var(--faint); margin-top:6px;
  text-transform:uppercase;
}
.ps .eq small{
  display:block; font-family:var(--ui); color:var(--dim);
  font-size:var(--t-fine); line-height:1.55; margin-top:6px; letter-spacing:0;
  white-space:normal; max-width:76ch;
}

/* KaTeX, tuned for a dark surface */
.ps .katex{font-size:1.14em; color:var(--txt)}
.ps .eq .katex-display{margin:0; text-align:left; padding:1px 0}
.ps .eq .katex-display > .katex{text-align:left}
.ps .katex .mord.text,.ps .katex .mop{color:var(--txt)}
.ps .katex .mrel,.ps .katex .mbin{color:var(--cu)}
.ps .katex .mopen,.ps .katex .mclose,.ps .katex .mpunct{color:var(--dim)}
.ps .katex .frac-line{border-bottom-color:var(--dim); border-bottom-width:.05em}
.ps .katex .sqrt > .root{color:var(--dim)}
.ps td .katex,.ps .fld .katex,.ps .warn .katex,.ps .lleg .katex,.ps .ird .katex{font-size:1em}
/* An eyebrow is uppercased and tracked out. Neither may reach the maths:
   uppercasing a variable turns v_out into V_OUT, which is a different
   quantity, and tracking pulls symbols away from their subscripts. */
.ps .eyebrow .katex{text-transform:none; letter-spacing:normal; font-size:1.12em}
.ps .eyebrow{overflow-wrap:break-word}
.ps td.k .katex,.ps .fld .katex{color:var(--dim)}
.ps td.k .katex .mrel,.ps .fld .katex .mrel{color:var(--dim)}
.ps .lleg .katex .mrel,.ps .lleg .katex .mbin{color:inherit}
.ps .katex-html{white-space:normal}

/* fallback typesetter, used only if a string fails to translate to LaTeX */
.ps .ef{font-family:var(--num); font-size:var(--t-body); line-height:1.6; color:var(--txt)}
.ps .mv{font-style:italic}
.ps .mu,.ps .mn{font-style:normal}
.ps .mn{font-variant-numeric:tabular-nums}
.ps .mr{color:var(--cu); padding:0 .3em; font-style:normal}
.ps .mo{color:var(--dim); padding:0 .07em; font-style:normal}
.ps .mx sub{font-size:.74em; vertical-align:-.22em; opacity:.82}
.ps .mx sup{font-size:.7em; vertical-align:.45em}

/* ------------------------------------------------------- flow overlay */
.ps .flowwrap{position:relative}
.ps .flowov{position:absolute; left:8px; right:8px; top:8px; bottom:8px; pointer-events:none}
.ps .flowglow{fill:none; stroke:var(--gn); stroke-width:8; opacity:.12;
  stroke-linecap:round; stroke-linejoin:round}
.ps .flowp{fill:none; stroke:var(--gn); stroke-linecap:round; stroke-linejoin:round;
  stroke-dasharray:7 13}
.ps .flowdim{fill:none; stroke:var(--faint); stroke-width:2; opacity:.4; stroke-dasharray:2 8}
.ps .ird{display:inline-flex; align-items:center; gap:8px; margin-left:auto;
  font-family:var(--num); font-size:var(--t-small); color:var(--dim);
  font-variant-numeric:tabular-nums}
.ps .ird b{color:var(--cu); font-weight:600}
.ps .ird em{font-style:normal; font-size:var(--t-micro); letter-spacing:.03em; font-family:var(--ui)}
.ps .ird em.up{color:var(--gn)} .ps .ird em.dn{color:var(--rd)}
.ps .wcur{position:absolute; top:8px; bottom:8px; width:1px; background:var(--txt);
  opacity:.55; pointer-events:none}
.ps .flownote{margin:13px 0 0; font-size:var(--t-body); color:var(--dim);
  line-height:1.62; max-width:82ch}

/* ------------------------------------------ device badges: switch vs diode
   A switch is COMMANDED — a lever visibly swings shut when the gate driver
   says so. A diode is not: it is a valve that responds to the voltage
   across it. They therefore get deliberately different vocabularies, so
   the two can never be mistaken for the same widget in two colours.      */
.ps .swb rect,.ps .dib rect{fill:#0C1017; stroke:var(--line); stroke-width:1; opacity:.96}
.ps .swb text,.ps .dib text{font-family:var(--ui); font-size:8.5px; font-weight:600;
  fill:var(--faint); letter-spacing:.05em}
.ps .swb circle{fill:var(--faint)}
.ps .swb path{stroke:var(--faint); stroke-width:1.8; fill:none; stroke-linecap:round}
.ps .swb .st{font-size:7px; font-weight:500; letter-spacing:.04em; fill:var(--ghost)}
.ps .swb.on rect{stroke:#2E5B45; fill:#0E1A14}
.ps .swb.on text{fill:var(--gn)}
.ps .swb.on circle{fill:var(--gn)}
.ps .swb.on path{stroke:var(--gn); stroke-width:2.2}
.ps .swb.on .st{fill:var(--gn-dim)}

/* diode: outlined valve behind a barrier when blocking, filled valve with
   current visibly running through it when forward biased */
.ps .dib .dtri{fill:none; stroke:var(--faint); stroke-width:1.5; stroke-linejoin:round}
.ps .dib .dbar{stroke:var(--faint); stroke-width:2.2; fill:none; stroke-linecap:round}
.ps .dib .dblock{stroke:var(--rd); stroke-width:1.5; fill:none; stroke-linecap:round;
  animation:psblock 2.2s ease-in-out infinite}
.ps .dib .dflow{stroke:var(--gn); stroke-width:2; fill:none; stroke-linecap:round;
  stroke-dasharray:2 5.5; animation:psdflow .62s linear infinite}
.ps .dib .st{font-size:7px; font-weight:500; letter-spacing:.04em; fill:var(--rd)}
.ps .dib.on rect{stroke:#2E5B45; fill:#0E1A14}
.ps .dib.on text{fill:var(--gn)}
.ps .dib.on .dtri{fill:var(--gn); stroke:var(--gn)}
.ps .dib.on .dbar{stroke:var(--gn); stroke-width:2.6}
.ps .dib.on .st{fill:var(--gn-dim)}
@keyframes psdflow{to{stroke-dashoffset:-7.5}}
@keyframes psblock{0%,100%{opacity:.4}50%{opacity:1}}

/* device state legend under the figure */
.ps .devleg{display:flex; flex-wrap:wrap; gap:6px 18px; margin:11px 0 0;
  font-size:var(--t-fine); color:var(--faint)}
.ps .devleg > span{display:inline-flex; align-items:center; gap:7px}
.ps .devleg i{width:7px; height:7px; border-radius:99px; display:inline-block; flex:none;
  background:var(--ghost)}
.ps .devleg b{font-family:var(--num); font-weight:600; color:var(--dim); font-size:var(--t-fine)}
.ps .devleg .lit i{background:var(--gn)}
.ps .devleg .lit b{color:var(--txt)}
.ps .devleg .blk i{background:var(--rd); opacity:.7}

/* --------------------------------------------------------------- EMC lens */
.ps .emcloop{fill:rgba(240,121,108,.07); stroke:var(--rd); stroke-width:2;
  stroke-dasharray:6 5; animation:psemc 2.4s ease-in-out infinite}
.ps .emcn{fill:rgba(168,139,240,.28); stroke:var(--vi); stroke-width:1.6}
.ps .emcn2{fill:rgba(168,139,240,.1); stroke:none; animation:psemc 2.4s ease-in-out infinite}
@keyframes psemc{0%,100%{opacity:.55}50%{opacity:1}}

/* ------------------------------------------------------------- loss bar */
.ps .lbar{display:flex; height:16px; border-radius:3px; overflow:hidden;
  border:1px solid var(--line); background:var(--surf2)}
.ps .lseg{height:100%; transition:width .3s ease}
/* One legend entry per grid cell rather than a wrapping flex row: each
   entry carries a formula, and formulas do not line-break, so they need a
   column wide enough to sit in instead of a scrollbar. */
.ps .lleg{display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr));
  gap:7px 24px; margin-top:10px;
  font-family:var(--ui); font-size:var(--t-fine); color:var(--dim)}
/* Direct children only. KaTeX builds its output from deeply nested spans,
   so a descendant selector here would turn every piece of every formula
   into a flex item and scatter the sub- and superscripts. */
.ps .lleg > span{display:inline-flex; align-items:baseline; gap:7px}
.ps .lleg i{width:8px; height:8px; border-radius:2px; display:inline-block; flex:none;
  transform:translateY(1px)}
.ps .lit{display:inline-flex; align-items:baseline; gap:7px; flex-wrap:wrap;
  min-width:0; max-width:100%}
.ps .lit b{color:var(--txt); font-weight:600}
.ps .lit em{font-style:normal; color:var(--faint); font-size:var(--t-micro); min-width:0}
/* Never put overflow on a .tex span: giving a KaTeX span its own scroll
   context breaks its strut-based baseline alignment and scatters the sub-
   and superscripts. Formulas are given columns wide enough to sit in
   instead — see .lleg — so nothing needs to scroll or be clipped. */

/* ---------------------------------------------------------------- lists */
.ps ul{margin:0; padding-left:18px; color:var(--dim)}
.ps li{margin-bottom:6px; max-width:70ch}
.ps li::marker{color:var(--ghost)}

/* -------------------------------------------------------------- warnings */
.ps .warn{
  border:1px solid #5A3126; background:#1E1210; color:#F2B2A8; padding:10px 13px;
  border-radius:3px; font-size:var(--t-small); margin-bottom:9px; line-height:1.55;
  max-width:none;
}
.ps .warn b{color:var(--rd); font-weight:650}
.ps .note{
  border:1px solid var(--line2); background:var(--surf2); color:var(--dim);
  padding:10px 13px; border-radius:3px; font-size:var(--t-small); margin-bottom:9px;
  line-height:1.55;
}
.ps .note b{color:var(--cy); font-weight:650}

/* --------------------------------------------------------------- filters */
.ps .flt{display:flex; gap:7px; flex-wrap:wrap; margin-bottom:18px}
.ps .flt button{
  background:var(--surf); border:1px solid var(--line); color:var(--dim); cursor:pointer;
  padding:6px 13px; font-size:var(--t-fine); border-radius:99px; font-weight:500;
  font-family:var(--ui); letter-spacing:.01em; transition:all .13s;
}
.ps .flt button:hover{color:var(--txt); border-color:var(--line2)}
.ps .flt button.on{color:var(--cu); border-color:#5A431F; background:#1B140A; font-weight:600}
.ps .sub{display:flex; gap:3px; border-bottom:1px solid var(--line); margin:0 0 16px}
.ps .sub button{
  background:none; border:0; border-bottom:2px solid transparent; color:var(--faint);
  padding:8px 13px; cursor:pointer; font-size:var(--t-fine); font-weight:500;
  font-family:var(--ui);
}
.ps .sub button.on{color:var(--cy); border-bottom-color:var(--cy); font-weight:600}
.ps .sub button:hover{color:var(--txt)}

/* ------------------------------------------------------------ stat tiles */
.ps .big{font-size:var(--t-display); font-weight:650; letter-spacing:-.024em;
  font-family:var(--num); font-variant-numeric:tabular-nums; line-height:1.15}
.ps .big.cu{color:var(--cu)} .ps .big.cy{color:var(--cy)} .ps .big.gn{color:var(--gn)}
.ps .big.vi{color:var(--vi)} .ps .big.rd{color:var(--rd)}
.ps .stat{border:1px solid var(--line); background:var(--surf2); padding:13px 15px;
  border-radius:3px}
.ps .stat .eyebrow{display:block; margin-bottom:6px}
.ps a{color:var(--cy); text-underline-offset:2px}

/* ---------------------------------------------------------------- heatmap */
.ps .hmwrap{position:relative}
.ps .hmgrid rect{shape-rendering:crispEdges; transition:opacity .12s}
.ps .hmcell:hover{stroke:var(--txt); stroke-width:1.4}
.ps .hmop{fill:none; stroke:#0C1017; stroke-width:3}
.ps .hmop2{fill:none; stroke:var(--txt); stroke-width:1.6}
.ps .hmtip{
  position:absolute; pointer-events:none; z-index:5; background:var(--surf3);
  border:1px solid var(--line3); border-radius:4px; padding:8px 11px;
  font-size:var(--t-fine); color:var(--txt); line-height:1.5; min-width:150px;
  box-shadow:0 6px 22px rgba(0,0,0,.5);
}
.ps .hmtip b{font-family:var(--num); font-weight:600; font-variant-numeric:tabular-nums}
.ps .hmtip em{font-style:normal; color:var(--faint); display:block; margin-top:3px;
  font-size:var(--t-micro)}
.ps .hmscale{display:flex; align-items:center; gap:9px; margin-top:11px;
  font-size:var(--t-micro); color:var(--faint); font-family:var(--num);
  font-variant-numeric:tabular-nums}
.ps .hmbar{flex:1; height:9px; border-radius:2px; border:1px solid var(--line);
  max-width:280px}

/* ----------------------------------------------------------------- footer */
.ps .foot{color:var(--faint); font-size:var(--t-small); padding:0 22px;
  max-width:1440px; margin:0 auto; line-height:1.6}

/* --------------------------------------------------------------- widths
   Desktop only — there are deliberately no width breakpoints. See the
   README before adding any.

   These rules are NOT narrow-screen support. Every grid track is
   minmax(0,1fr) rather than a bare 1fr because 1fr keeps an automatic
   minimum equal to the track's max-content width: one wide results table
   would then push the layout past its own container at any window size,
   including a half-screen desktop window. */
.ps main{min-width:0}
.ps .layout,.ps .grid2,.ps .grid3,.ps .fields{min-width:0}
.ps .grid2 > *,.ps .grid3 > *,.ps .layout > *{min-width:0}
/* The selector table has six columns and is genuinely wider than a narrow
   desktop window; it scrolls inside its own card rather than stretching
   the page. */
.ps .scrollx{overflow-x:auto; max-width:100%}
.ps .scrollx table{min-width:640px}
@media (prefers-reduced-motion:reduce){
  .ps *{transition:none !important; animation:none !important}
}
`;
