"use client";

import ImageFilenameInput from "./ImageFilenameInput.js";

const LAYOUTS = ["image-right", "image-left", "image-below", "image-pair-top"];

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span
        style={{
          display: "block",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#8a8a80",
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: "block", fontSize: 11, color: "#6b6b62", marginTop: 3 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
};

export default function HeroPanel({ hero, onChange, slug, brandFilter, onBrandFilterChange, publishedAt, onPublishedAtChange }) {
  const update = (patch) => onChange({ ...hero, ...patch });

  return (
    <section
      style={{
        background: "#18181a",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 12px" }}>
        Hero · Metadata
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Slug">
          <input style={inputStyle} value={slug} disabled />
        </Field>
        <Field label="Published">
          <input
            style={inputStyle}
            type="date"
            value={publishedAt}
            onChange={(e) => onPublishedAtChange(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Layout">
        <select
          style={inputStyle}
          value={hero.layout}
          onChange={(e) => update({ layout: e.target.value })}
        >
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </Field>

      <Field label="Eyebrow">
        <input
          style={inputStyle}
          value={hero.eyebrow}
          onChange={(e) => update({ eyebrow: e.target.value })}
        />
      </Field>

      <Field label="Title">
        <input
          style={inputStyle}
          value={hero.title}
          onChange={(e) => update({ title: e.target.value })}
        />
      </Field>

      <Field label="Subtitle" hint="Use \\n for a line break.">
        <textarea
          style={{ ...inputStyle, minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
          value={hero.subtitle}
          onChange={(e) => update({ subtitle: e.target.value })}
        />
      </Field>

      <Field label="Byline">
        <input
          style={inputStyle}
          value={hero.byline}
          onChange={(e) => update({ byline: e.target.value })}
        />
      </Field>

      <Field label="Hero image filename" hint={`File goes in public/editorial/${slug}/`}>
        <ImageFilenameInput
          slug={slug}
          value={hero.images?.[0] ?? ""}
          onChange={(v) => update({ images: [v] })}
          placeholder="hero image filename"
        />
      </Field>

      <Field label="Hero image alt">
        <input
          style={inputStyle}
          value={hero.imageAlt?.[0] ?? ""}
          onChange={(e) => update({ imageAlt: [e.target.value] })}
        />
      </Field>

      <Field label="Brand filter" hint="Used for the 'More from designer' grid + Generate prompt.">
        <input
          style={inputStyle}
          value={brandFilter}
          onChange={(e) => onBrandFilterChange(e.target.value)}
        />
      </Field>
    </section>
  );
}
