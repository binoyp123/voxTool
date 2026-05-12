import { useState } from "react";

const PRESETS = [
  { id: "bone", label: "Bone", min: 300, max: 1500 },
  { id: "electrodes", label: "Electrodes", min: 1500, max: 3500 },
  { id: "soft", label: "Soft", min: -100, max: 200 },
];

const CLIP_PLANES = [
  { id: "sagittal", label: "Sagittal" },
  { id: "coronal", label: "Coronal" },
  { id: "axial", label: "Axial" },
];

const LAYOUTS = [
  { id: "multi", label: "4-up", hint: "Axial + Coronal + Sagittal + 3D (0)" },
  { id: "axial", label: "A", hint: "Axial only (1)" },
  { id: "coronal", label: "C", hint: "Coronal only (2)" },
  { id: "sagittal", label: "S", hint: "Sagittal only (3)" },
  { id: "render", label: "3D", hint: "3D render only (4)" },
];

export default function Toolbar({
  scanFilename,
  calMin,
  calMax,
  onCalMinChange,
  onCalMaxChange,
  onWindowChange,
  clipDepth,
  clipPlane,
  onClipDepthChange,
  onClipPlaneChange,
  viewerLayout,
  onViewerLayoutChange,
  sidebarCollapsed,
  onToggleSidebar,
  hollowRender,
  onToggleHollowRender,
  disabled = false,
}) {
  const [autoLoading, setAutoLoading] = useState(false);

  const nvDisabled = disabled || !scanFilename;

  const applyPreset = (preset) => {
    if (onWindowChange) {
      onWindowChange(preset.min, preset.max);
    } else {
      onCalMinChange(preset.min);
      onCalMaxChange(preset.max);
    }
  };

  const applyAuto = async () => {
    if (!scanFilename) return;
    const API = process.env.REACT_APP_API_URL || "";
    setAutoLoading(true);
    try {
      const res = await fetch(`${API}/api/scans/${scanFilename}/range`);
      const data = await res.json();
      const min = Math.round(data.p1);
      const max = Math.round(data.p99);
      if (onWindowChange) {
        onWindowChange(min, max);
      } else {
        onCalMinChange(min);
        onCalMaxChange(max);
      }
    } catch (err) {
      console.error("applyAuto:", err);
      alert("Auto windowing failed.");
    }
    setAutoLoading(false);
  };

  return (
    <div className="toolbar toolbar-viewer">
      <button
        type="button"
        className="btn btn-compact"
        onClick={onToggleSidebar}
        title={
          sidebarCollapsed
            ? "Show sidebar (F)"
            : "Hide sidebar for more viewer space (F)"
        }
      >
        {sidebarCollapsed ? "›" : "‹"}
      </button>

      <div className="layout-group" title="Viewer layout (keys 0–4)">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`btn ${viewerLayout === l.id ? "btn-primary" : ""}`}
            onClick={() => onViewerLayoutChange(l.id)}
            title={l.hint}
            disabled={nvDisabled}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-presets" title="Intensity window presets">
        {PRESETS.map((p) => {
          const active = p.min === calMin && p.max === calMax;
          return (
            <button
              key={p.id}
              type="button"
              className={`btn btn-compact ${active ? "btn-primary" : ""}`}
              onClick={() => applyPreset(p)}
              disabled={nvDisabled}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-compact"
          onClick={applyAuto}
          disabled={nvDisabled || autoLoading}
          title="1st–99th percentile of this scan"
        >
          {autoLoading ? "…" : "Auto"}
        </button>
      </div>

      <label className="toolbar-slider">
        Min
        <input
          type="range"
          min={-200}
          max={2000}
          value={calMin}
          onChange={(e) => onCalMinChange(Number(e.target.value))}
          disabled={nvDisabled}
        />
        <span className="threshold-value">{calMin}</span>
      </label>

      <label className="toolbar-slider">
        Max
        <input
          type="range"
          min={0}
          max={5000}
          value={calMax}
          onChange={(e) => onCalMaxChange(Number(e.target.value))}
          disabled={nvDisabled}
        />
        <span className="threshold-value">{calMax}</span>
      </label>

      <button
        type="button"
        className={`btn btn-compact ${hollowRender ? "btn-primary" : ""}`}
        onClick={onToggleHollowRender}
        disabled={nvDisabled}
        title="Hollow / X-ray look on the 3D render so contacts inside the skull are visible (uses NiiVue MIP-style rendering)."
      >
        Hollow
      </button>

      <label className="toolbar-clip" title="Slice the 3D render">
        3D clip
        <select
          value={clipPlane}
          onChange={(e) => onClipPlaneChange(e.target.value)}
          disabled={nvDisabled}
        >
          <option value="off">Off</option>
          {CLIP_PLANES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          type="range"
          min={-100}
          max={100}
          value={Math.round(clipDepth * 100)}
          onChange={(e) => onClipDepthChange(Number(e.target.value) / 100)}
          disabled={clipPlane === "off" || nvDisabled}
        />
        <span className="threshold-value">
          {clipPlane === "off" ? "—" : clipDepth.toFixed(2)}
        </span>
      </label>
    </div>
  );
}
