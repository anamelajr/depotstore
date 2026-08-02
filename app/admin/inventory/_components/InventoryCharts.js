"use client";

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";

const card = { background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 8, padding: 16, marginBottom: 16 };
const title = { fontSize: 13, fontWeight: 500, marginBottom: 12 };
const caption = { fontSize: 11, color: "#8a8a80", lineHeight: 1.5 };
const axis = { fill: "#8a8a80", fontSize: 11 };
const ACCENT = "#c8b89a";
const ARRIVE = "#7d9b8a";
const DEPART = "#a8674f";
const tooltipStyle = { background: "#0f0f10", border: "1px solid #3a3a3c", borderRadius: 6, color: "#e7e7e2", fontSize: 12 };

// Exits mix true sales with plain removals (stores don't reliably distinguish),
// so every label here says "left", never "sold" / "demand".
const TURNOVER_CAPTION =
  "% = items that left ÷ items available in the window (stock at the start + new " +
  "arrivals) — sold or removed; stores don't reliably distinguish, and a late " +
  "arrival counts as fully available. Groups with under 20 tracked items are " +
  "hidden so one big store can't dominate. Days = average time to leave.";

export default function InventoryCharts({
  velocity, brandTurnover, categoryTurnover, flow, flowIsGlobal = false,
  sellableExits = null, exitedPeriod = null,
}) {
  const velocityCaption =
    "How long items take to leave. Only items first listed after tracking started " +
    "are counted" +
    (sellableExits == null || exitedPeriod == null
      ? "."
      : ` (${sellableExits.toLocaleString()} of ${exitedPeriod.toLocaleString()} exits in this window).`);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Panel title="Sell-through velocity — days to leave" caption={velocityCaption}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={velocity} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#232325" vertical={false} />
            <XAxis dataKey="label" tick={axis} stroke="#2a2a2c" />
            <YAxis tick={axis} stroke="#2a2a2c" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
            <Bar dataKey="count" fill={ACCENT} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* v_daily_flow has no store grain in v1 — when a store filter is active this
          panel stays all-stores and SAYS so, instead of silently mixing scopes. */}
      <Panel
        title={`Inventory flow — arrivals vs departures${flowIsGlobal ? " (all stores)" : ""}`}
        caption={
          flowIsGlobal
            ? "New listings vs removals per day. This panel always covers all stores combined — the daily flow data has no per-store grain, so the store filter does not apply here."
            : "New listings vs removals per day, all stores combined."
        }
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={flow} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#232325" vertical={false} />
            <XAxis dataKey="date" tick={axis} stroke="#2a2a2c" minTickGap={24} />
            <YAxis tick={axis} stroke="#2a2a2c" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#8a8a80" }} />
            {/* plotArrivals is null on the seed day — the censored backlog is not
                real arrivals; plotting it rescales the chart into a fake spike. */}
            <Line type="monotone" dataKey="plotArrivals" name="arrivals" stroke={ARRIVE} dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="departures" stroke={DEPART} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Brand turnover — % of stock that left" caption={TURNOVER_CAPTION}>
        <TurnoverBars data={brandTurnover} />
      </Panel>
      <Panel title="Category turnover — % of stock that left" caption={TURNOVER_CAPTION}>
        <TurnoverBars data={categoryTurnover} />
      </Panel>
    </div>
  );
}

// "62% · 9d · 310 items" — rate, average time to leave, tracked count.
function barLabel(d) {
  const days = d.avgDaysToSell == null ? "—" : `${d.avgDaysToSell}d`;
  return `${d.turnoverPct}% · ${days} · ${d.total.toLocaleString()} items`;
}

function TurnoverTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const days = d.avgDaysToSell == null ? "—" : `${d.avgDaysToSell} d`;
  return (
    <div style={{ ...tooltipStyle, padding: "8px 10px" }}>
      <div style={{ marginBottom: 4 }}>{d.name}</div>
      <div>{d.turnoverPct}% left (sold or removed)</div>
      <div>Avg days to leave: {days}</div>
      <div>Left: {d.exited.toLocaleString()} · active: {d.active.toLocaleString()}</div>
      <div>Total tracked: {d.total.toLocaleString()}</div>
    </div>
  );
}

function TurnoverBars({ data }) {
  if (!data.length) {
    return <div style={{ ...caption, padding: "8px 0" }}>No group has enough tracked items to rank in this window.</div>;
  }
  return (
    // Bars plot turnoverPct on an explicit 0–100 axis — the same field the label
    // and tooltip read, so no formatter can scale independently.
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 150, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#232325" horizontal={false} />
        <XAxis type="number" dataKey="turnoverPct" domain={[0, 100]} tick={axis} stroke="#2a2a2c" unit="%" />
        <YAxis type="category" dataKey="name" tick={axis} stroke="#2a2a2c" width={110} />
        <Tooltip content={<TurnoverTooltip />} cursor={{ fill: "#ffffff10" }} />
        <Bar dataKey="turnoverPct" fill={ARRIVE} radius={[0, 2, 2, 0]}>
          <LabelList dataKey="turnoverPct" content={renderBarLabel(data)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Recharts hands a label `content` only geometry + index, so the row is looked up
// from the same `data` array the bars were built from.
function renderBarLabel(data) {
  return function BarValueLabel({ x, y, width, height, index }) {
    const d = data[index];
    if (!d) return null;
    return (
      <text x={x + width + 6} y={y + height / 2} dy={4} fill="#8a8a80" fontSize={11}>
        {barLabel(d)}
      </text>
    );
  };
}

function Panel({ title: t, caption: c, children }) {
  return (
    <div style={card}>
      <div style={{ ...title, marginBottom: c ? 4 : 12 }}>{t}</div>
      {c && <div style={{ ...caption, marginBottom: 12 }}>{c}</div>}
      {children}
    </div>
  );
}
