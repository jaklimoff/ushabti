"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  CHART_TWICE,
  chartHeading,
  chartHint,
  chartSplit,
  chartSummary,
  firstUncharted,
  sameSources,
  type ChartChoice,
  type ChartDTO,
  type StoredSource,
} from "@/lib/charts";
import { Button, Pill } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Field, Label, Select } from "@/components/ui/Form";
import { HomeSection, WidePanel } from "./Empty";
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
  const nothing = choices.length === 0 ? "No project has a select to count yet." : undefined;
  return (
    <HomeSection
      title="Charts"
      count={charts.length}
      adding={adding}
      data-testid="my-charts"
      create={
        <Button
          variant="text"
          className={styles.headButton}
          data-testid="chart-new"
          disabled={adding || choices.length === 0}
          title={nothing}
          onClick={() => setAdding(true)}
        >
          + New chart
        </Button>
      }
      empty={
        <WidePanel
          label="+ New chart"
          hint="Counts the tasks that enter a column each day, such as how many shipped."
          shapes="bars"
          disabled={choices.length === 0}
          title={nothing}
          onClick={() => setAdding(true)}
          data-testid="chart-new"
        />
      }
    >
      {(adding || charts.length > 0) && (
        <div className={styles.grid}>
          {adding && (
            <ChartPicker
              choices={choices}
              charted={charts.map((c) =>
                c.sources.map((s) => ({
                  projectId: s.project.id,
                  propertyId: s.propertyId,
                  optionId: s.optionId,
                })),
              )}
              onDone={() => setAdding(false)}
            />
          )}
          {charts.map((chart) => (
            <Chart key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </HomeSection>
  );
}

function Chart({ chart }: { chart: ChartDTO }) {
  const { options } = chartHeading(chart);
  const router = useRouter();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

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
      <ChartFace chart={chart}>
        <button
          className={styles.chartDelete}
          aria-label={`Delete the chart Entered ${options}`}
          title="Delete chart"
          onClick={confirm.ask}
        >
          ✕
        </button>
      </ChartFace>
      <span className={styles.hint}>{chartHint(chart)}</span>
      {confirm.asking && (
        <ConfirmRow
          question={`Delete the chart Entered ${options}? The tasks and their history stay.`}
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

/**
 * What a chart shows: the keys and the options, the bars and the words under
 * them. A saved chart and the picker's preview both draw through here, so the
 * preview is the chart it becomes. `children` sits at the top right.
 */
function ChartFace({ chart, children }: { chart: ChartDTO; children?: React.ReactNode }) {
  const max = Math.max(1, ...chart.days.map((d) => d.count));
  const { today, average } = chartSummary(chart.days);
  const from = chart.days[0]?.day;
  const to = chart.days.at(-1)?.day;
  const heading = chartHeading(chart);
  return (
    <>
      <div className={styles.cardTop} title={heading.title} data-testid="chart-heading">
        <span className={`${styles.key} ${styles.chartKeys}`}>{heading.keys}</span>
        <span className={styles.chartName}>
          Entered <b>{heading.options}</b>
        </span>
        <span className={styles.spacer} />
        {children}
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
    </>
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
  const { options } = chartHeading(chart);
  const split = lit === null ? null : chartSplit(chart, lit);

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
        className={styles.chartBars}
        data-testid="chart-bars"
        data-lit={lit === null ? undefined : ""}
        tabIndex={0}
        role="group"
        aria-label={`Tasks that entered ${options}, one bar a day`}
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
            title={barTitle(chart, i)}
            data-testid="chart-bar"
            data-count={d.count}
            data-lit={i === lit ? "" : undefined}
          >
            <span
              className={styles.chartBar}
              style={{ height: d.count ? `${(d.count / max) * 100}%` : undefined }}
            />
          </span>
        ))}
      </div>
      {day && (
        <div ref={tip} className={styles.chartTip} data-testid="chart-tip" aria-hidden>
          <div className={styles.chartTipDay}>{words}</div>
          <div className={styles.chartTipRow}>
            <span className={styles.chartTipSwatch} />
            Entered {options}
            <b>{day.count}</b>
          </div>
          {split && (
            <div className={styles.chartTipSplit} data-testid="chart-tip-split">
              {split}
            </div>
          )}
        </div>
      )}
      <span className={styles.srOnly} aria-live="polite" data-testid="chart-said">
        {day ? `${words}: ${day.count} entered ${options}${split ? ` — ${split}` : ""}` : ""}
      </span>
    </>
  );
}

/** A bar's own words, which the tests read: the day and its count, then each project's. */
function barTitle(chart: ChartDTO, i: number) {
  const d = chart.days[i];
  const split = chartSplit(chart, i);
  return split ? `${dayName(d.day)} · ${d.count} — ${split}` : `${dayName(d.day)}: ${d.count}`;
}

type ChartPick = StoredSource;
const NO_PICK: ChartPick = { projectId: "", propertyId: "", optionId: "" };

/**
 * Project, then select, then option, each picked in place, with the chart it
 * will draw under them. **Add project** adds another source, of a project the
 * chart does not count yet. An option starts on the last one that does not
 * make a chart the person already has; one that does can be pressed, and says
 * why it cannot be added.
 */
function ChartPicker({
  choices,
  charted,
  onDone,
}: {
  choices: ChartChoice[];
  charted: StoredSource[][];
  onDone: () => void;
}) {
  const router = useRouter();
  const twin = (picks: ChartPick[]) => charted.some((c) => sameSources(c, picks));
  /* The options of source `i` that would make a chart the person already has. */
  const twinsAt = (picks: ChartPick[], i: number, options: { id: string }[]) =>
    new Set(
      options
        .filter((o) => twin(picks.map((p, j) => (j === i ? { ...p, optionId: o.id } : p))))
        .map((o) => o.id),
    );
  const startOf = (picks: ChartPick[], i: number, projectId: string, propertyId?: string) => {
    const project = choices.find((c) => c.id === projectId);
    const property = project?.properties.find((p) => p.id === propertyId) ?? project?.properties[0];
    const options = property?.options ?? [];
    const next = { projectId, propertyId: property?.id ?? "", optionId: "" };
    const placed = picks.map((p, j) => (j === i ? next : p));
    return placed.map((p, j) =>
      j === i ? { ...p, optionId: firstUncharted(options, twinsAt(placed, i, options)) } : p,
    );
  };
  const [picks, setPicks] = useState<ChartPick[]>(() =>
    startOf([NO_PICK], 0, choices[0]?.id ?? ""),
  );
  const taken = twin(picks);
  const unused = choices.filter((c) => !picks.some((p) => p.projectId === c.id));
  const ready = picks.every((p) => p.optionId);
  const preview = usePreview(picks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(next: ChartPick[]) {
    setPicks(next);
    setError(null);
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready || taken) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/charts", { sources: picks });
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the chart.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={add} data-testid="chart-picker">
      <Label>New chart</Label>
      {picks.map((pick, i) => (
        <ChartSourcePick
          key={i}
          pick={pick}
          choices={choices.filter(
            (c) => c.id === pick.projectId || !picks.some((p) => p.projectId === c.id),
          )}
          twins={twinsAt(
            picks,
            i,
            choices
              .find((c) => c.id === pick.projectId)
              ?.properties.find((p) => p.id === pick.propertyId)?.options ?? [],
          )}
          onProject={(id) => choose(startOf(picks, i, id))}
          onProperty={(id) => choose(startOf(picks, i, pick.projectId, id))}
          onOption={(id) => choose(picks.map((p, j) => (j === i ? { ...p, optionId: id } : p)))}
          onRemove={i > 0 ? () => choose(picks.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      {unused.length > 0 && (
        <div className={styles.row}>
          <Button
            variant="text"
            data-testid="chart-add-source"
            onClick={() => choose(startOf([...picks, NO_PICK], picks.length, unused[0].id))}
          >
            + Add project
          </Button>
        </div>
      )}
      <div
        className={`${styles.chart} ${styles.chartPreview}`}
        data-testid="chart-preview"
        aria-busy={preview ? undefined : true}
      >
        {preview ? (
          <ChartFace chart={preview}>
            <Label>Preview</Label>
          </ChartFace>
        ) : (
          <div className={styles.chartWaiting} />
        )}
      </div>
      {taken && (
        <div className={styles.error} role="alert" data-testid="chart-taken">
          {CHART_TWICE}
        </div>
      )}
      {error && !taken && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.row}>
        <Button type="submit" disabled={busy || !ready || taken}>
          {busy ? "Adding…" : "Add chart"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One source of a new chart: its project, its select and its column. */
function ChartSourcePick({
  pick,
  choices,
  twins,
  onProject,
  onProperty,
  onOption,
  onRemove,
}: {
  pick: ChartPick;
  choices: ChartChoice[];
  twins: ReadonlySet<string>;
  onProject: (id: string) => void;
  onProperty: (id: string) => void;
  onOption: (id: string) => void;
  onRemove?: () => void;
}) {
  const project = choices.find((c) => c.id === pick.projectId);
  const property = project?.properties.find((p) => p.id === pick.propertyId);
  const said = useId();
  return (
    <div className={styles.chartSource} data-testid="chart-source">
      <div className={styles.chartFields}>
        <Field label="Project">
          <Select
            block
            aria-label="Project"
            value={pick.projectId}
            onChange={onProject}
            options={choices.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Property">
          {project && project.properties.length === 1 ? (
            <span className={styles.chartOnly} data-testid="chart-property">
              {project.properties[0].name}
            </span>
          ) : (
            <Select
              block
              aria-label="Property"
              value={pick.propertyId}
              onChange={onProperty}
              options={(project?.properties ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
        </Field>
      </div>
      <div className={styles.chartPick} role="group" aria-labelledby={said}>
        <span className={styles.chartAsk} id={said}>
          Count the tasks that enter
        </span>
        <div className={styles.chartPills}>
          {(property?.options ?? []).map((o) => (
            <Pill
              key={o.id}
              on={o.id === pick.optionId}
              quiet={twins.has(o.id)}
              title={twins.has(o.id) ? "You already have this chart" : undefined}
              data-testid="chart-option"
              onClick={() => onOption(o.id)}
            >
              {o.name}
            </Pill>
          ))}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          className={styles.chartDelete}
          aria-label={`Remove ${project?.name ?? "this project"} from the chart`}
          title="Remove project"
          data-testid="chart-remove-source"
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The chart a pick would draw, counted by the server as a saved one is. Only
 * the answer to the latest pick lands; an older one is dropped on the way in,
 * and none is shown while the latest is out.
 */
function usePreview(picks: ChartPick[]): ChartDTO | null {
  const [shown, setShown] = useState<{ for: string; chart: ChartDTO } | null>(null);
  const asked = useRef(0);
  const key = picks.map((p) => `${p.projectId}/${p.propertyId}/${p.optionId}`).join(" ");
  useEffect(() => {
    if (!picks.every((p) => p.optionId)) return;
    const n = ++asked.current;
    api
      .post<{ chart: ChartDTO }>("/api/charts/preview", { sources: picks })
      .then(({ chart }) => {
        if (asked.current === n) setShown({ for: key, chart });
      })
      .catch(() => {
        if (asked.current === n) setShown(null);
      });
    // The key names the pick; the object is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shown?.for === key ? shown.chart : null;
}
