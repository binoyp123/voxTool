export default function ContactList({ contacts, leads, onDelete }) {
  const leadOrdinal = (leadName) => {
    const i = leads.findIndex((l) => l.name === leadName);
    return i >= 0 ? i + 1 : 0;
  };

  if (contacts.length === 0) {
    return (
      <div className="contact-list-empty muted">
        No contacts yet. Click the viewer to place the crosshair, then Submit.
      </div>
    );
  }

  return (
    <ul className="contact-list contact-list-dense">
      {contacts.map((c, idx) => {
        const lo = leadOrdinal(c.lead);
        const lbl = parseInt(c.label, 10);
        const labelNum = Number.isNaN(lbl) ? c.label : lbl;
        return (
          <li key={`${c.lead}-${c.label}-${idx}`}>
            <span className="contact-line">
              <span className="contact-name">
                {c.lead}
                {c.label}
              </span>
              <span className="contact-indices muted">
                ({lo}, {labelNum})
              </span>
              <span className="coord">
                ({c.coord.R}, {c.coord.A}, {c.coord.S})
                {c.voxel ? (
                  <span className="muted voxel-tag">
                    {" "}
                    vox [{c.voxel[0]}, {c.voxel[1]}, {c.voxel[2]}]
                  </span>
                ) : null}
              </span>
            </span>
            <button
              type="button"
              className="delete-btn"
              onClick={() => onDelete(idx)}
              title="Delete contact"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
