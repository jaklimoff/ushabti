// The promo: the filmed take (film.mjs) under a camera, with the words and
// the finish on top. Everything inside the window is a screenshot of the
// running app; this file only decides where the camera looks and what is
// said over it. Every choreography value is keyed to T, never to wall time.
const { CompositionStage, useComposition, Easing, clamp } = window;
const TAKE = window.TAKE;

const SCENES = [
  { name: "Hook", dur: 3.2 },
  { name: "Title", dur: 3.0 },
  { name: "Board", dur: 3.6 },
  { name: "Drag", dur: 4.2 },
  { name: "Agent", dur: 7.6 },
  { name: "Properties", dur: 5.2 },
  { name: "Live", dur: 3.6 },
  { name: "Views", dur: 5.4 },
  { name: "Close", dur: 6.0 },
];

/* ---------------------------------------------------------------- tokens (src/app/globals.css) */
const K = {
  bg: "#0a0b0d",
  top: "#0f1013",
  line: "#1c1f24",
  menu: "#262b32",
  accent: "#3fb0c8",
  ink: "#05242b",
  text: "#e8e9ec",
  t2: "#dfe1e5",
  t3: "#cdd2d9",
  t4: "#a4aab3",
};
const FRIEND = "#2f9e7a";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const APP_W = 1440,
  APP_H = 900;
