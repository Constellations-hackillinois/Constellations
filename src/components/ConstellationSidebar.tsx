"use client";

import { useEffect, useRef, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  fetchConstellations as fetchConstellationsDB,
  searchConstellations as searchConstellationsAction,
  renameConstellation as renameConstellationDB,
  deleteConstellation as deleteConstellationDB,
  type SavedConstellation,
} from "@/app/actions/constellations";
import { normalizeRequiredTitle } from "@/lib/papers";
import styles from "@/app/constellations/constellations.module.css";

interface ConstellationSidebarProps {
  activeId?: string;
  onOpenChange?: (open: boolean) => void;
}

export default function ConstellationSidebar({ activeId, onOpenChange }: ConstellationSidebarProps) {
  const [open, setOpen] = useState(true);
  const [constellations, setConstellations] = useState<SavedConstellation[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [sidebarSearchResults, setSidebarSearchResults] = useState<SavedConstellation[]>([]);
  const [sidebarSearchLoading, setSidebarSearchLoading] = useState(false);
  const sidebarSearchInputRef = useRef<HTMLInputElement>(null);
  const sidebarSearchIdRef = useRef(0);

  useEffect(() => {
    fetchConstellationsDB().then(setConstellations);
  }, []);

  useEffect(() => {
    const q = sidebarSearchQuery.trim();
    if (!q) {
      setSidebarSearchResults([]);
      console.log("search");
      return;
    }
    sidebarSearchIdRef.current += 1;
    const id = sidebarSearchIdRef.current;
    setSidebarSearchLoading(true);
    searchConstellationsAction(q)
      .then((list) => {
        if (id === sidebarSearchIdRef.current) setSidebarSearchResults(list);
      })
      .finally(() => {
        if (id === sidebarSearchIdRef.current) setSidebarSearchLoading(false);
      });
  }, [sidebarSearchQuery]);

  useEffect(() => {
    if (!open) setSidebarSearchOpen(false);
  }, [open]);

  function handleRename(id: string) {
    if (!renameValue.trim()) return;
    const newName = normalizeRequiredTitle(renameValue, renameValue.trim());
    const updated = constellations.map((c) =>
      c.id === id ? { ...c, name: newName } : c
    );
    setConstellations(updated);
    setRenaming(null);
    setRenameValue("");
    renameConstellationDB(id, newName);
  }

  function handleDelete(id: string) {
    setDeletingId(id);
    deleteConstellationDB(id);

    setTimeout(() => {
      setConstellations((prev) => prev.filter((c) => c.id !== id));
      setDeletingId(null);
    }, 400);
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
          onClick={() => { setOpen((o) => !o); onOpenChange?.(!open); }}
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
        <button
          className={styles.sidebarActionBtn}
          title="Search Constellations"
          onClick={() => {
            setSidebarSearchOpen((o) => !o);
            if (!sidebarSearchOpen) setTimeout(() => sidebarSearchInputRef.current?.focus(), 120);
          }}
        >
          <Search size={18} />
          {open && <span>Search Constellations</span>}
        </button>
      </div>
      {open && (
        <>
          <div className={styles.sidebarDivider} />
          <div
            className={`${styles.sidebarSearchWrap} ${sidebarSearchOpen ? styles.sidebarSearchWrapOpen : ""}`}
          >
            <input
              ref={sidebarSearchInputRef}
              type="text"
              className={styles.sidebarSearchInput}
              placeholder="Find constellation by name or paper..."
              value={sidebarSearchQuery}
              onChange={(e) => setSidebarSearchQuery(e.target.value)}
              aria-label="Find any constellation"
            />
          </div>
          <div className={styles.sidebarList}>
            {sidebarSearchLoading && sidebarSearchQuery.trim() ? (
              <div className={styles.sidebarEmpty}>Searching...</div>
            ) : (() => {
              const list = sidebarSearchQuery.trim() ? sidebarSearchResults : constellations;
              if (list.length === 0) {
                return (
                  <div className={styles.sidebarEmpty}>
                    {sidebarSearchQuery.trim() ? "No constellations match." : "No saved constellations yet."}
                  </div>
                );
              }
              return list.map((c) => {
                const isActive = c.id === activeId;
                const isDeleting = c.id === deletingId;
                return (
                  <div
                    key={c.id}
                    className={`${styles.sidebarItem} ${isActive ? styles.sidebarItemActive : ""} ${isDeleting ? styles.sidebarItemRemoving : ""}`}
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
              });
            })()}
          </div>
        </>
      )}
    </aside>
  );
}
