"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
      {/* The words under the bars say the numbers, and each bar's title says its own. */}
      <div className={styles.bars} data-testid="chart-bars">
        {chart.days.map((d, i) => (
          <span
            key={d.day}
            className={styles.barSlot}
            title={`${dayName(d.day)}: ${d.count}`}
            data-testid="chart-bar"
            data-count={d.count}
          >
            <span
              className={styles.bar}
              style={{
                height: d.count ? `${(d.count / max) * 100}%` : undefined,
                background: chart.color,
                opacity: i === chart.days.length - 1 ? 1 : 0.45,
              }}
            />
          </span>
        ))}
      </div>
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
