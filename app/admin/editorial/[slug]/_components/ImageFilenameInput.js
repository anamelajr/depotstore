"use client";

import { useEffect, useState } from "react";

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

export default function ImageFilenameInput({ slug, value, onChange, placeholder }) {
  const [files, setFiles] = useState([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!slug || slug === "(slug)") return;
    let cancelled = false;
    fetch(`/api/admin/list-files?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setFiles(data.files || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  const matches = focused && value
    ? files.filter((f) => f.toLowerCase().includes(value.toLowerCase())).slice(0, 8)
    : focused ? files.slice(0, 8) : [];

  const hasFile = files.includes(value);

  return (
    <div style={{ position: "relative" }}>
      <input
        style={inputStyle}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {value && !hasFile && (
        <div style={{ fontSize: 10, color: "#c9806b", marginTop: 3 }}>
          File not found in public/editorial/{slug}/
        </div>
      )}
      {matches.length > 0 && focused && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 2,
            background: "#18181a",
            border: "1px solid #2a2a2c",
            borderRadius: 4,
            zIndex: 5,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {matches.map((f) => (
            <div
              key={f}
              onClick={() => onChange(f)}
              style={{ padding: "5px 8px", fontSize: 12, cursor: "pointer", color: "#e7e7e2" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {f}
            </div>
          ))}
        </div>
      )}
      {hasFile && (
        <img
          src={`/editorial/${slug}/${value}`}
          alt=""
          style={{ marginTop: 6, maxWidth: 120, maxHeight: 80, objectFit: "cover", borderRadius: 3 }}
        />
      )}
    </div>
  );
}
