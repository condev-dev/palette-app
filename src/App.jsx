import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Download,
  X,
} from "lucide-react";

// --- color science helpers -------------------------------------------------

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function hexToRgbArr(hex) {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.substr(i, 2), 16));
}

// keeps ambient glow colors always visible on a dark canvas, without
// touching the real extracted hex shown on the swatch itself
function glowSafeHex(hex) {
  const rgb = hexToRgbArr(hex);
  let { h, s, l } = rgbToHsl(...rgb);
  l = Math.min(Math.max(l, 0.24), 0.6);
  s = Math.max(s, 0.4);
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

// picks a palette color safe to use as a UI accent (readable on dark bg)
function getAccentHex(palette, fallback) {
  for (const p of palette) {
    const { l } = rgbToHsl(...p.rgb);
    if (l > 0.22) return p.hex;
  }
  return fallback;
}

function distSq(a, b) {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function quantize(v, step) {
  return Math.round(v / step) * step;
}

// Groups pixels into coarse color buckets, then reports each bucket's
// MEDIAN pixel value (not the mean). Median resists being dragged off by a
// minority of stray pixels inside a region -- anti-aliased edges, drop
// shadows, or text sitting on top of a flat fill -- so a solid color block
// comes back as its true, exact HEX rather than a blended approximation.
//
// Selection is greedy by frequency, NOT by percentage share: on a busy image
// with 20+ real colors, every single one can have a small share (a couple
// percent each), so filtering by "share too low" would wipe out almost all
// of them and leave just the dominant background. Instead we walk buckets
// from most to least frequent and keep up to `maxColors` that are actually
// distinct from what's already picked -- only true single-pixel/edge noise
// gets skipped.
function extractPalette(pixels, maxColors = 6) {
  const buckets = new Map();
  for (const [r, g, b] of pixels) {
    const key = quantize(r, 12) + "," + quantize(g, 12) + "," + quantize(b, 12);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { rs: [], gs: [], bs: [] };
      buckets.set(key, bucket);
    }
    bucket.rs.push(r);
    bucket.gs.push(g);
    bucket.bs.push(b);
  }

  let entries = [...buckets.values()].map((b) => ({
    rgb: [median(b.rs), median(b.gs), median(b.bs)],
    count: b.rs.length,
  }));
  entries.sort((a, b) => b.count - a.count);

  const noiseFloor = Math.max(3, Math.round(pixels.length * 0.001)); // real noise only
  const merged = [];
  for (const e of entries) {
    if (e.count < noiseFloor) continue;
    const dup = merged.find((m) => Math.sqrt(distSq(m.rgb, e.rgb)) < 22);
    if (dup) {
      dup.count += e.count;
      continue;
    }
    if (merged.length < maxColors) merged.push({ rgb: e.rgb, count: e.count });
    // once we've picked maxColors distinct colors, keep scanning (without
    // adding new ones) just so any further near-duplicates still add to the
    // right color's share % instead of being silently dropped
  }
  return merged.sort((a, b) => b.count - a.count);
}

// --- PWA install prompt -----------------------------------------------------

function InstallModal({ onInstall, onClose, isIOS }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="install-modal glass rounded-3xl w-full max-w-sm p-6 relative"
        style={{ background: "rgba(20,20,24,0.92)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 left-4 w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={15} />
        </button>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "linear-gradient(135deg,#8B7CF6,#5B4FE0)" }}
        >
          <Sparkles size={24} color="#fff" />
        </div>
        <h3 className="text-white font-bold text-lg mb-1.5">اپ رو نصب کن</h3>
        <p className="text-white/50 text-sm leading-relaxed mb-5">
          {isIOS
            ? "از منوی Share گزینه ی «Add to Home Screen» رو بزن تا این ابزار مثل یه اپ روی گوشیت باشه، حتی آفلاین."
            : "این ابزار رو رو گوشی یا کامپیوترت نصب کن، بدون مرورگر و حتی آفلاین بازش کن."}
        </p>
        <div className="flex gap-2">
          {!isIOS && (
            <button
              onClick={onInstall}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl text-white"
              style={{ background: "linear-gradient(135deg,#8B7CF6,#5B4FE0)" }}
            >
              <Download size={15} /> نصب کن
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 text-sm py-2.5 rounded-xl text-white/60 border border-white/10"
          >
            {isIOS ? "متوجه شدم" : "شاید بعدا"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- component --------------------------------------------------------------

const DEFAULT_GLOW = ["#5B4FE0", "#1F8A70", "#0B0B0D"];
const DEFAULT_ACCENT = "#8B7CF6";

export default function App() {
  const [imgSrc, setImgSrc] = useState(null);
  const [palette, setPalette] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const [toastKey, setToastKey] = useState(0);
  const [showInstall, setShowInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const deferredPromptRef = useRef(null);

  // PWA: capture install prompt + register service worker.
  // Note: this in-memory "seen" state resets each session inside this preview.
  // In your real deployed app, swap it for a localStorage flag so the modal
  // only ever shows once per visitor.
  useEffect(() => {
    const iosDevice =
      typeof navigator !== "undefined" &&
      /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iosDevice);

    const handler = (e) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setTimeout(() => setShowInstall(true), 2200);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if (iosDevice) setTimeout(() => setShowInstall(true), 2200);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = () => {
    const evt = deferredPromptRef.current;
    if (evt) {
      evt.prompt();
      evt.userChoice.finally(() => setShowInstall(false));
    } else {
      setShowInstall(false);
    }
  };

  const showToast = (text) => {
    clearTimeout(toastTimerRef.current);
    setToast(text);
    setToastKey((k) => k + 1);
    toastTimerRef.current = setTimeout(() => setToast(null), 1700);
  };

  const process = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setExtracting(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setImgSrc(dataUrl);
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const size = 160;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const pixels = [];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 100) continue;
          pixels.push([data[i], data[i + 1], data[i + 2]]);
        }
        const clusters = extractPalette(pixels, 6);
        setPalette(
          clusters.map((c) => ({
            hex: rgbToHex(...c.rgb),
            rgb: c.rgb,
            share: c.count,
          })),
        );
        setExtracting(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleCopy = (text, idx) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx);
      showToast("کد رنگ کپی شد");
      setTimeout(() => setCopiedIdx(null), 1400);
    });
  };

  const reset = () => {
    setImgSrc(null);
    setPalette([]);
    setCopiedIdx(null);
  };

  const totalShare = palette.reduce((s, p) => s + p.share, 0) || 1;
  const glowColors = palette.length
    ? palette.slice(0, 3).map((p) => glowSafeHex(p.hex))
    : DEFAULT_GLOW;
  const heroColor = palette.length
    ? getAccentHex(palette, DEFAULT_ACCENT)
    : DEFAULT_ACCENT;

  return (
    <div
      dir="rtl"
      className="min-h-screen w-full relative overflow-hidden flex items-center justify-center px-4 py-10"
      style={{ background: "#0A0A0C", fontFamily: "'Vazirmatn', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;900&family=Space+Mono:wght@400;700&display=swap');
        .mono-font { font-family: 'Space Mono', monospace; direction: ltr; unicode-bidi: isolate; }
        .glass {
          background: rgba(255,255,255,0.045);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.09);
        }
        .blob {
          position: absolute;
          border-radius: 9999px;
          filter: blur(90px);
          transition: background 1.2s ease, opacity 1.2s ease;
          pointer-events: none;
        }
        .swatch {
          transition: transform .4s cubic-bezier(.16,1,.3,1), box-shadow .4s ease;
        }
        .swatch:hover { transform: translateY(-14px) scale(1.03); }
        .swatch-copy { opacity: 0; transition: opacity .25s ease; }
        .swatch:hover .swatch-copy { opacity: 1; }
        .fade-up { animation: fadeUp .6s cubic-bezier(.16,1,.3,1) both; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .toast-in { animation: toastIn .35s cubic-bezier(.16,1,.3,1) both; }
        @keyframes toastIn {
          from { opacity: 0; transform: translate(-50%, -16px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .install-modal { animation: fadeUp .35s cubic-bezier(.16,1,.3,1) both; }
        .dropzone { transition: border-color .3s ease, background .3s ease; }
        @media (prefers-reduced-motion: reduce) {
          .swatch, .fade-up, .blob, .toast-in, .install-modal { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* ambient background glow, tinted by extracted palette (contrast-safe) */}
      <div
        className="blob"
        style={{
          width: 520,
          height: 520,
          top: "-10%",
          right: "-8%",
          background: glowColors[0],
          opacity: 0.28,
        }}
      />
      <div
        className="blob"
        style={{
          width: 460,
          height: 460,
          bottom: "-14%",
          left: "-6%",
          background: glowColors[1] || glowColors[0],
          opacity: 0.22,
        }}
      />
      <div
        className="blob"
        style={{
          width: 380,
          height: 380,
          top: "40%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          background: glowColors[2] || glowColors[0],
          opacity: 0.14,
        }}
      />

      {/* copy toast */}
      {toast && (
        <div
          key={toastKey}
          className="toast-in fixed top-6 left-1/2 z-50 glass px-4 py-2.5 rounded-full flex items-center gap-2"
          style={{ background: "rgba(20,20,24,0.9)" }}
        >
          <Check size={14} color="#4ADE80" />
          <span className="text-white text-xs font-medium">{toast}</span>
        </div>
      )}

      {showInstall && (
        <InstallModal
          onInstall={handleInstall}
          onClose={() => setShowInstall(false)}
          isIOS={isIOS}
        />
      )}

      <div className="relative w-full max-w-3xl">
        {/* header */}
        <div className="text-center mb-10 fade-up">
          <div
            className="inline-flex items-center gap-2 mono-font text-[11px] tracking-widest uppercase px-3 py-1.5 rounded-full glass mb-5"
            style={{ color: heroColor }}
          >
            <Sparkles size={12} />
            <span>palette extractor</span>
          </div>
          <h1 className="text-[2.2rem] md:text-6xl font-black text-white leading-[1.12] tracking-tight mt-5">
            استخراج پالت <br />
          </h1>
          <h1 className="text-[2.2rem] md:text-6xl font-black text-white leading-[1.12] tracking-tight mt-5 pt-3">
            <span style={{ color: heroColor }}>رنگ های</span> از عکس ها
          </h1>
          <p className="text-white/45 mt-5 pt-5 text-sm md:text-base max-w-xs  mx-auto leading-relaxed">
            یه عکس بنداز، رنگ های اصلیش رو با کد HEX و RGB دقیق در چند ثانیه
            بگیر 😊
          </p>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* dropzone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            process(e.dataTransfer.files?.[0]);
          }}
          className="dropzone glass rounded-3xl cursor-pointer overflow-hidden relative fade-up"
          style={{
            height: imgSrc ? 260 : 220,
            borderColor: dragOver ? heroColor : undefined,
            borderStyle: dragOver ? "dashed" : undefined,
            borderWidth: dragOver ? 2 : undefined,
            animationDelay: "80ms",
          }}
        >
          {imgSrc ? (
            <>
              <img src={imgSrc} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                className="absolute top-4 right-4 flex items-center gap-1.5 text-xs text-white/80 bg-black/40 backdrop-blur px-3 py-1.5 rounded-full hover:bg-black/60 transition-colors"
              >
                <RotateCcw size={12} /> عکس جدید
              </button>
              {palette.length > 0 && (
                <p className="absolute bottom-4 left-4 text-xs text-white/70">
                  {palette.length} رنگ پیدا شد
                </p>
              )}
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <Upload size={24} color="rgba(255,255,255,0.6)" />
              </div>
              <div className="text-center mt-2">
                <p className="text-white/85 text-sm font-medium">
                  عکس رو بکش این جا یا کلیک کن
                </p>
                <p className="text-white/30 text-xs mt-3">JPG یا PNG</p>
              </div>
            </div>
          )}
          {extracting && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <p className="mono-font text-xs text-white animate-pulse">
                در حال تحلیل رنگ ها…
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => process(e.target.files?.[0])}
          />
        </div>

        {/* swatches */}
        {palette.length > 0 && (
          <div
            className="grid gap-3 mt-8"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
            }}
          >
            {palette.map((c, i) => {
              const lum = rgbToHsl(...c.rgb).l;
              const textColor = lum > 0.62 ? "#0A0A0C" : "#FFFFFF";
              const subColor =
                lum > 0.62 ? "rgba(10,10,12,0.6)" : "rgba(255,255,255,0.65)";
              const pct = Math.round((c.share / totalShare) * 100);
              return (
                <div
                  key={i}
                  onClick={() => handleCopy(c.hex, i)}
                  className="swatch fade-up rounded-2xl cursor-pointer flex flex-col justify-between p-3.5 relative"
                  style={{
                    background: c.hex,
                    color: textColor,
                    height: 152,
                    boxShadow: "0 20px 40px -20px rgba(0,0,0,0.5)",
                    animationDelay: `${120 + i * 60}ms`,
                  }}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className="mono-font text-[10px]"
                      style={{ color: subColor }}
                    >
                      {pct}%
                    </span>
                    <span className="swatch-copy">
                      {copiedIdx === i ? (
                        <Check size={13} />
                      ) : (
                        <Copy size={13} />
                      )}
                    </span>
                  </div>
                  <div>
                    <p className="mono-font text-[12px] font-bold leading-tight">
                      {c.hex}
                    </p>
                    <p
                      className="mono-font text-[10px] mt-1"
                      style={{ color: subColor }}
                    >
                      {c.rgb.join(", ")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {palette.length === 0 && (
          <p
            className="text-center text-white/25 text-xs mt-6 fade-up"
            style={{ animationDelay: "140ms" }}
          >
            نمونه رنگ ها بعد از آپلود این جا ظاهر می شن
          </p>
        )}
      </div>
    </div>
  );
}
