"use client";

import { useEffect, useRef, useCallback, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { followUpSearch, expandSearch } from "@/app/actions/search";
import styles from "./constellations.module.css";


// ─── Types ───
interface ConstellationNode {
  id: number;
  label: string;
  depth: number;
  parentId: number | null;
  angle: number;
  x: number;
  y: number;
  children: number[];
  messages: { role: "user" | "ai"; text: string }[];
  el: HTMLDivElement | null;
  paperTitle: string | null;
  paperUrl: string | null;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  baseAlpha: number;
}

interface EdgeAnim {
  fromId: number;
  toId: number;
  progress: number;
  startTime: number;
}

const BASE_RADIUS = 110;
const RING_SPACING = 100;

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
    return JSON.parse(localStorage.getItem("constellations") || "[]");
  } catch {
    return [];
  }
}

function saveConstellations(list: SavedConstellation[]) {
  localStorage.setItem("constellations", JSON.stringify(list));
}

function ConstellationsInner() {
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [constellations, setConstellations] = useState<SavedConstellation[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const currentTopic = searchParams.get("topic") || "";
  const currentId = searchParams.get("id") || "";
  const debugMode = searchParams.get("debug") === "true";

  useEffect(() => {
    const saved = loadConstellations();
    if (currentTopic && !currentId) {
      const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
      const entry: SavedConstellation = {
        id,
        name: currentTopic,
        topic: currentTopic,
        paperTitle: searchParams.get("paperTitle") || undefined,
        paperUrl: searchParams.get("paperUrl") || undefined,
        createdAt: Date.now(),
      };
      const updated = [entry, ...saved];
      saveConstellations(updated);
      setConstellations(updated);
      const params = new URLSearchParams(searchParams.toString());
      params.set("id", id);
      window.history.replaceState(null, "", `?${params.toString()}`);
    } else {
      setConstellations(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatHeaderRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // All mutable state lives in refs to avoid re-renders
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
    container.innerHTML = "";
    if (node.messages.length === 0) {
      const hint = document.createElement("div");
      hint.className = `${styles.chatMsg} ${styles.ai}`;
      hint.textContent = "Greetings, traveler. Ask me about " + node.label + ".";
      container.appendChild(hint);
    } else {
      node.messages.forEach((m) => {
        const div = document.createElement("div");
        div.className = `${styles.chatMsg} ${m.role === "user" ? styles.user : styles.ai}`;
        div.textContent = m.text;
        container.appendChild(div);
      });
    }

    // Show paper link if this node has one
    if (node.paperUrl) {
      const paperDiv = document.createElement("div");
      paperDiv.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);";
      const link = document.createElement("a");
      link.href = node.paperUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.cssText = "display:block;font-size:11px;color:#ffd866;text-decoration:none;word-break:break-all;";
      link.textContent = "📄 " + (node.paperTitle ?? "View Paper");
      link.addEventListener("mouseenter", () => { link.style.textDecoration = "underline"; });
      link.addEventListener("mouseleave", () => { link.style.textDecoration = "none"; });
      paperDiv.appendChild(link);
      container.appendChild(paperDiv);
    }

    container.scrollTop = container.scrollHeight;
  }, []);

  const hideChat = useCallback(() => {
    chatRef.current?.classList.remove(styles.visible);
    stateRef.current.chatNodeId = null;
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

  // Ref to break circular dep: sendMessage needs createNode which is declared later
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

    // Show searching indicator
    node.messages.push({ role: "ai", text: "🔍 Searching for related papers..." });
    renderMessages(node);
    const parentNodeId = node.id;

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

      // Replace the searching message with the real response
      node.messages[node.messages.length - 1] = { role: "ai", text: aiResponse };
      if (s.chatNodeId === parentNodeId) {
        renderMessages(node);
      }

      // Spawn daughter node if a paper was found
      if (pickedPaper) {
        // Place on global orbit ring, in a narrow cone pointing outward
        const isOrigin = node.depth === 0;
        const parentAngle = Math.atan2(node.y, node.x);
        const angle = isOrigin
          ? Math.random() * Math.PI * 2
          : parentAngle + (Math.random() - 0.5) * (Math.PI * 0.22);

        const child = createNodeRef.current(
          pickedPaper.title,
          node.depth + 1,
          parentNodeId,
          angle
        );
        child.paperTitle = pickedPaper.title;
        child.paperUrl = pickedPaper.url;

        child.el?.classList.add(styles.igniting);
        const el = child.el;
        if (el) setTimeout(() => el.classList.remove(styles.igniting), 600);

        node.children.push(child.id);

        s.edgeAnims.push({
          fromId: parentNodeId,
          toId: child.id,
          progress: 0,
          startTime: performance.now(),
        });
      }
    } catch (err) {
      console.error("[constellation] followUpSearch failed:", err);
      node.messages[node.messages.length - 1] = {
        role: "ai",
        text: "Something went wrong while searching. Please try again.",
      };
      if (s.chatNodeId === parentNodeId) {
        renderMessages(node);
      }
    }
  }, [renderMessages, debugMode]);

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

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        expandNodeRef.current(node.id);
      });

      el.addEventListener("mouseenter", () => {
        if (s.chatHideTimer) clearTimeout(s.chatHideTimer);
        if (s.chatShowTimer) clearTimeout(s.chatShowTimer);
        s.chatShowTimer = setTimeout(() => showChat(node.id), 200);
      });

      el.addEventListener("mouseleave", () => {
        if (s.chatShowTimer) clearTimeout(s.chatShowTimer);
        s.chatHideTimer = setTimeout(hideChat, 150);
      });

      container.appendChild(el);
      node.el = el;
      updateNodePosition(node);
    },
    [showChat, hideChat, updateNodePosition]
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
      };

      if (depth > 0) {
        // Place on a global orbit circle centered at origin (0,0)
        const orbitRadius = BASE_RADIUS + (depth - 1) * RING_SPACING;
        node.x = Math.cos(angle) * orbitRadius;
        node.y = Math.sin(angle) * orbitRadius;
      }

      s.nodes.set(id, node);
      createNodeElement(node);
      return node;
    },
    [createNodeElement]
  );

  // Keep createNodeRef up to date
  createNodeRef.current = createNode;

  // Ref for expandNode so click handler can access it
  const expandNodeRef = useRef<(id: number) => void>(() => {});

  const expandNode = useCallback(
    async (id: number) => {
      const s = stateRef.current;
      const parent = s.nodes.get(id);
      if (!parent || parent.children.length > 0) {
        // Already expanded — highlight subtree instead
        if (parent && parent.children.length > 0) highlightSubtree(id);
        return;
      }

      const paperTitle = parent.paperTitle ?? parent.label;
      const paperUrl = parent.paperUrl ?? "";

      // Show loading state on the node
      if (parent.el) parent.el.style.opacity = "0.6";

      try {
        let papers: { title: string; url: string }[];
        if (debugMode) {
          await fakeDelay(400 + Math.random() * 600);
          papers = fakePapers(3 + Math.floor(Math.random() * 3));
        } else {
          papers = await expandSearch(paperUrl, paperTitle);
        }

        if (parent.el) parent.el.style.opacity = "1";
        if (papers.length === 0) return;

        const numChildren = papers.length;
        const isOrigin = parent.depth === 0;
        const parentAngle = Math.atan2(parent.y, parent.x);

        for (let i = 0; i < numChildren; i++) {
          let angle: number;
          if (isOrigin) {
            // Origin: distribute evenly around full circle
            angle = (i / numChildren) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
          } else {
            // Non-origin: narrow cone centered on parent's radial direction
            const coneSpread = Math.PI * 0.22; // ~40° total
            const t = numChildren === 1 ? 0.5 : i / (numChildren - 1);
            angle = parentAngle - coneSpread / 2 + t * coneSpread + (Math.random() - 0.5) * 0.08;
          }

          const child = createNodeRef.current(
            papers[i].title,
            parent.depth + 1,
            id,
            angle
          );
          child.paperTitle = papers[i].title;
          child.paperUrl = papers[i].url;

          child.el?.classList.add(styles.igniting);
          const el = child.el;
          if (el) setTimeout(() => el.classList.remove(styles.igniting), 600);

          parent.children.push(child.id);

          s.edgeAnims.push({
            fromId: id,
            toId: child.id,
            progress: 0,
            startTime: performance.now() + i * 80,
          });
        }
      } catch (err) {
        console.error("[constellation] expandSearch failed:", err);
        if (parent.el) parent.el.style.opacity = "1";
      }
    },
    [highlightSubtree, debugMode]
  );

  // Keep expandNodeRef up to date
  expandNodeRef.current = expandNode;

  // ─── Main effect: setup everything ───
  useEffect(() => {
    const s = stateRef.current;
    const starCanvas = starCanvasRef.current!;
    const edgeCanvas = edgeCanvasRef.current!;
    const starCtx = starCanvas.getContext("2d")!;
    const edgeCtx = edgeCanvas.getContext("2d")!;
    const chat = chatRef.current!;

    // ─── Star field ───
    function initStars() {
      s.stars = [];
      const count = Math.floor(
        (starCanvas.width * starCanvas.height) / 3000
      );
      for (let i = 0; i < count; i++) {
        s.stars.push({
          x: Math.random() * starCanvas.width,
          y: Math.random() * starCanvas.height,
          r: Math.random() * 1.4 + 0.3,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.8 + 0.3,
          baseAlpha: Math.random() * 0.5 + 0.15,
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

    // ─── Pan & Zoom ───
    function handleMouseDown(e: MouseEvent) {
      if (
        (e.target as HTMLElement).closest(`.${styles.starNode}`) ||
        (e.target as HTMLElement).closest(`.${styles.chatWindow}`) ||
        (e.target as HTMLElement).closest(`.${styles.sidebar}`) ||
        (e.target as HTMLElement).closest(`.${styles.sidebarToggle}`)
      )
        return;
      s.isDragging = true;
      s.dragStartX = e.clientX;
      s.dragStartY = e.clientY;
      s.panStartX = s.panX;
      s.panStartY = s.panY;
      document.body.style.cursor = "grabbing";
    }

    function handleMouseMove(e: MouseEvent) {
      if (!s.isDragging) return;
      s.panX = s.panStartX + (e.clientX - s.dragStartX);
      s.panY = s.panStartY + (e.clientY - s.dragStartY);
      updateAllPositions();
    }

    function handleMouseUp() {
      s.isDragging = false;
      document.body.style.cursor = "";
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const oldZoom = s.zoom;
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      s.zoom = Math.max(0.3, Math.min(3.0, s.zoom * delta));

      const mx = e.clientX - cx();
      const my = e.clientY - cy();
      s.panX = mx - (mx - s.panX) * (s.zoom / oldZoom);
      s.panY = my - (my - s.panY) * (s.zoom / oldZoom);

      updateAllPositions();
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("wheel", handleWheel, { passive: false });

    // ─── Chat hover ───
    function chatEnter() {
      if (s.chatHideTimer) clearTimeout(s.chatHideTimer);
    }
    function chatLeave() {
      s.chatHideTimer = setTimeout(hideChat, 150);
    }
    chat.addEventListener("mouseenter", chatEnter);
    chat.addEventListener("mouseleave", chatLeave);

    // ─── Render loop ───
    function drawStarField(time: number) {
      starCtx.clearRect(0, 0, starCanvas.width, starCanvas.height);
      for (const star of s.stars) {
        const alpha =
          star.baseAlpha +
          Math.sin(time * 0.001 * star.speed + star.phase) * 0.2;
        starCtx.beginPath();
        starCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        starCtx.fillStyle = `rgba(255,255,255,${Math.max(0.05, alpha)})`;
        starCtx.fill();
      }
    }

    function drawEdges(time: number) {
      edgeCtx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);

      // Established edges
      s.nodes.forEach((node) => {
        if (node.parentId === null) return;
        const parent = s.nodes.get(node.parentId);
        if (!parent) return;

        const anim = s.edgeAnims.find(
          (a) =>
            a.fromId === node.parentId &&
            a.toId === node.id &&
            a.progress < 1
        );
        if (anim) return;

        const from = toScreen(parent.x, parent.y);
        const to = toScreen(node.x, node.y);

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
        edgeCtx.lineTo(to.x, to.y);
        edgeCtx.strokeStyle = hl
          ? `rgba(255,216,102,${edgeAlpha})`
          : `rgba(255,255,255,${edgeAlpha})`;
        edgeCtx.lineWidth = hl ? 1.8 : 1;
        edgeCtx.stroke();
      });

      // Animating edges
      for (let i = s.edgeAnims.length - 1; i >= 0; i--) {
        const anim = s.edgeAnims[i];
        if (time < anim.startTime) continue;

        const elapsed = time - anim.startTime;
        anim.progress = Math.min(1, elapsed / 400);

        const from = s.nodes.get(anim.fromId);
        const to = s.nodes.get(anim.toId);
        if (!from || !to) {
          s.edgeAnims.splice(i, 1);
          continue;
        }

        const fs = toScreen(from.x, from.y);
        const ts = toScreen(to.x, to.y);
        const endX = fs.x + (ts.x - fs.x) * anim.progress;
        const endY = fs.y + (ts.y - fs.y) * anim.progress;

        edgeCtx.beginPath();
        edgeCtx.moveTo(fs.x, fs.y);
        edgeCtx.lineTo(endX, endY);
        edgeCtx.strokeStyle = `rgba(255,216,102,${0.4 + 0.3 * (1 - anim.progress)})`;
        edgeCtx.lineWidth = 1.5;
        edgeCtx.stroke();

        if (anim.progress >= 1) {
          s.edgeAnims.splice(i, 1);
        }
      }
    }

    function frame(time: number) {
      drawStarField(time);
      drawEdges(time);
      s.animFrameId = requestAnimationFrame(frame);
    }

    // ─── Create origin node & start ───
    const originLabel = searchParams.get("paperTitle") || searchParams.get("topic") || "Origin";
    const originNode = createNode(originLabel, 0, null, 0);
    const pTitle = searchParams.get("paperTitle");
    const pUrl = searchParams.get("paperUrl");
    if (pTitle) originNode.paperTitle = pTitle;
    if (pUrl) originNode.paperUrl = pUrl;
    s.animFrameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(s.animFrameId);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("wheel", handleWheel);
      chat.removeEventListener("mouseenter", chatEnter);
      chat.removeEventListener("mouseleave", chatLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* ─── Debug badge ─── */}
      {debugMode && <div className={styles.debugBadge}>Debug Mode</div>}

      {/* ─── Home button ─── */}
      <a
        href="/"
        className={styles.homeButton}
        title="Back to search"
        style={debugMode ? { right: 120 } : undefined}
      >
        &#8962;
      </a>

      {/* ─── Sidebar ─── */}
      <button
        className={styles.sidebarToggle}
        onClick={() => setSidebarOpen((o) => !o)}
        title="Toggle constellation list"
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarHeader}>Constellations</div>
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
                    &#9998;
                  </button>
                  <button
                    className={styles.sidebarAction}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id);
                    }}
                  >
                    &#128465;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <canvas ref={starCanvasRef} className={styles.starfield} />
      <canvas ref={edgeCanvasRef} className={styles.edges} />
      <div ref={nodesRef} className={styles.nodesContainer} />

      {/* ─── Chat ─── */}
      <div ref={chatRef} className={styles.chatWindow}>
        <div ref={chatHeaderRef} className={styles.chatHeader}>
          Node
        </div>
        <div ref={chatMessagesRef} className={styles.chatMessages} />
        <div className={styles.chatInputArea}>
          <input
            ref={chatInputRef}
            className={styles.chatInput}
            type="text"
            placeholder="Ask a follow-up question..."
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button className={styles.chatSend} onClick={sendMessage}>
            &#9654;
          </button>
        </div>
      </div>

      {/* ─── Onboarding hint ─── */}
      <div className={styles.onboardingHint}>
        Click a node to expand &middot; Hover for details &middot; Drag to pan &middot; Scroll to zoom
      </div>
    </>
  );
}

export default function ConstellationsPage() {
  return (
    <Suspense>
      <ConstellationsInner />
    </Suspense>
  );
}
