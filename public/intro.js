function startArasIntro() {
  const root = document.getElementById("intro");
  const video = root && root.querySelector("video");
  const skip = document.getElementById("intro-skip");
  const key = "aras-lab-intro";

  function hide() {
    if (video) {
      video.pause();
      video.removeAttribute("autoplay");
    }
    if (root) {
      root.hidden = true;
      root.style.display = "none";
    }
    document.body.classList.remove("intro-on");
  }

  function done() {
    if (done.called) return;
    done.called = true;
    try {
      sessionStorage.setItem(key, "1");
    } catch {}
    hide();
  }

  let seen = false;
  try {
    seen = sessionStorage.getItem(key) === "1";
  } catch {}
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!root || seen || reduce) {
    hide();
    return;
  }

  document.body.classList.add("intro-on");
  if (skip) skip.onclick = done;
  if (!video) {
    done();
    return;
  }
  video.loop = false;
  video.addEventListener("ended", done);
  video.addEventListener("error", done);
  const play = video.play();
  if (play && typeof play.catch === "function") play.catch(done);
  window.setTimeout(done, 14000);
}
