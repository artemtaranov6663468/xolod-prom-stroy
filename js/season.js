(function () {
  const LAT = 41.3111;
  const LON = 69.2797;
  const STORE = "xps-fx";
  const COPY = {
    ru: {
      city: "Ташкент", hum: "Влажность", wind: "Ветер", unit: "м/с",
      on: "Эффекты", off: "Без эффектов",
      onLabel: "Выключить сезонные эффекты", offLabel: "Включить сезонные эффекты",
      status: "Погода в Ташкенте", fail: "Погода недоступна"
    },
    uz: {
      city: "Toshkent", hum: "Namlik", wind: "Shamol", unit: "m/s",
      on: "Effektlar", off: "Effektlarsiz",
      onLabel: "Mavsumiy effektlarni o‘chirish", offLabel: "Mavsumiy effektlarni yoqish",
      status: "Toshkent ob-havosi", fail: "Ob-havo ochilmadi"
    },
    en: {
      city: "Tashkent", hum: "Humidity", wind: "Wind", unit: "m/s",
      on: "Effects", off: "Effects off",
      onLabel: "Turn seasonal effects off", offLabel: "Turn seasonal effects on",
      status: "Weather in Tashkent", fail: "Weather unavailable"
    }
  };

  const header = document.querySelector("header.top");
  if (!header) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saved = localStorage.getItem(STORE);
  let effectsOn = saved ? saved === "on" : !reduced;
  let season = "winter";
  let newYear = false;
  let weather = "cloud";
  let particles = [];
  let running = false;
  let frame = 0;
  let lastWeather = null;
  let weatherReady = false;

  header.insertAdjacentHTML("afterbegin",
    '<div class="wx-bar"><div class="wrap wx-inner">' +
      '<div class="wx" role="status">' +
        '<span class="wx-ico" aria-hidden="true"></span>' +
        '<span class="wx-temp">—°</span>' +
        '<span class="wx-city"></span>' +
        '<span class="wx-meta"><span class="wx-hum"></span><span class="wx-wind"></span></span>' +
      '</div>' +
      '<button class="wx-toggle" id="wx-toggle" type="button"></button>' +
    "</div></div>" +
    '<div class="fx-garland" aria-hidden="true"></div>');

  const widget = header.querySelector(".wx");
  const iconBox = header.querySelector(".wx-ico");
  const tempEl = header.querySelector(".wx-temp");
  const cityEl = header.querySelector(".wx-city");
  const humEl = header.querySelector(".wx-hum");
  const windEl = header.querySelector(".wx-wind");
  const toggle = header.querySelector(".wx-toggle");
  const garland = header.querySelector(".fx-garland");
  for (let i = 0; i < 28; i += 1) garland.appendChild(document.createElement("i"));

  const canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  function lang() {
    const value = localStorage.getItem("xps-lang") || "ru";
    return COPY[value] ? value : "ru";
  }

  function t() {
    return COPY[lang()];
  }

  function paintCopy() {
    const copy = t();
    cityEl.textContent = copy.city;
    toggle.textContent = effectsOn ? copy.on : copy.off;
    toggle.setAttribute("aria-pressed", effectsOn ? "true" : "false");
    toggle.setAttribute("aria-label", effectsOn ? copy.onLabel : copy.offLabel);
    widget.setAttribute("aria-label", copy.status);
  }

  function icon(name) {
    const open = '<svg viewBox="0 0 24 24" fill="none" stroke="#1c8fd6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
    const cloud = '<path d="M7.2 17.2h9.4a3.7 3.7 0 0 0 .3-7.4 5 5 0 0 0-9.6 1.4 3.2 3.2 0 0 0-.1 6z" fill="#e7f4fc"/>';
    const shapes = {
      clear: '<circle cx="12" cy="12" r="3.4" fill="#e85d2a" stroke="none"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
      cloud: cloud,
      rain: cloud + '<path d="M8 19.2v1.6M12 19.2v1.6M16 19.2v1.6"/>',
      snow: cloud + '<path d="M8 19.4h.1M12 19.4h.1M16 19.4h.1" stroke-width="2.4"/>',
      storm: cloud + '<path d="M13 16.2l-2 2.4h2l-1.2 2.6" stroke="#e85d2a"/>',
      fog: '<path d="M4 9h16M3 13h18M5 17h14"/>'
    };
    iconBox.innerHTML = open + (shapes[name] || shapes.cloud) + "</svg>";
  }

  function tashkentDate() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const pick = (type) => Number(parts.find((part) => part.type === type).value);
    return { m: pick("month"), d: pick("day") };
  }

  function readCalendar() {
    const now = tashkentDate();
    newYear = (now.m === 12 && now.d >= 15) || (now.m === 1 && now.d <= 5);
    if (now.m === 12 || now.m <= 2) season = "winter";
    else if (now.m <= 5) season = "spring";
    else if (now.m <= 8) season = "summer";
    else season = "autumn";
  }

  function weatherKind(code, rainAmount, snowAmount) {
    if (snowAmount > 0 || [71, 73, 75, 77, 85, 86].indexOf(code) !== -1) return "snow";
    if ([95, 96, 99].indexOf(code) !== -1) return "storm";
    if (rainAmount > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].indexOf(code) !== -1) return "rain";
    if (code === 0 || code === 1) return "clear";
    if (code === 45 || code === 48) return "fog";
    return "cloud";
  }

  function viewSize() {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function spawn(kind, anywhere) {
    const size = viewSize();
    const item = {
      kind: kind,
      x: Math.random() * size.w,
      y: anywhere ? Math.random() * size.h : -20 - Math.random() * 80,
      r: 2,
      speed: 1,
      drift: (Math.random() - 0.5) * 0.6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.04,
      tone: Math.floor(Math.random() * 3)
    };
    if (kind === "snow") {
      item.r = 1.2 + Math.random() * 2.4;
      item.speed = 0.6 + Math.random() * 1.1;
    } else if (kind === "petal") {
      item.r = 4 + Math.random() * 4;
      item.speed = 0.7 + Math.random() * 0.9;
    } else if (kind === "leaf") {
      item.r = 5 + Math.random() * 5;
      item.speed = 0.8 + Math.random() * 1.2;
    } else if (kind === "rain") {
      item.r = 10 + Math.random() * 10;
      item.speed = 7 + Math.random() * 5;
      item.drift = -0.4;
    } else {
      item.r = 70 + Math.random() * 80;
      item.speed = 0.15 + Math.random() * 0.2;
      item.y = Math.random() * size.h * 0.55;
    }
    return item;
  }

  function budget() {
    const scale = window.matchMedia("(max-width: 760px)").matches ? 0.45 : 1;
    const count = { snow: 0, petal: 0, leaf: 0, rain: 0, sun: 0 };
    if (season === "winter" || newYear) count.snow = Math.round(48 * scale);
    if (season === "spring") count.petal = Math.round(24 * scale);
    if (season === "summer") count.sun = 4;
    if (season === "autumn") count.leaf = Math.round(22 * scale);
    if (weather === "snow") count.snow = Math.round(Math.max(count.snow, 24 * scale) * 1.8);
    if (weather === "rain" || weather === "storm") count.rain = Math.round((weather === "storm" ? 64 : 36) * scale);
    if (weather === "clear") count.sun = Math.max(count.sun, 3);
    if (newYear) count.snow = Math.round(count.snow * 1.2);
    return count;
  }

  function syncParticles() {
    const need = budget();
    const next = [];
    Object.keys(need).forEach((kind) => {
      const have = particles.filter((item) => item.kind === kind);
      while (have.length < need[kind]) have.push(spawn(kind, true));
      have.length = need[kind];
      next.push.apply(next, have);
    });
    particles = next;
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const size = viewSize();
    canvas.width = Math.floor(size.w * ratio);
    canvas.height = Math.floor(size.h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function stepParticle(item, size) {
    item.x += item.drift + Math.sin(item.y * 0.01 + item.rot) * (item.kind === "rain" ? 0 : 0.35);
    item.y += item.speed;
    item.rot += item.spin;
    const limit = item.kind === "sun" ? size.h * 0.7 : size.h + 20;
    if (item.y > limit || item.x < -30 || item.x > size.w + 30) {
      item.x = Math.random() * size.w;
      item.y = item.kind === "sun" ? Math.random() * size.h * 0.4 : -20;
    }
  }

  function drawParticle(item) {
    if (item.kind === "snow") {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (item.kind === "rain") {
      ctx.strokeStyle = "rgba(28,143,214,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(item.x, item.y);
      ctx.lineTo(item.x - 1, item.y + item.r);
      ctx.stroke();
      return;
    }
    if (item.kind === "sun") {
      const glow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.r);
      glow.addColorStop(0, "rgba(255, 206, 120, 0.16)");
      glow.addColorStop(1, "rgba(255, 206, 120, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rot);
    if (item.kind === "petal") {
      ctx.fillStyle = item.tone === 0 ? "rgba(255,255,255,0.8)" : "rgba(243,182,200,0.75)";
      ctx.beginPath();
      ctx.ellipse(0, 0, item.r, item.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const tones = ["#c4622d", "#d9892b", "#8c4a2f"];
      ctx.fillStyle = tones[item.tone];
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, item.r, item.r * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function frameTick() {
    if (!running) return;
    const size = viewSize();
    ctx.clearRect(0, 0, size.w, size.h);
    particles.forEach((item) => {
      stepParticle(item, size);
      drawParticle(item);
    });
    frame = requestAnimationFrame(frameTick);
  }

  function applyEffects() {
    garland.classList.toggle("on", effectsOn && newYear);
    canvas.style.display = effectsOn ? "block" : "none";
    if (!effectsOn) {
      running = false;
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, viewSize().w, viewSize().h);
      return;
    }
    syncParticles();
    if (!running) {
      running = true;
      frameTick();
    }
  }

  function showWeather(data) {
    const copy = t();
    if (!data) {
      tempEl.textContent = "—°";
      humEl.textContent = copy.fail;
      windEl.textContent = "";
      icon("cloud");
      return;
    }
    const current = data.current || {};
    const code = current.weather_code;
    weather = weatherKind(code, current.precipitation || 0, current.snowfall || 0);
    const iconName = weather === "storm" ? "storm" : weather === "rain" ? "rain" : weather === "snow" ? "snow" : weather === "fog" ? "fog" : weather === "clear" ? "clear" : "cloud";
    icon(iconName);
    tempEl.textContent = Math.round(current.temperature_2m) + "°";
    humEl.textContent = copy.hum + " " + Math.round(current.relative_humidity_2m) + "%";
    const speed = current.wind_speed_10m;
    windEl.textContent = copy.wind + " " + (Math.round(speed * 10) / 10) + " " + copy.unit;
    applyEffects();
  }

  function loadWeather() {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON +
      "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,snowfall" +
      "&wind_speed_unit=ms&timezone=Asia%2FTashkent";
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("weather");
        return response.json();
      })
      .then((data) => {
        weatherReady = true;
        lastWeather = data;
        showWeather(data);
      })
      .catch(() => {
        weatherReady = true;
        lastWeather = null;
        showWeather(null);
      });
  }

  toggle.addEventListener("click", () => {
    effectsOn = !effectsOn;
    localStorage.setItem(STORE, effectsOn ? "on" : "off");
    paintCopy();
    applyEffects();
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".langs button")) {
      paintCopy();
      if (weatherReady) showWeather(lastWeather);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
      return;
    }
    if (effectsOn) applyEffects();
  });

  window.addEventListener("resize", () => {
    resize();
    if (effectsOn) syncParticles();
  });

  paintCopy();
  icon("cloud");
  readCalendar();
  resize();
  applyEffects();
  loadWeather();
  setInterval(loadWeather, 30 * 60 * 1000);
})();
