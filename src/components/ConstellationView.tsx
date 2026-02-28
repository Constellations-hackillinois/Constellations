"use client";

import { useEffect, useRef, useCallback, useState, type FormEvent } from "react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { followUpSearch, expandSearch } from "@/app/actions/search";
import { ragSearchPerPaper, ragSearchGlobal, removeDocumentFromConstellation } from "@/app/actions/supermemory";
import { ingestPaper } from "@/app/actions/pipeline";
import {
  fetchConstellations as fetchConstellationsDB,
  upsertConstellation,
  renameConstellation as renameConstellationDB,
  deleteConstellation as deleteConstellationDB,
  saveGraphData,
  loadGraphData,
  type SavedConstellation,
  type SerializedGraph,
  type SerializedNode,
} from "@/app/actions/constellations";

interface PdfChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  loading?: boolean;
}
import { extractArxivId, toCanonicalArxivPdfUrl } from "@/lib/arxiv";
import { createRoot, type Root } from "react-dom/client";
import styles from "@/app/constellations/constellations.module.css";

// ─── Types ───
type ChatMessageIcon = "bookOpen" | "search";
type GlobalSearchMessageStatus = "complete" | "loading" | "error";

interface ConstellationNode {
  id: number;
  label: string;
  depth: number;
  parentId: number | null;
  angle: number;
  x: number;
  y: number;
  children: number[];
  messages: { role: "user" | "ai"; text: string; icon?: ChatMessageIcon }[];
  el: HTMLDivElement | null;
  paperTitle: string | null;
  paperUrl: string | null;
  expanding: boolean;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  baseAlpha: number;
  depth: number;
  tint: number[];
}

interface EdgeAnim {
  fromId: number;
  toId: number;
  progress: number;
  startTime: number;
}

interface GlobalSearchMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  sourceArxivIds?: string[];
  status?: GlobalSearchMessageStatus;
}

const BASE_RADIUS = 140;
const RING_SPACING = 120;
const MIN_NODE_DISTANCE = 55;
const MAX_PLACEMENT_ATTEMPTS = 12;
const NODE_DRAG_THRESHOLD = 6;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Debug mode: fake data for testing UI without Exa credits ───
const FAKE_TITLES = [
  "Attention Is All You Need",
  "BERT: Pre-training of Deep Bidirectional Transformers",
  "Generative Adversarial Networks",
  "Deep Residual Learning for Image Recognition",
  "ImageNet Classification with Deep Convolutional Neural Networks",
  "Playing Atari with Deep Reinforcement Learning",
  "A Neural Algorithm of Artistic Style",
  "Batch Normalization: Accelerating Deep Network Training",
  "Dropout: A Simple Way to Prevent Neural Networks from Overfitting",
  "Sequence to Sequence Learning with Neural Networks",
  "Neural Machine Translation by Jointly Learning to Align and Translate",
  "Variational Autoencoders for Collaborative Filtering",
  "Proximal Policy Optimization Algorithms",
  "Language Models are Few-Shot Learners",
  "Scaling Laws for Neural Language Models",
  "Chain-of-Thought Prompting Elicits Reasoning",
  "Denoising Diffusion Probabilistic Models",
  "High-Resolution Image Synthesis with Latent Diffusion Models",
  "LoRA: Low-Rank Adaptation of Large Language Models",
  "Constitutional AI: Harmlessness from AI Feedback",
];

const FAKE_RESPONSES = [
  "This paper extends the core ideas by introducing a novel training objective.",
  "A foundational work that influenced many subsequent architectures.",
  "This explores an alternative approach to the same underlying problem.",
  "Interesting connection — this paper cites the parent work extensively.",
  "A key advancement that improved scalability significantly.",
  "This work provides the theoretical foundation for the approach.",
  "A highly cited paper that proposed a simpler but effective method.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fakePapers(count: number): { title: string; url: string }[] {
  const shuffled = [...FAKE_TITLES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((title) => ({
    title,
    url: `https://arxiv.org/abs/${2000 + Math.floor(Math.random() * 500)}.${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`,
  }));
}

async function fakeDelay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClientId() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}


// ─── Props ───
interface ConstellationViewProps {
  topic: string;
  paperTitle?: string;
  paperUrl?: string;
  debugMode?: boolean;
  constellationId?: string;
}

