import { useState, useCallback, useEffect, useMemo } from "react";
import "./App.css";
import Toolbar from "./components/Toolbar";
import ControlPanel from "./components/ControlPanel";
import NiiVueViewer from "./components/NiiVueViewer";
import ThresholdCloudViewer from "./components/ThresholdCloudViewer";

const API = process.env.REACT_APP_API_URL || "";

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
  const [uploadingScan, setUploadingScan] = useState(false);
  const [saving, setSaving] = useState(false);
  // {tone: 'ok'|'warn'|'err', text: string} — shows under the Interpolate button.
  const [interpStatus, setInterpStatus] = useState(null);
  const [viewerTab, setViewerTab] = useState("slices");

  const nextLabel = useMemo(
    () => nextLabelForLead(selectedLead, contacts),
    [selectedLead, contacts]
  );

  useEffect(() => {
    setContactIndexInput(nextLabel);
  }, [selectedLead, nextLabel]);


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

  const handleScanUpload = useCallback(
    async (file) => {
      if (!file) return;
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".nii") && !lower.endsWith(".nii.gz")) {
        alert("Please choose a .nii or .nii.gz file.");
        return;
      }
      setUploadingScan(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${API}/api/scans/upload`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Upload failed (${res.status})`);
        }
        const listRes = await fetch(`${API}/api/scans/`);
        const list = await listRes.json();
        setScanList(list);
        setPickerSelected(data.filename);
        setScanFilename(data.filename);
        setShowPicker(false);
        alert(`Uploaded ${data.filename} (${data.size_mb} MB).`);
      } catch (err) {
        console.error("handleScanUpload:", err);
        alert(
          `Upload failed: ${err.message || err}. ` +
            `Large files (~80 MB) can take a few minutes on Render free tier.`
        );
      } finally {
        setUploadingScan(false);
      }
    },
    []
  );

  const applyThreshold = useCallback(() => {
    const v = parseFloat(String(thresholdInput).replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v <= 100) {
      setThresholdPct(v);
      setThresholdInput(String(v));
    } else {
      alert("CT threshold must be a percentile between 0 and 100 (e.g. 99.96).");
    }
  }, [thresholdInput]);

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
            "Bright blob hit max_voxels cap — centroid may be biased; try a higher CT threshold %ile."
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
    if (contacts.length === 0 && !pendingContact) return;
    if (!window.confirm("Remove all contacts and clear the pending marker?")) {
      return;
    }
    setContacts([]);
    setPendingContact(null);
  }, [contacts.length, pendingContact]);

  const saveAnnotations = useCallback(async () => {
    if (!scanFilename) return;
    setSaving(true);
    const scanId = scanFilename.replace(/\.nii(\.gz)?$/, "");
    const payload = {
      schema_version: 1,
      scan_id: scanId,
      scan_filename: scanFilename,
      include_bipolar_pairs: includeBipolarPairs,
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
  }, [scanFilename, leads, contacts, includeBipolarPairs]);

  const loadAnnotations = useCallback(async () => {
    if (!scanFilename) return;
    const scanId = scanFilename.replace(/\.nii(\.gz)?$/, "");

    if (contacts.length > 0 || leads.length > 0) {
      const ok = window.confirm(
        `This will replace your current ${leads.length} lead(s) and ${contacts.length} contact(s) ` +
          `with the saved annotations for ${scanId}. Continue?`
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
  }, [scanFilename, contacts.length, leads.length, selectedLead]);

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

    const leadRadiusMm = { D: 3, G: 3, S: 5 }[lead?.type] ?? 3;
    const existingVoxels = leadContacts
      .map((c) => c.voxel)
      .filter((v) => Array.isArray(v) && v.length === 3);

    setInterpolating(true);
    const newOnes = [];
    let snappedCount = 0;
    let interpFailMsg = null;
    try {
      if (span >= 2) {
        const body = {
          low_label: low.n,
          high_label: high.n,
          labels: targets.map((t) => t.n),
          threshold_pct: thresholdPct,
          lead_type: lead.type,
          existing_voxels: existingVoxels,
        };
        if (low.voxel?.length === 3 && high.voxel?.length === 3) {
          body.start_voxel = low.voxel;
          body.end_voxel = high.voxel;
        } else {
          body.start_mm = [low.coord.R, low.coord.A, low.coord.S];
          body.end_mm = [high.coord.R, high.coord.A, high.coord.S];
        }

        const res = await fetch(`${API}/api/scans/${scanFilename}/interpolate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.interior)) {
          for (const item of data.interior) {
            if (!item.mm || item.mm.length !== 3) continue;
            if (item.snapped) snappedCount++;
            newOnes.push({
              lead: selectedLead,
              label: String(item.label),
              coord: {
                R: parseFloat(item.mm[0].toFixed(1)),
                A: parseFloat(item.mm[1].toFixed(1)),
                S: parseFloat(item.mm[2].toFixed(1)),
              },
              voxel: item.voxel?.length === 3 ? [...item.voxel] : null,
            });
          }
        } else {
          interpFailMsg = data.error || data.message || "interpolate failed";
          console.warn("interpolate:", data);
        }
      } else {
        // Consecutive labels (e.g. 1 & 2): extrapolate spacing with legacy snap radius.
        for (const t of targets) {
          const { n, guess } = t;
          let out = { ...guess };
          let voxelOut = null;
          try {
            const res = await fetch(`${API}/api/scans/${scanFilename}/snap`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                point_mm: [guess.R, guess.A, guess.S],
                radius_mm: leadRadiusMm,
                threshold_pct: thresholdPct,
                iterations: 4,
              }),
            });
            const snap = await res.json();
            if (snap.success && (snap.voxel_count ?? 0) > 0) {
              out = {
                R: parseFloat(snap.center_mm[0].toFixed(1)),
                A: parseFloat(snap.center_mm[1].toFixed(1)),
                S: parseFloat(snap.center_mm[2].toFixed(1)),
              };
              snappedCount++;
              if (snap.center_voxel?.length === 3) {
                voxelOut = [...snap.center_voxel];
              }
            }
          } catch {
            /* keep linear guess */
          }
          if (!voxelOut) {
            try {
              const res = await fetch(`${API}/api/scans/${scanFilename}/mm_to_voxel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ point_mm: [out.R, out.A, out.S] }),
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
            coord: out,
            voxel: voxelOut,
          });
        }
      }

      if (newOnes.length > 0) {
        setContacts((prev) => [...prev, ...newOnes]);
        setInterpStatus({
          tone: "ok",
          text:
            `Filled ${newOnes.length} contact${newOnes.length === 1 ? "" : "s"} ` +
            `along straight line (legacy snap, ${leadRadiusMm} mm radius, ` +
            `${snappedCount} snapped to bright voxels).`,
        });
      } else if (interpFailMsg) {
        setInterpStatus({ tone: "err", text: interpFailMsg });
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
          <div className="ct-threshold-row">
            <span className="ct-threshold-label">CT threshold (%ile)</span>
            <input
              type="text"
              className="ct-threshold-input"
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyThreshold()}
              title="Percentile for bright-voxel display, snap, cloud pick, and interpolation (default 99.96)"
            />
            <button type="button" className="btn btn-compact" onClick={applyThreshold}>
              Update
            </button>
          </div>
        </div>

        {viewerTab === "slices" && (
          <Toolbar
            scanFilename={scanFilename}
            calMin={calMin}
            calMax={calMax}
            onWindowChange={(min, max) => {
              setCalMin(min);
              setCalMax(max);
            }}
            viewerLayout={viewerLayout}
            onViewerLayoutChange={setViewerLayout}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          />
        )}

        {scanFilename ? (
          viewerTab === "slices" ? (
            <NiiVueViewer
              scanFilename={scanFilename}
              calMin={calMin}
              calMax={calMax}
              onLocationChange={handleLocationChange}
              contacts={contacts}
              leads={leads}
              pendingContact={pendingContact}
              layout={viewerLayout}
              snapRadius={3}
              snapThresholdPct={thresholdPct}
              showRasTags={showRasTags}
            />
          ) : (
            <ThresholdCloudViewer
              scanFilename={scanFilename}
              cloudThresholdPct={thresholdPct}
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
                No scans on the server yet. Upload a CT below, or place{" "}
                <code>.nii</code> / <code>.nii.gz</code> in{" "}
                <code>web/backend/data/</code> when running locally.
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
            <div className="modal-actions modal-actions-scan">
              <label className="btn btn-primary" style={{ cursor: uploadingScan ? "wait" : "pointer" }}>
                {uploadingScan ? "Uploading…" : "Upload .nii / .nii.gz"}
                <input
                  type="file"
                  accept=".nii,.gz,application/gzip"
                  style={{ display: "none" }}
                  disabled={uploadingScan}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleScanUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button className="btn" onClick={() => setShowPicker(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmScanPick}
                disabled={!pickerSelected || uploadingScan}
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