const tint = (hex, a) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`;
};
const lerp = (a, b, p) => a + (b - a) * p;
const prog = (T, a, b) => clamp((T - a) / (b - a), 0, 1);
const MOTION = {
  enter: (T, a, d = 0.5) => Easing.easeOutCubic(prog(T, a, a + d)),
  move: (T, a, b) => Easing.easeInOutCubic(prog(T, a, b)),
  glide: (T, a, b) => Easing.easeInOutQuart(prog(T, a, b)),
  pop: (T, a, d = 0.5) => Easing.easeOutBack(prog(T, a, a + d)),
};

/* ---------------------------------------------------------------- the take */
/* The frame showing film time f: the last one taken at or before it. */
function frameAt(f) {
  const fr = TAKE.frames;
  let lo = 0,
    hi = fr.length - 1;
  if (f <= fr[0].v) return fr[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fr[mid].v <= f) lo = mid;
    else hi = mid - 1;
  }
  return fr[lo];
}
const src = (frame) => `out/frames/${frame.file}`;

/* ---------------------------------------------------------------- camera, in app pixels */
function makeCam(C) {
  const B = C.Board,
    D = C.Drag,
    A = C.Agent,
    P = C.Properties,
    L = C.Live,
    V = C.Views,
    X = C.Close;
  return [
    { t: B, cx: 748, cy: 480, s: 0.72, rx: 32, rz: -8 },
    { t: B + 2.6, cx: 748, cy: 450, s: 1.26, rx: 0, rz: 0 },
    { t: D, cx: 730, cy: 420, s: 1.3, rx: 0, rz: 0 },
    { t: D + 0.9, cx: 660, cy: 300, s: 1.95, rx: 0, rz: 0 },
    { t: D + 3.0, cx: 720, cy: 300, s: 2.05, rx: 0, rz: 0 },
    { t: D + 4.0, cx: 620, cy: 320, s: 1.8, rx: 0, rz: 0 },
    { t: A + 0.6, cx: 560, cy: 300, s: 1.85, rx: 0, rz: 0 },
    { t: A + 1.4, cx: 940, cy: 290, s: 1.9, rx: 0, rz: 0 },
    { t: A + 3.4, cx: 950, cy: 300, s: 1.95, rx: 0, rz: 0 },
    { t: A + 4.4, cx: 960, cy: 590, s: 1.85, rx: 0, rz: 0 },
    { t: A + 6.8, cx: 968, cy: 612, s: 1.9, rx: 0, rz: 0 },
    { t: A + 7.5, cx: 760, cy: 330, s: 1.55, rx: 0, rz: 0 },
    { t: P + 0.9, cx: 930, cy: 300, s: 1.85, rx: 0, rz: 0 },
    { t: P + 4.3, cx: 945, cy: 305, s: 1.95, rx: 0, rz: 0 },
    { t: P + 5.0, cx: 620, cy: 330, s: 1.75, rx: 0, rz: 0 },
    { t: L + 3.4, cx: 600, cy: 320, s: 1.85, rx: 0, rz: 0 },
    { t: V + 0.5, cx: 748, cy: 420, s: 1.32, rx: 0, rz: 0 },
    { t: V + 2.0, cx: 700, cy: 270, s: 1.62, rx: 0, rz: 0 },
    { t: V + 5.3, cx: 720, cy: 278, s: 1.72, rx: 0, rz: 0 },
    { t: X + 1.4, cx: 748, cy: 470, s: 0.86, rx: 24, rz: -6 },
    { t: X + 6.0, cx: 748, cy: 470, s: 0.8, rx: 28, rz: -7 },
  ];
}
function camAt(T, cam) {
  if (T <= cam[0].t) return cam[0];
  for (let i = 0; i < cam.length - 1; i++) {
    const a = cam[i],
      b = cam[i + 1];
    if (T <= b.t) {
      const p = MOTION.glide(T, a.t, b.t);
      return {
        cx: lerp(a.cx, b.cx, p),
        cy: lerp(a.cy, b.cy, p),
        s: lerp(a.s, b.s, p),
        rx: lerp(a.rx, b.rx, p),
        rz: lerp(a.rz, b.rz, p),
      };
    }
  }
  return cam[cam.length - 1];
}

/* ---------------------------------------------------------------- over the footage */
function Pointer({ x, y, o, press }) {
  if (o <= 0.01) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: o,
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        style={{
          position: "absolute",
          left: -3,
          top: -2,
          transform: `scale(${press})`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 3px 6px rgba(0,0,0,.5))",
        }}
      >
        <path
          d="M3 2 L3 19 L7.5 15 L10.5 22 L13.5 20.8 L10.6 14 L16.5 14 Z"
          fill="#fff"
          stroke="#0a0b0d"
          strokeWidth="1.3"
          strokeLinejoin="round"
        ></path>
      </svg>
    </div>
  );
}
function ClickRing({ x, y, T, at }) {
  const p = prog(T, at, at + 0.5);
  if (p <= 0 || p >= 1) return null;
  const e = Easing.easeOutCubic(p);
  return (
    <div
      style={{
        position: "absolute",
        left: x - 16,
        top: y - 16,
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: `2px solid ${K.accent}`,
        transform: `scale(${0.3 + e * 1.1})`,
        opacity: 1 - p,
        zIndex: 59,
      }}
    ></div>
  );
}
/* A ring that grows out of a card that changed on somebody else's screen. */
function Ripple({ rect, T, at, color }) {
  const p = prog(T, at, at + 1.0);
  if (!rect || p <= 0 || p >= 1) return null;
  const e = Easing.easeOutCubic(p);
  const g = 20 * e;
  const [x, y, w, h] = rect;
  return (
    <div
      style={{
        position: "absolute",
        left: x - g,
        top: y - g,
        width: w + 2 * g,
        height: h + 2 * g,
        borderRadius: 6 + g,
        border: `1.5px solid ${color}`,
        opacity: 0.85 * (1 - p),
        zIndex: 25,
      }}
    ></div>
  );
}
function WhoTag({ rect, T, at, until, color, name }) {
  if (!rect) return null;
  const e = MOTION.pop(T, at, 0.4) * (1 - MOTION.enter(T, until, 0.3));
  if (e <= 0.01) return null;
  const [x, y, w] = rect;
  return (
    <div
      style={{
        position: "absolute",
        left: x + w - 8,
        top: y - 12,
        transform: `translateX(-100%) scale(${0.8 + 0.2 * e})`,
        transformOrigin: "100% 100%",
        opacity: Math.min(1, e),
        zIndex: 26,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 4px",
        borderRadius: 6,
        background: color,
        color: "#fff",
        fontFamily: SANS,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        boxShadow: "0 6px 18px rgba(0,0,0,.45)",
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "rgba(255,255,255,.22)",
          display: "grid",
          placeItems: "center",
          fontSize: 8,
        }}
      >
        SP
      </div>
      {name}
    </div>
  );
}

/* The app window: one filmed frame, with the board behind an open panel
   drawn out of focus so the eye goes to the panel. */
function Footage({ frame, prev, swap, appRef }) {
  const panel = frame.panel;
  const dof = panel ? clamp((APP_W - panel[0]) / panel[2], 0, 1) : 0;
  const img = {
    position: "absolute",
    left: 0,
    top: 0,
    width: APP_W,
    height: APP_H,
    display: "block",
  };
  return (
    <div
      ref={appRef}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: APP_W,
        height: APP_H,
        background: K.bg,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${K.line}`,
        boxShadow: "0 60px 160px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.03)",
      }}
    >
      <img
        alt=""
        src={src(frame)}
        style={{
          ...img,
          filter: dof > 0.01 ? `blur(${1.6 * dof}px) brightness(${1 - 0.3 * dof})` : "none",
        }}
      />
      {dof > 0.01 && (
        <img alt="" src={src(frame)} style={{ ...img, clipPath: `inset(0 0 0 ${panel[0]}px)` }} />
      )}
      {prev && swap > 0 && (
        <img
          alt=""
          src={src(prev)}
          style={{ ...img, opacity: swap, filter: `blur(${(1 - swap) * 6}px)` }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- type */
function Kicker({ children, o = 1, size = 18, color = K.accent, line = 1 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, opacity: o }}>
      <div
        style={{
          width: 44 * line,
          height: 2,
          background: color,
          borderRadius: 1,
          boxShadow: `0 0 12px ${tint(color, 0.6)}`,
        }}
      ></div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: size,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color,
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}
/* Words that rise out of a blur, one after another. */
function Words({ text, T, at, step = 0.075, dur = 0.6, color, accentFrom, rise = 34 }) {
  return text.split(" ").map((w, i) => {
    const e = MOTION.enter(T, at + i * step, dur);
    return (
      <span
        key={i}
        style={{
          display: "inline-block",
          marginRight: "0.24em",
          opacity: e,
          transform: `translateY(${(1 - e) * rise}px)`,
          filter: e < 0.999 ? `blur(${(1 - e) * 10}px)` : "none",
          color: accentFrom !== undefined && i >= accentFrom ? K.accent : color,
        }}
      >
        {w}
      </span>
    );
  });
}
/* The app's own icon (src/app/icon.svg), with a light that can sweep over it. */
function Mark({ size, sweep = -1 }) {
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: size * 0.25,
        overflow: "hidden",
        boxShadow: `0 ${size * 0.2}px ${size * 0.7}px ${tint(K.accent, 0.28)}, inset 0 1px 0 rgba(255,255,255,.25)`,
      }}
    >
      <svg viewBox="0 0 32 32" width={size} height={size} style={{ display: "block" }}>
        <rect width="32" height="32" fill={K.accent}></rect>
        <path
          d="M11.6 8.7v7.6a4.4 4.4 0 0 0 8.8 0V8.7"
          fill="none"
          stroke={K.ink}
          strokeWidth="2.6"
          strokeLinecap="round"
        ></path>
      </svg>
      {sweep > -1 && sweep < 2 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(105deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.55) 50%, rgba(255,255,255,0) 70%)",
            transform: `translateX(${(sweep - 0.5) * 220}%)`,
          }}
        ></div>
      )}
    </div>
  );
}

