import { useEffect, useMemo, useRef, useState } from "react";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.error("Image failed:", src);
      resolve(null);
    };
    img.src = src;
  });
}

function drawCover(ctx, img, cw, ch, opts) {
  const { offsetX = 0, offsetY = 0, posX = 0.5, posY = 0.5, overscan = 0 } = opts;

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  const scale = Math.max(cw / iw, ch / ih) * (1 + overscan);
  const dw = iw * scale;
  const dh = ih * scale;

  const baseX = (cw - dw) * posX;
  const baseY = (ch - dh) * posY;

  ctx.drawImage(img, baseX + offsetX, baseY + offsetY, dw, dh);
}

function drawSprite(ctx, img, cw, ch, opts) {
  const {
    x = 0.5,
    y = 0.5,
    ax = 0.5,
    ay = 0.5,
    w = 0.25,
    scale = 1,
    offsetX = 0,
    offsetY = 0,
  } = opts;

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  const dw = cw * w * scale;
  const dh = dw * (ih / iw);

  const px = cw * x - dw * ax + offsetX;
  const py = ch * y - dh * ay + offsetY;

  ctx.drawImage(img, px, py, dw, dh);
}

const DEFAULT_LAYERS = [
  { id: "bg", type: "cover", src: "/BackGround.jpg", parallaxX: 0.12, parallaxY: 0.06, posX: 0.5, posY: 0.5, overscan: 0.04, mobile: { posX: 0.1 } },

  { id: "sun", type: "sprite", src: "/Sun.png", parallaxX: 0.35, parallaxY: 0.22, x: 0.078, y: 0.16, ax: 0.42, ay: 0.47, w: 0.95, mobile: { x: 0.14, y: 0.2, w: 2.2 } },

  { id: "cloud", type: "sprite", src: "/Cloud.png", parallaxX: 0.25, parallaxY: 0.15, x: 0.7, y: 0.68, ax: 0.5, ay: 1.0, w: 0.85, mobile: { x: 1.2, y: 0.6, w: 2.5  },},

  { id: "sand", type: "sprite", src: "/Sand.png", parallaxX: 0.18, parallaxY: 0.06, x: 0.5, y: 1.0, ax: 0.5, ay: 1.0, w: 1.17, mobile: { w: 4.3, x: 1.8  },},
  
];

function resolveLayer(layer, flags) {
  let out = layer;
  if (flags.isMobile && layer.mobile) out = { ...out, ...layer.mobile };
  if (flags.isPortrait && layer.portrait) out = { ...out, ...layer.portrait };
  return out;
}

export default function ParallaxCanvas({
  className = "",
  style,

  strength = 36,
  smoothing = 0.12,
  invert = true,

  layers: layersProp,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  const imgsRef = useRef(new Map());

  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });

  const flagsRef = useRef({
    isMobile: false,
    isPortrait: false,
    reducedMotion: false,
  });

  const [uiIsMobile, setUiIsMobile] = useState(false);

  const layers = useMemo(() => layersProp ?? DEFAULT_LAYERS, [layersProp]);

  useEffect(() => {
    const mCoarse = window.matchMedia?.("(pointer: coarse)");
    const mSmall = window.matchMedia?.("(max-width: 768px)");
    const mPortrait = window.matchMedia?.("(orientation: portrait)");
    const mReduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const update = () => {
      const isMobile =
        (mCoarse?.matches ?? false) || (mSmall?.matches ?? false);

      const isPortrait = mPortrait?.matches ?? false;
      const reducedMotion = mReduce?.matches ?? false;

      flagsRef.current.isMobile = isMobile;
      flagsRef.current.isPortrait = isPortrait;
      flagsRef.current.reducedMotion = reducedMotion;

      setUiIsMobile(isMobile);
    };

    update();

    const subs = [mCoarse, mSmall, mPortrait, mReduce].filter(Boolean);
    for (const m of subs) m.addEventListener?.("change", update);
    return () => {
      for (const m of subs) m.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      const cw = Math.max(320, Math.floor(rect.width));
      const ch = Math.max(320, Math.floor(rect.height));

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";

      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;

      flagsRef.current.isPortrait = ch >= cw;
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const entries = await Promise.all(
        layers.map(async (l) => [l.id, await loadImage(l.src)])
      );
      if (!alive) return;
      imgsRef.current = new Map(entries);
    })();

    return () => {
      alive = false;
    };
  }, [layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const opt = { passive: false };

    const setFromEvent = (e) => {
      e.preventDefault();

      const r = canvas.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;

      targetRef.current.x = clamp((nx - 0.5) * 2, -1, 1);
      targetRef.current.y = clamp((ny - 0.5) * 2, -1, 1);
    };

    const onDown = (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      setFromEvent(e);
    };

    const onMove = (e) => setFromEvent(e);

    const onUp = () => {
      targetRef.current.x = 0;
      targetRef.current.y = 0;
    };

    canvas.addEventListener("pointerdown", onDown, opt);
    canvas.addEventListener("pointermove", onMove, opt);
    canvas.addEventListener("pointerup", onUp, opt);
    canvas.addEventListener("pointercancel", onUp, opt);
    canvas.addEventListener("pointerleave", onUp, opt);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);

      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;

      const flags = flagsRef.current;
      const mobileK = flags.isMobile ? 0.55 : 1;
      const strengthNow = strength * mobileK;

      const smoothingNow = flags.reducedMotion
        ? 0.22
        : (flags.isMobile ? Math.min(0.18, smoothing + 0.04) : smoothing);

      const t = targetRef.current;
      const c = currentRef.current;
      c.x += (t.x - c.x) * smoothingNow;
      c.y += (t.y - c.y) * smoothingNow;

      const dir = invert ? -1 : 1;
      const mx = c.x * strengthNow * dir;
      const my = c.y * strengthNow * dir;

      ctx.clearRect(0, 0, cw, ch);

      for (const baseLayer of layers) {
        const l = resolveLayer(baseLayer, flags);

        const img = imgsRef.current.get(l.id);
        if (!img) continue;

        const ox = mx * (l.parallaxX ?? 0.2);
        const oy = my * (l.parallaxY ?? 0.2);

        if (l.type === "cover") {
          drawCover(ctx, img, cw, ch, {
            offsetX: ox,
            offsetY: oy,
            posX: l.posX ?? 0.5,
            posY: l.posY ?? 0.5,
            overscan: l.overscan ?? 0.06,
          });
        } else {
          drawSprite(ctx, img, cw, ch, {
            offsetX: ox,
            offsetY: oy,
            x: l.x ?? 0.5,
            y: l.y ?? 0.5,
            ax: l.ax ?? 0.5,
            ay: l.ay ?? 0.5,
            w: l.w ?? 0.3,
            scale: l.scale ?? 1,
          });
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layers, strength, smoothing, invert]);

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: 18,
        touchAction: "none",
        cursor: uiIsMobile ? "auto" : "none",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none",
        }}
      />
    </div>
  );
}
