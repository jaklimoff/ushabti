"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { chartSummary, type ChartChoice, type ChartDTO } from "@/lib/charts";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Select } from "@/components/ui/Form";
import styles from "./ProjectList.module.css";

/* A calendar day has no zone, so it is written in UTC: the server and the
   browser then draw the same words. */
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayName = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
/* The tooltip's day is the footer's words with the weekday in front, so the
   two never name a day two ways. */
const longDayName = (day: string) =>
  `${WEEKDAY.format(new Date(`${day}T00:00:00Z`))}, ${dayName(day)}`;

/**
 * The person's charts: how many tasks entered one column a day. A chart is
 * added and deleted right here, with no dialog.
 */
export function Charts({ charts, choices }: { charts: ChartDTO[]; choices: ChartChoice[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className={styles.lists} data-testid="my-charts">
      <h2 className={styles.section}>Charts</h2>
      <div className={styles.charts}>
        {charts.map((chart) => (
          <Chart key={chart.id} chart={chart} />
        ))}
        {adding ? (
          <ChartPicker choices={choices} onDone={() => setAdding(false)} />
        ) : (
          <button
            className={styles.newCard}
            data-testid="chart-new"
            disabled={choices.length === 0}
            title={choices.length === 0 ? "No project has a select to count yet." : undefined}
            onClick={() => setAdding(true)}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            <span className="label" style={{ color: "inherit" }}>
              New chart
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

function Chart({ chart }: { chart: ChartDTO }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const max = Math.max(1, ...chart.days.map((d) => d.count));
  const { today, average } = chartSummary(chart.days);
  const from = chart.days[0]?.day;
  const to = chart.days.at(-1)?.day;

  async function remove() {
    setError(null);
    try {
      await api.del(`/api/charts/${chart.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the chart.");
    }
  }

  return (
    <div className={styles.chart} data-testid="chart">
      <div className={styles.cardTop}>
        <span className={styles.key}>{chart.project.key}</span>
        <span className={styles.chartName}>
          Entered <b>{chart.option}</b>
        </span>
        <span className={styles.spacer} />
        <button
          className={styles.chartDelete}
          aria-label={`Delete the chart Entered ${chart.option}`}
          title="Delete chart"
          onClick={confirm.ask}
        >
          ✕
        </button>
      </div>
      <ChartBars chart={chart} max={max} />
      <div className={styles.chartFoot} data-testid="chart-foot">
        <span>
          Today <b data-testid="chart-today">{today}</b>
        </span>
        <span>{average} a day</span>
        <span className={styles.chartRange}>
          {from && to && `${dayName(from)} – ${dayName(to)}`}
        </span>
      </div>
      <span className={styles.hint}>
        {chart.property} in {chart.project.name}
      </span>
      {confirm.asking && (
        <ConfirmRow
          question={`Delete the chart Entered ${chart.option}? The tasks and their history stay.`}
          onConfirm={() => confirm.confirm(() => void remove())}
          onCancel={confirm.cancel}
        />
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/* Room the tooltip keeps from the card's edge, and the caret's height. */
const EDGE = 6;
const CARET = 7;

/**
 * The bars, with one day lit at a time: under the pointer, or walked with the
 * arrow keys. The pointer is read off the whole strip rather than off each
 * bar, so the gaps between bars never drop the highlight.
 */
function ChartBars({ chart, max }: { chart: ChartDTO; max: number }) {
  const [lit, setLit] = useState<number | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const last = chart.days.length - 1;
  const day = lit === null ? null : chart.days[lit];
  const words = day && `${lit === last ? "Today · " : ""}${longDayName(day.day)}`;

  // The tooltip sits over the lit bar and is pushed back inside the card at
  // either edge; the caret keeps pointing at the bar.
  useLayoutEffect(() => {
    const box = tip.current;
    const slot = lit === null ? null : bars.current?.children[lit];
    const card = box?.offsetParent as HTMLElement | null;
    if (!box || !slot || !card) return;
    const c = card.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    const fill = (slot.firstElementChild ?? slot).getBoundingClientRect();
    const centre = s.left + s.width / 2 - c.left - card.clientLeft;
    const room = card.clientWidth - box.offsetWidth - EDGE;
    const left = Math.max(EDGE, Math.min(centre - box.offsetWidth / 2, room));
    const top = Math.max(EDGE, fill.top - c.top - card.clientTop - box.offsetHeight - CARET);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.setProperty("--caret", `${centre - left - box.clientLeft}px`);
  }, [lit]);

  function point(event: React.PointerEvent<HTMLDivElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    const at = Math.floor(((event.clientX - r.left) / r.width) * chart.days.length);
    setLit(Math.max(0, Math.min(at, last)));
  }

  function key(event: React.KeyboardEvent<HTMLDivElement>) {
    const from = lit ?? last;
    const to: Record<string, number | null> = {
      ArrowLeft: lit === null ? last : Math.max(0, from - 1),
      ArrowRight: lit === null ? last : Math.min(last, from + 1),
      Home: 0,
      End: last,
      Escape: null,
    };
    if (!(event.key in to)) return;
    event.preventDefault();
    setLit(to[event.key]);
  }

  return (
    <>
      {/* Each bar keeps its title for the tests, but takes no pointer, so the
          browser's own late tooltip never shows over this one. */}
      <div
        ref={bars}
        className={styles.bars}
        data-testid="chart-bars"
        data-lit={lit === null ? undefined : ""}
        tabIndex={0}
        role="group"
        aria-label={`Tasks that entered ${chart.option}, one bar a day`}
        onPointerMove={point}
        onPointerLeave={() => setLit(null)}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setLit(last)}
        onBlur={() => setLit(null)}
        onKeyDown={key}
      >
        {chart.days.map((d, i) => (
          <span
            key={d.day}
            className={styles.barSlot}
            title={`${dayName(d.day)}: ${d.count}`}
            data-testid="chart-bar"
            data-count={d.count}
            data-lit={i === lit ? "" : undefined}
          >
            <span
              className={styles.chartBar}
              style={{
                height: d.count ? `${(d.count / max) * 100}%` : undefined,
                background: chart.color,
              }}
            />
          </span>
        ))}
      </div>
      {day && (
        <div ref={tip} className={styles.chartTip} data-testid="chart-tip" aria-hidden>
          <div className={styles.chartTipDay}>{words}</div>
          <div className={styles.chartTipRow}>
            <span className={styles.chartTipSwatch} style={{ background: chart.color }} />
            Entered {chart.option}
            <b>{day.count}</b>
          </div>
        </div>
      )}
      <span className={styles.srOnly} aria-live="polite" data-testid="chart-said">
        {day ? `${words}: ${day.count} entered ${chart.option}` : ""}
      </span>
    </>
  );
}

/** Project, then select, then option, each picked in place. */
function ChartPicker({ choices, onDone }: { choices: ChartChoice[]; onDone: () => void }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(choices[0]?.id ?? "");
  const project = choices.find((c) => c.id === projectId);
  const [propertyId, setPropertyId] = useState(project?.properties[0]?.id ?? "");
  const property = project?.properties.find((p) => p.id === propertyId);
  const [optionId, setOptionId] = useState(property?.options.at(-1)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickProject(id: string) {
    setProjectId(id);
    const first = choices.find((c) => c.id === id)?.properties[0];
    setPropertyId(first?.id ?? "");
    setOptionId(first?.options.at(-1)?.id ?? "");
  }

  function pickProperty(id: string) {
    setPropertyId(id);
    setOptionId(project?.properties.find((p) => p.id === id)?.options.at(-1)?.id ?? "");
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !optionId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/charts", { projectId, propertyId, optionId });
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the chart.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={add} data-testid="chart-picker">
      <span className="label">New chart</span>
      <Select
        block
        aria-label="Project"
        value={projectId}
        onChange={pickProject}
        options={choices.map((c) => ({ value: c.id, label: `${c.key} · ${c.name}` }))}
      />
      <Select
        block
        aria-label="Property"
        value={propertyId}
        onChange={pickProperty}
        options={(project?.properties ?? []).map((p) => ({ value: p.id, label: p.name }))}
      />
      <Select
        block
        aria-label="Option"
        value={optionId}
        onChange={setOptionId}
        options={(property?.options ?? []).map((o) => ({ value: o.id, label: o.name }))}
      />
      <span className={styles.hint}>Counts the tasks that entered it each day.</span>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.row}>
        <Button type="submit" disabled={busy || !optionId}>
          {busy ? "Adding…" : "Add chart"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