function Hook({ T, C }) {
  const H = C.Hook,
    out = MOTION.move(T, C.Title - 0.5, C.Title + 0.05);
  if (T > C.Title + 0.1) return null;
  const k = MOTION.enter(T, H + 2.05, 0.6);
  const glow = MOTION.enter(T, H + 1.2, 1.2);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        opacity: 1 - out,
        transform: `scale(${1 + out * 0.12 + (T - H) * 0.008})`,
        filter: out > 0.01 ? `blur(${out * 14}px)` : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "56%",
          width: 900,
          height: 300,
          marginLeft: -450,
          marginTop: -150,
          background: `radial-gradient(closest-side, ${tint(K.accent, 0.16 * glow)}, ${tint(K.accent, 0)})`,
        }}
      ></div>
      <div
        style={{
          position: "relative",
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 136,
          lineHeight: 1.06,
          letterSpacing: "-0.03em",
          color: K.text,
          textAlign: "center",
        }}
      >
        <div>
          <Words text="Here I am." T={T} at={H + 0.25} step={0.13} color={K.text} rise={44} />
        </div>
        <div>
          <Words text="I will do it." T={T} at={H + 1.1} step={0.13} color={K.accent} rise={44} />
        </div>
      </div>
      <div
        style={{
          position: "relative",
          fontFamily: MONO,
          fontSize: 21,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: K.t4,
          opacity: k,
          transform: `translateY(${(1 - k) * 12}px)`,
          filter: k < 1 ? `blur(${(1 - k) * 6}px)` : "none",
        }}
      >
        The words cut into every ushabti
      </div>
    </div>
  );
}

