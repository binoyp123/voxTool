import { useState, useCallback, useEffect, useMemo } from "react";
import "./App.css";
import Toolbar from "./components/Toolbar";
import ControlPanel from "./components/ControlPanel";
import NiiVueViewer from "./components/NiiVueViewer";
import ThresholdCloudViewer from "./components/ThresholdCloudViewer";

const API = process.env.REACT_APP_API_URL || "";

function voxelKey(v) {
  return `${v[0]},${v[1]},${v[2]}`;
}

/** Euclidean distance in mm (RAS). */
function distMm(p, q) {
  const dR = p.R - q.R;
  const dA = p.A - q.A;
  const dS = p.S - q.S;
  return Math.sqrt(dR * dR + dA * dA + dS * dS);
}

/** Perpendicular distance from point p to the infinite line through a and b (mm). */
function distPointToLineMm(p, a, b) {
  const ux = b.R - a.R;
  const uy = b.A - a.A;
  const uz = b.S - a.S;
  const vx = p.R - a.R;
  const vy = p.A - a.A;
  const vz = p.S - a.S;
  const u2 = ux * ux + uy * uy + uz * uz;
  if (u2 < 1e-8) return distMm(p, a);
  const t = (vx * ux + vy * uy + vz * uz) / u2;
  const px = a.R + t * ux;
  const py = a.A + t * uy;
  const pz = a.S + t * uz;
  const dx = p.R - px;
  const dy = p.A - py;
  const dz = p.S - pz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nextLabelForLead(leadName, contacts) {
  if (!leadName) return "1";
  const used = new Set(
    contacts
      .filter((c) => c.lead === leadName)
      .map((c) => parseInt(c.label, 10))
      .filter((n) => !Number.isNaN(n))
  );
  let n = 1;
  while (used.has(n)) n++;
  return String(n);
}

export default function App() {
  const [scanFilename, setScanFilename] = useState(null);
  const [calMin, setCalMin] = useState(300);
  const [calMax, setCalMax] = useState(1500);
  const [clipDepth, setClipDepth] = useState(0);
  const [clipPlane, setClipPlane] = useState("off");
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState("");
  const [contacts, setContacts] = useState([]);
  const [currentCoord, setCurrentCoord] = useState(null);
  const [pendingContact, setPendingContact] = useState(null);
  const [interpolating, setInterpolating] = useState(false);
  const [contactIndexInput, setContactIndexInput] = useState("1");
  const [thresholdPct, setThresholdPct] = useState(99.96);
  const [thresholdInput, setThresholdInput] = useState("99.96");
  const [showRasTags, setShowRasTags] = useState(true);
  const [includeBipolarPairs, setIncludeBipolarPairs] = useState(false);
  const [viewerLayout, setViewerLayout] = useState("multi");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [scanList, setScanList] = useState([]);
  const [pickerSelected, setPickerSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [hollowRender, setHollowRender] = useState(false);
  // {tone: 'ok'|'warn'|'err', text: string} — shows under the Interpolate button.
  const [interpStatus, setInterpStatus] = useState(null);
  const [viewerTab, setViewerTab] = useState("slices");
  const [cloudThresholdPct, setCloudThresholdPct] = useState(99.5);
  const [cloudThresholdInput, setCloudThresholdInput] = useState("99.5");
  const [componentBallMm, setComponentBallMm] = useState(6);
  const [componentBallInput, setComponentBallInput] = useState("6");
  const [excludedVoxels, setExcludedVoxels] = useState([]);
  const [excludeClickMode, setExcludeClickMode] = useState(false);

  const nextLabel = useMemo(
    () => nextLabelForLead(selectedLead, contacts),
    [selectedLead, contacts]
  );

  useEffect(() => {
    setContactIndexInput(nextLabel);
  }, [selectedLead, nextLabel]);

  useEffect(() => {
    setExcludedVoxels([]);
    setExcludeClickMode(false);
  }, [scanFilename]);

  const openScanPicker = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/scans/`);
      const data = await res.json();
      setScanList(data);
      setPickerSelected(data[0] || "");
      setShowPicker(true);
    } catch (err) {
      console.error("openScanPicker:", err);
      alert("Could not reach backend. Is Flask running on port 5001?");
    }
  }, []);

  const confirmScanPick = useCallback(() => {
    if (pickerSelected) {
      setScanFilename(pickerSelected);
    }
    setShowPicker(false);
  }, [pickerSelected]);

  const applyThreshold = useCallback(() => {
    const v = parseFloat(String(thresholdInput).replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v <= 100) {
      setThresholdPct(v);
      setThresholdInput(String(v));
    } else {
      alert("CT threshold must be a percentile between 0 and 100 (e.g. 99.96).");
    }
  }, [thresholdInput]);

  const applyCloudThreshold = useCallback(() => {
    const v = parseFloat(String(cloudThresholdInput).replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v <= 100) {
      setCloudThresholdPct(v);
      setCloudThresholdInput(String(v));
    } else {
      alert("Cloud percentile must be between 0 and 100 (e.g. 99.5).");
    }
  }, [cloudThresholdInput]);

  const applyComponentBall = useCallback(() => {
    const v = parseFloat(String(componentBallInput).replace(",", "."));
    if (Number.isFinite(v) && v >= 0 && v <= 50) {
      setComponentBallMm(v);
      setComponentBallInput(String(v));
    } else {
      alert("Blob radius must be between 0 and 50 mm (0 = no limit, default 6).");
    }
  }, [componentBallInput]);

  const handleExcludedAdd = useCallback((voxel) => {
    setExcludedVoxels((prev) => {
      const k = voxelKey(voxel);
      if (prev.some((x) => voxelKey(x) === k)) return prev;
      return [...prev, [voxel[0], voxel[1], voxel[2]]];
    });
  }, []);

  const handleClearExcluded = useCallback(() => {
    if (excludedVoxels.length === 0) return;
    if (!window.confirm(`Clear ${excludedVoxels.length} excluded voxel(s)?`)) return;
    setExcludedVoxels([]);
  }, [excludedVoxels.length]);

  const handleCloudVoxelPick = useCallback(
    async (pick) => {
      if (!scanFilename || !selectedLead || !pick?.centroid_mm || !pick?.centroid_voxel)
        return;
      try {
        const mm = pick.centroid_mm;
        const coord = {
          R: parseFloat(Number(mm[0]).toFixed(1)),
          A: parseFloat(Number(mm[1]).toFixed(1)),
          S: parseFloat(Number(mm[2]).toFixed(1)),
        };
        const n = parseInt(contactIndexInput, 10);
        const label =
          !Number.isNaN(n) && n >= 1 ? String(n) : nextLabelForLead(selectedLead, contacts);
        setCurrentCoord({
          ...coord,
          snapped: true,
          voxelCount: pick.count ?? 1,
        });
        setPendingContact({
          lead: selectedLead,
          label,
          coord,
          voxel: [
            pick.centroid_voxel[0],
            pick.centroid_voxel[1],
            pick.centroid_voxel[2],
          ],
        });
        if (pick.fallback && pick.fallbackReason) {
          console.warn("Cloud pick fallback:", pick.fallbackReason);
        }
        if (pick.capped) {
          console.warn(
            "Bright blob hit max_voxels cap — centroid may be biased; lower cloud %ile or exclude skull clutter."
          );
        }
      } catch (e) {
        console.error("handleCloudVoxelPick:", e);
      }
    },
    [scanFilename, selectedLead, contactIndexInput, contacts]
  );

  const handleLocationChange = useCallback(
    (coord) => {
      setCurrentCoord(coord);
      if (coord?.snapped && selectedLead) {
        const n = parseInt(contactIndexInput, 10);
        const label =
          !Number.isNaN(n) && n >= 1
            ? String(n)
            : nextLabelForLead(selectedLead, contacts);
        setPendingContact({
          lead: selectedLead,
          label,
          coord: { R: coord.R, A: coord.A, S: coord.S },
          voxel:
            coord.centerVoxel && coord.centerVoxel.length === 3
              ? [...coord.centerVoxel]
              : null,
        });
      }
    },
    [selectedLead, contacts, contactIndexInput]
  );

  const activeLead = useMemo(
    () => leads.find((l) => l.name === selectedLead),
    [leads, selectedLead]
  );

  const commitPending = useCallback(async () => {
    if (!pendingContact || !selectedLead || !scanFilename) return;
    const total =
      (activeLead?.dimensions[0] || 1) * (activeLead?.dimensions[1] || 1);
    const n = parseInt(contactIndexInput, 10);
    const label =
      !Number.isNaN(n) && n >= 1 ? String(n) : pendingContact.label;
    if (Number.isNaN(parseInt(label, 10)) || parseInt(label, 10) < 1) {
      alert("Enter a valid contact index (1 or greater).");
      return;
    }
    const labelNum = parseInt(label, 10);
    if (labelNum > total) {
      alert(
        `Contact index ${labelNum} is beyond this lead (${total} contacts).`
      );
      return;
    }
    const dup = contacts.some(
      (c) => c.lead === selectedLead && c.label === label
    );
    if (dup) {
      alert(`${selectedLead}${label} is already in the contact list.`);
      return;
    }
    let voxel = pendingContact.voxel;
    if (!voxel || voxel.length !== 3) {
      try {
        const res = await fetch(`${API}/api/scans/${scanFilename}/mm_to_voxel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            point_mm: [
              pendingContact.coord.R,
              pendingContact.coord.A,
              pendingContact.coord.S,
            ],
          }),
        });
        const d = await res.json();
        if (d.voxel) voxel = d.voxel;
      } catch (e) {
        console.error("mm_to_voxel:", e);
      }
    }
    const newContact = {
      lead: selectedLead,
      label,
      coord: { ...pendingContact.coord },
      voxel: voxel && voxel.length === 3 ? [...voxel] : null,
    };
    const updated = [...contacts, newContact];
    setContacts(updated);
    setPendingContact(null);
    setContactIndexInput(nextLabelForLead(selectedLead, updated));
  }, [
    pendingContact,
    selectedLead,
    contactIndexInput,
    contacts,
    activeLead,
    scanFilename,
  ]);

  const handleDeleteContact = useCallback((idx) => {
    setContacts((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const cleanScan = useCallback(() => {
    if (contacts.length === 0 && !pendingContact && excludedVoxels.length === 0)
      return;
    if (
      !window.confirm(
        "Remove all contacts, clear pending marker, and reset excluded voxels for this session?"
      )
    ) {
      return;
    }
    setContacts([]);
    setPendingContact(null);
    setExcludedVoxels([]);
  }, [contacts.length, pendingContact, excludedVoxels.length]);

  const saveAnnotations = useCallback(async () => {
    if (!scanFilename) return;
    setSaving(true);
    const scanId = scanFilename.replace(/\.nii(\.gz)?$/, "");
    const payload = {
      schema_version: 1,
      scan_id: scanId,
      scan_filename: scanFilename,
      include_bipolar_pairs: includeBipolarPairs,
      excluded_voxels: excludedVoxels,
      leads: leads.map((l) => ({
        name: l.name,
        type: l.type,
        dimensions: l.dimensions,
      })),
      contacts: contacts.map((c) => {
        const cs = {
          mm: { R: c.coord.R, A: c.coord.A, S: c.coord.S },
        };
        if (c.voxel && c.voxel.length === 3) {
          cs.voxel = [c.voxel[0], c.voxel[1], c.voxel[2]];
        }
        return {
          lead: c.lead,
          label: c.label,
          coordinate_spaces: cs,
        };
      }),
    };
    try {
      await fetch(`${API}/api/annotations/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      alert("Annotations saved!");
    } catch (err) {
      console.error("saveAnnotations:", err);
      alert("Failed to save annotations.");
    }
    setSaving(false);
  }, [scanFilename, leads, contacts, includeBipolarPairs, excludedVoxels]);

  const loadAnnotations = useCallback(async () => {
    if (!scanFilename) return;
    const scanId = scanFilename.replace(/\.nii(\.gz)?$/, "");

    if (contacts.length > 0 || leads.length > 0 || excludedVoxels.length > 0) {
      const ok = window.confirm(
        `This will replace your current ${leads.length} lead(s), ${contacts.length} contact(s), ` +
          `and ${excludedVoxels.length} excluded voxel(s) with the saved annotations for ${scanId}. Continue?`
      );
      if (!ok) return;
    }

    try {
      const res = await fetch(`${API}/api/annotations/${scanId}`);
      if (!res.ok) {
        alert(`Failed to load annotations (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        alert(`No saved annotations found for "${scanId}".`);
        return;
      }
      const latest = data[data.length - 1];
      const newLeads = (latest.leads || []).map((l) => ({
        name: l.name,
        type: l.type,
        dimensions: l.dimensions,
      }));
      setExcludedVoxels(latest.excluded_voxels || []);

      const rawContacts = latest.contacts || [];
      const newContacts = [];
      for (const c of rawContacts) {
        const mm = c.coordinate_spaces?.mm;
        let voxel = c.coordinate_spaces?.voxel;
        if (Array.isArray(voxel) && voxel.length === 3) {
          voxel = [Number(voxel[0]), Number(voxel[1]), Number(voxel[2])];
        } else {
          voxel = null;
        }
        let coord = null;
        if (mm && mm.R != null && mm.A != null && mm.S != null) {
          coord = { R: mm.R, A: mm.A, S: mm.S };
        }
        if (!voxel && mm && scanFilename) {
          try {
            const res = await fetch(`${API}/api/scans/${scanFilename}/mm_to_voxel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ point_mm: [mm.R, mm.A, mm.S] }),
            });
            const d = await res.json();
            if (d.voxel) voxel = d.voxel;
          } catch (e) {
            console.error("mm_to_voxel load:", e);
          }
        }
        if (!coord && voxel && scanFilename) {
          try {
            const res = await fetch(`${API}/api/scans/${scanFilename}/voxel_to_mm`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ voxel }),
            });
            const d = await res.json();
            if (d.mm)
              coord = {
                R: parseFloat(d.mm[0].toFixed(1)),
                A: parseFloat(d.mm[1].toFixed(1)),
                S: parseFloat(d.mm[2].toFixed(1)),
              };
          } catch (e) {
            console.error("voxel_to_mm load:", e);
          }
        }
        if (!coord) continue;
        newContacts.push({
          lead: c.lead,
          label: c.label,
          coord,
          voxel,
        });
      }

      setLeads(newLeads);
      setContacts(newContacts);
      setIncludeBipolarPairs(!!latest.include_bipolar_pairs);
      setPendingContact(null);
      if (newLeads.length && !newLeads.find((l) => l.name === selectedLead)) {
        setSelectedLead(newLeads[0].name);
      }
      alert(
        `Loaded ${newContacts.length} contact(s) across ${newLeads.length} lead(s) ` +
          `from ${scanId}.`
      );
    } catch (err) {
      console.error("loadAnnotations failed:", err);
      alert(`Failed to load annotations: ${err.message || err}`);
    }
  }, [scanFilename, contacts.length, leads.length, selectedLead, excludedVoxels.length]);

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "s":
        case "S":
          e.preventDefault();
          commitPending();
          break;
        case "Escape":
          setPendingContact(null);
          break;
        case "1":
          setViewerLayout("axial");
          break;
        case "2":
          setViewerLayout("coronal");
          break;
        case "3":
          setViewerLayout("sagittal");
          break;
        case "4":
          setViewerLayout("render");
          break;
        case "0":
          setViewerLayout("multi");
          break;
        case "f":
        case "F":
          setSidebarCollapsed((c) => !c);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commitPending]);

  useEffect(() => {
    setPendingContact(null);
  }, [selectedLead]);

  const handleInterpolate = useCallback(async () => {
    if (!selectedLead || !scanFilename) return;
    setInterpStatus(null);
    const lead = leads.find((l) => l.name === selectedLead);
    if (!lead) return;
    const total = (lead.dimensions[0] || 1) * (lead.dimensions[1] || 1);

    const leadContacts = contacts
      .filter((c) => c.lead === selectedLead)
      .map((c) => ({ ...c, n: parseInt(c.label, 10) }))
      .filter((c) => !Number.isNaN(c.n))
      .sort((a, b) => a.n - b.n);

    if (leadContacts.length < 2) {
      alert(
        `Mark at least two contacts on ${selectedLead} (the two ends of the span you want filled), then interpolate.`
      );
      return;
    }

    const low = leadContacts[0];
    const high = leadContacts[leadContacts.length - 1];
    const span = high.n - low.n;
    if (span <= 0) {
      alert("Marked contacts need two different label numbers on this lead.");
      return;
    }

    // Common user workflow: click two far-apart physical endpoints but accept auto labels 1 and 2.
    // In that case, extrapolating from a huge 1→2 step will fly off-screen. Detect and offer a fix.
    if (leadContacts.length === 2 && span === 1 && total >= 3) {
      const anchorDist = distMm(low.coord, high.coord);
      if (anchorDist > 12) {
        const ok = window.confirm(
          `These two points are ~${anchorDist.toFixed(
            1
          )} mm apart, which is too far for adjacent contacts (1 & 2).\n\n` +
            `Did you mean them to be contact 1 and contact ${total}?\n` +
            `If you click OK, I'll relabel the second point to ${total} and fill ${2}–${
              total - 1
            } between them.`
        );
        if (ok) {
          // Relabel the "high" contact (currently 2) to N for this lead.
          setContacts((prev) =>
            prev.map((c) => {
              if (c.lead !== selectedLead) return c;
              if (String(c.label) !== String(high.n)) return c;
              return { ...c, label: String(total) };
            })
          );
          alert(
            `Relabeled ${selectedLead}${high.n} → ${selectedLead}${total}. Now click Interpolate again to fill the middle.`
          );
          return;
        }
      }
    }

    const existing = new Set(leadContacts.map((c) => c.n));
    const targets = [];

    // Room *between* label numbers (e.g. 1 and 8 → fill 2–7): uses endpoints only.
    if (span >= 2) {
      const step = {
        R: (high.coord.R - low.coord.R) / span,
        A: (high.coord.A - low.coord.A) / span,
        S: (high.coord.S - low.coord.S) / span,
      };
      for (let n = low.n + 1; n < high.n; n++) {
        if (existing.has(n)) continue;
        const dn = n - low.n;
        targets.push({
          n,
          guess: {
            R: low.coord.R + step.R * dn,
            A: low.coord.A + step.A * dn,
            S: low.coord.S + step.S * dn,
          },
        });
      }
    }

    // Two *consecutive* labels (usually 1 & 2 from back-to-back submits): there is no integer
    // between them, but anatomically the lead continues. Re-use the 1→2 step to place 3…N
    // (and 1…low−1 if needed) along the same line — same idea as calibrating spacing from two contacts.
    if (targets.length === 0 && leadContacts.length === 2 && span === 1) {
      const a = low;
      const b = high;
      const step = {
        R: b.coord.R - a.coord.R,
        A: b.coord.A - a.coord.A,
        S: b.coord.S - a.coord.S,
      };
      for (let n = 1; n < a.n; n++) {
        if (existing.has(n)) continue;
        const dn = n - a.n;
        targets.push({
          n,
          guess: {
            R: a.coord.R + step.R * dn,
            A: a.coord.A + step.A * dn,
            S: a.coord.S + step.S * dn,
          },
        });
      }
      for (let n = b.n + 1; n <= total; n++) {
        if (existing.has(n)) continue;
        const dn = n - a.n;
        targets.push({
          n,
          guess: {
            R: a.coord.R + step.R * dn,
            A: a.coord.A + step.A * dn,
            S: a.coord.S + step.S * dn,
          },
        });
      }
    }

    if (targets.length === 0) {
      if (span >= 2) {
        alert(
          `Every index between ${low.n} and ${high.n} is already marked on ${selectedLead}.`
        );
      } else {
        alert(
          `Nothing to add on ${selectedLead} (${total} contacts). ` +
            `If you meant to bridge two far-apart contacts, set the # field to the real indices ` +
            `(e.g. 1 and 8) before Submit — the app fills *numbers* between labels, not voxel space between 1 and 2.`
        );
      }
      return;
    }

    targets.sort((x, y) => x.n - y.n);

    // Curved leads: straight RAS chords leave the skull. Prefer a bright-voxel path (server A*).
    let pathDiag = null;
    let pathFailMsg = null;
    if (span >= 2 && targets.length > 0) {
      try {
        const res = await fetch(
          `${API}/api/scans/${scanFilename}/interior_path`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              start_mm: [low.coord.R, low.coord.A, low.coord.S],
              end_mm: [high.coord.R, high.coord.A, high.coord.S],
              low_label: low.n,
              high_label: high.n,
              labels: targets.map((t) => t.n),
              threshold_pct: thresholdPct,
            }),
          }
        );
        const pdata = await res.json();
        pathDiag = pdata?.diagnostics || null;
        if (pdata.success && Array.isArray(pdata.interior)) {
          const byLabel = Object.fromEntries(
            pdata.interior.map((x) => [String(x.label), x.mm])
          );
          for (const t of targets) {
            const mm = byLabel[String(t.n)];
            if (mm?.length === 3) {
              t.guess = { R: mm[0], A: mm[1], S: mm[2] };
              t.fromPath = true;
            }
          }
        } else if (pdata && !pdata.success) {
          pathFailMsg = pdata.message || pdata.error || "interior_path failed";
          console.warn("interior_path skipped:", pdata);
        }
      } catch (e) {
        pathFailMsg = `interior_path request error: ${e.message || e}`;
        console.error("interior_path:", e);
      }
    }

    // Lead axis from the two submitted anchors (loose guard for non-path snaps).
    const lineA = low.coord;
    const lineB = high.coord;

    setInterpolating(true);
    const newOnes = [];
    let snapAdjusted = 0;
    try {
      const maxDrift = 5;
      // Real depth leads can curve ~3–4mm off the chord between contacts 1 and 8;
      // a tight off-line gate kept rejecting good candidates and we ended up with
      // a perfect chord. Loosen and rely on drift + voxel_count instead.
      const maxOffLine = 6;
      const minVoxels = 6;

      for (const t of targets) {
        const { n, guess, fromPath } = t;
        let out = { ...guess };
        let voxelOut = null;

        if (!fromPath) {
          try {
            const res = await fetch(`${API}/api/scans/${scanFilename}/snap`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                point_mm: [guess.R, guess.A, guess.S],
                radius_mm: 2.5,
                threshold_pct: thresholdPct,
                iterations: 1,
              }),
            });
            const data = await res.json();
            if (data.success && (data.voxel_count ?? 0) >= minVoxels) {
              const cand = {
                R: parseFloat(data.center_mm[0].toFixed(1)),
                A: parseFloat(data.center_mm[1].toFixed(1)),
                S: parseFloat(data.center_mm[2].toFixed(1)),
              };
              const drift = distMm(cand, guess);
              const offLine = distPointToLineMm(cand, lineA, lineB);
              if (drift <= maxDrift && offLine <= maxOffLine) {
                out = cand;
                snapAdjusted++;
              }
              if (Array.isArray(data.center_voxel) && data.center_voxel.length === 3) {
                voxelOut = [
                  data.center_voxel[0],
                  data.center_voxel[1],
                  data.center_voxel[2],
                ];
              }
            }
          } catch {
            /* keep linear guess */
          }
        }

        if (!voxelOut) {
          try {
            const res = await fetch(`${API}/api/scans/${scanFilename}/mm_to_voxel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                point_mm: [out.R, out.A, out.S],
              }),
            });
            const d = await res.json();
            if (d.voxel) voxelOut = d.voxel;
          } catch {
            /* optional */
          }
        }

        newOnes.push({
          lead: selectedLead,
          label: String(n),
          coord: {
            R: parseFloat(out.R.toFixed(1)),
            A: parseFloat(out.A.toFixed(1)),
            S: parseFloat(out.S.toFixed(1)),
          },
          voxel: voxelOut,
        });
      }
      if (newOnes.length > 0) {
        setContacts((prev) => [...prev, ...newOnes]);
      }

      const fromPathCount = targets.filter((t) => t.fromPath).length;
      if (fromPathCount > 0 && pathDiag?.selected) {
        const sel = pathDiag.selected;
        setInterpStatus({
          tone: "ok",
          text:
            `Curved path used for ${fromPathCount}/${newOnes.length} contacts ` +
            `(threshold ${sel.threshold_pct}%ile · dilate ${sel.dilate} · ` +
            `arc ${sel.arc_mm}mm · endpoints ${sel.start_dist_mm}/${sel.goal_dist_mm}mm off bright voxels).`,
        });
      } else if (newOnes.length > 0) {
        const reason = pathFailMsg
          ? ` Curved path skipped: ${pathFailMsg}`
          : "";
        setInterpStatus({
          tone: "warn",
          text:
            `Filled ${newOnes.length} contact${newOnes.length === 1 ? "" : "s"} ` +
            `from straight chord (snap improved ${snapAdjusted}).` +
            reason,
        });
      }
    } finally {
      setInterpolating(false);
    }
  }, [selectedLead, scanFilename, contacts, leads, thresholdPct]);

  return (
    <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {!sidebarCollapsed && (
        <ControlPanel
          scanLoaded={!!scanFilename}
          scanFilename={scanFilename}
          leads={leads}
          setLeads={setLeads}
          selectedLead={selectedLead}
          setSelectedLead={setSelectedLead}
          contacts={contacts}
          nextLabel={nextLabel}
          contactIndexInput={contactIndexInput}
          setContactIndexInput={setContactIndexInput}
          pendingContact={pendingContact}
          onCommitPending={commitPending}
          onCancelPending={() => setPendingContact(null)}
          onDeleteContact={handleDeleteContact}
          onInterpolate={handleInterpolate}
          interpolating={interpolating}
          interpStatus={interpStatus}
          onClearInterpStatus={() => setInterpStatus(null)}
          currentCoord={currentCoord}
          showRasTags={showRasTags}
          setShowRasTags={setShowRasTags}
          includeBipolarPairs={includeBipolarPairs}
          setIncludeBipolarPairs={setIncludeBipolarPairs}
          onLoadScan={openScanPicker}
          onLoadCoordinates={loadAnnotations}
          onSave={saveAnnotations}
          saving={saving}
          onCleanScan={cleanScan}
        />
      )}

      <div className="viewer-area">
        <div className="viewer-top-bar">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`btn btn-compact ${viewerTab === "slices" ? "btn-primary" : ""}`}
              onClick={() => setViewerTab("slices")}
            >
              Slices (NiiVue)
            </button>
            <button
              type="button"
              className={`btn btn-compact ${viewerTab === "cloud" ? "btn-primary" : ""}`}
              onClick={() => setViewerTab("cloud")}
              disabled={!scanFilename}
              title="Sparse super-threshold voxel cloud (professor workflow)"
            >
              Threshold cloud
            </button>
          </div>
          {viewerTab === "slices" ? (
            <div className="ct-threshold-row">
              <span className="ct-threshold-label">Snap threshold (%ile)</span>
              <input
                type="text"
                className="ct-threshold-input"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyThreshold()}
                title="Percentile for slice snap / interpolation path"
              />
              <button type="button" className="btn btn-compact" onClick={applyThreshold}>
                Update
              </button>
            </div>
          ) : (
            <>
              <div className="ct-threshold-row">
                <span className="ct-threshold-label">Cloud percentile (%ile)</span>
                <input
                  type="text"
                  className="ct-threshold-input"
                  value={cloudThresholdInput}
                  onChange={(e) => setCloudThresholdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyCloudThreshold()}
                  title="Percentile for sparse 3D cloud tab (often slightly lower than snap)"
                />
                <button type="button" className="btn btn-compact" onClick={applyCloudThreshold}>
                  Update
                </button>
                <span className="muted" style={{ fontSize: 11 }}>
                  Excluded voxels: {excludedVoxels.length}
                </span>
              </div>
              <div className="ct-threshold-row cloud-second-row">
                <span className="ct-threshold-label">Blob radius (mm)</span>
                <input
                  type="text"
                  className="ct-threshold-input"
                  value={componentBallInput}
                  onChange={(e) => setComponentBallInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyComponentBall()}
                  title="Only voxels within this Euclidean distance (mm) of your click are included in the orange blob. Default 6 ≈ one contact. Use 0 for no limit (full fused component)."
                  style={{ width: 56 }}
                />
                <button type="button" className="btn btn-compact" onClick={applyComponentBall}>
                  Update
                </button>
                <span className="muted" style={{ fontSize: 11 }}>
                  Active: {componentBallMm === 0 ? "none (full connectivity)" : `${componentBallMm} mm`}
                </span>
              </div>
            </>
          )}
        </div>

        <Toolbar
          scanFilename={scanFilename}
          calMin={calMin}
          calMax={calMax}
          onCalMinChange={setCalMin}
          onCalMaxChange={setCalMax}
          onWindowChange={(min, max) => {
            setCalMin(min);
            setCalMax(max);
          }}
          clipDepth={clipDepth}
          clipPlane={clipPlane}
          onClipDepthChange={setClipDepth}
          onClipPlaneChange={setClipPlane}
          viewerLayout={viewerLayout}
          onViewerLayoutChange={setViewerLayout}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          hollowRender={hollowRender}
          onToggleHollowRender={() => setHollowRender((h) => !h)}
          disabled={viewerTab === "cloud"}
        />

        {scanFilename ? (
          viewerTab === "slices" ? (
            <NiiVueViewer
              scanFilename={scanFilename}
              calMin={calMin}
              calMax={calMax}
              clipDepth={clipDepth}
              clipPlane={clipPlane}
              onLocationChange={handleLocationChange}
              contacts={contacts}
              leads={leads}
              pendingContact={pendingContact}
              layout={viewerLayout}
              snapThresholdPct={thresholdPct}
              showRasTags={showRasTags}
              hollowRender={hollowRender}
            />
          ) : (
            <ThresholdCloudViewer
              scanFilename={scanFilename}
              cloudThresholdPct={cloudThresholdPct}
              componentMaxBallMm={componentBallMm}
              excludedVoxels={excludedVoxels}
              onExcludedAdd={handleExcludedAdd}
              excludeClickMode={excludeClickMode}
              onExcludeModeChange={setExcludeClickMode}
              onClearExcluded={handleClearExcluded}
              excludedCount={excludedVoxels.length}
              onCloudVoxelPick={handleCloudVoxelPick}
              contacts={contacts}
              leads={leads}
              pendingContact={pendingContact}
              selectedLead={selectedLead}
            />
          )
        ) : (
          <div className="empty-state">
            <div>
              <p style={{ fontSize: 18, marginBottom: 8 }}>No scan loaded</p>
              <p>
                Use <strong>Load Scan</strong> in the sidebar to open a NIfTI CT
                from the server.
              </p>
              <p style={{ marginTop: 8, fontSize: 12 }}>
                Place <code>.nii</code> or <code>.nii.gz</code> files in{" "}
                <code>web/backend/data/</code>
              </p>
            </div>
          </div>
        )}

        <div className="status-bar">
          <span>
            {scanFilename ? `Scan: ${scanFilename}` : "No scan loaded"}
          </span>
          <span className="status-bar-right">
            <span className="ras-legend">
              <span className="ras-legend-r">R</span>=Right
              <span className="ras-legend-a">A</span>=Anterior
              <span className="ras-legend-s">S</span>=Superior
            </span>
            <span className="status-hint">
              <kbd>S</kbd> submit · <kbd>Esc</kbd> cancel · <kbd>F</kbd> sidebar
            </span>
            <span>
              {contacts.length} contact{contacts.length !== 1 ? "s" : ""} ·{" "}
              {leads.length} lead{leads.length !== 1 ? "s" : ""}
            </span>
          </span>
        </div>
      </div>

      {showPicker && (
        <div className="modal-overlay" onClick={() => setShowPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Select a Scan</h2>
            {scanList.length === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>
                No scans found. Place <code>.nii</code> or{" "}
                <code>.nii.gz</code> files in <code>web/backend/data/</code>.
              </p>
            ) : (
              <ul className="scan-list">
                {scanList.map((s) => (
                  <li
                    key={s}
                    className={s === pickerSelected ? "selected" : ""}
                    onClick={() => setPickerSelected(s)}
                    onDoubleClick={() => {
                      setPickerSelected(s);
                      setScanFilename(s);
                      setShowPicker(false);
                    }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowPicker(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmScanPick}
                disabled={!pickerSelected}
              >
                Load
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
