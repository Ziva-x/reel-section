(function () {
  "use strict";

  function initSection(sec) {
    if (!sec || sec._pvtDone) return;
    sec._pvtDone = true;

    var secId = sec.getAttribute("data-section-id") || sec.id;
    if (!window.sessionStorage.getItem("pvt_" + secId)) {
      fetch("/apps/reelsection", { method: "POST" }).catch(function () {});
      window.sessionStorage.setItem("pvt_" + secId, "1");
    }

    var track = sec.querySelector(".pvt2__track");
    var list = sec.querySelector(".pvt2__list");
    var arrowPrev = sec.querySelector(".pvt2__arrow--prev");
    var arrowNext = sec.querySelector(".pvt2__arrow--next");
    var dotsWrap = sec.querySelector(".pvt2__dots");
    var showMoreBtn = sec.querySelector(".pvt2__show-more");
    var showMoreWrap = sec.querySelector(".pvt2__show-more-wrap");
    var allCards = Array.prototype.slice.call(sec.querySelectorAll(".pvt2__card"));
    var videoWraps = Array.prototype.slice.call(sec.querySelectorAll("[data-video-container]"));

    var isAuto = sec.getAttribute("data-autoloop") === "true";
    var spdSec = parseFloat(sec.getAttribute("data-autoloop-speed")) || 4;
    var autoMs = Math.max(2, spdSec) * 1000;
    var timerId = null;
    var isHover = false;
    var isTouch = false;
    var resTimer = null;
    var isSectionInView = false;

    sec.querySelectorAll(".pvt2__poster").forEach(function (img) {
      var wrap = img.closest("[data-video-container]");
      if (wrap) {
        var skel = wrap.querySelector("[data-skeleton]");
        if (skel) {
          if (img.complete) { skel.classList.add("pvt2__skeleton--hidden"); }
          else {
            img.addEventListener("load", function () { skel.classList.add("pvt2__skeleton--hidden"); });
            img.addEventListener("error", function () { skel.classList.add("pvt2__skeleton--hidden"); });
          }
        }
      }
    });

    sec.querySelectorAll("[data-read-more]").forEach(function (btn) {
      var rev = btn.previousElementSibling;
      if (rev) {
        if (rev.scrollHeight <= rev.clientHeight + 4) {
          btn.style.display = "none";
        } else {
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            var exp = btn.getAttribute("aria-expanded") === "true";
            rev.setAttribute("data-clamped", exp ? "true" : "false");
            btn.setAttribute("aria-expanded", exp ? "false" : "true");
            btn.textContent = exp ? "Read more" : "Show less";
          });
        }
      }
    });

    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", function (e) {
        e.preventDefault();
        allCards.forEach(function (c) { c.classList.remove("pvt2__card--hidden"); });
        if (showMoreWrap) showMoreWrap.style.display = "none";
        updateNav();
        playAllVideos();
      });
    }

    function getCardStep() {
      var card = sec.querySelector(".pvt2__card:not(.pvt2__card--hidden)");
      if (!card || !list) return 296;
      var st = window.getComputedStyle(list);
      var gap = parseInt(st.gap || st.columnGap || "16", 10) || 16;
      return card.offsetWidth + gap;
    }

    function updateNav() {
      if (!track) return;
      var maxScroll = track.scrollWidth - track.clientWidth - 4;
      if (arrowPrev) arrowPrev.disabled = track.scrollLeft <= 4;
      if (arrowNext) arrowNext.disabled = track.scrollLeft >= maxScroll;

      var step = getCardStep();
      var curIdx = Math.round(track.scrollLeft / step);

      if (dotsWrap) {
        var dots = dotsWrap.querySelectorAll(".pvt2__dot");
        dots.forEach(function (d, i) {
          var act = i === curIdx;
          d.classList.toggle("is-active", act);
          d.setAttribute("aria-selected", act ? "true" : "false");
        });
      }
    }

    function playSingleVideo(wrap) {
      if (!wrap) return;
      var v = wrap.querySelector(".pvt2__video");
      if (!v) return;
      var p = v.play();
      var done = function () {
        wrap.classList.add("is-playing");
        var sk = wrap.querySelector("[data-skeleton]");
        if (sk) sk.classList.add("pvt2__skeleton--hidden");
      };
      if (p && typeof p.then === "function") { p.then(done).catch(function () {}); }
      else { done(); }
    }

    function pauseSingleVideo(wrap) {
      if (!wrap) return;
      var v = wrap.querySelector(".pvt2__video");
      if (!v) return;
      wrap.classList.remove("is-playing");
      v.pause();
    }

    function playAllVideos() {
      videoWraps.forEach(function (w) { playSingleVideo(w); });
    }

    function pauseAllVideos() {
      videoWraps.forEach(function (w) { pauseSingleVideo(w); });
    }

    videoWraps.forEach(function (wrap) {
      var playBtn = wrap.querySelector(".pvt2__play-btn");
      var soundBtn = wrap.querySelector("[data-sound-btn]");
      var v = wrap.querySelector(".pvt2__video");

      if (v) {
        v.addEventListener("click", function (e) {
          e.stopPropagation();
          if (wrap.classList.contains("is-playing")) { pauseSingleVideo(wrap); }
          else { playSingleVideo(wrap); }
        });
      }

      if (playBtn) {
        playBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (wrap.classList.contains("is-playing")) { pauseSingleVideo(wrap); }
          else { playSingleVideo(wrap); }
        });
      }

      if (soundBtn && v) {
        soundBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          var willUnmute = v.muted;
          if (willUnmute) {
            videoWraps.forEach(function (otherWrap) {
              if (otherWrap !== wrap) {
                var ov = otherWrap.querySelector(".pvt2__video");
                var os = otherWrap.querySelector("[data-sound-btn]");
                if (ov) ov.muted = true;
                if (os) {
                  os.classList.remove("is-unmuted");
                  os.setAttribute("aria-label", "Unmute video");
                }
              }
            });
          }
          v.muted = !willUnmute;
          soundBtn.classList.toggle("is-unmuted", willUnmute);
          soundBtn.setAttribute("aria-label", willUnmute ? "Mute video" : "Unmute video");
        });
      }

      var pill = wrap.querySelector(".pvt2__glass-pill");
      if (pill) {
        pill.addEventListener("click", function () {
          fetch("/apps/reelsection?action=click", { method: "POST" }).catch(function () {});
        });
      }
    });

    if (arrowPrev) {
      arrowPrev.addEventListener("click", function (e) {
        e.preventDefault();
        if (track) track.scrollBy({ left: -getCardStep(), behavior: "smooth" });
        pauseAutoloopBriefly();
      });
    }

    if (arrowNext) {
      arrowNext.addEventListener("click", function (e) {
        e.preventDefault();
        if (track) {
          var maxScroll = track.scrollWidth - track.clientWidth - 4;
          if (track.scrollLeft >= maxScroll) {
            track.scrollTo({ left: 0, behavior: "smooth" });
          } else {
            track.scrollBy({ left: getCardStep(), behavior: "smooth" });
          }
        }
        pauseAutoloopBriefly();
      });
    }

    if (dotsWrap) {
      dotsWrap.querySelectorAll(".pvt2__dot").forEach(function (d, idx) {
        d.addEventListener("click", function (e) {
          e.preventDefault();
          if (track) track.scrollTo({ left: idx * getCardStep(), behavior: "smooth" });
          pauseAutoloopBriefly();
        });
      });
    }

    if (track) {
      track.addEventListener("scroll", updateNav, { passive: true });
      window.addEventListener("resize", updateNav);
      updateNav();
    }

    function stepAuto() {
      if (!isAuto || !isSectionInView || isHover || isTouch || document.hidden || !track) return;
      var maxScroll = track.scrollWidth - track.clientWidth - 6;
      if (track.scrollLeft >= maxScroll) {
        track.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        track.scrollBy({ left: getCardStep(), behavior: "smooth" });
      }
    }

    function startAuto() {
      if (!isAuto || timerId) return;
      timerId = setInterval(stepAuto, autoMs);
    }

    function stopAuto() {
      if (timerId) { clearInterval(timerId); timerId = null; }
    }

    function pauseAutoloopBriefly() {
      if (!isAuto) return;
      stopAuto();
      clearTimeout(resTimer);
      resTimer = setTimeout(function () {
        if (isAuto && !isHover && !isTouch) startAuto();
      }, 4000);
    }

    if (isAuto) {
      startAuto();

      sec.addEventListener("mouseenter", function () { isHover = true; stopAuto(); });
      sec.addEventListener("mouseleave", function () { isHover = false; if (isAuto) startAuto(); });

      if (track) {
        track.addEventListener("touchstart", function () { isTouch = true; stopAuto(); }, { passive: true });
        track.addEventListener("touchend", function () { isTouch = false; pauseAutoloopBriefly(); }, { passive: true });
      }

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopAuto();
        else if (isAuto && !isHover && !isTouch) startAuto();
      });
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            isSectionInView = true;
            playAllVideos();
          } else {
            isSectionInView = false;
            pauseAllVideos();
          }
        });
      }, { threshold: 0.15 }).observe(sec);
    } else {
      isSectionInView = true;
      playAllVideos();
    }
  }

  function initAll() { document.querySelectorAll(".pvt2").forEach(initSection); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  document.addEventListener("shopify:section:load", function (e) {
    var s = e.target.querySelector(".pvt2") || e.target;
    if (s && s.classList && s.classList.contains("pvt2")) {
      s._pvtDone = false;
      initSection(s);
    }
  });
})();