function TitleCard({ T, C }) {
  const t0 = C.Title;
  if (T < t0 - 0.2 || T > C.Board + 0.7) return null;
  const inn = MOTION.enter(T, t0 - 0.15, 0.6);
  const m = MOTION.pop(T, t0 + 0.05, 0.7);
  const s = MOTION.enter(T, t0 + 1.05, 0.7);
  const out = MOTION.move(T, C.Board - 0.35, C.Board + 0.55);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 44,
        opacity: inn * (1 - out),
        transform: `translateY(${-out * 90}px) scale(${(0.94 + 0.06 * inn) * (1 + (T - t0) * 0.012)})`,
        filter: out > 0.01 ? `blur(${out * 10}px)` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 38 }}>
        <div style={{ transform: `scale(${m}) rotate(${(1 - m) * -14}deg)` }}>
          <Mark size={138} sweep={prog(T, t0 + 0.6, t0 + 1.5) * 1.6} />
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: 156,
            letterSpacing: "-0.035em",
            color: K.text,
            display: "flex",
          }}
        >
          {"Ushabti".split("").map((l, i) => {
            const e = MOTION.enter(T, t0 + 0.32 + i * 0.05, 0.55);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: e,
                  transform: `translateY(${(1 - e) * 40}px)`,
                  filter: e < 1 ? `blur(${(1 - e) * 12}px)` : "none",
                }}
              >
                {l}
              </span>
            );
          })}
        </div>
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 46,
          color: K.t3,
          whiteSpace: "nowrap",
          opacity: s,
          transform: `translateY(${(1 - s) * 18}px)`,
          filter: s < 1 ? `blur(${(1 - s) * 8}px)` : "none",
        }}
      >
        The task board for <span style={{ color: K.text, fontWeight: 600 }}>humans</span> and{" "}
        <span style={{ color: K.accent, fontWeight: 600 }}>agents</span>.
      </div>
    </div>
  );
}

function Caption({ T, items }) {
  const it = items.find((c) => T >= c.at - 0.05 && T < c.until);
  if (!it) return null;
  const k = MOTION.enter(T, it.at, 0.5);
  const x = 1 - MOTION.move(T, it.until - 0.4, it.until);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        bottom: 100,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        opacity: x,
        transform: `translateY(${-(1 - x) * 14}px)`,
        filter: x < 1 ? `blur(${(1 - x) * 8}px)` : "none",
        zIndex: 80,
      }}
    >
      <Kicker size={19} o={k} line={k}>
        {it.kicker}
      </Kicker>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 78,
          lineHeight: 1.04,
          letterSpacing: "-0.028em",
          color: K.text,
          whiteSpace: "nowrap",
          textShadow: "0 6px 50px rgba(0,0,0,.75)",
        }}
      >
        <Words text={it.text} T={T} at={it.at + 0.12} color={K.text} accentFrom={it.accentFrom} />
      </div>
    </div>
  );
}

