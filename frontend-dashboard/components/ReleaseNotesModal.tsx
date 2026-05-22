"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RELEASE_NOTES_STORAGE_KEY, releaseNotes } from "@/lib/releaseNotes";

export function ReleaseNotesModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const dismissedVersion = window.localStorage.getItem(RELEASE_NOTES_STORAGE_KEY);
      setIsOpen(dismissedVersion !== releaseNotes.version);
    } catch {
      setIsOpen(false);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(RELEASE_NOTES_STORAGE_KEY, releaseNotes.version);
    } catch {
      // Ignore storage failures; the modal can safely appear again next visit.
    }
    setIsOpen(false);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={dismiss}>
      <section
        className="modalPanel releaseNotesPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modalHeader releaseNotesHeader">
          <div className="releaseNotesTitleBlock">
            <span className="releaseNotesIcon">
              <Sparkles size={20} />
            </span>
            <div>
              <span className="eyebrow">Version {releaseNotes.version}</span>
              <h2 id="release-notes-title">{releaseNotes.title}</h2>
              <p>{releaseNotes.date}</p>
            </div>
          </div>
          <button type="button" className="iconButton small" onClick={dismiss} title="Close release notes">
            <X size={16} />
          </button>
        </header>

        <section className="modalSection releaseNotesBody">
          <p>{releaseNotes.intro}</p>
          <ul>
            {releaseNotes.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <footer className="releaseNotesFooter">
          <button type="button" className="primaryButton" onClick={dismiss}>
            Got it
          </button>
        </footer>
      </section>
    </div>
  );
}
