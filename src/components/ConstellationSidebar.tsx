"use client";

import { useEffect, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import styles from "@/app/constellations/constellations.module.css";

interface SavedConstellation {
  id: string;
  name: string;
  topic: string;
  paperTitle?: string;
  paperUrl?: string;
  createdAt: number;
}

function loadConstellations(): SavedConstellation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: SavedConstellation[] = JSON.parse(
      localStorage.getItem("constellations") || "[]"
    );
    const seen = new Set<string>();
    return raw.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  } catch {
    return [];
  }
}

function saveConstellations(list: SavedConstellation[]) {
  localStorage.setItem("constellations", JSON.stringify(list));
}

interface ConstellationSidebarProps {
  activeId?: string;
}

export default function ConstellationSidebar({ activeId }: ConstellationSidebarProps) {
  const [open, setOpen] = useState(false);
  const [constellations, setConstellations] = useState<SavedConstellation[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    setConstellations(loadConstellations());
  }, []);

  function handleRename(id: string) {
    if (!renameValue.trim()) return;
    const updated = constellations.map((c) =>
      c.id === id ? { ...c, name: renameValue.trim() } : c
    );
    saveConstellations(updated);
    setConstellations(updated);
    setRenaming(null);
    setRenameValue("");
  }

  function handleDelete(id: string) {
    const updated = constellations.filter((c) => c.id !== id);
    saveConstellations(updated);
    setConstellations(updated);
  }

  function handleSelect(c: SavedConstellation) {
    const params = new URLSearchParams();
    params.set("topic", c.topic);
    params.set("id", c.id);
    if (c.paperTitle) params.set("paperTitle", c.paperTitle);
    if (c.paperUrl) params.set("paperUrl", c.paperUrl);
    window.location.href = `/constellations?${params.toString()}`;
  }

  return (
    <aside className={`${styles.sidebar} ${open ? styles.sidebarExpanded : ""}`}>
      <div className={styles.sidebarActions}>
        <button
          className={`${styles.sidebarActionBtn} ${styles.sidebarToggleBtn}`}
          onClick={() => setOpen((o) => !o)}
          title={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          <span className={styles.sidebarLogo} aria-hidden="true" />
          {open ? (
            <PanelLeftClose size={18} className={styles.sidebarCloseIcon} />
          ) : (
            <PanelLeftOpen size={18} className={styles.sidebarHoverIcon} />
          )}
        </button>
        <button
          className={styles.sidebarActionBtn}
          onClick={() => { window.location.href = "/"; }}
          title="New constellation"
        >
          <Plus size={18} />
          {open && <span>New Constellation</span>}
        </button>
      </div>
      {open && (
        <>
          <div className={styles.sidebarDivider} />
          <div className={styles.sidebarList}>
            {constellations.length === 0 && (
              <div className={styles.sidebarEmpty}>No saved constellations yet.</div>
            )}
            {constellations.map((c) => {
              const isActive = c.id === activeId;
              return (
                <div
                  key={c.id}
                  className={`${styles.sidebarItem} ${isActive ? styles.sidebarItemActive : ""}`}
                >
                  {renaming === c.id ? (
                    <form
                      className={styles.sidebarRenameForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRename(c.id);
                      }}
                    >
                      <input
                        className={styles.sidebarRenameInput}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                        onBlur={() => setRenaming(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    </form>
                  ) : (
                    <button
                      className={styles.sidebarItemName}
                      onClick={() => handleSelect(c)}
                      title={c.topic}
                    >
                      {c.name}
                    </button>
                  )}
                  <div className={styles.sidebarItemActions}>
                    <button
                      className={styles.sidebarAction}
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(c.id);
                        setRenameValue(c.name);
                      }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      className={styles.sidebarAction}
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(c.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