function EndCard({ T, C }) {
  const X = C.Close;
  if (T < X) return null;
  const words = ["Free.", "Self-hosted.", "MIT."];
  const wOut = MOTION.move(T, X + 2.45, X + 2.9);
  const lock = MOTION.pop(T, X + 2.85, 0.7);
  const tag = MOTION.enter(T, X + 3.3, 0.6);
  const cta = MOTION.enter(T, X + 3.75, 0.6);
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 90 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 44,
          opacity: 1 - wOut,
          transform: `translateY(${-wOut * 50}px)`,
          filter: wOut > 0.01 ? `blur(${wOut * 10}px)` : "none",
        }}
      >
        {words.map((w, i) => {
          const e = MOTION.enter(T, X + 0.7 + i * 0.42, 0.6);
          return (
            <div
              key={w}
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: 132,
                letterSpacing: "-0.03em",
                color: i === 2 ? K.accent : K.text,
                opacity: e,
                transform: `translateY(${(1 - e) * 46}px)`,
                filter: e < 1 ? `blur(${(1 - e) * 12}px)` : "none",
                textShadow: i === 2 ? `0 0 60px ${tint(K.accent, 0.45)}` : "none",
              }}
            >
              {w}
            </div>
          );
        })}
      </div>
      {T > X + 2.75 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 38,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 30,
              transform: `scale(${0.86 + 0.14 * lock})`,
              opacity: Math.min(1, lock * 1.3),
            }}
          >
            <Mark size={108} sweep={prog(T, X + 3.2, X + 4.2) * 1.6} />
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: 124,
                letterSpacing: "-0.035em",
                color: K.text,
              }}
            >
              Ushabti
            </div>
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 42,
              color: K.t3,
              whiteSpace: "nowrap",
              opacity: tag,
              transform: `translateY(${(1 - tag) * 14}px)`,
            }}
          >
            Write the work down. Let your ushabti answer.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              marginTop: 14,
              opacity: cta,
              transform: `translateY(${(1 - cta) * 14}px)`,
            }}
          >
            <div
              style={{
                padding: "15px 24px",
                borderRadius: 12,
                background: K.top,
                border: `1px solid ${K.menu}`,
                fontFamily: MONO,
                fontSize: 28,
                color: K.t2,
                whiteSpace: "nowrap",
                boxShadow: `0 20px 60px rgba(0,0,0,.5), 0 0 0 1px ${tint(K.accent, 0.12 * cta)}`,
              }}
            >
              <span style={{ color: K.accent }}>$</span> docker compose up
            </div>
            <div style={{ fontFamily: MONO, fontSize: 26, color: K.t4, whiteSpace: "nowrap" }}>
              jaklimoff.github.io/ushabti
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- finish: grain and vignette */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
function Finish({ T }) {
  const f = Math.floor(T * 30);
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)",
          pointerEvents: "none",
          zIndex: 95,
        }}
      ></div>
      <div
        style={{
          position: "absolute",
          inset: -240,
          backgroundImage: GRAIN,
          backgroundSize: "240px 240px",
          transform: `translate(${(f * 67) % 240}px, ${(f * 131) % 240}px)`,
          opacity: 0.05,
          mixBlendMode: "overlay",
          pointerEvents: "none",
          zIndex: 96,
        }}
      ></div>
    </>
  );
}

