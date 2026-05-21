// Admin shell. Visual identity is intentionally plain — this is a local
// dev tool, not part of the public site. Matches Dépôt's font/theme so
// the live preview pane looks correct.
export const metadata = { robots: "noindex, nofollow" };

export default function AdminLayout({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0f0f10", color: "#e7e7e2" }}>
      <header
        style={{
          borderBottom: "1px solid #2a2a2c",
          padding: "12px 20px",
          fontSize: 13,
          display: "flex",
          gap: 20,
          alignItems: "center",
        }}
      >
        <a href="/admin" style={{ color: "#e7e7e2", textDecoration: "none", fontWeight: 500 }}>
          Dépôt · Admin
        </a>
        <a href="/admin/editorial" style={{ color: "#b6b6ad", textDecoration: "none" }}>
          Editorial
        </a>
        <a href="/admin/homepage-edit" style={{ color: "#b6b6ad", textDecoration: "none" }}>
          Today's Edit
        </a>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b6b62" }}>
          local-only · NODE_ENV={process.env.NODE_ENV}
        </span>
      </header>
      <main style={{ padding: 20 }}>{children}</main>
    </div>
  );
}
