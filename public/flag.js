function startFlag(root) {
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;

  const RED = [200, 16, 46];
  const GREEN = [0, 122, 61];
  const WHITE = [255, 255, 255];
  const BLACK = [14, 14, 14];

  function size() {
    const box = root.getBoundingClientRect();
    w = Math.max(48, box.width);
    h = Math.max(32, box.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  function project(x, y, z) {
    const f = Math.max(260, w * 1.55);
    const s = f / (f + z);
    return [x * s, y * s, s];
  }

  function mix(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    return [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k
    ];
  }

  function shade(rgb, light, spec) {
    const lit = mix([18, 14, 10], rgb, Math.max(0.38, Math.min(1.22, light)));
    const k = spec > 0 ? Math.min(1, spec) : 0;
    const r = lit[0] + (255 - lit[0]) * k;
    const g = lit[1] + (255 - lit[1]) * k;
    const b = lit[2] + (245 - lit[2]) * k;
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  function colorAt(u, v) {
    if (u < 0.25) return RED;
    if (v < 1 / 3) return GREEN;
    if (v < 2 / 3) return WHITE;
    return BLACK;
  }

  function draw(now) {
    const t = reduce ? 0.7 : now / 900;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const poleX = w * 0.16;
    const poleTop = h * 0.08;
    const poleH = h * 0.82;
    const poleW = Math.max(3.5, w * 0.022);

    ctx.fillStyle = "rgba(28, 22, 14, 0.16)";
    ctx.beginPath();
    ctx.ellipse(w * 0.54, h * 0.91, w * 0.32, h * 0.042, 0, 0, Math.PI * 2);
    ctx.fill();

    const clothW = w * 0.72;
    const clothH = clothW * 0.5;
    const ox = poleX + poleW * 0.35;
    const oy = poleTop + poleW * 1.35;
    const cols = w < 90 ? 18 : 36;
    const rows = w < 90 ? 10 : 20;
    const pts = [];

    for (let j = 0; j <= rows; j++) {
      pts[j] = [];
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const v = j / rows;
        const travel = u * 4.1 - t * 3.1;
        const flap = Math.sin(travel) * (10 + 28 * u * u);
        const ripple = Math.sin(v * 3.4 + t * 1.6 + u * 1.2) * (4 + 9 * u);
        const curl = Math.cos(travel * 0.55) * 6 * u;
        const x = ox + u * clothW;
        const y = oy + v * clothH + (flap + ripple) * 0.22;
        const z = 10 + u * 58 - flap * 1.05 + curl;
        const p = project(x - w * 0.1, y, z);
        pts[j][i] = [p[0] + w * 0.1, p[1], p[2], flap, u, v];
      }
    }

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = pts[j][i];
        const b = pts[j][i + 1];
        const c = pts[j + 1][i + 1];
        const d = pts[j + 1][i];
        const du = b[3] - a[3];
        const light = 0.82 + du * 0.028 + (a[2] - 0.78) * 0.9;
        const spec = Math.max(0, du * 0.045);
        ctx.fillStyle = shade(colorAt((i + 0.5) / cols, (j + 0.5) / rows), light, spec);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    const pg = ctx.createLinearGradient(poleX - poleW, 0, poleX + poleW, 0);
    pg.addColorStop(0, "#2c2c2c");
    pg.addColorStop(0.22, "#d8d8d8");
    pg.addColorStop(0.45, "#ffffff");
    pg.addColorStop(0.7, "#8f8f8f");
    pg.addColorStop(1, "#2a2a2a");
    ctx.fillStyle = pg;
    ctx.fillRect(poleX - poleW / 2, poleTop, poleW, poleH);

    const ballR = poleW * 1.45;
    const shine = ctx.createRadialGradient(
      poleX - ballR * 0.32,
      poleTop - ballR * 0.28,
      0.6,
      poleX,
      poleTop,
      ballR
    );
    shine.addColorStop(0, "#fff6d2");
    shine.addColorStop(0.35, "#e0c072");
    shine.addColorStop(0.75, "#b08a3a");
    shine.addColorStop(1, "#5c4310");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(poleX, poleTop, ballR, 0, Math.PI * 2);
    ctx.fill();

    if (!reduce) requestAnimationFrame(draw);
  }

  size();
  draw(0);
  window.addEventListener("resize", () => {
    size();
    if (reduce) draw(0);
  });
}
