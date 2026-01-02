import { useEffect, useMemo, useRef, useState } from "react";

// ====== Настройки (можешь крутить без боли) ======
const SCALE = 2.5; // масштаб всего мира
const PLAYER_SIZE = 64 * SCALE; // на экране (не размер png)
const PLATFORM_W = 96 * SCALE;
const PLATFORM_H = 18 * SCALE;

const GRAVITY = 0.45;
const JUMP_VELOCITY = 14.5;
const MAX_X_SPEED = 7.2;

const PLATFORM_GAP_MIN = 90;
const PLATFORM_GAP_MAX = 200;
const BREAKABLE_CHANCE = 0.22;

const CAMERA_FOLLOW_Y = 0.42; 

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function makePlatform({ x, y, type }) {
  return {
    id: crypto.randomUUID(),
    x,
    y,
    w: PLATFORM_W,
    h: PLATFORM_H,
    type,
    broken: false,

    breakVy: 0,
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export default function App() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  const [state, setState] = useState("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => {
    const v = Number(localStorage.getItem("doodle_best") || 0);
    return Number.isFinite(v) ? v : 0;
  });

  const imagesRef = useRef({
    player: null,
    platform: null,
    platformBreak: null,
  });

  const worldRef = useRef({
    vw: 900,
    vh: 600,

    cameraY: 0,

    player: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      w: PLAYER_SIZE,
      h: PLAYER_SIZE,
      prevX: 0,
      prevY: 0,
    },

    platforms: [],

    pointerX: 0,

    maxHeight: 0,

    lastT: 0,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [player, platform, platformBreak] = await Promise.all([
        loadImage("/player.png"),
        loadImage("/platform.png"),
        loadImage("/platform_break.png"),
      ]);
      if (!alive) return;
      imagesRef.current = { player, platform, platformBreak };
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      const vw = Math.max(320, Math.floor(rect.width));
      const vh = Math.max(420, Math.floor(rect.height));

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.floor(vw * dpr);
      canvas.height = Math.floor(vh * dpr);
      canvas.style.width = vw + "px";
      canvas.style.height = vh + "px";

      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = worldRef.current;
      w.vw = vw;
      w.vh = vh;

      w.player.x = clamp(w.player.x, 0, vw - w.player.w);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const resetWorld = () => {
    const w = worldRef.current;
    const { vw, vh } = w;

    w.cameraY = 0;
    w.maxHeight = 0;
    w.lastT = 0;

    w.player.w = PLAYER_SIZE;
    w.player.h = PLAYER_SIZE;
    w.player.x = vw / 2 - w.player.w / 2;
    w.player.y = vh * 0.72;
    w.player.vx = 0;
    w.player.vy = 0;
    w.player.prevX = w.player.x;
    w.player.prevY = w.player.y;

    w.pointerX = vw / 2;

    const platforms = [];

    platforms.push(
      makePlatform({
        x: vw / 2 - PLATFORM_W / 2,
        y: vh * 0.82,
        type: "normal",
      })
    );

    let y = vh * 0.82 - rand(PLATFORM_GAP_MIN, PLATFORM_GAP_MAX);
    const topTarget = -2200;

    while (y > topTarget) {
      const type = Math.random() < BREAKABLE_CHANCE ? "break" : "normal";
      const x = rand(10, vw - PLATFORM_W - 10);
      platforms.push(makePlatform({ x, y, type }));
      y -= rand(PLATFORM_GAP_MIN, PLATFORM_GAP_MAX);
    }

    w.platforms = platforms;

    setScore(0);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      worldRef.current.pointerX = clamp(x, 0, worldRef.current.vw);
    };

    canvas.addEventListener("pointermove", onMove);
    return () => canvas.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const step = (t) => {
      rafRef.current = requestAnimationFrame(step);

      const w = worldRef.current;
      const { vw, vh } = w;

      if (!w.lastT) w.lastT = t;
      const dt = clamp((t - w.lastT) / 16.6667, 0.5, 1.8);
      w.lastT = t;

      if (state === "running") {
        updateWorld(w, dt);
      }

      render(ctx, w, state, score, best, imagesRef.current);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, score, best]);

  const updateWorld = (w, dt) => {
    const { vw, vh } = w;
    const p = w.player;

    p.prevX = p.x;
    p.prevY = p.y;

    const nx = (w.pointerX - vw / 2) / (vw / 2);
    const targetVx = clamp(nx, -1, 1) * MAX_X_SPEED;
    p.vx += (targetVx - p.vx) * (0.18 * dt);

    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < -p.w * 0.5) p.x = vw - p.w * 0.5;
    if (p.x > vw - p.w * 0.5) p.x = -p.w * 0.5;
    if (p.vy > 0) {
      for (const pl of w.platforms) {
        if (pl.broken) continue;

        const playerRect = { x: p.x, y: p.y, w: p.w, h: p.h };
        const platRect = { x: pl.x, y: pl.y, w: pl.w, h: pl.h };

        if (!aabbOverlap(playerRect.x, playerRect.y, playerRect.w, playerRect.h, platRect.x, platRect.y, platRect.w, platRect.h)) {
          continue;
        }

        const prevBottom = p.prevY + p.h;
        const currBottom = p.y + p.h;
        const platTop = pl.y;

        if (prevBottom <= platTop + 1 && currBottom >= platTop) {
          p.y = platTop - p.h;
          p.vy = -JUMP_VELOCITY;

          if (pl.type === "break") {
            pl.broken = true;
            pl.breakVy = 1.5;
          }
        }
      }
    }

    for (const pl of w.platforms) {
      if (!pl.broken) continue;
      pl.breakVy += 0.25 * dt;
      pl.y += pl.breakVy * dt;
    }

    const followLine = w.cameraY + vh * CAMERA_FOLLOW_Y;
    if (p.y < followLine) {
      w.cameraY = p.y - vh * CAMERA_FOLLOW_Y;
    }

    w.maxHeight = Math.max(w.maxHeight, -p.y);
    const s = Math.floor(w.maxHeight);
    setScore(s);

    ensurePlatformsAhead(w);

    w.platforms = w.platforms.filter((pl) => pl.y - w.cameraY < vh + 260);

    if (p.y - w.cameraY > vh + 140) {
      setState("gameover");
      setBest((prev) => {
        const nb = Math.max(prev, s);
        localStorage.setItem("doodle_best", String(nb));
        return nb;
      });
    }
  };

  const ensurePlatformsAhead = (w) => {
    const { vw, cameraY } = w;

    let minY = Infinity;
    for (const pl of w.platforms) minY = Math.min(minY, pl.y);

    const topNeed = cameraY - 2000;

    while (minY > topNeed) {
      const gap = rand(PLATFORM_GAP_MIN, PLATFORM_GAP_MAX);
      const y = minY - gap;
      const type = Math.random() < BREAKABLE_CHANCE ? "break" : "normal";
      const x = rand(10, vw - PLATFORM_W - 10);

      w.platforms.push(makePlatform({ x, y, type }));
      minY = y;
    }
  };

  const render = (ctx, w, gameState, currentScore, bestScore, imgs) => {
    const { vw, vh } = w;
    const p = w.player;

    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, vw, vh);

    ctx.globalAlpha = 0.07;
    ctx.fillStyle = "#ffffff";
    for (let x = 0; x < vw; x += 40) ctx.fillRect(x, 0, 1, vh);
    for (let y = 0; y < vh; y += 40) ctx.fillRect(0, y, vw, 1);
    ctx.globalAlpha = 1;

    for (const pl of w.platforms) {
      const sx = pl.x;
      const sy = pl.y - w.cameraY;

      if (sy < -60 || sy > vh + 60) continue;

      if (pl.broken) ctx.globalAlpha = 0.35;

      const img = pl.type === "break" ? imgs.platformBreak : imgs.platform;

      if (img) {
        ctx.drawImage(img, sx, sy, pl.w, pl.h);
      } else {
        ctx.fillStyle = pl.type === "break" ? "#ffb020" : "#42d67e";
        ctx.fillRect(sx, sy, pl.w, pl.h);
      }

      ctx.globalAlpha = 1;
    }

    const psx = p.x;
    const psy = p.y - w.cameraY;
    if (imgs.player) {
      ctx.drawImage(imgs.player, psx, psy, p.w, p.h);
    } else {
      ctx.fillStyle = "#74a7ff";
      ctx.fillRect(psx, psy, p.w, p.h);
    }

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(`Score: ${currentScore}`, 16, 28);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText(`Best: ${bestScore}`, 16, 52);

    if (gameState === "idle") {
      drawCenterText(ctx, vw, vh, "Нажми START — и он сразу прыгнет вверх", "Двигай мышь влево/вправо для управления");
    }

    if (gameState === "gameover") {
      drawCenterText(ctx, vw, vh, "GAME OVER", "Нажми RESTART, чтобы начать заново");
    }
  };

  const drawCenterText = (ctx, vw, vh, title, subtitle) => {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(vw * 0.12, vh * 0.32, vw * 0.76, vh * 0.28);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(title, vw / 2, vh * 0.45);

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(subtitle, vw / 2, vh * 0.52);

    ctx.textAlign = "left";
  };

  const onStart = () => {
    resetWorld();
    worldRef.current.player.vy = -JUMP_VELOCITY;
    setState("running");
  };

  const onRestart = () => {
    onStart();
  };

  const buttonText = useMemo(() => {
    if (state === "running") return "RUNNING";
    if (state === "gameover") return "RESTART";
    return "START";
  }, [state]);

  const onButton = () => {
    if (state === "running") return;
    if (state === "gameover") return onRestart();
    return onStart();
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "#070b16",
        color: "white",
      }}
    >
      <header
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <button
          onClick={onButton}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.16)",
            background: state === "running" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
            color: "white",
            cursor: state === "running" ? "not-allowed" : "pointer",
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
          disabled={state === "running"}
        >
          {buttonText}
        </button>

        <div style={{ opacity: 0.8, fontSize: 14 }}>
          Управление: двигай мышь влево/вправо. Прыжок — автоматом при приземлении.
        </div>
      </header>

      <main style={{ padding: 12 }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 20px 70px rgba(0,0,0,0.45)",
          }}
        >
          <canvas ref={canvasRef} />
        </div>
      </main>
    </div>
  );
}