// Dashboard redesign mockup — tiny interactivity only. No app code touched.
(function () {
  const body = document.body;

  // Accent switcher
  document.querySelectorAll("[data-accent-choice]").forEach((sw) => {
    sw.addEventListener("click", () => {
      const accent = sw.getAttribute("data-accent-choice");
      body.setAttribute("data-accent", accent);
      document.querySelectorAll("[data-accent-choice]").forEach((s) => s.classList.remove("is-active"));
      sw.classList.add("is-active");
    });
  });

  // View switch (Calendar / Customers) via rail nav
  document.querySelectorAll("[data-view-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view-target");
      body.setAttribute("data-view", view);
      document.querySelectorAll(".rail__item").forEach((i) => i.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
  });

  // Open appointment drawer
  document.querySelectorAll("[data-open-drawer]").forEach((ev) => {
    ev.addEventListener("click", () => body.classList.add("drawer-open"));
  });
  document.querySelectorAll("[data-close-drawer]").forEach((el) => {
    el.addEventListener("click", () => body.classList.remove("drawer-open"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") body.classList.remove("drawer-open");
  });

  // Customer list selection
  document.querySelectorAll(".cust-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".cust-item").forEach((i) => i.classList.remove("is-active"));
      item.classList.add("is-active");
    });
  });

  // Collapse / expand secondary sidebar
  document.querySelectorAll("[data-toggle-sidebar]").forEach((btn) => {
    btn.addEventListener("click", () => body.classList.toggle("side-collapsed"));
  });

  // Full-screen calendar: hide/show the whole menu sidebar
  document.querySelectorAll("[data-toggle-nav]").forEach((btn) => {
    btn.addEventListener("click", () => body.classList.toggle("nav-hidden"));
  });

  // Day / Week / Month calendar view switch
  document.querySelectorAll("[data-cal-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-cal-view");
      document.querySelectorAll("[data-cal-view]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      body.setAttribute("data-cal", v === "day" ? "day" : "week");
    });
  });

  // Slot granularity: grid density follows tenant setting (15 / 30 min)
  document.querySelectorAll("[data-grain-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-grain-btn]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      body.setAttribute("data-grain", btn.getAttribute("data-grain-btn"));
    });
  });

  // Consolidated location/provider context dropdown
  const ctx = document.querySelector(".context");
  if (ctx) {
    const toggle = ctx.querySelector("[data-context-toggle]");
    const menu = ctx.querySelector(".context-menu");
    const label = ctx.querySelector(".context__label");
    const locGroup = ctx.querySelector(".context-menu__group--loc");
    const provOpts = Array.from(ctx.querySelectorAll("[data-context-prov]"));
    const chipImg = ctx.querySelector(".context__pfp");
    const chipAll = ctx.querySelector(".context__pfp-all");
    let loc = "Downtown";
    let prov = "Alina R.";
    let singleLocation = false;

    const update = () => {
      label.textContent = singleLocation ? prov : `${loc} · ${prov}`;
      const sel = provOpts.find((o) => o.classList.contains("is-selected"));
      const photo = sel ? sel.getAttribute("data-pfp") : "";
      if (chipImg && chipAll) {
        if (photo) { chipImg.src = photo; chipImg.hidden = false; chipAll.hidden = true; }
        else { chipImg.hidden = true; chipAll.hidden = false; }
      }
    };

    // Show only providers who work at the selected location; reset if unavailable
    const filterProviders = () => {
      let selectedStillVisible = false;
      provOpts.forEach((opt) => {
        const locs = (opt.getAttribute("data-locs") || "").split(",");
        const visible = locs.includes(loc);
        opt.hidden = !visible;
        if (visible && opt.classList.contains("is-selected")) selectedStillVisible = true;
      });
      if (!selectedStillVisible) {
        provOpts.forEach((o) => o.classList.remove("is-selected"));
        const all = provOpts.find((o) => o.getAttribute("data-context-prov") === "All providers");
        if (all) all.classList.add("is-selected");
        prov = "All providers";
      }
    };

    // Single-location tenants don't need a location selector
    const applyLocationMode = () => {
      if (locGroup) locGroup.hidden = singleLocation;
      if (singleLocation) {
        provOpts.forEach((o) => (o.hidden = false)); // all providers at the one location
      } else {
        filterProviders();
      }
      update();
    };

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!ctx.contains(e.target)) menu.hidden = true;
    });
    ctx.querySelectorAll("[data-context-loc]").forEach((opt) => {
      opt.addEventListener("click", () => {
        ctx.querySelectorAll("[data-context-loc]").forEach((o) => o.classList.remove("is-selected"));
        opt.classList.add("is-selected");
        loc = opt.getAttribute("data-context-loc");
        filterProviders();
        update();
      });
    });
    provOpts.forEach((opt) => {
      opt.addEventListener("click", () => {
        provOpts.forEach((o) => o.classList.remove("is-selected"));
        opt.classList.add("is-selected");
        prov = opt.getAttribute("data-context-prov");
        update();
      });
    });

    // Mockup toggle: simulate 1 vs multiple locations
    document.querySelectorAll("[data-loc-count]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("[data-loc-count]").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        singleLocation = b.getAttribute("data-loc-count") === "1";
        applyLocationMode();
      });
    });

    applyLocationMode(); // initial
  }

  // Filter-bar chips (variant B)
  document.querySelectorAll(".toggle-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("is-on");
      chip.classList.toggle("is-off");
    });
  });

  // Sidebar nav-menu active state
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("is-active"));
      link.classList.add("is-active");
    });
  });
})();
