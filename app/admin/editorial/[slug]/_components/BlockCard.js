"use client";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: 6,
  borderRadius: 3,
  fontSize: 12,
  fontFamily: "inherit",
};

const textareaStyle = { ...inputStyle, minHeight: 80, resize: "vertical", lineHeight: 1.5 };

function Pill({ label, active, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        padding: "2px 8px",
        border: `1px solid ${active ? "#d6d2c4" : "#2a2a2c"}`,
        background: active ? "#d6d2c4" : "transparent",
        color: active ? "#18181a" : "#b6b6ad",
        borderRadius: 10,
        fontSize: 10,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
    </span>
  );
}

export default function BlockCard({ block, index, total, onChange, onMoveUp, onMoveDown, onDelete }) {
  const update = (patch) => onChange({ ...block, ...patch });

  return (
    <div
      style={{
        background: "#18181a",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            background: "#2a2a2c",
            color: "#b6b6ad",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {block.type}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button onClick={onMoveUp} disabled={index === 0} style={btnStyle}>↑</button>
          <button onClick={onMoveDown} disabled={index === total - 1} style={btnStyle}>↓</button>
          <button onClick={onDelete} style={{ ...btnStyle, color: "#c9806b" }}>×</button>
        </div>
      </header>

      {block.type === "text" && (
        <>
          <textarea
            style={textareaStyle}
            value={block.body ?? ""}
            onChange={(e) => update({ body: e.target.value })}
            placeholder="Paragraph text…"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#8a8a80", alignItems: "center" }}>
            <span>width:</span>
            <Pill label="narrow" active={block.width === "narrow"} onClick={() => update({ width: "narrow" })} />
            <Pill label="wide" active={block.width === "wide"} onClick={() => update({ width: "wide" })} />
            <span style={{ marginLeft: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={!!block.dropcap}
                  onChange={(e) => update({ dropcap: e.target.checked })}
                /> dropcap
              </label>
            </span>
          </div>
        </>
      )}

      {block.type === "section-heading" && (
        <input
          style={inputStyle}
          value={block.text ?? ""}
          onChange={(e) => update({ text: e.target.value })}
          placeholder="Section heading…"
        />
      )}

      {block.type === "pullquote" && (
        <>
          <input
            style={inputStyle}
            value={block.text ?? ""}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Quote text…"
          />
          <input
            style={{ ...inputStyle, marginTop: 6 }}
            value={block.attribution ?? ""}
            onChange={(e) => update({ attribution: e.target.value })}
            placeholder="Attribution"
          />
        </>
      )}

      {block.type === "image" && (
        <>
          <input
            style={inputStyle}
            value={block.src ?? ""}
            onChange={(e) => update({ src: e.target.value })}
            placeholder="filename in public/editorial/<slug>/"
          />
          <input
            style={{ ...inputStyle, marginTop: 6 }}
            value={block.alt ?? ""}
            onChange={(e) => update({ alt: e.target.value })}
            placeholder="alt text"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#8a8a80", alignItems: "center" }}>
            <span>width:</span>
            <Pill label="narrow" active={block.width === "narrow"} onClick={() => update({ width: "narrow" })} />
            <Pill label="wide" active={block.width === "wide"} onClick={() => update({ width: "wide" })} />
            <Pill label="full-bleed" active={block.width === "full-bleed"} onClick={() => update({ width: "full-bleed" })} />
          </div>
        </>
      )}

      {block.type === "image-pair" && (
        <>
          {[0, 1].map((i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <input
                style={inputStyle}
                value={block.images?.[i]?.src ?? ""}
                onChange={(e) => {
                  const next = [...(block.images ?? [{}, {}])];
                  next[i] = { ...next[i], src: e.target.value };
                  update({ images: next });
                }}
                placeholder={`image ${i + 1} filename`}
              />
              <input
                style={{ ...inputStyle, marginTop: 4 }}
                value={block.images?.[i]?.alt ?? ""}
                onChange={(e) => {
                  const next = [...(block.images ?? [{}, {}])];
                  next[i] = { ...next[i], alt: e.target.value };
                  update({ images: next });
                }}
                placeholder={`image ${i + 1} alt`}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const btnStyle = {
  background: "transparent",
  border: "1px solid #2a2a2c",
  color: "#b6b6ad",
  width: 22,
  height: 22,
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
