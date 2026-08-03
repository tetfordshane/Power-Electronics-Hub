import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { CSS } from "./styles.js";
import { Eq, Mx, Mixed, Sub } from "./tex.jsx";
import { FIELDS, order } from "./fields.js";
import { clamp } from "./format.js";
import { TOPOS, CATS, FLOW, FAMILY } from "./topologies/index.js";
import { simFacts, engineFor } from "./engine/adapter.js";
import { SHEETS } from "./content/sheets.js";
import { SELECT, SELECT_ID } from "./content/select.js";
import { EXAMPLES } from "./content/examples.js";
import { termsFor } from "./content/terms.js";
import { SCH } from "./schematic/sch.jsx";
import { drawScope } from "./schematic/parts.jsx";
import { mkRaw, Fields } from "./ui/Fields.jsx";
import { Results } from "./ui/Results.jsx";
import { FlowCard } from "./ui/FlowCard.jsx";
import { HeatCard } from "./ui/HeatCard.jsx";
import { SpecCard } from "./ui/SpecCard.jsx";

const TABS = [["bench", "Bench"], ["cheat", "Cheat sheet"], ["select", "Selector"]];

/* Move the entered values from one topology to another. Only what the user
   actually changed travels: a switching frequency or an output current
   means the same thing on the next page and re-typing it is pure friction,
   but each topology's own defaults exist because its sensible operating
   point differs, so an untouched field takes the new page's default rather
   than dragging a 3.3 V buck output onto a boost that cannot produce it. */
function carryOver(fromId, toId, prev) {
  const fromDefaults = mkRaw(fromId);
  const next = mkRaw(toId);
  Object.keys(next).forEach((k) => {
    const edited = prev[k] !== undefined && fromDefaults[k] !== undefined
      && prev[k] !== fromDefaults[k];
    if (edited) next[k] = prev[k];
  });
  return next;
}

/* The tab and the topology live in the URL hash, so the back button works,
   a reload lands where you left off, and a specific converter can be sent
   to someone as a link. */
function readHash() {
  if (typeof window === "undefined") return {};
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h) return {};
  const [tab, tid] = h.split("/");
  return {
    tab: ["bench", "cheat", "select"].includes(tab) ? tab : undefined,
    tid: tid && TOPOS.some((t) => t.id === tid) ? tid : undefined,
  };
}

/* The words this page used, defined. Scanned out of the page's own prose, so
   there is nothing per-topology to keep in step: write a new interval note
   that mentions dead time and the definition appears by itself. */
