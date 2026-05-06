export function NodeSummary({
  summary
}: {
  summary: {
    states: [string, number][];
    gpus: [string, number][];
    partitions: [string, number][];
  };
}) {
  return (
    <div className="node-summary" aria-label="Node summary">
      <SummaryColumn title="States" rows={summary.states} />
      <SummaryColumn title="GPU Types" rows={summary.gpus} />
      <SummaryColumn title="Partitions" rows={summary.partitions} />
    </div>
  );
}

function SummaryColumn({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="summary-column">
      <strong>{title}</strong>
      {rows.length ? (
        rows.slice(0, 6).map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <em>{count}</em>
          </div>
        ))
      ) : (
        <div>
          <span>none</span>
          <em>0</em>
        </div>
      )}
    </div>
  );
}
