import React, { useMemo } from "react";
import katex from "katex";

/* =====================================================================
   Typesetting.

   The topology data holds ~200 formulas written in a compact linear
   notation — "C_out = ΔI_L/(8·f_sw·ΔV)", "R_DS(on)", "√(L_r/C_r)". Rather
   than rewrite every one of them by hand as LaTeX, this module parses that
   notation and emits LaTeX for KaTeX to set.

   The parse is a small recursive descent over relations → sums → products
   → powers → atoms. Doing it properly (rather than with string replaces)
   is what buys real stacked fractions and correctly sized radicals and
   delimiters, which is the visible difference between "monospace with
   subscripts" and typeset mathematics.

   Prose is left alone. A note like "ripple is worst at V_in max" is mostly
   English, and setting English in math italics is exactly the mistake that
   makes technical documents look amateurish. splitRuns separates the two
   so words stay in the UI face and only the symbols go through KaTeX.
   ===================================================================== */

/* ------------------------------------------------------------- lexicon */
const GREEK = {
  Δ: "\\Delta", π: "\\pi", η: "\\eta", φ: "\\varphi", ϕ: "\\varphi", ω: "\\omega",
  θ: "\\theta", Ω: "\\Omega", µ: "\\mu", μ: "\\mu", α: "\\alpha", β: "\\beta",
  ρ: "\\rho", λ: "\\lambda", τ: "\\tau", σ: "\\sigma", Φ: "\\Phi", Σ: "\\Sigma",
  γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ψ: "\\psi", χ: "\\chi", Λ: "\\Lambda",
};
const REL = {
  "=": "=", "≈": "\\approx", "≤": "\\le", "≥": "\\ge", "<": "<", ">": ">",
  "∝": "\\propto", "≡": "\\equiv", "→": "\\to", "≠": "\\ne", "≪": "\\ll", "≫": "\\gg",
  ":": ":",
};
const ADD = { "+": "+", "-": "-", "−": "-", "±": "\\pm", "∓": "\\mp" };
const MUL = { "·": "\\cdot", "×": "\\times", "*": "\\cdot" };
const FUNCS = new Set(["sin", "cos", "tan", "arcsin", "arccos", "arctan", "atan",
  "log", "ln", "exp", "sinh", "cosh", "tanh", "sinc"]);
const OPNAME = new Set(["max", "min", "floor", "ceil", "avg", "rms", "sgn", "mod", "round"]);
/* set upright and spaced when they follow a number */
const UNITS = new Set(["V", "A", "W", "F", "H", "J", "K", "N", "C", "T", "S", "s", "m",
  "Hz", "kHz", "MHz", "GHz", "mm", "cm", "nm", "ns", "ps", "us", "ms", "µs", "µm", "µH",
  "µF", "mH", "nH", "pF", "nF", "mF", "mΩ", "Ω", "kΩ", "dB", "dBµV", "oz", "mT", "T",
  "VA", "Vrms", "var", "rpm", "mV", "kV", "mA", "kA", "kW", "MW", "mW", "µA", "Wb"]);
/* subscripts that are numbers stay numbers; everything else is an abbreviation */
const isNum = (c) => c >= "0" && c <= "9";
const isAlpha = (c) => /[A-Za-zΑ-Ωα-ωµμ]/.test(c);

