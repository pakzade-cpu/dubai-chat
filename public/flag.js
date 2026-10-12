function startFlag(root) {
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;

  function size() {
    const box = root.getBoundingClientRect();
    w = Math.max(48, box.width);
    h = Math.max(32, box.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  function project(x, y, z) {
    const f = Math.max(220, w * 1.35);
    const s = f / (f + z);
    return [x * s, y * s, s];
  }

  function shade(rgb, light) {
    const k = Math.max(0.45, Math.min(1.35, light));
    return "rgb(" + (rgb[0] * k | 0) + "," + (rgb[1] * k | 0) + "," + (rgb[2] * k | 0) + ")";
  }

  function colorAt(u, v) {
    if (u < 0.26) return [239, 51, 64];
    if (v < 0.333) return [0, 151, 57];
    if (v < 0.666) return [255, 255, 255];
    return [17, 17, 17];
  }

  function draw(now) {
    const t = reduce ? 0.9 : now / 480;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const poleX = w * 0.18;
    const poleTop = h * 0.1;
    const poleH = h * 0.78;
    const poleW = Math.max(4, w * 0.028);

    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(w * 0.56, h * 0.9, w * 0.3, h * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();

    const clothW = w * 0.7;
    const clothH = h * 0.5;
    const ox = poleX + poleW * 0.2;
    const oy = poleTop + poleW * 1.6;
    const cols = w < 80 ? 12 : 20;
    const rows = w < 80 ? 7 : 12;
    const pts = [];

    for (let j = 0; j <= rows; j++) {
      pts[j] = [];
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const v = j / rows;
        const wave =
          Math.sin(u * 3.2 - t * 2.6) * (14 + 34 * u) +
          Math.sin(v * 2.4 + t * 1.8) * (7 + 12 * u);
        const x = ox + u * clothW;
        const y = oy + v * clothH + wave * 0.28;
        const z = 18 + u * 70 - wave * 1.15;
        const p = project(x - w * 0.08, y, z);
        pts[j][i] = [p[0] + w * 0.08, p[1], p[2], wave];
      }
    }

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = pts[j][i];
        const b = pts[j][i + 1];
        const c = pts[j + 1][i + 1];
        const d = pts[j + 1][i];
        const light = 0.78 + (b[3] - a[3]) * 0.035 + (a[2] - 0.72) * 0.8;
        ctx.fillStyle = shade(colorAt((i + 0.5) / cols, (j + 0.5) / rows), light);
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
    pg.addColorStop(0, "#4e4e4e");
    pg.addColorStop(0.35, "#f4f4f4");
    pg.addColorStop(0.7, "#9a9a9a");
    pg.addColorStop(1, "#3f3f3f");
    ctx.fillStyle = pg;
    ctx.fillRect(poleX - poleW / 2, poleTop, poleW, poleH);

    const ballR = poleW * 1.35;
    const shine = ctx.createRadialGradient(poleX - ballR * 0.3, poleTop - ballR * 0.2, 1, poleX, poleTop, ballR);
    shine.addColorStop(0, "#fff4c4");
    shine.addColorStop(0.45, "#c4a056");
    shine.addColorStop(1, "#6a4e12");
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