/* ---------------------------------------------------------------- the piece */
function Piece() {
  const { T, CUES } = useComposition();
  const CAM = React.useMemo(() => makeCam(CUES), [CUES]);
  const B = CUES.Board,
    D = CUES.Drag,
    A = CUES.Agent,
    P = CUES.Properties,
    L = CUES.Live,
    V = CUES.Views,
    X = CUES.Close;

  const f = clamp(T - B, 0, TAKE.at.end);
  const frame = frameAt(f);
  /* The list replaces the board in one paint; the board frame dissolves into it. */
  const listAt = B + TAKE.marks.list;
  const swap = T > listAt ? 1 - MOTION.enter(T, listAt + 0.05, 0.45) : 0;
  const prev = swap > 0 ? frameAt(TAKE.marks.list - 0.02) : null;

  /* a slow handheld drift keeps the frame alive between moves */
  const c0 = camAt(T, CAM);
  const cam = {
    ...c0,
    cx: c0.cx + Math.sin(T * 0.61) * 3.5,
    cy: c0.cy + Math.cos(T * 0.47) * 2.5,
    s: c0.s * (1 + Math.sin(T * 0.37) * 0.004),
  };
  const winO = MOTION.enter(T, B - 0.25, 0.8);

  const seen = (a, b) => Math.min(MOTION.enter(T, a, 0.25), 1 - MOTION.enter(T, b, 0.25));
  const pO = Math.max(
    seen(D + 0.15, D + 3.9),
    seen(A + 0.05, A + 7.4),
    seen(P - 0.05, P + 5.0),
    seen(V + 0.05, V + 2.1),
  );
  const near = (t) => Math.max(0, 1 - Math.abs(T - t) / 0.12);
  const press =
    1 - 0.14 * Math.max(frame.ptr.down ? 1 : 0, ...TAKE.clicks.map((c) => near(B + c.v)));

  const live = B + TAKE.marks.live;
  const nine = frameAt(TAKE.marks.live + 0.4).cards["USH-9"];

  const dim = MOTION.move(T, X + 0.1, X + 1.2) * 0.87;
  const fadeEnd = MOTION.move(T, X + 5.4, X + 6.0);

  const captions = [
    {
      at: B + 2.0,
      until: D + 0.6,
      kicker: "One board",
      text: "Humans and agents. Same board.",
      accentFrom: 3,
    },
    { at: D + 0.9, until: A + 0.3, kicker: "Drag and drop", text: "Pick it up. Put it down." },
    { at: A + 0.8, until: A + 3.9, kicker: "Agents", text: "Agents take the card." },
    {
      at: A + 4.0,
      until: P + 0.3,
      kicker: "Agents",
      text: "You watch the plan, live.",
      accentFrom: 4,
    },
    {
      at: P + 0.8,
      until: L + 0.3,
      kicker: "Custom properties",
      text: "Every field is yours. Even Status.",
      accentFrom: 4,
    },
    {
      at: L + 0.6,
      until: V + 0.4,
      kicker: "Live updates",
      text: "Every change. Every screen.",
      accentFrom: 2,
    },
    { at: V + 1.4, until: X + 0.2, kicker: "Views", text: "Same tasks. Any angle.", accentFrom: 2 },
  ];

  const aurora = 0.5 + 0.5 * Math.sin(T * 0.25);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: K.bg,
        fontFamily: SANS,
        color: K.text,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 55% 45% at ${42 + aurora * 16}% 36%, rgba(63,176,200,0.11), rgba(63,176,200,0) 70%), radial-gradient(ellipse 40% 40% at ${70 - aurora * 12}% 78%, rgba(109,91,208,0.07), rgba(109,91,208,0) 70%)`,
        }}
      ></div>

      {winO > 0 && (
        <div
          style={{
            position: "absolute",
            left: 960,
            top: 540,
            width: 0,
            height: 0,
            opacity: winO,
            transformOrigin: "0 0",
            transform: `perspective(2400px) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) scale(${cam.s}) translate(${-cam.cx}px, ${-cam.cy}px)`,
          }}
        >
          <Footage frame={frame} prev={prev} swap={swap} />
          <Ripple rect={nine} T={T} at={live + 0.15} color={FRIEND} />
          <WhoTag
            rect={nine}
            T={T}
            at={live + 0.15}
            until={live + 2.4}
            color={FRIEND}
            name="Second Person"
          />
          {TAKE.clicks.map((c, i) => (
            <ClickRing key={i} T={T} at={B + c.v} x={c.x} y={c.y} />
          ))}
          <Pointer x={frame.ptr.x} y={frame.ptr.y} o={pO} press={press} />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 440,
          background:
            "linear-gradient(180deg, rgba(10,11,13,0) 0%, rgba(10,11,13,0.8) 58%, rgba(10,11,13,0.94) 100%)",
          /* only behind the caption, so the right half stays lit */ WebkitMaskImage:
            "linear-gradient(90deg, #000 0%, #000 42%, transparent 72%)",
          maskImage: "linear-gradient(90deg, #000 0%, #000 42%, transparent 72%)",
          opacity:
            T > B + 1.6 && T < X + 0.4
              ? Math.min(MOTION.enter(T, B + 1.6, 0.5), 1 - MOTION.enter(T, X, 0.4))
              : 0,
          pointerEvents: "none",
        }}
      ></div>
      <Caption T={T} items={captions} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: K.bg,
          opacity: dim,
          pointerEvents: "none",
        }}
      ></div>

      <Hook T={T} C={CUES} />
      <TitleCard T={T} C={CUES} />
      <EndCard T={T} C={CUES} />
      <Finish T={T} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#000",
          opacity: fadeEnd,
          pointerEvents: "none",
          zIndex: 99,
        }}
      ></div>
    </div>
  );
}

function UshabtiPromo() {
  return (
    <CompositionStage width={1920} height={1080} scenes={SCENES}>
      <Piece />
    </CompositionStage>
  );
}

window.UshabtiPromo = UshabtiPromo;
