"use client";

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const card = { background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 8, padding: 16, marginBottom: 16 };
const title = { fontSize: 13, fontWeight: 500, marginBottom: 12 };
const axis = { fill: "#8a8a80", fontSize: 11 };
const ACCENT = "#c8b89a";
const ARRIVE = "#7d9b8a";
const DEPART = "#a8674f";
const tooltipStyle = { background: "#0f0f10", border: "1px solid #3a3a3c", borderRadius: 6, color: "#e7e7e2", fontSize: 12 };

export default function InventoryCharts({ velocity, brandTurnover, categoryTurnover, flow, flowIsGlobal = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Panel title="Sell-through velocity — days to sell">
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
      <Panel title={`Inventory flow — arrivals vs departures${flowIsGlobal ? " (all stores)" : ""}`}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={flow} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#232325" vertical={false} />
            <XAxis dataKey="date" tick={axis} stroke="#2a2a2c" minTickGap={24} />
            <YAxis tick={axis} stroke="#2a2a2c" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#8a8a80" }} />
            <Line type="monotone" dataKey="arrivals" stroke={ARRIVE} dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="departures" stroke={DEPART} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Brand turnover — exited (demand proxy)">
        <TurnoverBars data={brandTurnover} />
      </Panel>
      <Panel title="Category turnover — exited">
        <TurnoverBars data={categoryTurnover} />
      </Panel>
    </div>
  );
}

function TurnoverBars({ data }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#232325" horizontal={false} />
        <XAxis type="number" tick={axis} stroke="#2a2a2c" allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={axis} stroke="#2a2a2c" width={110} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
        <Bar dataKey="exited" fill={ARRIVE} radius={[0, 2, 2, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Panel({ title: t, children }) {
  return (
    <div style={card}>
      <div style={title}>{t}</div>
      {children}
    </div>
  );
}