/* ------------------------------------------------------------- lexer */
function lex(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === " ") { i++; continue; }
    if (isNum(c) || (c === "." && isNum(src[i + 1]))) {
      let j = i;
      while (j < src.length && (isNum(src[j]) || src[j] === ".")) j++;
      t.push({ k: "num", v: src.slice(i, j) }); i = j; continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < src.length && isAlpha(src[j])) j++;
      const base = src.slice(i, j);
      i = j;
      let sub = null;
      /* A component designator writes its index tight against the letter:
         Q1, D4, C_1, L2. Without this the digit is read as a separate
         factor and set as "Q 1", with multiplication spacing. */
      if (sub === null && /^[A-Z]$/.test(base) && /^[0-9]{1,2}(?![0-9])/.test(src.slice(i))) {
        const d = src.slice(i).match(/^[0-9]{1,2}/)[0];
        sub = d; i += d.length;
      }
      if (sub === null && src[i] === "_") {
        const k = i + 1;
        if (src[k] === "{") {
          const e = src.indexOf("}", k);
          if (e > 0) { sub = src.slice(k + 1, e); i = e + 1; }
        } else {
          let m = k;
          while (m < src.length && /[A-Za-zΑ-Ωα-ω0-9]/.test(src[m])) m++;
          if (m > k) {
            sub = src.slice(k, m); i = m;
            /* a bracketed qualifier belongs to the subscript: R_DS(on) */
            if (src[i] === "(") {
              const e = src.indexOf(")", i);
              if (e > 0 && /^[A-Za-z.\-]{1,5}$/.test(src.slice(i + 1, e))) {
                sub += "(" + src.slice(i + 1, e) + ")"; i = e + 1;
              }
            }
          }
        }
      }
      t.push({ k: "id", v: base, sub }); continue;
    }
    if (GREEK[c]) {
      /* a Greek letter can carry a subscript too: ΔI_L, φ_m */
      let j = i + 1, sub = null;
      if (src[j] === "_") {
        let m = j + 1;
        while (m < src.length && /[A-Za-zΑ-Ωα-ω0-9]/.test(src[m])) m++;
        if (m > j + 1) { sub = src.slice(j + 1, m); j = m; }
      }
      t.push({ k: "greek", v: c, sub }); i = j; continue;
    }
    if (REL[c]) { t.push({ k: "rel", v: c }); i++; continue; }
    if (ADD[c]) { t.push({ k: "add", v: c }); i++; continue; }
    if (MUL[c]) { t.push({ k: "mul", v: c }); i++; continue; }
    if (c === "/") { t.push({ k: "div" }); i++; continue; }
    if (c === "^") { t.push({ k: "pow" }); i++; continue; }
    if (c === "√") { t.push({ k: "sqrt" }); i++; continue; }
    if (c === "(" || c === "[") { t.push({ k: "lp", v: c }); i++; continue; }
    if (c === ")" || c === "]") { t.push({ k: "rp", v: c }); i++; continue; }
    if (c === "|") { t.push({ k: "abs" }); i++; continue; }
    if (c === "²") { t.push({ k: "sup", v: "2" }); i++; continue; }
    if (c === "³") { t.push({ k: "sup", v: "3" }); i++; continue; }
    if (c === "½") { t.push({ k: "frac", v: ["1", "2"] }); i++; continue; }
    if (c === "¼") { t.push({ k: "frac", v: ["1", "4"] }); i++; continue; }
    if (c === "°") {
      /* "°C" and "°F" are one unit, not a degree sign times a variable */
      if (src[i + 1] === "C" || src[i + 1] === "F") {
        t.push({ k: "raw", v: "^{\\circ}\\mathrm{" + src[i + 1] + "}" }); i += 2; continue;
      }
      t.push({ k: "deg" }); i++; continue;
    }
    if (c === "~") { t.push({ k: "approx" }); i++; continue; }
    if (c === "%") { t.push({ k: "raw", v: "\\%" }); i++; continue; }
    if (c === ",") { t.push({ k: "raw", v: "{,}\\;" }); i++; continue; }
    if (c === "∫") { t.push({ k: "raw", v: "\\int" }); i++; continue; }
    if (c === "∞") { t.push({ k: "raw", v: "\\infty" }); i++; continue; }
    t.push({ k: "raw", v: "\\text{" + c.replace(/([\\{}$&#_%])/g, "\\$1") + "}" });
    i++;
  }
  return t;
}

/* --------------------------------------------------------- emitters */
const sub = (s) => {
  if (s === null || s === undefined || s === "") return "";
  return /^[0-9]+$/.test(s) ? "_{" + s + "}" : "_{\\mathrm{" + esc(s) + "}}";
};
const esc = (s) => String(s).replace(/([\\{}$&#%_])/g, "\\$1");
const ident = (tok, prevNum) => {
  const b = tok.v;
  if (FUNCS.has(b)) return "\\" + b + " ";
  if (OPNAME.has(b)) return "\\operatorname{" + b + "}";
  if (prevNum && UNITS.has(b) && !tok.sub) return "\\,\\mathrm{" + esc(b) + "}";
  if (b.length === 1) return b + sub(tok.sub);
  return "\\mathrm{" + esc(b) + "}" + sub(tok.sub);
};

/* --------------------------------------------------------- parser */
function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  /* atom: the smallest self-contained piece */
  function atom(prevNum) {
    const t = peek();
    if (!t) return "";
    if (t.k === "num") { eat(); return t.v; }
    if (t.k === "id") {
      eat();
      const s = ident(t, prevNum);
      /* function or operator name applied to a bracketed argument */
      if ((FUNCS.has(t.v) || OPNAME.has(t.v)) && peek() && peek().k === "lp") {
        eat();
        const inner = relation();
        if (peek() && peek().k === "rp") eat();
        return s + "\\left(" + inner + "\\right)";
      }
      return s;
    }
    if (t.k === "greek") { eat(); return (GREEK[t.v] || t.v) + " " + sub(t.sub); }
    if (t.k === "frac") { eat(); return "\\tfrac{" + t.v[0] + "}{" + t.v[1] + "}"; }
    if (t.k === "raw") { eat(); return t.v; }
    if (t.k === "sqrt") {
      eat();
      const inner = atom(false);
      return "\\sqrt{" + inner + "}";
    }
    if (t.k === "abs") {
      eat();
      const inner = relation();
      if (peek() && peek().k === "abs") eat();
      return "\\left|" + inner + "\\right|";
    }
    if (t.k === "lp") {
      const open = t.v; eat();
      const inner = relation();
      const close = peek() && peek().k === "rp" ? eat().v : (open === "[" ? "]" : ")");
      const L = open === "[" ? "[" : "(", Rr = close === "]" ? "]" : ")";
      return "\\left" + L + inner + "\\right" + Rr;
    }
    if (t.k === "add") { eat(); return ADD[t.v] + atom(false); }   // unary sign
    /* "~60 V" is "about 60 volts". Binding the marker tight to the number it
       qualifies keeps it out of the implicit-multiplication path, which would
       otherwise wedge a thin space in and set it as "∼ 60". Braced so KaTeX
       treats it as an ordinary symbol rather than a relation. */
    if (t.k === "approx") { eat(); return "{\\sim}" + atom(false); }
    eat();
    return "";
  }

  /* power: atom^atom, plus the standalone ² ³ ° markers */
  function power(prevNum) {
    let s = atom(prevNum);
    for (;;) {
      const t = peek();
      if (t && t.k === "pow") { eat(); s += "^{" + atom(false) + "}"; continue; }
      if (t && t.k === "sup") { eat(); s += "^{" + t.v + "}"; continue; }
      if (t && t.k === "deg") { eat(); s += "^{\\circ}"; continue; }
      break;
    }
    return s;
  }

  /* product, with real fractions for '/' */
  function product() {
    let acc = power(false);
    let lastWasNum = tokens[i - 1] && tokens[i - 1].k === "num";
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.k === "mul") {
        eat();
        acc += " " + MUL[t.v] + " " + power(false);
        lastWasNum = tokens[i - 1] && tokens[i - 1].k === "num";
        continue;
      }
      if (t.k === "div") {
        eat();
        /* everything accumulated so far is the numerator; the next factor
           (usually a bracketed group) is the denominator */
        const den = power(false);
        acc = "\\frac{" + acc + "}{" + den + "}";
        lastWasNum = false;
        continue;
      }
      if (t.k === "raw") { eat(); acc += t.v; continue; }
      /* implicit multiplication: "2π", "Q²(f_n − 1/f_n)", "n V_2" */
      if (t.k === "num" || t.k === "id" || t.k === "greek" || t.k === "lp"
        || t.k === "sqrt" || t.k === "frac" || t.k === "abs") {
        const isUnit = t.k === "id" && lastWasNum && UNITS.has(t.v) && !t.sub;
        const nxt = power(lastWasNum);
        acc += (isUnit ? "" : "\\,") + nxt;
        lastWasNum = tokens[i - 1] && tokens[i - 1].k === "num";
        continue;
      }
      break;
    }
    return acc;
  }

  function sum() {
    let acc = product();
    for (;;) {
      const t = peek();
      if (t && t.k === "add") { eat(); acc += " " + ADD[t.v] + " " + product(); continue; }
      break;
    }
    return acc;
  }

  function relation() {
    let acc = sum();
    for (;;) {
      const t = peek();
      if (t && t.k === "rel") { eat(); acc += " " + REL[t.v] + " " + sum(); continue; }
      break;
    }
    return acc;
  }

  const out = relation();
  return { latex: out, complete: i >= tokens.length };
}

export function toLatex(src) {
  try {
    const { latex, complete } = parse(lex(src));
    return complete && latex.trim() ? latex : null;
  } catch (e) {
    return null;
  }
}

/* --------------------------------------------- prose / math splitting */
const MATHY = /[_^·√ΔπηωθφΩ±×∓≈≤≥∝≡²³½°]|[0-9]/;
const WORDY = /^[A-Za-z][a-z]{2,}$/;      /* an English word, not a symbol */
/* single letters that are far more often prose than variables */
const PROSE1 = new Set(["a", "A", "I", "o", "O"]);

const OPS_ONLY = /^[=<>+\-−/*|·×∝≈≤≥≡∓±:,]+$/;

/* A token that is prose whatever surrounds it: an English word that is not one
   of the names the parser sets as an operator, or the bare indefinite article.

   These are the tokens a math run must never swallow. A swallowed word still
   parses — "V a SEPIC" is a perfectly good product of three symbols — so the
   damage is invisible to "did toLatex return null", and shows up only as word
   spaces rendered at 3/18 em: "Above ~60 V a SEPIC" set as "Above ∼60VaSEPIC".
   Exported so scripts/check-tex.mjs can assert on the same rule the splitter
   applies, rather than keeping a second copy of it that drifts. */
export function isProseWord(w) {
  const s = String(w);
  if (s === "a") return true;
  const core = s.replace(/^[([{]+/, "").replace(/[)\]}]+$/, "");
  return WORDY.test(core) && !FUNCS.has(core) && !OPNAME.has(core);
}

function classify(tok) {
  if (!tok) return "w";
  /* The article, before the single-letter rule below can call it a variable.
     Left as "?" it joined whichever side surrounded it, and between a unit and
     an acronym — "~60 V a SEPIC" — both sides are maths. */
  if (tok === "a") return "w";
  /* Judge the token by its core: "(m" is the variable m, not a word. */
  const core = tok.replace(/^[([{]+/, "").replace(/[)\]}]+$/, "");
  if (core === "") return "?";
  if (/^[.,;:!?]+$/.test(core)) return "?";
  /* A run made only of operators carries no expression of its own — a bare
     "/" or "×" in a sentence is punctuation, and setting it as maths just
     produces an unparseable fragment. */
  if (OPS_ONLY.test(core)) return "?";
  if (MATHY.test(core)) {
    /* a word that merely contains a digit or degree sign */
    if (WORDY.test(core)) return "w";
    return "m";
  }
  if (core.length === 1 && isAlpha(core)) return PROSE1.has(core) ? "?" : "m";
  if (WORDY.test(core)) return "w";
  if (/^[A-Z]{2,}$/.test(core)) return "m";     /* ESR, PIV, ZVS */
  return "w";
}

/* Trim brackets that have no partner inside the run, so a fragment cut out
   of a longer sentence still parses on its own. */
function trimUnbalanced(text) {
  let pre = "", post = "", body = text;
  for (;;) {
    let depth = 0, badOpen = -1, badClose = -1;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "(" || c === "[") { depth++; if (badOpen < 0 && depth === 1) badOpen = i; }
      else if (c === ")" || c === "]") { depth--; if (depth < 0) { badClose = i; break; } }
    }
    if (badClose >= 0) {
      post = body.slice(badClose) + post;
      body = body.slice(0, badClose);
      continue;
    }
    if (depth > 0 && badOpen >= 0) {
      pre += body.slice(0, badOpen + 1);
      body = body.slice(badOpen + 1);
      continue;
    }
    break;
  }
  return { pre, body, post };
}

/* Break a string into alternating prose and math runs. Ambiguous tokens
   ("?" — bare punctuation, lone operators, lone letters) join whichever
   side surrounds them, so "at d = 0.5" keeps "d = 0.5" together while
   "Sendust / Kool Mµ" stays prose. */
export function splitRuns(src) {
  const words = String(src).split(/(\s+)/).filter((w) => w !== "");
  const cls = words.map((w) => (/^\s+$/.test(w) ? "s" : classify(w)));

  /* Brackets bind. Everything between an opening bracket and its match
     belongs to the run that opened it — otherwise an expression is cut in
     half at a space and neither half is valid on its own. */
  let depth = 0, holder = null;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === "s") continue;
    const opens = (words[i].match(/[([]/g) || []).length;
    const closes = (words[i].match(/[)\]]/g) || []).length;
    const entering = depth;
    /* — but an English word inside the brackets is still an English word.
       "Clamp cap (5 % ripple)" opened its group on a number, and binding
       dragged "ripple" in after it to be set as a variable. */
    if (entering > 0 && holder && !isProseWord(words[i])) cls[i] = holder;
    depth = Math.max(0, depth + opens - closes);
    if (entering === 0 && depth > 0) holder = cls[i];
    if (depth === 0) holder = null;
  }

  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== "?") continue;
    let before = "w";
    for (let j = i - 1; j >= 0; j--) if (cls[j] !== "s" && cls[j] !== "?") { before = cls[j]; break; }
    let after = "w";
    for (let j = i + 1; j < cls.length; j++) if (cls[j] !== "s" && cls[j] !== "?") { after = cls[j]; break; }
    cls[i] = before === "m" && after === "m" ? "m" : "w";
  }

  const runs = [];
  let cur = null;
  for (let i = 0; i < words.length; i++) {
    if (cls[i] === "s") { if (cur) cur.text += words[i]; else runs.push({ t: "w", text: words[i] }); continue; }
    if (!cur || cur.t !== cls[i]) { cur = { t: cls[i], text: words[i] }; runs.push(cur); }
    else cur.text += words[i];
  }

  /* Whitespace, sentence punctuation and orphaned brackets belong to
     prose, never to a math run. */
  const out = [];
  runs.forEach((r) => {
    if (r.t !== "m") { out.push(r); return; }
    const m = r.text.match(/^(\s*)([\s\S]*?)([.,;:!?]*)(\s*)$/);
    const b = trimUnbalanced(m[2]);
    const pre = m[1] + b.pre, post = b.post + m[3] + m[4];
    if (!b.body || OPS_ONLY.test(b.body)) { out.push({ t: "w", text: r.text }); return; }
    /* A slash with spaces around it inside a run that states no relation is
       an "or", not a division: "HS / LS rms", "GaN / SiC", "N87 / C95".
       Setting those as fractions is both wrong and unreadable. Where the run
       IS an equation — "L = V_out·(1 − D) / (f_sw·ΔI_L)" — the slash keeps
       its arithmetic meaning. */
    if (!/[=≈≤≥∝≡]/.test(b.body) && /\s\/\s/.test(b.body)) {
      const parts = b.body.split(/\s\/\s/);
      parts.forEach((piece, i) => {
        if (i) out.push({ t: "w", text: " / " });
        const inner = trimUnbalanced(piece.trim());
        if (!inner.body || OPS_ONLY.test(inner.body)) out.push({ t: "w", text: piece });
        else out.push({ t: "m", text: inner.body,
          pre: (i === 0 ? pre : "") + inner.pre,
          post: inner.post + (i === parts.length - 1 ? post : "") });
      });
      return;
    }
    out.push({ t: "m", text: b.body, pre, post });
  });
  /* fold neighbouring prose runs back together */
  const merged = [];
  out.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && last.t === "w" && r.t === "w") last.text += r.text;
    else merged.push({ ...r });
  });
  return merged;
}

