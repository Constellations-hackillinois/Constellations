"use client";

import { useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./constellations.module.css";

// ─── Word lists ───
const ADJECTIVES = [
  "Quantum", "Stellar", "Cosmic", "Neural", "Orbital", "Fractal", "Astral",
  "Photon", "Nebula", "Plasma", "Crystal", "Binary", "Radiant", "Spectral",
  "Primal", "Amber", "Lucid", "Mystic", "Silent", "Vivid",
];
const NOUNS = [
  "Drift", "Echo", "Pulse", "Forge", "Spire", "Bloom", "Nexus",
  "Shard", "Veil", "Gate", "Seed", "Wave", "Core", "Flux",
  "Loom", "Arc", "Dusk", "Glyph", "Haven", "Rift",
];
const AI_TEMPLATES = [
  "The {adj} {noun} resonates with hidden frequencies...",
  "Detecting patterns in the {adj} spectrum — {noun} signatures confirmed.",
  "This region shows traces of {adj} activity. The {noun} is unusually active.",
  "Fascinating. The {noun} here exhibits {adj} properties I haven't seen before.",
  "My sensors indicate a {adj} anomaly. Possibly related to the {noun} field.",
  "The data suggests a {adj} convergence near the {noun} threshold.",
  "Interesting question. The {adj} layer seems to interact with the {noun} matrix.",
  "Analysis complete: {adj} harmonics are amplifying the {noun} signal.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function generateLabel(): string {
  return pick(ADJECTIVES) + " " + pick(NOUNS);
}
function generateResponse(): string {
  return pick(AI_TEMPLATES)
    .replace("{adj}", pick(ADJECTIVES).toLowerCase())
    .replace("{noun}", pick(NOUNS).toLowerCase());
}

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

function ConstellationsInner() {
  const searchParams = useSearchParams();
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

  const sendMessage = useCallback(() => {
    const s = stateRef.current;
    const input = chatInputRef.current;
    const text = input?.value.trim();
    if (!text || s.chatNodeId === null) return;
    const node = s.nodes.get(s.chatNodeId);
    if (!node) return;

    node.messages.push({ role: "user", text });
    if (input) input.value = "";
    renderMessages(node);

    const currentChatNode = s.chatNodeId;
    setTimeout(() => {
      node.messages.push({ role: "ai", text: generateResponse() });
      if (s.chatNodeId === currentChatNode) {
        renderMessages(node);
      }
    }, 600 + Math.random() * 300);
  }, [renderMessages]);

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

      const label = document.createElement("div");
      label.className = styles.starLabel;
      label.textContent = node.label;
      el.appendChild(label);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const n = s.nodes.get(node.id);
        if (!n) return;
        if (n.children.length > 0) {
          highlightSubtree(node.id);
        } else {
          expandNode(node.id);
        }
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
    [highlightSubtree, showChat, hideChat, updateNodePosition]
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

      if (depth > 0 && parentId !== null) {
        const parent = s.nodes.get(parentId);
        if (parent) {
          const radius = BASE_RADIUS + (depth - 1) * RING_SPACING;
          node.x = parent.x + Math.cos(angle) * radius;
          node.y = parent.y + Math.sin(angle) * radius;
        }
      }

      s.nodes.set(id, node);
      createNodeElement(node);
      return node;
    },
    [createNodeElement]
  );

  // expandNode needs to be hoisted for the click handler closure
  // We use a ref to break the circular dependency
  const expandNodeRef = useRef<(id: number) => void>(() => { });

  const expandNode = useCallback(
    (id: number) => {
      const s = stateRef.current;
      const parent = s.nodes.get(id);
      if (!parent) return;

      const numChildren = 3 + Math.floor(Math.random() * 3);
      const toCenterAngle = Math.atan2(-parent.y, -parent.x);
      const arcSpread = Math.PI * 1.2;
      const awayAngle = toCenterAngle + Math.PI;
      const startAngle = awayAngle - arcSpread / 2;

      for (let i = 0; i < numChildren; i++) {
        const t = numChildren === 1 ? 0.5 : i / (numChildren - 1);
        const angle = startAngle + t * arcSpread + (Math.random() - 0.5) * 0.2;
        const child = createNode(
          generateLabel(),
          parent.depth + 1,
          id,
          angle
        );

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
    },
    [createNode]
  );

  // Keep the ref up to date
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
        (e.target as HTMLElement).closest(`.${styles.chatWindow}`)
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
      <canvas ref={starCanvasRef} className={styles.starfield} />
      <canvas ref={edgeCanvasRef} className={styles.edges} />
      <div ref={nodesRef} className={styles.nodesContainer} />
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
            placeholder="Ask something..."
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
