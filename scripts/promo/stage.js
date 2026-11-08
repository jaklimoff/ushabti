// The clock the promo is drawn against. The whole film is one React tree
// drawn as a function of one time, T, in seconds. render.mjs moves T one
// frame at a time with window.__seek; opening index.html?play plays it.
(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const Easing = {
    linear: (t) => t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    easeOutBack: (t) => {
      const c1 = 1.70158,
        c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
  };

  /* Scenes are named stretches of time; a cue is where one starts. */
  function cuesOf(scenes) {
    const cues = {};
    let t = 0;
    for (const s of scenes) {
      cues[s.name] = t;
      t += s.dur;
    }
    return { cues, total: t };
  }

  const Clock = React.createContext({ T: 0, CUES: {} });

  function CompositionStage({ width, height, scenes, children }) {
    const { cues, total } = React.useMemo(() => cuesOf(scenes), [scenes]);
    const [T, setT] = React.useState(0);
    React.useEffect(() => {
      window.__total = total;
      window.__seek = (t) => ReactDOM.flushSync(() => setT(t));
      window.__ready = true;
      if (!new URLSearchParams(location.search).has("play")) return;
      let start = null,
        raf = 0;
      const tick = (now) => {
        if (start === null) start = now;
        setT(((now - start) / 1000) % total);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [total]);
    return React.createElement(
      "div",
      { id: "stage", style: { position: "relative", width, height, overflow: "hidden" } },
      React.createElement(Clock.Provider, { value: { T, CUES: cues } }, children),
    );
  }

  Object.assign(window, {
    clamp,
    Easing,
    CompositionStage,
    useComposition: () => React.useContext(Clock),
  });
})();