/* ------------------------------------------------------- components */
function render(latex, display) {
  return katex.renderToString(latex, {
    displayMode: !!display,
    throwOnError: false,
    strict: false,
    output: "html",
    trust: false,
  });
}

/* A math fragment. Falls back to plain text if the parse fails, so a
   formula never disappears — worst case it looks like the old renderer.

   Deliberately NOT called `Math`: a hoisted `function Math` shadows the
   global Math object for the whole module, and every Math.max in this file
   would throw at runtime. */
export function TeXSpan({ t, display }) {
  const html = useMemo(() => {
    const latex = toLatex(t);
    if (!latex) return null;
    try { return render(latex, display); } catch (e) { return null; }
  }, [t, display]);
  if (html === null) return <span className="ef">{String(t)}</span>;
  return <span className="tex" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* Mixed prose and mathematics — the default for anything a person reads. */
export function Mixed({ t }) {
  const runs = useMemo(() => splitRuns(t == null ? "" : t), [t]);
  return (
    <>
      {runs.map((r, i) =>
        r.t === "m"
          ? <React.Fragment key={i}>{r.pre}<TeXSpan t={r.text} />{r.post}</React.Fragment>
          : <React.Fragment key={i}>{r.text}</React.Fragment>
      )}
    </>
  );
}

/* Is this string a whole equation rather than a sentence containing one? */
function isWholeEquation(s) {
  if (!/[=≈≤≥∝≡]/.test(s)) return false;
  const runs = splitRuns(s);
  return runs.every((r) => r.t === "m" || !r.text.trim());
}

/* A display equation with its footnote. */
export const Eq = ({ e, n, src }) => {
  const whole = useMemo(() => isWholeEquation(String(e || "")), [e]);
  return (
    <div className="eq">
      <div className="efline">
        {whole ? <TeXSpan t={e} display /> : <span className="efmix"><Mixed t={e} /></span>}
      </div>
      {n ? <small><Mixed t={n} /></small> : null}
      {src ? <em className="src">{src}</em> : null}
    </div>
  );
};

/* Inline maths for labels, table cells and warnings. */
export const Mx = ({ t }) => <Mixed t={t} />;
/* Prose: identical treatment — the splitter already protects the words. */
export const Sub = ({ t }) => <Mixed t={t} />;