export default function ConstellationView({
  topic,
  paperTitle,
  paperUrl,
  debugMode = false,
  constellationId: constellationIdProp,
}: ConstellationViewProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [constellations, setConstellations] = useState<SavedConstellation[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchMessages, setGlobalSearchMessages] = useState<GlobalSearchMessage[]>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPaperUrl, setPdfPaperUrl] = useState<string>("");
  const [pdfTitle, setPdfTitle] = useState<string>("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfChatMessages, setPdfChatMessages] = useState<PdfChatMessage[]>([]);
  const [pdfChatLoading, setPdfChatLoading] = useState(false);
  const [pdfChatQuery, setPdfChatQuery] = useState("");
  const [pdfPanelWidth, setPdfPanelWidth] = useState(65);
  const [chatPaneVisible, setChatPaneVisible] = useState(true);
  const paperViewRef = useRef<HTMLDivElement>(null);

  const pdfChatMessagesRef = useRef<HTMLDivElement>(null);
  const pdfChatInputRef = useRef<HTMLInputElement>(null);

  const currentIdRef = useRef("");

  // Set the constellation ID synchronously so the canvas useEffect can read it immediately
  if (!currentIdRef.current) {
    if (constellationIdProp) {
      currentIdRef.current = constellationIdProp;
    } else if (topic) {
      currentIdRef.current = crypto.randomUUID();
    }
  }

  useEffect(() => {
    const resolvedId = currentIdRef.current;

    async function init() {
      const saved = await fetchConstellationsDB();

      if (resolvedId && constellationIdProp) {
        setCurrentId(resolvedId);
        const exists = saved.some((c) => c.id === resolvedId);

        if (!exists && topic) {
          const entry: SavedConstellation = {
            id: resolvedId,
            name: paperTitle || topic,
            topic: paperTitle || topic,
            paperTitle,
            paperUrl,
            createdAt: Date.now(),
          };
          await upsertConstellation(entry);
          setConstellations([entry, ...saved]);
        } else {
          setConstellations(saved);
        }
      } else if (resolvedId && topic) {
        setCurrentId(resolvedId);

        const entry: SavedConstellation = {
          id: resolvedId,
          name: paperTitle || topic,
          topic: paperTitle || topic,
          paperTitle,
          paperUrl,
          createdAt: Date.now(),
        };
        await upsertConstellation(entry);
        setConstellations([entry, ...saved]);

        const params = new URLSearchParams(window.location.search);
        params.set("id", resolvedId);
        window.history.replaceState(null, "", `?${params.toString()}`);
      } else {
        setConstellations(saved);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRename(id: string) {
    if (!renameValue.trim()) return;
    const newName = renameValue.trim();
    const updated = constellations.map((c) =>
      c.id === id ? { ...c, name: newName } : c
    );
    setConstellations(updated);
    setRenaming(null);
    setRenameValue("");
    renameConstellationDB(id, newName);
  }

  function handleDelete(id: string) {
    const updated = constellations.filter((c) => c.id !== id);
    setConstellations(updated);
    deleteConstellationDB(id);
  }

  function handleSelect(c: SavedConstellation) {
    const params = new URLSearchParams();
    params.set("topic", c.topic);
    params.set("id", c.id);
    if (c.paperTitle) params.set("paperTitle", c.paperTitle);
    if (c.paperUrl) params.set("paperUrl", c.paperUrl);
    window.location.href = `/constellations?${params.toString()}`;
  }

  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatHeaderRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatMessagesRootRef = useRef<Root | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const globalSearchRef = useRef<HTMLDivElement>(null);
  const globalSearchInputRef = useRef<HTMLInputElement>(null);
  const globalSearchMessagesRef = useRef<HTMLDivElement>(null);
  const globalSearchStickToBottomRef = useRef(true);
  const returnBtnRef = useRef<HTMLButtonElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serializeGraph = useCallback((): SerializedGraph => {
    const s = stateRef.current;
    const nodes: SerializedNode[] = [];
    for (const [, node] of s.nodes) {
      nodes.push({
        id: node.id,
        label: node.label,
        depth: node.depth,
        parentId: node.parentId,
        angle: node.angle,
        x: node.x,
        y: node.y,
        children: [...node.children],
        messages: node.messages.map((m) => ({ role: m.role, text: m.text, icon: m.icon })),
        paperTitle: node.paperTitle,
        paperUrl: node.paperUrl,
      });
    }
    return { nextId: s.nextId, nodes };
  }, []);

  const flushGraph = useCallback(() => {
    if (!currentIdRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const graph = serializeGraph();
    saveGraphData(currentIdRef.current, graph);
  }, [serializeGraph]);

  const persistGraph = useCallback(() => {
    if (!currentIdRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const graph = serializeGraph();
      saveGraphData(currentIdRef.current, graph);
    }, 1500);
  }, [serializeGraph]);

  useEffect(() => {
    const handleBeforeUnload = () => { flushGraph(); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushGraph();
    };
  }, [flushGraph]);

  const stateRef = useRef({
    nodes: new Map<number, ConstellationNode>(),
    nextId: 0,
    panX: 0,
    panY: 0,
    zoom: 1.0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0,
    stars: [] as Star[],
    edgeAnims: [] as EdgeAnim[],
    highlights: new Map<number, { startTime: number }>(),
    chatNodeId: null as number | null,
    chatHideTimer: null as ReturnType<typeof setTimeout> | null,
    chatShowTimer: null as ReturnType<typeof setTimeout> | null,
    animFrameId: 0,
    panAnimating: false,
    panAnimFromX: 0,
    panAnimFromY: 0,
    panTargetX: 0,
    panTargetY: 0,
    panAnimStart: 0,
    panAnimDuration: 800,
    zoomAnimFrom: 1.0,
    zoomTarget: 1.0,
    draggedNodeId: null as number | null,
    dragNodeStartX: 0,
    dragNodeStartY: 0,
    dragPointerStartClientX: 0,
    dragPointerStartClientY: 0,
    didDragNode: false,
  });

  const cx = useCallback(() => window.innerWidth / 2, []);
  const cy = useCallback(() => window.innerHeight / 2, []);

  const toScreen = useCallback(
    (lx: number, ly: number) => {
      const s = stateRef.current;
      return {
        x: lx * s.zoom + s.panX + cx(),
        y: ly * s.zoom + s.panY + cy(),
      };
    },
    [cx, cy]
  );

  const updateNodePosition = useCallback(
    (node: ConstellationNode) => {
      if (!node.el) return;
      const pos = toScreen(node.x, node.y);
      node.el.style.left = pos.x + "px";
      node.el.style.top = pos.y + "px";
    },
    [toScreen]
  );

  const updateAllPositions = useCallback(() => {
    stateRef.current.nodes.forEach((n) => updateNodePosition(n));
  }, [updateNodePosition]);

  // ─── Chat helpers ───
  const renderMessages = useCallback((node: ConstellationNode) => {
    const container = chatMessagesRef.current;
    if (!container) return;
    if (!chatMessagesRootRef.current) {
      chatMessagesRootRef.current = createRoot(container);
    }

    chatMessagesRootRef.current.render(
      <>
        {node.messages.length === 0 ? (
          <div className={`${styles.chatMsg} ${styles.ai}`}>
            Greetings, traveler. Ask me about {node.label}.
          </div>
        ) : (
          node.messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`${styles.chatMsg} ${message.role === "user" ? styles.user : styles.ai}`}
            >
              {message.icon ? (
                <span className={styles.chatMsgContent}>
                  <span className={styles.chatMsgIcon} aria-hidden="true">
                    {message.icon === "bookOpen" ? <BookOpen size={13} /> : <Search size={13} />}
                  </span>
                  <span>{message.text}</span>
                </span>
              ) : (
                message.text
              )}
            </div>
          ))
        )}
        {node.paperUrl && (
          <div className={styles.chatPaperMeta}>
            <a
              href={node.paperUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.chatPaperLink}
            >
              <FileText size={12} aria-hidden="true" />
              <span>{node.paperTitle ?? "View Paper"}</span>
            </a>
          </div>
        )}
      </>
    );

    requestAnimationFrame(() => {
      if (chatMessagesRef.current === container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, []);

  const hideChat = useCallback(() => {
    chatRef.current?.classList.remove(styles.visible);
    stateRef.current.chatNodeId = null;
  }, []);

  const clearChatTimers = useCallback(() => {
    const s = stateRef.current;
    if (s.chatShowTimer) clearTimeout(s.chatShowTimer);
    if (s.chatHideTimer) clearTimeout(s.chatHideTimer);
    s.chatShowTimer = null;
    s.chatHideTimer = null;
  }, []);

  const showChat = useCallback(
    (id: number) => {
      const s = stateRef.current;
      const node = s.nodes.get(id);
      if (!node) return;
      s.chatNodeId = id;

      if (chatHeaderRef.current) chatHeaderRef.current.textContent = node.label;
      renderMessages(node);

      const pos = toScreen(node.x, node.y);
      let left = pos.x + 25;
      let top = pos.y - 30;
      if (left + 270 > window.innerWidth) left = pos.x - 285;
      if (top + 310 > window.innerHeight) top = window.innerHeight - 320;
      if (top < 10) top = 10;

      const chat = chatRef.current;
      if (chat) {
        chat.style.left = left + "px";
        chat.style.top = top + "px";
        chat.classList.add(styles.visible);
      }
      chatInputRef.current?.focus();
    },
    [toScreen, renderMessages]
  );

  const openNodeSurface = useCallback((nodeId: number) => {
    const node = stateRef.current.nodes.get(nodeId);
    if (!node) return;

    if (node.paperUrl) {
      const canonical = toCanonicalArxivPdfUrl(node.paperUrl);
      if (canonical) {
        setPdfUrl(canonical);
        setPdfPaperUrl(node.paperUrl);
        setPdfTitle(node.paperTitle ?? node.label);
        setPdfLoading(true);
        setPdfChatMessages([]);
        setPdfChatQuery("");
        setChatPaneVisible(true);
        return;
      }
    }

    showChat(nodeId);
  }, [showChat]);

  const handleReturnToOrigin = useCallback(() => {
    const s = stateRef.current;
    s.panAnimating = true;
    s.panAnimFromX = s.panX;
    s.panAnimFromY = s.panY;
    s.panTargetX = 0;
    s.panTargetY = 0;
    s.zoomAnimFrom = s.zoom;
    s.zoomTarget = 1.0;
    s.panAnimStart = performance.now();
    s.panAnimDuration = 1200;
  }, []);

  const createNodeRef = useRef<(label: string, depth: number, parentId: number | null, angle: number) => ConstellationNode>(null!);

  const sendMessage = useCallback(async () => {
    const s = stateRef.current;
    const input = chatInputRef.current;
    const text = input?.value.trim();
    if (!text || s.chatNodeId === null) return;
    const node = s.nodes.get(s.chatNodeId);
    if (!node) return;

    node.messages.push({ role: "user", text });
    if (input) input.value = "";
    renderMessages(node);

    const parentNodeId = node.id;

    node.messages.push({ role: "ai", text: "Searching for related papers...", icon: "search" });
    renderMessages(node);

    try {
      let pickedPaper: { title: string; url: string } | null;
      let aiResponse: string;

      if (debugMode) {
        await fakeDelay(600 + Math.random() * 400);
        const papers = fakePapers(1);
        pickedPaper = papers[0];
        aiResponse = pickRandom(FAKE_RESPONSES);
      } else {
        const parentUrl = node.paperUrl ?? "";
        const parentTitle = node.paperTitle ?? node.label;
        const result = await followUpSearch(parentUrl, parentTitle, text);
        pickedPaper = result.pickedPaper;
        aiResponse = result.aiResponse;
      }

      node.messages[node.messages.length - 1] = { role: "ai", text: aiResponse };
      if (s.chatNodeId === parentNodeId) {
        renderMessages(node);
      }

      if (pickedPaper) {
        const isOrigin = node.depth === 0;
        const parentAngle = Math.atan2(node.y, node.x);
        const angle = isOrigin
          ? Math.random() * Math.PI * 2
          : parentAngle + (Math.random() - 0.5) * (Math.PI * 0.4);

        // Parent emits a pulse
        node.el?.classList.add(styles.spawning);
        setTimeout(() => node.el?.classList.remove(styles.spawning), 900);

        const child = createNodeRef.current(
          pickedPaper.title,
          node.depth + 1,
          parentNodeId,
          angle
        );
        child.paperTitle = pickedPaper.title;
        child.paperUrl = pickedPaper.url;
        if (pickedPaper.url) ingestPaper(pickedPaper.url, pickedPaper.title, currentIdRef.current);

        child.el?.classList.add(styles.igniting);
        if (child.el) child.el.style.setProperty("--ignition-delay", "420ms");
        const el = child.el;
        if (el) setTimeout(() => el.classList.remove(styles.igniting), 1200);

        node.children.push(child.id);

        s.edgeAnims.push({
          fromId: parentNodeId,
          toId: child.id,
          progress: 0,
          startTime: performance.now(),
        });

        s.panAnimating = true;
        s.panAnimFromX = s.panX;
        s.panAnimFromY = s.panY;
        s.panTargetX = s.panX + (-child.x * s.zoom - s.panX) * 0.15;
        s.panTargetY = s.panY + (-child.y * s.zoom - s.panY) * 0.15;
        s.zoomAnimFrom = s.zoom;
        s.zoomTarget = s.zoom;
        s.panAnimStart = performance.now();
        s.panAnimDuration = 800;
      }
      flushGraph();
    } catch (err) {
      console.error("[constellation] followUpSearch failed:", err);
      node.messages[node.messages.length - 1] = {
        role: "ai",
        text: "Something went wrong while searching. Please try again.",
      };
      if (s.chatNodeId === parentNodeId) {
        renderMessages(node);
      }
      flushGraph();
    }
  }, [renderMessages, debugMode, flushGraph]);

  // ─── Node interactions ───
  const highlightSubtree = useCallback((id: number) => {
    const s = stateRef.current;
    const now = performance.now();
    const stack = [id];
    while (stack.length) {
      const nid = stack.pop()!;
      s.highlights.set(nid, { startTime: now });
      const n = s.nodes.get(nid);
      if (n?.el) {
        n.el.classList.remove(styles.highlighting);
        void n.el.offsetWidth;
        n.el.classList.add(styles.highlighting);
        const el = n.el;
        setTimeout(() => el.classList.remove(styles.highlighting), 1000);
        stack.push(...n.children);
      }
    }
    setTimeout(() => s.highlights.clear(), 1000);
  }, []);

  const highlightNodesByArxivIds = useCallback((ids: string[]) => {
    const s = stateRef.current;
    const now = performance.now();
    const idSet = new Set(ids);
    s.nodes.forEach((node) => {
      if (!node.paperUrl) return;
      const key = extractArxivId(node.paperUrl) ?? node.paperUrl;
      if (idSet.has(key)) {
        s.highlights.set(node.id, { startTime: now });
        if (node.el) {
          node.el.classList.remove(styles.highlighting);
          void node.el.offsetWidth;
          node.el.classList.add(styles.highlighting);
          const el = node.el;
          setTimeout(() => el.classList.remove(styles.highlighting), 1000);
        }
      }
    });
    setTimeout(() => s.highlights.clear(), 1000);
  }, []);

  const focusGlobalSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = globalSearchInputRef.current;
      if (!input) return;
      input.focus();
      const length = input.value.length;
      input.setSelectionRange(length, length);
    });
  }, []);

  const handleGlobalSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || globalSearchLoading) return;
    const userId = createClientId();
    const assistantId = createClientId();
    setGlobalSearchLoading(true);
    setGlobalSearchQuery("");
    globalSearchStickToBottomRef.current = true;
    setGlobalSearchMessages((messages) => [
      ...messages,
      { id: userId, role: "user", text: trimmed, status: "complete" },
      {
        id: assistantId,
        role: "ai",
        text: "Searching the knowledge graph...",
        status: "loading",
      },
    ]);
    try {
      const { answer, sourceArxivIds } = await ragSearchGlobal(trimmed, currentIdRef.current);
      setGlobalSearchMessages((messages) =>
        messages.map((message) =>
          message.id === assistantId
            ? {
              ...message,
              text: answer,
              sourceArxivIds,
              status: "complete",
            }
            : message
        )
      );
      if (sourceArxivIds.length > 0) {
        highlightNodesByArxivIds(sourceArxivIds);
      }
    } catch (err) {
      console.error("[constellation] globalSearch failed:", err);
      setGlobalSearchMessages((messages) =>
        messages.map((message) =>
          message.id === assistantId
            ? {
              ...message,
              text: "Something went wrong. Please try again.",
              status: "error",
            }
            : message
        )
      );
    } finally {
      setGlobalSearchLoading(false);
    }
  }, [globalSearchLoading, highlightNodesByArxivIds]);

  const handleGlobalSearchMessagesScroll = useCallback(() => {
    const container = globalSearchMessagesRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    globalSearchStickToBottomRef.current = distanceFromBottom < 32;
  }, []);

  useEffect(() => {
    if (!globalSearchOpen) return;
    globalSearchStickToBottomRef.current = true;
    focusGlobalSearchInput();
  }, [focusGlobalSearchInput, globalSearchOpen]);

  useEffect(() => {
    const container = globalSearchMessagesRef.current;
    if (!container || !globalSearchOpen || !globalSearchStickToBottomRef.current) return;
    container.scrollTo({ top: container.scrollHeight });
  }, [globalSearchMessages, globalSearchOpen]);

  useEffect(() => {
    function handleGlobalSearchMouseDown(e: MouseEvent) {
      if (!globalSearchOpen || globalSearchLoading) return;
      const target = e.target as Node | null;
      if (target && globalSearchRef.current?.contains(target)) return;
      setGlobalSearchOpen(false);
    }

    function handleGlobalSearchKeyDown(e: KeyboardEvent) {
      const openWithSlash =
        e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const openWithShortcut =
        (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";

      if ((openWithSlash || openWithShortcut) && !isEditableElement(e.target)) {
        e.preventDefault();
        setGlobalSearchOpen(true);
        focusGlobalSearchInput();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        // Close PDF viewer first (highest z-index)
        if (pdfUrl) {
          setPdfUrl(null);
          return;
        }
        if (globalSearchOpen) {
          if (globalSearchQuery.trim()) setGlobalSearchQuery("");
          else setGlobalSearchOpen(false);
        }
      }
    }

    document.addEventListener("mousedown", handleGlobalSearchMouseDown);
    document.addEventListener("keydown", handleGlobalSearchKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleGlobalSearchMouseDown);
      document.removeEventListener("keydown", handleGlobalSearchKeyDown);
    };
  }, [focusGlobalSearchInput, globalSearchLoading, globalSearchOpen, globalSearchQuery, pdfUrl]);

  const createNodeElement = useCallback(
    (node: ConstellationNode) => {
      const container = nodesRef.current;
      if (!container) return;

      const s = stateRef.current;
      const el = document.createElement("div");
      let cls = styles.starNode;
      if (node.depth === 0) cls += " " + styles.depth0;
      else if (node.depth >= 2) cls += " " + styles.depthDeep;
      el.className = cls;
      el.dataset.nodeId = String(node.id);

      const body = document.createElement("div");
      body.className = styles.starBody;
      el.appendChild(body);

      if (node.depth === 0) {
        const label = document.createElement("div");
        label.className = styles.starLabel;
        label.textContent = node.label;
        el.appendChild(label);
      }

      el.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const current = stateRef.current;
        current.panAnimating = false;
        current.draggedNodeId = node.id;
        current.dragNodeStartX = node.x;
        current.dragNodeStartY = node.y;
        current.dragPointerStartClientX = e.clientX;
        current.dragPointerStartClientY = e.clientY;
        current.didDragNode = false;
        clearChatTimers();
      });

      el.addEventListener("mouseenter", () => {
        if (stateRef.current.draggedNodeId !== null) return;
        if (s.chatHideTimer) clearTimeout(s.chatHideTimer);
        if (s.chatShowTimer) clearTimeout(s.chatShowTimer);
        s.chatShowTimer = setTimeout(() => showChat(node.id), 200);
      });

      el.addEventListener("mouseleave", () => {
        if (stateRef.current.draggedNodeId !== null) return;
        if (s.chatShowTimer) clearTimeout(s.chatShowTimer);
        s.chatHideTimer = setTimeout(hideChat, 150);
      });

      container.appendChild(el);
      node.el = el;
      updateNodePosition(node);
    },
    [clearChatTimers, showChat, hideChat, updateNodePosition]
  );

  const createNode = useCallback(
    (
      label: string,
      depth: number,
      parentId: number | null,
      angle: number
    ): ConstellationNode => {
      const s = stateRef.current;
      const id = s.nextId++;
      const node: ConstellationNode = {
        id,
        label,
        depth,
        parentId,
        angle,
        x: 0,
        y: 0,
        children: [],
        messages: [],
        el: null,
        paperTitle: null,
        paperUrl: null,
        expanding: false,
      };

      if (depth > 0) {
        const baseRadius = BASE_RADIUS + (depth - 1) * RING_SPACING;
        const radiusJitter = (Math.random() - 0.5) * 30;
        const orbitRadius = baseRadius + radiusJitter;

        let bestAngle = angle;
        let bestDist = 0;

        for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
          let testAngle: number;
          if (attempt === 0) {
            testAngle = angle;
          } else {
            const dir = attempt % 2 === 1 ? 1 : -1;
            const step = Math.ceil(attempt / 2);
            testAngle = angle + step * 0.18 * dir;
          }

          const testX = Math.cos(testAngle) * orbitRadius;
          const testY = Math.sin(testAngle) * orbitRadius;

          let minDist = Infinity;
          for (const [, other] of s.nodes) {
            const dx = testX - other.x;
            const dy = testY - other.y;
            minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
          }

          if (minDist >= MIN_NODE_DISTANCE) {
            bestAngle = testAngle;
            break;
          }
          if (minDist > bestDist) {
            bestDist = minDist;
            bestAngle = testAngle;
          }
        }

        node.angle = bestAngle;
        node.x = Math.cos(bestAngle) * orbitRadius;
        node.y = Math.sin(bestAngle) * orbitRadius;
      }

      s.nodes.set(id, node);
      createNodeElement(node);
      persistGraph();
      return node;
    },
    [createNodeElement, persistGraph]
  );

  createNodeRef.current = createNode;

  const expandNodeRef = useRef<(id: number) => void>(() => { });

  const expandNode = useCallback(
    async (id: number) => {
      const s = stateRef.current;
      const parent = s.nodes.get(id);
      if (!parent || parent.children.length > 0 || parent.expanding) {
        if (parent && parent.children.length > 0) highlightSubtree(id);
        return;
      }

      parent.expanding = true;
      const pTitle = parent.paperTitle ?? parent.label;
      const pUrl = parent.paperUrl ?? "";

      if (parent.el) parent.el.style.opacity = "0.6";

      try {
        let papers: { title: string; url: string }[];
        if (debugMode) {
          await fakeDelay(400 + Math.random() * 600);
          papers = fakePapers(3 + Math.floor(Math.random() * 3));
        } else {
          papers = await expandSearch(pUrl, pTitle);
        }

        if (parent.el) parent.el.style.opacity = "1";
        if (papers.length === 0) return;

        // Parent emits a pulse
        parent.el?.classList.add(styles.spawning);
        setTimeout(() => parent.el?.classList.remove(styles.spawning), 900);

        const numChildren = papers.length;
        const isOrigin = parent.depth === 0;
        const parentAngle = Math.atan2(parent.y, parent.x);
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const startAngle = Math.random() * Math.PI * 2;

        for (let i = 0; i < numChildren; i++) {
          let angle: number;
          if (isOrigin) {
            angle = startAngle + i * goldenAngle + (Math.random() - 0.5) * 0.4;
          } else {
            const coneSpread = Math.PI * (0.3 + numChildren * 0.06);
            const t = numChildren === 1 ? 0.5 : i / (numChildren - 1);
            angle = parentAngle - coneSpread / 2 + t * coneSpread + (Math.random() - 0.5) * 0.15;
          }

          const child = createNodeRef.current(
            papers[i].title,
            parent.depth + 1,
            id,
            angle
          );
          child.paperTitle = papers[i].title;
          child.paperUrl = papers[i].url;
          if (papers[i].url) {
            ingestPaper(papers[i].url, papers[i].title, currentIdRef.current);
          }

          // Staged ignition: child materializes as beam approaches
          const ignitionDelay = i * 150 + 420;
          child.el?.classList.add(styles.igniting);
          if (child.el) child.el.style.setProperty("--ignition-delay", `${ignitionDelay}ms`);
          const el = child.el;
          if (el) setTimeout(() => el.classList.remove(styles.igniting), ignitionDelay + 800);

          parent.children.push(child.id);

          s.edgeAnims.push({
            fromId: id,
            toId: child.id,
            progress: 0,
            startTime: performance.now() + i * 150,
          });
        }

        const allPts = [parent, ...parent.children.map(cid => s.nodes.get(cid)).filter(Boolean)] as ConstellationNode[];
        let minWX = Infinity, maxWX = -Infinity, minWY = Infinity, maxWY = -Infinity;
        for (const n of allPts) {
          minWX = Math.min(minWX, n.x);
          maxWX = Math.max(maxWX, n.x);
          minWY = Math.min(minWY, n.y);
          maxWY = Math.max(maxWY, n.y);
        }
        const focusCX = (minWX + maxWX) / 2;
        const focusCY = (minWY + maxWY) / 2;
        const extentX = maxWX - minWX + 120;
        const extentY = maxWY - minWY + 120;
        const idealZoomX = window.innerWidth * 0.7 / Math.max(extentX, 1);
        const idealZoomY = window.innerHeight * 0.7 / Math.max(extentY, 1);
        const idealZoom = Math.max(0.5, Math.min(2.0, Math.min(idealZoomX, idealZoomY)));

        s.panAnimating = true;
        s.panAnimFromX = s.panX;
        s.panAnimFromY = s.panY;
        s.panTargetX = -focusCX * idealZoom;
        s.panTargetY = -focusCY * idealZoom;
        s.zoomAnimFrom = s.zoom;
        s.zoomTarget = idealZoom;
        s.panAnimStart = performance.now();
        s.panAnimDuration = 1000;
        flushGraph();
      } catch (err) {
        console.error("[constellation] expandSearch failed:", err);
        if (parent.el) parent.el.style.opacity = "1";
      }
    },
    [highlightSubtree, debugMode, flushGraph]
  );

  expandNodeRef.current = expandNode;

  const deleteNodeCascade = useCallback(
    (targetId: number) => {
      const s = stateRef.current;
      const target = s.nodes.get(targetId);
      if (!target || target.depth === 0) return;

      // Collect the full subtree (target + all descendants)
      const toDelete: number[] = [];
      const stack = [targetId];
      while (stack.length) {
        const nid = stack.pop()!;
        toDelete.push(nid);
        const n = s.nodes.get(nid);
        if (n) stack.push(...n.children);
      }

      // Close chat if it's open on a node we're about to delete
      if (s.chatNodeId !== null && toDelete.includes(s.chatNodeId)) {
        hideChat();
      }

      // Phase 1: Animate collapse (nodes shrink, edges retract)
      const animDuration = 500;
      const parentNode = target.parentId !== null ? s.nodes.get(target.parentId) : null;

      for (const nid of toDelete) {
        const n = s.nodes.get(nid);
        if (n?.el) {
          n.el.classList.add(styles.collapsing);
        }
      }

      // Add reverse edge animations (retract toward parent)
      for (const nid of toDelete) {
        const n = s.nodes.get(nid);
        if (n && n.parentId !== null) {
          s.edgeAnims = s.edgeAnims.filter(
            (a) => !(a.fromId === n.parentId && a.toId === n.id)
          );
        }
      }

      // Phase 2: After animation, remove from data structures
      setTimeout(() => {
        const paperUrls: string[] = [];

        for (const nid of toDelete) {
          const n = s.nodes.get(nid);
          if (n) {
            if (n.paperUrl) paperUrls.push(n.paperUrl);
            if (n.el) {
              n.el.remove();
              n.el = null;
            }
            s.nodes.delete(nid);
          }
        }

        // Remove target from parent's children array
        if (parentNode) {
          parentNode.children = parentNode.children.filter((cid) => cid !== targetId);
        }

        // Clean up any remaining edge anims referencing deleted nodes
        s.edgeAnims = s.edgeAnims.filter(
          (a) => !toDelete.includes(a.fromId) && !toDelete.includes(a.toId)
        );

        // Clean up highlights
        for (const nid of toDelete) {
          s.highlights.delete(nid);
        }

        // Persist to Supabase
        flushGraph();

        // Clean up Supermemory in background
        const cid = currentIdRef.current;
        if (cid) {
          for (const url of paperUrls) {
            removeDocumentFromConstellation(url, cid).catch((err) =>
              console.error("[supermemory] cleanup failed:", err)
            );
          }
        }
      }, animDuration);
    },
    [hideChat, flushGraph]
  );

  // ─── Main effect: setup everything ───
  useEffect(() => {
    const s = stateRef.current;
    const starCanvas = starCanvasRef.current!;
    const edgeCanvas = edgeCanvasRef.current!;
    const starCtx = starCanvas.getContext("2d")!;
    const edgeCtx = edgeCanvas.getContext("2d")!;
    const chat = chatRef.current!;

    const STAR_TINTS = [
      [255, 255, 255],
      [255, 255, 255],
      [255, 240, 220],
      [255, 216, 102],
      [180, 220, 255],
      [126, 200, 227],
      [220, 200, 255],
    ];

    function initStars() {
      s.stars = [];
      const count = Math.floor(
        (starCanvas.width * starCanvas.height) / 2800
      );
      for (let i = 0; i < count; i++) {
        const tint = STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)];
        s.stars.push({
          x: Math.random() * starCanvas.width,
          y: Math.random() * starCanvas.height,
          r: Math.random() * 1.4 + 0.3,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.8 + 0.3,
          baseAlpha: Math.random() * 0.5 + 0.15,
          depth: Math.random() * 0.12 + 0.03,
          tint,
        });
      }
    }

    function handleResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      starCanvas.width = w;
      starCanvas.height = h;
      edgeCanvas.width = w;
      edgeCanvas.height = h;
      initStars();
      updateAllPositions();
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    function handleMouseDown(e: MouseEvent) {
      if (
        (e.target as HTMLElement).closest(`.${styles.starNode}`) ||
        (e.target as HTMLElement).closest(`.${styles.chatWindow}`) ||
        (e.target as HTMLElement).closest(`.${styles.sidebar}`) ||
        (e.target as HTMLElement).closest(`.${styles.returnToOrigin}`) ||
        (e.target as HTMLElement).closest(`.${styles.globalSearchShell}`)
      )
        return;
      s.panAnimating = false;
      s.isDragging = true;
      s.dragStartX = e.clientX;
      s.dragStartY = e.clientY;
      s.panStartX = s.panX;
      s.panStartY = s.panY;
      document.body.style.cursor = "grabbing";
    }

    function handleMouseMove(e: MouseEvent) {
      if (s.draggedNodeId !== null) {
        const node = s.nodes.get(s.draggedNodeId);
        if (!node) return;

        const dx = e.clientX - s.dragPointerStartClientX;
        const dy = e.clientY - s.dragPointerStartClientY;

        if (!s.didDragNode) {
          if (Math.hypot(dx, dy) < NODE_DRAG_THRESHOLD) return;
          s.didDragNode = true;
          s.panAnimating = false;
          clearChatTimers();
          hideChat();
          node.el?.classList.add(styles.draggingNode);
          document.body.style.cursor = "grabbing";
        }

        node.x = s.dragNodeStartX + dx / s.zoom;
        node.y = s.dragNodeStartY + dy / s.zoom;
        updateNodePosition(node);
        return;
      }

      if (!s.isDragging) return;
      s.panX = s.panStartX + (e.clientX - s.dragStartX);
      s.panY = s.panStartY + (e.clientY - s.dragStartY);
      updateAllPositions();
    }

    function handleMouseUp() {
      if (s.draggedNodeId !== null) {
        const draggedNodeId = s.draggedNodeId;
        const node = s.nodes.get(draggedNodeId);
        const didDragNode = s.didDragNode;

        node?.el?.classList.remove(styles.draggingNode);
        s.draggedNodeId = null;
        s.dragNodeStartX = 0;
        s.dragNodeStartY = 0;
        s.dragPointerStartClientX = 0;
        s.dragPointerStartClientY = 0;
        s.didDragNode = false;
        document.body.style.cursor = "";

        if (didDragNode) {
          persistGraph();
        } else {
          openNodeSurface(draggedNodeId);
        }
        return;
      }

      s.isDragging = false;
      document.body.style.cursor = "";
    }

    function handleWheel(e: WheelEvent) {
      // Allow native scroll inside the PDF overlay (chat panel, etc.)
      if ((e.target as HTMLElement)?.closest?.('[data-pdf-overlay]')) return;

      e.preventDefault();
      s.panAnimating = false;
      const oldZoom = s.zoom;
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      s.zoom = Math.max(0.3, Math.min(3.0, s.zoom * delta));

      const mx = e.clientX - cx();
      const my = e.clientY - cy();
      s.panX = mx - (mx - s.panX) * (s.zoom / oldZoom);
      s.panY = my - (my - s.panY) * (s.zoom / oldZoom);

      updateAllPositions();
    }

    function handleGlowMove(e: MouseEvent) {
      if (glowRef.current) {
        glowRef.current.style.background =
          `radial-gradient(600px circle at ${e.clientX}px ${e.clientY}px, rgba(255,216,102,0.04), rgba(126,200,227,0.018) 50%, transparent 80%)`;
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mousemove", handleGlowMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("wheel", handleWheel, { passive: false });

    function chatEnter() {
      if (s.chatHideTimer) clearTimeout(s.chatHideTimer);
    }
    function chatLeave() {
      s.chatHideTimer = setTimeout(hideChat, 150);
    }
    chat.addEventListener("mouseenter", chatEnter);
    chat.addEventListener("mouseleave", chatLeave);

    function drawStarField(time: number) {
      starCtx.clearRect(0, 0, starCanvas.width, starCanvas.height);
      const w = starCanvas.width;
      const h = starCanvas.height;
      for (const star of s.stars) {
        const alpha =
          star.baseAlpha +
          Math.sin(time * 0.001 * star.speed + star.phase) * 0.2;
        const sx = ((star.x + s.panX * star.depth) % w + w) % w;
        const sy = ((star.y + s.panY * star.depth) % h + h) % h;
        starCtx.beginPath();
        starCtx.arc(sx, sy, star.r, 0, Math.PI * 2);
        const t = star.tint;
        starCtx.fillStyle = `rgba(${t[0]},${t[1]},${t[2]},${Math.max(0.05, alpha)})`;
        starCtx.fill();
      }
    }

    function getEdgeCP(par: ConstellationNode, child: ConstellationNode) {
      const dx = child.x - par.x;
      const dy = child.y - par.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return { x: (par.x + child.x) / 2, y: (par.y + child.y) / 2 };
      const midX = (par.x + child.x) / 2;
      const midY = (par.y + child.y) / 2;
      const perpX = -dy / len;
      const perpY = dx / len;
      const sibIdx = par.children.indexOf(child.id);
      const sibCount = par.children.length;
      let offset: number;
      if (sibCount <= 1) {
        offset = len * 0.05;
      } else {
        offset = (sibIdx - (sibCount - 1) / 2) * Math.min(len * 0.1, 18);
      }
      return { x: midX + perpX * offset, y: midY + perpY * offset };
    }

    function drawEdges(time: number) {
      edgeCtx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);

      s.nodes.forEach((node) => {
        if (node.parentId === null) return;
        const par = s.nodes.get(node.parentId);
        if (!par) return;

        const anim = s.edgeAnims.find(
          (a) =>
            a.fromId === node.parentId &&
            a.toId === node.id &&
            a.progress < 1
        );
        if (anim) return;

        const cp = getEdgeCP(par, node);
        const from = toScreen(par.x, par.y);
        const to = toScreen(node.x, node.y);
        const cps = toScreen(cp.x, cp.y);

        const hl =
          s.highlights.has(node.id) && s.highlights.has(node.parentId);
        const hlEntry = hl ? s.highlights.get(node.id) : null;
        let edgeAlpha = 0.18;
        if (hlEntry) {
          const elapsed = time - hlEntry.startTime;
          const t = Math.max(0, 1 - elapsed / 1000);
          edgeAlpha = 0.18 + 0.5 * t;
        }

        edgeCtx.beginPath();
        edgeCtx.moveTo(from.x, from.y);
        edgeCtx.quadraticCurveTo(cps.x, cps.y, to.x, to.y);
        edgeCtx.strokeStyle = hl
          ? `rgba(255,216,102,${edgeAlpha})`
          : `rgba(255,255,255,${edgeAlpha})`;
        edgeCtx.lineWidth = hl ? 1.8 : 1;
        edgeCtx.stroke();
      });

      for (let i = s.edgeAnims.length - 1; i >= 0; i--) {
        const anim = s.edgeAnims[i];
        if (time < anim.startTime) continue;

        const elapsed = time - anim.startTime;
        const rawT = Math.min(1, elapsed / 700);
        anim.progress = easeInOutCubic(rawT);

        const fromNode = s.nodes.get(anim.fromId);
        const toNode = s.nodes.get(anim.toId);
        if (!fromNode || !toNode) {
          s.edgeAnims.splice(i, 1);
          continue;
        }

        const cp = getEdgeCP(fromNode, toNode);
        const fs = toScreen(fromNode.x, fromNode.y);
        const ts = toScreen(toNode.x, toNode.y);
        const cps = toScreen(cp.x, cp.y);
        const p = anim.progress;

        const headX = (1 - p) * (1 - p) * fs.x + 2 * (1 - p) * p * cps.x + p * p * ts.x;
        const headY = (1 - p) * (1 - p) * fs.y + 2 * (1 - p) * p * cps.y + p * p * ts.y;
        const subCpX = (1 - p) * fs.x + p * cps.x;
        const subCpY = (1 - p) * fs.y + p * cps.y;

        edgeCtx.beginPath();
        edgeCtx.moveTo(fs.x, fs.y);
        edgeCtx.quadraticCurveTo(subCpX, subCpY, headX, headY);
        edgeCtx.strokeStyle = `rgba(255,216,102,${0.12 + 0.2 * p})`;
        edgeCtx.lineWidth = 1;
        edgeCtx.stroke();

        const headAlpha = 0.7 * (1 - rawT * 0.4);
        edgeCtx.beginPath();
        edgeCtx.arc(headX, headY, 3, 0, Math.PI * 2);
        edgeCtx.fillStyle = `rgba(255,255,255,${headAlpha})`;
        edgeCtx.fill();

        const glowR = 14;
        const grad = edgeCtx.createRadialGradient(headX, headY, 0, headX, headY, glowR);
        grad.addColorStop(0, `rgba(255,216,102,${headAlpha * 0.5})`);
        grad.addColorStop(1, "rgba(255,216,102,0)");
        edgeCtx.beginPath();
        edgeCtx.arc(headX, headY, glowR, 0, Math.PI * 2);
        edgeCtx.fillStyle = grad;
        edgeCtx.fill();

        if (rawT >= 1) {
          s.edgeAnims.splice(i, 1);
        }
      }
    }

    function frame(time: number) {
      // Smooth auto-pan toward newly spawned nodes
      if (s.panAnimating) {
        const elapsed = time - s.panAnimStart;
        const t = Math.min(1, elapsed / (s.panAnimDuration || 800));
        const e = easeInOutCubic(t);
        s.panX = s.panAnimFromX + (s.panTargetX - s.panAnimFromX) * e;
        s.panY = s.panAnimFromY + (s.panTargetY - s.panAnimFromY) * e;
        s.zoom = s.zoomAnimFrom + (s.zoomTarget - s.zoomAnimFrom) * e;
        updateAllPositions();
        if (t >= 1) s.panAnimating = false;
      }

      const dist = Math.sqrt(s.panX * s.panX + s.panY * s.panY);
      const btn = returnBtnRef.current;
      if (btn) {
        const show = dist > 500;
        btn.style.opacity = show ? "1" : "0";
        btn.style.pointerEvents = show ? "all" : "none";
      }

      drawStarField(time);
      drawEdges(time);
      s.animFrameId = requestAnimationFrame(frame);
    }

    function restoreGraph(saved: SerializedGraph) {
      s.nextId = saved.nextId;
      const parentChildPairs: [number, number][] = [];
      for (const sn of saved.nodes) {
        const node: ConstellationNode = {
          id: sn.id,
          label: sn.label,
          depth: sn.depth,
          parentId: sn.parentId,
          angle: sn.angle,
          x: sn.x,
          y: sn.y,
          children: [...sn.children],
          messages: sn.messages.map((m) => ({ role: m.role, text: m.text, icon: m.icon })),
          el: null,
          paperTitle: sn.paperTitle,
          paperUrl: sn.paperUrl,
          expanding: false,
        };
        s.nodes.set(node.id, node);
        createNodeElement(node);
        if (sn.parentId !== null) {
          parentChildPairs.push([sn.parentId, sn.id]);
        }
      }
      for (const [fromId, toId] of parentChildPairs) {
        s.edgeAnims.push({ fromId, toId, progress: 1, startTime: 0 });
      }
    }

    function createFreshOrigin() {
      const originLabel = paperTitle || topic || "Origin";
      const originNode = createNode(originLabel, 0, null, 0);
      if (paperTitle) originNode.paperTitle = paperTitle;
      if (paperUrl) {
        originNode.paperUrl = paperUrl;
        ingestPaper(paperUrl, paperTitle || null, currentIdRef.current);
      }
    }

    const cid = currentIdRef.current;
    if (cid) {
      loadGraphData(cid).then((saved) => {
        if (saved && saved.nodes.length > 0) {
          restoreGraph(saved);
        } else {
          createFreshOrigin();
        }
      }).catch(() => {
        createFreshOrigin();
      });
    } else {
      createFreshOrigin();
    }

    s.animFrameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(s.animFrameId);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mousemove", handleGlowMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("wheel", handleWheel);
      chat.removeEventListener("mouseenter", chatEnter);
      chat.removeEventListener("mouseleave", chatLeave);
      chatMessagesRootRef.current?.unmount();
      chatMessagesRootRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {debugMode && <div className={styles.debugBadge}>Debug Mode</div>}

      <a
        href="/"
        className={styles.homeButton}
        title="Back to search"
        style={debugMode ? { right: 120 } : undefined}
      >
        <House size={16} aria-hidden="true" />
      </a>

      <button
        ref={returnBtnRef}
        className={styles.returnToOrigin}
        onClick={handleReturnToOrigin}
        title="Return to origin"
        style={{ opacity: 0, pointerEvents: "none" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      </button>

      {/* ─── Global RAG search ─── */}
      <div
        ref={globalSearchRef}
        className={`${styles.globalSearchShell} ${globalSearchOpen ? styles.globalSearchShellOpen : ""}`}
      >
        {globalSearchOpen ? (
          <>
            <form
              className={styles.globalSearchBar}
              onSubmit={(e) => {
                e.preventDefault();
                handleGlobalSearch(globalSearchQuery);
              }}
            >
              <span className={styles.globalSearchLeadingIcon} aria-hidden="true">
                <Search size={16} />
              </span>
              <input
                ref={globalSearchInputRef}
                className={styles.globalSearchInput}
                type="text"
                placeholder="Ask the knowledge graph..."
                autoComplete="off"
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
              />
              <button
                type="submit"
                className={styles.globalSearchAction}
                title="Send"
                disabled={!globalSearchQuery.trim() || globalSearchLoading}
              >
                <SendHorizontal size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.globalSearchClose}
                title="Close knowledge graph search"
                onClick={() => setGlobalSearchOpen(false)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </form>
            <div className={styles.globalSearchDialog} role="dialog" aria-label="Knowledge graph search">
              <div
                ref={globalSearchMessagesRef}
                className={styles.globalSearchMessages}
                onScroll={handleGlobalSearchMessagesScroll}
              >
                {globalSearchMessages.length === 0 ? (
                  <div className={styles.globalSearchEmpty}>
                    Ask about themes, connections, or trends across this constellation.
                  </div>
                ) : (
                  globalSearchMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`${styles.globalSearchMessage} ${message.role === "user" ? styles.globalSearchMessageUser : styles.globalSearchMessageAi
                        } ${message.status === "error" ? styles.globalSearchMessageError : ""}`}
                    >
                      <div className={styles.globalSearchBubble}>{message.text}</div>
                      {message.role === "ai" && message.sourceArxivIds && message.sourceArxivIds.length > 0 && (
                        <div className={styles.globalSearchMeta}>
                          Found in {message.sourceArxivIds.length} paper
                          {message.sourceArxivIds.length !== 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <button
            type="button"
            className={styles.globalSearchCollapsed}
            title="Search the knowledge graph"
            aria-expanded={globalSearchOpen}
            onClick={() => {
              setGlobalSearchOpen(true);
              focusGlobalSearchInput();
            }}
          >
            <span className={styles.globalSearchLeadingIcon} aria-hidden="true">
              <Search size={16} />
            </span>
            <span className={styles.globalSearchCollapsedLabel}>Ask the knowledge graph...</span>
            <span className={styles.globalSearchShortcut}>⌘K</span>
          </button>
        )}
      </div>

      {/* ─── Sidebar ─── */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarExpanded : ""}`}>
        <div className={styles.sidebarActions}>
          <button
            className={`${styles.sidebarActionBtn} ${styles.sidebarToggleBtn}`}
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <span className={styles.sidebarLogo} aria-hidden="true" />
            {sidebarOpen ? (
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
            {sidebarOpen && <span>New Constellation</span>}
          </button>
          <button
            className={styles.sidebarActionBtn}
            onClick={() => { setGlobalSearchOpen(true); focusGlobalSearchInput(); }}
            title="Search Constellations"
          >
            <Search size={18} />
            {sidebarOpen && <span>Search Constellations</span>}
          </button>
        </div>
        {sidebarOpen && (
          <>
            <div className={styles.sidebarDivider} />
            <div className={styles.sidebarList}>
              {constellations.length === 0 && (
                <div className={styles.sidebarEmpty}>No saved constellations yet.</div>
              )}
              {constellations.map((c) => {
                const isActive = c.id === currentId;
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

      <canvas ref={starCanvasRef} className={styles.starfield} />
      <div ref={glowRef} className={styles.mouseGlow} />
      <canvas ref={edgeCanvasRef} className={styles.edges} />
      <div ref={nodesRef} className={styles.nodesContainer} />

      <div ref={chatRef} className={styles.chatWindow}>
        <div className={styles.chatHeaderRow}>
          <div ref={chatHeaderRef} className={styles.chatHeader}>
            Node
          </div>
          <button
            className={styles.chatExpandBtn}
            title="Find related papers"
            onClick={() => {
              const id = stateRef.current.chatNodeId;
              if (id !== null) expandNodeRef.current(id);
            }}
          >
            <Plus size={13} aria-hidden="true" />
            Expand
          </button>
          <button
            className={styles.chatDeleteBtn}
            title="Delete this node and its branches"
            onClick={() => {
              const id = stateRef.current.chatNodeId;
              if (id !== null) {
                const node = stateRef.current.nodes.get(id);
                if (node && node.depth > 0) deleteNodeCascade(id);
              }
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            Delete
          </button>
        </div>
        <div ref={chatMessagesRef} className={styles.chatMessages} />
        <div className={styles.chatInputArea}>
          <input
            ref={chatInputRef}
            className={styles.chatInput}
            type="text"
            placeholder="Search for a related paper..."
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button className={styles.chatSend} onClick={sendMessage}>
            <SendHorizontal size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {pdfUrl && (
        <div
          ref={paperViewRef}
          data-pdf-overlay
          className={styles.paperViewRoot}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* ── Paper Pane ── */}
          <div
            data-paper-pane
            className={styles.paperPane}
            style={{ width: chatPaneVisible ? `${pdfPanelWidth}%` : '100%' }}
          >
            <div className={styles.paperHeader}>
              <button
                className={styles.paperBackBtn}
                onClick={() => setPdfUrl(null)}
                title="Back to constellation"
              >
                <X size={16} aria-hidden="true" />
              </button>
              <h1 className={styles.paperTitleText}>{pdfTitle}</h1>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.paperExternalLink}
                title="Open in new tab"
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              {!chatPaneVisible && (
                <button
                  className={styles.paperChatToggle}
                  onClick={() => setChatPaneVisible(true)}
                  title="Open chat"
                >
                  <BookOpen size={14} aria-hidden="true" />
                  <span>Chat</span>
                </button>
              )}
            </div>
            <div className={styles.paperBody}>
              {pdfLoading && (
                <div className={styles.pdfLoading}>
                  <div className={styles.pdfSpinner} />
                  Loading paper…
                </div>
              )}
              <iframe
                className={styles.paperIframe}
                src={pdfUrl}
                title={pdfTitle}
                onLoad={() => setPdfLoading(false)}
              />
            </div>
          </div>

          {/* ── Draggable Divider ── */}
          {chatPaneVisible && (
            <div
              className={styles.paperDivider}
              onMouseDown={(e) => {
                e.preventDefault();
                const root = paperViewRef.current;
                const pp = root?.querySelector('[data-paper-pane]') as HTMLElement | null;
                const cp = root?.querySelector('[data-chat-pane]') as HTMLElement | null;
                if (!pp || !cp) return;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                root?.classList.add(styles.paperViewDragging);
                let w = pdfPanelWidth;
                const onMove = (ev: MouseEvent) => {
                  w = Math.max(30, Math.min(80, (ev.clientX / window.innerWidth) * 100));
                  pp.style.width = `${w}%`;
                  cp.style.width = `${100 - w}%`;
                };
                const onUp = () => {
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                  root?.classList.remove(styles.paperViewDragging);
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                  setPdfPanelWidth(w);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            >
              <div className={styles.paperDividerLine} />
            </div>
          )}

          {/* ── Chat Pane ── */}
          {chatPaneVisible && (
            <div
              data-chat-pane
              className={styles.chatPane}
              style={{ width: `${100 - pdfPanelWidth}%` }}
            >
              <div className={styles.chatPaneHeader}>
                <span className={styles.chatPaneHeaderTitle}>Chat with this paper</span>
                <button
                  className={styles.chatPaneCollapseBtn}
                  onClick={() => setChatPaneVisible(false)}
                  title="Close chat"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <div ref={pdfChatMessagesRef} className={styles.chatPaneMessages}>
                {pdfChatMessages.length === 0 ? (
                  <div className={styles.chatPaneEmpty}>
                    <div className={styles.chatPaneEmptyIcon}>
                      <BookOpen size={32} aria-hidden="true" />
                    </div>
                    <p>Ask any question about this paper</p>
                    <p className={styles.chatPaneEmptySub}>Answers are powered by the knowledge graph.</p>
                  </div>
                ) : (
                  pdfChatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`${styles.chatPaneMsg} ${msg.role === "user" ? styles.chatPaneMsgUser : styles.chatPaneMsgAi}`}
                    >
                      {msg.loading ? (
                        <span className={styles.chatPaneThinking}>
                          <div className={styles.pdfSpinner} style={{ width: 14, height: 14 }} />
                          Thinking…
                        </span>
                      ) : msg.text}
                    </div>
                  ))
                )}
              </div>
              <div className={styles.chatPaneInputArea}>
                {pdfChatMessages.length === 0 && (
                  <div className={styles.chatPaneQuickActions}>
                    {['Summarize', 'Key findings', 'Methodology'].map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={styles.chatPaneQuickBtn}
                        onClick={() => {
                          setPdfChatQuery(label);
                          pdfChatInputRef.current?.focus();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={async (e: FormEvent) => {
                    e.preventDefault();
                    const q = pdfChatQuery.trim();
                    if (!q || pdfChatLoading) return;
                    const userId = crypto.randomUUID();
                    const aiId = crypto.randomUUID();
                    setPdfChatQuery("");
                    setPdfChatLoading(true);
                    setPdfChatMessages((prev) => [
                      ...prev,
                      { id: userId, role: "user", text: q },
                      { id: aiId, role: "ai", text: "", loading: true },
                    ]);
                    requestAnimationFrame(() => {
                      pdfChatMessagesRef.current?.scrollTo({ top: pdfChatMessagesRef.current.scrollHeight, behavior: "smooth" });
                    });
                    try {
                      const answer = await ragSearchPerPaper(q, pdfPaperUrl, pdfTitle, currentIdRef.current);
                      setPdfChatMessages((prev) =>
                        prev.map((m) => m.id === aiId ? { ...m, text: answer, loading: false } : m)
                      );
                    } catch {
                      setPdfChatMessages((prev) =>
                        prev.map((m) => m.id === aiId ? { ...m, text: "Something went wrong. Please try again.", loading: false } : m)
                      );
                    } finally {
                      setPdfChatLoading(false);
                      requestAnimationFrame(() => {
                        pdfChatMessagesRef.current?.scrollTo({ top: pdfChatMessagesRef.current.scrollHeight, behavior: "smooth" });
                      });
                    }
                  }}
                >
                  <div className={styles.chatPaneInputWrapper}>
                    <input
                      ref={pdfChatInputRef}
                      className={styles.chatPaneInput}
                      type="text"
                      placeholder="Ask about this paper…"
                      autoComplete="off"
                      value={pdfChatQuery}
                      onChange={(e) => setPdfChatQuery(e.target.value)}
                    />
                    <button
                      type="submit"
                      className={styles.chatPaneSendBtn}
                      disabled={pdfChatLoading || !pdfChatQuery.trim()}
                    >
                      <SendHorizontal size={15} aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={styles.onboardingHint}>
        Click a node to view paper &middot; Hover for details &middot; Drag to pan &middot; Scroll to zoom
      </div>
    </>
  );
}
