export default function AdminLanding() {
  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 24, fontWeight: 400, marginBottom: 16 }}>
        What do you want to edit?
      </h1>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        <li>
          <a
            href="/admin/editorial"
            style={{
              display: "block",
              padding: 16,
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              color: "#e7e7e2",
              textDecoration: "none",
            }}
          >
            <strong>Editorial entries</strong>
            <div style={{ fontSize: 12, color: "#8a8a80", marginTop: 4 }}>
              Designer profiles. Create, edit, generate drafts.
            </div>
          </a>
        </li>
        <li>
          <a
            href="/admin/homepage-edit"
            style={{
              display: "block",
              padding: 16,
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              color: "#e7e7e2",
              textDecoration: "none",
            }}
          >
            <strong>Today's Edit</strong>
            <div style={{ fontSize: 12, color: "#8a8a80", marginTop: 4 }}>
              Hand-pick which 8 products appear on the homepage.
            </div>
          </a>
        </li>
        <li>
          <a
            href="/admin/inventory"
            style={{
              display: "block",
              padding: 16,
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              color: "#e7e7e2",
              textDecoration: "none",
            }}
          >
            <strong>Inventory insights</strong>
            <div style={{ fontSize: 12, color: "#8a8a80", marginTop: 4 }}>
              Sell-through velocity, brand/category turnover, inventory flow.
            </div>
          </a>
        </li>
      </ul>
    </div>
  );
}