function TermCard({ topo }) {
  const F = FLOW[topo.id];
  /* Everything the reader can see on the page, including the equations and
     their footnotes — those carry most of the vocabulary a beginner trips
     over ("ideal CCM", "the real duty", "drops into DCM"), and leaving them
     out gave the buck page two definitions when it wanted five. */
  const text = [topo.tag, topo.what, (topo.chips || []).join(" "),
    (topo.pros || []).join(" "), (topo.cons || []).join(" "), (topo.use || []).join(" "),
    (topo.eqs || []).map((e) => e.e + " " + (e.n || "")).join(" "),
    FAMILY[topo.id] || "", (F && F.ph ? F.ph.map((q) => q.n).join(" ") : ""),
    /* The worked examples are prose on this page too, and they are where the
       vocabulary a beginner has not met yet tends to turn up first — hold-up
       time, crest factor, loaded Q. A term defined nowhere because it was
       only ever said in an example is the fault this scan exists to avoid. */
    (EXAMPLES[topo.cat] || []).map((x) => x.t + " " + x.n).join(" ")].join(" ");
  const hits = termsFor(text);
  if (!hits.length) return null;
  return (
    <div className="card">
      <h3 className="eyebrow">Terms used on this page</h3>
      <dl className="terms">
        {hits.map(([name, , def]) => (
          <div key={name}>
            <dt><Sub t={name} /></dt>
            <dd><Sub t={def} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function App() {
  const start = readHash();
  const [tab, setTab] = useState(start.tab || "bench");
  const [tid, setTid] = useState(start.tid || "buck");
  const [q, setQ] = useState("");
  const [sq, setSq] = useState("");
  const [raw, setRaw] = useState(() => mkRaw(start.tid || "buck"));
  const [scat, setScat] = useState("All");
  const tabRefs = useRef([]);

  useEffect(() => {
    const want = "#/" + tab + (tab === "bench" ? "/" + tid : "");
    if (window.location.hash !== want) window.history.replaceState(null, "", want);
  }, [tab, tid]);
  /* A hash change — the back button, a pasted link, an in-page jump — moves
     to a different topology without reloading, so the inputs have to be
     rebuilt for it. Setting tid alone left the panel showing the previous
     topology's values, and blanks wherever the two field lists differed. */
  useEffect(() => {
    const on = () => {
      const h = readHash();
      if (h.tab) setTab(h.tab);
      if (h.tid) setTid((prevId) => {
        if (h.tid !== prevId) setRaw((prev) => carryOver(prevId, h.tid, prev));
        return h.tid;
      });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const topo = TOPOS.find((t) => t.id === tid) || TOPOS[0];

  /* Sanitise once, here, so no design() ever has to defend itself. Anything
     unparseable falls back to the field default; anything out of range is
     clamped to the nearest usable value; anything out of ORDER with its
     siblings is pushed back into order. The field itself shows the user that
     their entry was rewritten (see Fields). */
  const spec = useMemo(() => {
    const o = {};
    Object.entries(raw).forEach(([k, v]) => {
      const F = FIELDS[k];
      const n = parseFloat(v);
      const base = isFinite(n) ? n : (F ? F.d : 0);
      o[k] = F && F.mn !== undefined ? clamp(base, F.mn, F.mx) : base;
    });
    return order(o);
  }, [raw]);

  /* A thrown exception and a design that simply yields no numbers are
     different failures and get different messages — the old code caught
     everything and reported "enter a full set of numbers", which was both
     wrong and unhelpful when the real cause was a bug. */
  const res = useMemo(() => {
    if (!topo.design) return null;
    try { return topo.design(spec); } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }, [topo, spec]);

  /* What the circuit says about the design, where there is a circuit to ask.
     Shares one engine with the figure — the cache in the adapter is keyed on
     the operating point AND the components, so this costs nothing beyond the
     run the figure was going to do anyway. Null for every topology that has
     no netlist yet, and the panel simply says nothing. */
  const sim = useMemo(() => {
    if (!res || res.error || res.infeasible) return null;
    try { return simFacts(topo, spec, res); } catch { return null; }
  }, [topo, spec, res]);

  /* Picking a topology carries the reader's edits across; loading a worked
     example does not. An example is a specific job with its own numbers, and
     inheriting a half-finished design into it would answer a question nobody
     asked — so it starts from that topology's defaults and patches them. */
  /* The cycle the results panel draws its sparklines from. Same engine, same
     cache key, same operating point as the figure and as simFacts above — so
     this is a lookup rather than a second run to steady state, and the shapes
     beside the numbers cannot disagree with the shapes in the figure. */
  const cyc = useMemo(() => {
    if (!res || res.error || res.infeasible || !res.wave) return null;
    try { return engineFor(topo, spec, res).cycle(); } catch { return null; }
  }, [topo, spec, res]);

  const pick = useCallback((id, over) => {
    setRaw((prev) => (over ? { ...mkRaw(id), ...over } : carryOver(tid, id, prev)));
    setTid(id);
    setTab("bench");
  }, [tid]);
  const set = (k, v) => setRaw((r) => ({ ...r, [k]: v }));

  /* Fold diacritics so "cuk" finds "Ćuk" — otherwise the entry is
     unreachable by typing, because nobody reaches for Ć. */
  const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(q.trim());
  const hits = TOPOS.filter((t) =>
    !needle || fold(t.name + " " + t.cat + " " + t.tag + " " + t.chips.join(" ")).includes(needle));
  const sheetNeedle = fold(sq.trim());
  const sheetCats = ["All", ...Array.from(new Set(SHEETS.map((s) => s.cat)))];
  const sheets = SHEETS.filter((s) => (scat === "All" || s.cat === scat)
    && (!sheetNeedle || fold(s.title + " " + s.cat + " "
      + s.rows.map((r) => r.e + " " + (r.n || "")).join(" ")).includes(sheetNeedle)));

  return (
    <div className="ps">
      <style>{CSS}</style>
      <div className="hdr">
        <div className="brand">
          <h1>POWER<b>·</b>STAGE</h1>
          <span>interactive designer and reference · {TOPOS.length} topologies</span>
        </div>
        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map(([k, l], i) => (
            <button key={k} id={"tab-" + k} role="tab" ref={(el) => { tabRefs.current[i] = el; }}
              aria-selected={tab === k} aria-controls={"panel-" + k} tabIndex={tab === k ? 0 : -1}
              className={"tab" + (tab === k ? " on" : "")}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const n = (i + d + TABS.length) % TABS.length;
                setTab(TABS[n][0]);
                if (tabRefs.current[n]) tabRefs.current[n].focus();
              }}
              onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "bench" && (
        <div className="wrap" id="panel-bench" role="tabpanel" aria-labelledby="tab-bench"><div className="layout">
          <nav className="rail" aria-label="Topologies">
            <div className="railsearch">
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Filter topologies…" aria-label="Filter topologies" />
              {q ? <button className="railclear" onClick={() => setQ("")} aria-label="Clear filter">×</button> : null}
            </div>
            {q ? (
              <span className="railcount" role="status" aria-live="polite">
                {hits.length} of {TOPOS.length} topologies
              </span>
            ) : null}
            {CATS.map((c) => {
              const list = hits.filter((t) => t.cat === c);
              if (!list.length) return null;
              return (
                <div className="rgrp" key={c}>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{c}</span>
                  {list.map((t) => (
                    <button key={t.id} className={"ritem" + (t.id === tid ? " on" : "")}
                      aria-current={t.id === tid ? "true" : undefined}
                      onClick={() => pick(t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              );
            })}
            {!hits.length && (
              <div className="rgrp">
                <p style={{ fontSize: "var(--t-fine)", margin: "4px 0 10px" }}>
                  Nothing matches “{q}”.
                </p>
                <button className="ritem" onClick={() => setQ("")}>Clear the filter</button>
              </div>
            )}
          </nav>

          <main>
            <div className="card">
              <span className="eyebrow">{topo.cat}</span>
              <h2>{topo.name}</h2>
              <p style={{ marginBottom: 2 }}><Sub t={topo.tag} /></p>
              <div className="chips" style={{ marginBottom: 14 }}>
                {topo.chips.map((c, i) => <span key={i} className={"chip " + ["cu", "cy", "vi"][i % 3]}>{c}</span>)}
              </div>
              {/* The same schematic, twice, was the single most confusing thing
                  on the page. Where a topology has a traced conduction path,
                  the card below draws this exact circuit again — with devices
                  that light up, current that moves and polarity marks that
                  flip — and a reader scrolling past two identical drawings
                  reasonably assumes they are two different circuits and starts
                  looking for the difference. So the static copy only appears
                  where nothing better follows it. */}
              {!FLOW[topo.id] && SCH[topo.sch]
                ? React.cloneElement(SCH[topo.sch](), { label: topo.name + " schematic" })
                : null}
              <p style={{ margin: "14px 0 0" }}><Sub t={topo.what} /></p>
            </div>

            {/* Every topology traces its own circuit now, so there is one
                branch here where there used to be two. The generic family
                figure it replaced came with a note admitting the drawing was
                not the schematic above it; what that figure was genuinely
                good at — placing a converter in its family — survives as the
                `fam` line inside the card. */}
            <FlowCard topo={topo} res={res} spec={spec} />

            <div className="card">
              <h3 className="eyebrow">Specification</h3>
              <Fields topo={topo} raw={raw} spec={spec} set={set} />
            </div>

            <div className="card">
              <h3 className="eyebrow">Design output</h3>
              <Results res={res} spec={spec} hideWave={!!FLOW[topo.id]} sim={sim} cyc={cyc} />
            </div>

            <HeatCard topo={topo} spec={spec} />

            <SpecCard topo={topo} spec={spec} res={res} />

            <div className="card">
              <h3 className="eyebrow">Governing equations</h3>
              {topo.eqs.map((e, i) => <Eq key={i} e={e.e} n={e.n} />)}
            </div>

            <div className="card">
              <span className="eyebrow">Trade-offs</span>
              <div className="grid3">
                <div><h3 style={{ color: "#6FD39B" }}>Strengths</h3><ul>{topo.pros.map((x, i) => <li key={i}><Sub t={x} /></li>)}</ul></div>
                <div><h3 style={{ color: "#F0796C" }}>Costs</h3><ul>{topo.cons.map((x, i) => <li key={i}><Sub t={x} /></li>)}</ul></div>
                <div><h3 style={{ color: "#E0A458" }}>Found in</h3><ul>{topo.use.map((x, i) => <li key={i}><Sub t={x} /></li>)}</ul></div>
              </div>
            </div>

            {/* Where the numbers come from. Every other card answers "what do
                these inputs give me"; a reader who has never sized a converter
                arrives with no inputs at all, and the defaults are a sensible
                operating point rather than a job anyone has. These are jobs —
                loadable, so the question becomes an experiment. */}
            {(EXAMPLES[topo.cat] || []).length ? (
              <div className="card">
                <h3 className="eyebrow">Worked examples · {topo.cat}</h3>
                {EXAMPLES[topo.cat].map((x, i) => {
                  const to = TOPOS.find((q) => q.id === x.go.tid);
                  const here = x.go.tid === topo.id;
                  return (
                    <div className="wex" key={i}>
                      <b><Sub t={x.t} /></b>
                      <Eq e={x.e} n={x.n} />
                      <button className="ritem wexgo" onClick={() => pick(x.go.tid, x.go.over)}>
                        {here ? "Load these numbers" : "Load this on the " + to.name + " page"} →
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <TermCard topo={topo} /></main>
        </div></div>
      )}

      {tab === "cheat" && (
        <div className="wrap" id="panel-cheat" role="tabpanel" aria-labelledby="tab-cheat">
          <div className="railsearch" style={{ maxWidth: 340, marginBottom: 14 }}>
            <input className="sheetsearch" value={sq} onChange={(e) => setSq(e.target.value)}
              placeholder="Search the cheat sheet…" aria-label="Search the cheat sheet" />
            {sq ? <button className="railclear" onClick={() => setSq("")} aria-label="Clear search">×</button> : null}
          </div>
          <div className="flt">
            {sheetCats.map((c) => (
              <button key={c} className={scat === c ? "on" : ""} onClick={() => setScat(c)}
                aria-pressed={scat === c}>{c}</button>
            ))}
          </div>
          {sq || scat !== "All" ? (
            <p role="status" aria-live="polite" style={{ fontSize: "var(--t-fine)", marginTop: -6 }}>
              {sheets.length} of {SHEETS.length} sections
            </p>
          ) : null}
          <div className="grid2">
            {sheets.map((s, i) => (
              <div className="card" key={i}>
                <span className="eyebrow">{s.cat}</span>
                <h3 style={{ marginBottom: 12 }}>{s.title}</h3>
                {s.rows.map((r, j) => <Eq key={j} e={r.e} n={r.n} src={r.src} />)}
              </div>
            ))}
          </div>
          {!sheets.length ? (
            <div className="card"><p>Nothing matches “{sq}”. <button className="ritem"
              style={{ display: "inline", width: "auto", padding: "2px 6px" }}
              onClick={() => { setSq(""); setScat("All"); }}>Clear the search</button></p></div>
          ) : null}
        </div>
      )}

      {tab === "select" && (
        <div className="wrap" id="panel-select" role="tabpanel" aria-labelledby="tab-select">
          <div className="card">
            <span className="eyebrow">Pick a topology</span>
            <h3>Five questions, in this order</h3>
            <ul style={{ marginBottom: 14 }}>
              <li><b style={{ color: "#E4ECF4" }}>Do you need isolation?</b> Safety, ground loops or a large potential difference — if yes, everything in the isolated column, and the answer is usually a flyback below 150 W and a bridge above it.</li>
              <li><b style={{ color: "#E4ECF4" }}>Does V_in cross V_out?</b> If it does, you need a buck-boost family member: four-switch for efficiency, SEPIC for simplicity, Ćuk or Zeta if the ripple has to sit on a particular port.</li>
              <li><b style={{ color: "#E4ECF4" }}>How much power?</b> Above roughly 500 W, single-switch topologies stop making sense — move to bridges. Above 1 kW, start asking about soft switching.</li>
              <li><b style={{ color: "#E4ECF4" }}>What is the real constraint?</b> Efficiency, height, cost, EMI, transient response. Each points toward a different solution, and they rarely coincide.</li>
              <li><b style={{ color: "#E4ECF4" }}>How will you rectify?</b> A separate decision from the primary topology, and often the bigger lever. Below about 12 V out, the diode drop costs more than anything you will win on the primary side — go synchronous, and use a current doubler once the output current passes roughly 20 A.</li>
            </ul>
            <p style={{ fontSize: "var(--t-fine)", color: "var(--faint)" }}>
              Every row below that maps to a converter on the bench is clickable — it opens that
              design with your current numbers already filled in.
            </p>
            <div className="scrollx">
              <table>
                <thead><tr>
                  <th>Topology</th><th>Conversion</th><th>Isolated</th><th>Typical power</th>
                  <th>Switch stress</th><th>Character</th>
                </tr></thead>
                <tbody>
                  {SELECT.map((r, i) => {
                    const id = SELECT_ID[r[0]];
                    const go = id ? () => pick(id) : null;
                    return (
                      <tr key={i} onClick={go || undefined}
                        tabIndex={go ? 0 : undefined}
                        role={go ? "link" : undefined}
                        onKeyDown={go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } : undefined}
                        title={go ? "Open " + r[0] + " on the bench" : undefined}
                        style={go ? { cursor: "pointer" } : undefined}>
                        <td style={{ color: go ? "var(--cy)" : "var(--txt)" }}>{r[0]}</td>
                        <td><Mx t={r[1]} /></td>
                        <td className="n" style={{ color: r[2] === "yes" ? "#6FD39B" : "#5C6E82" }}>{r[2]}</td>
                        <td className="n">{r[3]}</td>
                        <td className="v" style={{ fontSize: "var(--t-fine)" }}><Mx t={r[4]} /></td>
                        <td className="n"><Sub t={r[5]} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <p className="foot">
        Every number here is a first-pass estimate from idealised models — enough to choose parts and sanity-check a datasheet,
        not a substitute for simulation and a prototype. Loss figures ignore layout parasitics, core loss and temperature rise.
      </p>
    </div>
  );
}
