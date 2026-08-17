import { fetchActiveStoresFresh } from "../../lib/stores.js";
import { getInventoryInsights } from "../../lib/inventoryAnalytics.js";
import InventoryCharts from "./_components/InventoryCharts.js";

export const metadata = { robots: "noindex, nofollow" };
// Always read fresh prod data; never cache an admin analytics view.
export const dynamic = "force-dynamic";

const RANGES = [
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "7", label: "Last 7 days" },
  { key: "all", label: "All time" },
];

const card = { background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 8, padding: 16 };
const muted = { color: "#8a8a80" };

export default async function InventoryInsightsPage({ searchParams }) {
  const sp = await searchParams; // Next 15+: searchParams is async
  const store = sp?.store && sp.store !== "all" ? sp.store : null;
  const rangeKey = RANGES.some((r) => r.key === sp?.range) ? sp.range : "30";
  const sinceDays = rangeKey === "all" ? null : Number(rangeKey);

  // Local-archive mode: when DEPOT_ARCHIVE_DB points at the SQLite mirror, read
  // the full history from it instead of Supabase (which keeps only a ~14-day hot
  // window). The env var is never set on Vercel, so prod never loads node:sqlite
  // — hence the dynamic import.
  const archivePath = process.env.DEPOT_ARCHIVE_DB;
  let readers = {};
  let archiveMeta = null;
  let archiveError = null;
  if (archivePath) {
    try {
      const mod = await import("../../lib/inventoryArchive/localReaders.js");
      readers = mod.makeLocalReaders({ path: archivePath });
      archiveMeta = await mod.getArchiveMeta({ path: archivePath });
    } catch (e) {
      archiveError = e.message;
      readers = {};
    }
  }

  let data, error;
  try {
    data = await getInventoryInsights({ store, sinceDays, readers });
  } catch (e) {
    error = e.message;
  }
  const stores = await fetchActiveStoresFresh().catch(() => []);

  if (error) {
    return (
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400 }}>Inventory insights</h1>
        <p style={{ color: "#c98b7a" }}>Could not load insights: {error}</p>
        {archivePath ? (
          <p style={muted}>Reading the local archive at <code>{archivePath}</code>. If the file is
            missing or empty, run <code>npm run archive</code> to mirror from Supabase.</p>
        ) : (
          <p style={muted}>If the views are missing, apply
            <code> scripts/sql/2026-07-03-inventory-insights-mv.sql</code> in the SQL Editor.</p>
        )}
      </div>
    );
  }

  const { kpis, velocity, brandTurnover, categoryTurnover, storeBreakdown, flow, meta } = data;
  const empty = meta.totalTracked === 0;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, marginBottom: 4 }}>Inventory insights</h1>
      <p style={{ ...muted, fontSize: 12, marginBottom: 20 }}>
        Forward-going history from daily snapshots. Velocity excludes left-censored
        (pre-deploy) items. {meta.totalTracked.toLocaleString()} products tracked.
        {meta.gapExits > 0 && ` ${meta.gapExits.toLocaleString()} pre-tracking exits excluded.`}
      </p>

      {archiveMeta && (
        <p style={{ ...muted, fontSize: 12, marginTop: -12, marginBottom: 20 }}>
          Data as of {archiveMeta.lastArchivedDay ?? "—"} · local archive
          ({archiveMeta.days} days, {archiveMeta.snapshotRows.toLocaleString()} snapshot rows;
          last run {archiveMeta.lastRunAt ?? "never"}).
        </p>
      )}
      {archiveError && (
        <p style={{ color: "#c98b7a", fontSize: 12, marginTop: -12, marginBottom: 20 }}>
          Local archive unavailable ({archiveError}) — showing Supabase data, which keeps only the
          recent hot window. Run <code>npm run archive</code>.
        </p>
      )}

      {/* Filters (plain GET form) */}
      <form method="get" style={{ display: "flex", gap: 12, marginBottom: 24, fontSize: 13 }}>
        <select name="store" defaultValue={store ?? "all"} style={selectStyle}>
          <option value="all">All stores</option>
          {stores.map((s) => (
            <option key={s.domain} value={s.domain}>{s.displayName ?? s.storeName ?? s.domain}</option>
          ))}
        </select>
        <select name="range" defaultValue={rangeKey} style={selectStyle}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <button type="submit" style={btnStyle}>Apply</button>
      </form>

      {empty && (
        <div style={{ ...card, marginBottom: 24, ...muted }}>
          No snapshots captured yet. Deploy Phase 1 and let the cron run; this page
          fills in as days accumulate.
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 28 }}>
        <Kpi label="Active now" value={kpis.activeNow.toLocaleString()} note="Listed and still available right now." />
        <Kpi
          label={`Sold / left · ${rangeKey === "all" ? "all" : rangeKey + "d"}`}
          value={kpis.exitedPeriod.toLocaleString()}
          note="Sold or removed — stores don't always distinguish."
        />
        <Kpi
          label="Median days-to-sell"
          value={kpis.medianDaysToSell == null ? "—" : `${kpis.medianDaysToSell} d`}
          note="Only items listed after tracking began."
        />
        <Kpi
          label={`New arrivals · ${rangeKey === "all" ? "all" : rangeKey + "d"}`}
          value={kpis.arrivalsPeriod.toLocaleString()}
          note="First listed in this window; pre-tracking backlog excluded."
        />
      </div>

      {/* Charts (client / Recharts) */}
      <InventoryCharts
        velocity={velocity}
        brandTurnover={brandTurnover}
        categoryTurnover={categoryTurnover}
        flow={flow}
        flowIsGlobal={Boolean(store)}
        sellableExits={meta.sellableExits}
        exitedPeriod={kpis.exitedPeriod}
      />

      {/* Per-store breakdown (server-rendered table) */}
      <h2 style={{ fontSize: 14, fontWeight: 500, margin: "28px 0 4px" }}>Per-store breakdown</h2>
      <p style={{ ...muted, fontSize: 11, margin: "0 0 10px" }}>
        Follows the filters above. &quot;Exited&quot; means sold or removed.
      </p>
      <div style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={muted}>
              {["Store", "Sold signal", "Active", "Exited", "Avg days-to-sell"].map((h, i) => (
                <th key={h} style={{ textAlign: i < 2 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid #2a2a2c" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storeBreakdown.map((s) => (
              <tr key={s.store}>
                <td style={tdL}>{s.store}</td>
                <td style={tdL}>{s.signal}</td>
                <td style={tdR}>{s.active.toLocaleString()}</td>
                <td style={tdR}>{s.exited.toLocaleString()}</td>
                <td style={tdR}>{s.avgDaysToSell ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, note }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: "#8a8a80", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, marginTop: 6 }}>{value}</div>
      {note && <div style={{ fontSize: 11, color: "#8a8a80", marginTop: 6, lineHeight: 1.4 }}>{note}</div>}
    </div>
  );
}

const selectStyle = { background: "#18181a", color: "#e7e7e2", border: "1px solid #2a2a2c", borderRadius: 6, padding: "6px 10px" };
const btnStyle = { background: "#2a2a2c", color: "#e7e7e2", border: "1px solid #3a3a3c", borderRadius: 6, padding: "6px 14px", cursor: "pointer" };
const tdL = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #232325" };
const tdR = { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #232325", fontVariantNumeric: "tabular-nums" };
