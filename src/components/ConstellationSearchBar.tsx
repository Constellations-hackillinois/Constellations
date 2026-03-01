"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Search, SendHorizontal } from "lucide-react";
import { searchConstellations as searchConstellationsAction, type SavedConstellation } from "@/app/actions/constellations";
import styles from "@/app/constellations/constellations.module.css";

const SEARCH_DEBOUNCE_MS = 180;

export interface ConstellationSearchBarRef {
  open: () => void;
}

interface ConstellationSearchBarProps {
  /** Highlight this constellation in the results (e.g. current page). */
  currentId?: string;
}

function ConstellationSearchBarInner(
  { currentId }: ConstellationSearchBarProps,
  ref: React.Ref<ConstellationSearchBarRef | null>
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SavedConstellation[]>([]);
  const [loading, setLoading] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchIdRef = useRef(0);

  const runSearch = useCallback((q: string) => {
    searchIdRef.current += 1;
    const id = searchIdRef.current;
    setLoading(true);
    searchConstellationsAction(q)
      .then((list) => {
        if (id === searchIdRef.current) setResults(list);
      })
      .finally(() => {
        if (id === searchIdRef.current) setLoading(false);
      });
  }, []);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  }));

  useEffect(() => {
    if (!open) return;
    runSearch("");
  }, [open, runSearch]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, query, runSearch]);

  const handleSelect = useCallback((c: SavedConstellation) => {
    const params = new URLSearchParams();
    params.set("topic", c.topic);
    params.set("id", c.id);
    if (c.paperTitle) params.set("paperTitle", c.paperTitle);
    if (c.paperUrl) params.set("paperUrl", c.paperUrl);
    window.location.href = `/constellations?${params.toString()}`;
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (query.trim()) setQuery("");
        else setOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (target && shellRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div
      ref={shellRef}
      className={`${styles.globalSearchShell} ${open ? styles.globalSearchShellOpen : ""}`}
    >
      {open ? (
        <>
          <form
            className={styles.globalSearchBar}
            onSubmit={(e) => {
              e.preventDefault();
              if (results.length === 1) handleSelect(results[0]);
            }}
          >
            <span className={styles.globalSearchLeadingIcon} aria-hidden="true">
              <Search size={16} />
            </span>
            <input
              ref={inputRef}
              className={styles.globalSearchInput}
              type="text"
              placeholder="Search your constellations..."
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              
              className={styles.globalSearchAction}
              title="Search"
              disabled={loading}
            >
              <SendHorizontal size={14} aria-hidden="true" />
            </button>
          </form>
          <div className={styles.globalSearchDialog} role="dialog" aria-label="Search constellations">
            <div className={styles.globalSearchMessages}>
              {loading && results.length === 0 ? (
                <div className={styles.globalSearchEmpty}>Searching...</div>
              ) : results.length === 0 ? (
                <div className={styles.globalSearchEmpty}>
                  {query.trim() ? "No constellations match your search." : "Type to search by name or any paper in a constellation."}
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.globalSearchResultItem} ${c.id === currentId ? styles.globalSearchResultItemActive : ""}`}
                    onClick={() => handleSelect(c)}
                  >
                    <span className={styles.globalSearchResultName}>{c.name}</span>
                    {c.paperTitle && c.paperTitle !== c.name && (
                      <span className={styles.globalSearchResultMeta}>{c.paperTitle}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <button
          type="button"
          className={styles.globalSearchCollapsed}
          title="Search constellations"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            setQuery("");
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        >
          <span className={styles.globalSearchLeadingIcon} aria-hidden="true">
            <Search size={16} />
          </span>
          <span className={styles.globalSearchCollapsedLabel}>Search your constellations...</span>
          <span className={styles.globalSearchAction} aria-hidden="true">
            <SendHorizontal size={14} />
          </span>
        </button>
      )}
    </div>
  );
}

const ConstellationSearchBar = React.forwardRef<ConstellationSearchBarRef, ConstellationSearchBarProps>(
  ConstellationSearchBarInner
);

export default ConstellationSearchBar;
