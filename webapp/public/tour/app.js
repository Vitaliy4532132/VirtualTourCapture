(function () {
"use strict";

var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ================= Состояние ================= */
var app = document.getElementById("app");
var canvas = document.getElementById("pano");
var gl = null, prog = null, uni = {}, hasGL = false;
var W = 0, H = 0, aspect = 1, dpr = Math.min(window.devicePixelRatio || 1, 2);

var tourBase = "tours/demo";
var STATIONS = [];   // {id, index, roomLabel, x, y, z, path}
var EDGES = [];      // [[i,j], ...] по индексам в STATIONS
var stationAssets = new Map(); // station.id -> {img, url, tex}
var activeAsset = null;
var currentIdx = 0;
var transing = false;

var yaw = 0.6, pitch = 0, fovDeg = 76;
var MIN_FOV = 42, MAX_FOV = 95, BASE_FOV = 76;
var fadeVal = 0;

/* ================= Утилиты ================= */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function formatPrice(amount, currency) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency || "RUB", maximumFractionDigits: 0 }).format(amount);
  } catch (e) {
    return new Intl.NumberFormat("ru-RU").format(amount) + " " + (currency || "");
  }
}
function stationWord(n) {
  var m = n % 10, m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return "станций";
  if (m === 1) return "станция";
  if (m >= 2 && m <= 4) return "станции";
  return "станций";
}
function roomWord(n) {
  var m = n % 10, m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return "комнат";
  if (m === 1) return "комната";
  if (m >= 2 && m <= 4) return "комнаты";
  return "комнат";
}
async function fetchJSON(url) {
  var res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status + " для " + url);
  return res.json();
}
function loadViaScriptTag(url, globalName) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = url;
    s.onload = function () {
      var data = window[globalName];
      delete window[globalName];
      s.remove();
      if (data) resolve(data); else reject(new Error("Нет данных в " + url));
    };
    s.onerror = function () { s.remove(); reject(new Error("Не удалось загрузить " + url)); };
    document.head.appendChild(s);
  });
}
/*
 * При открытии страницы напрямую как файла (file://) браузер блокирует
 * fetch() локальных JSON — это ограничение безопасности, не баг сервера.
 * В этом случае используем запасной .js-дубликат тех же данных: обычный
 * <script src> браузер грузить с file:// разрешает. На настоящем
 * хостинге (http/https) до этого не доходит — там fetch() отрабатывает
 * с первой попытки.
 */
async function loadJSONFlexible(jsonUrl, jsUrl, globalName) {
  try {
    return await fetchJSON(jsonUrl);
  } catch (e) {
    return await loadViaScriptTag(jsUrl, globalName);
  }
}
function loadImage(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("Не удалось декодировать изображение")); };
    img.src = url;
  });
}
async function fetchWithProgress(url, onProgress) {
  var res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " для " + url);
  var totalHeader = res.headers.get("Content-Length");
  var total = totalHeader ? parseInt(totalHeader, 10) : 0;
  if (!res.body || !total) {
    onProgress(-1);
    var blob0 = await res.blob();
    onProgress(1);
    return URL.createObjectURL(blob0);
  }
  var reader = res.body.getReader();
  var received = 0, chunks = [];
  for (;;) {
    var r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    received += r.value.length;
    onProgress(received / total);
  }
  return URL.createObjectURL(new Blob(chunks));
}
function animate(dur, onUpdate) {
  return new Promise(function (resolve) {
    if (reduceMotion || dur <= 0) { onUpdate(1); resolve(); return; }
    var t0 = performance.now();
    function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      onUpdate(k);
      if (k < 1) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
}

/* ================= Ошибка / тост ================= */
function showError(msg) {
  document.getElementById("errMsg").textContent = msg;
  document.getElementById("errBox").hidden = false;
  document.getElementById("loader").classList.add("done");
}
var toastEl = document.getElementById("toast"), toastT = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 1900);
}

/* ================= Загрузчик (прогресс) ================= */
var ldFillEl = document.getElementById("ldFill");
var ldBarEl = ldFillEl.parentElement;
var ldPctEl = document.getElementById("ldPct");
function updateLoaderProgress(p) {
  if (p < 0) {
    ldBarEl.classList.add("indeterminate");
    ldPctEl.textContent = "";
    return;
  }
  ldBarEl.classList.remove("indeterminate");
  var pct = Math.round(p * 100);
  ldFillEl.style.width = pct + "%";
  ldPctEl.textContent = pct + "%";
}

/* ================= WebGL: эквиректангулярный рендер ================= */
function setupGL() {
  gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return false;
  var vs = "attribute vec2 aPos;varying vec2 vN;void main(){vN=aPos;gl_Position=vec4(aPos,0.,1.);}";
  var fs = "precision highp float;varying vec2 vN;uniform sampler2D uT;uniform float uYaw,uPitch,uFov,uAsp,uFade;" +
    "void main(){float t=tan(uFov*.5);" +
    "vec3 c=normalize(vec3(vN.x*t*uAsp,vN.y*t,-1.));" +
    "float cp=cos(uPitch),sp=sin(uPitch);" +
    "vec3 p=vec3(c.x,cp*c.y-sp*c.z,sp*c.y+cp*c.z);" +
    "float cy=cos(uYaw),sy=sin(uYaw);" +
    "vec3 w=vec3(cy*p.x+sy*p.z,p.y,-sy*p.x+cy*p.z);" +
    "float lon=atan(w.x,-w.z);float lat=asin(clamp(w.y,-1.,1.));" +
    "vec2 uv=vec2(lon*.15915494+.5,.5-lat*.31830988);" +
    "vec4 col=texture2D(uT,uv);" +
    "float d=length(vN*vec2(uAsp,1.))/max(uAsp,1.);" +
    "col.rgb*=1.-.28*smoothstep(.55,1.4,d);" +
    "col.rgb*=(1.-uFade);" +
    "gl_FragColor=col;}";
  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  ["uYaw", "uPitch", "uFov", "uAsp", "uFade"].forEach(function (n) { uni[n] = gl.getUniformLocation(prog, n); });
  return true;
}
function createTexture(img) {
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  /*
   * WebGL1 требует CLAMP_TO_EDGE по ОБЕИМ осям для текстур, чьи размеры не
   * являются степенью двойки (наши панорамы из реальных фото — например
   * 2560x1280 — как раз такие). При REPEAT такая текстура считается
   * "неполной" и рендерится сплошным чёрным, без единой ошибки в консоли.
   * Видимого шва на стыке 360° это не даёт: lon/lat в шейдере уже сами
   * заворачивают координату через atan2, за пределы [0,1] она не выходит.
   */
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}
function draw() {
  if (!hasGL || !prog || !activeAsset || !activeAsset.tex) return;
  gl.bindTexture(gl.TEXTURE_2D, activeAsset.tex);
  gl.uniform1f(uni.uYaw, yaw);
  gl.uniform1f(uni.uPitch, pitch);
  gl.uniform1f(uni.uFov, fovDeg * Math.PI / 180);
  gl.uniform1f(uni.uAsp, aspect);
  gl.uniform1f(uni.uFade, fadeVal);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function resize() {
  W = canvas.clientWidth; H = canvas.clientHeight; aspect = W / H;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  if (hasGL) gl.viewport(0, 0, canvas.width, canvas.height);
}
addEventListener("resize", resize);

/* ================= Ассеты станций (загрузка панорам) ================= */
async function ensureStationAsset(st, onProgress, fileOverride) {
  var cached = stationAssets.get(st.id);
  if (cached && !fileOverride) return cached;
  var img, resolvedUrl;
  if (fileOverride) {
    resolvedUrl = URL.createObjectURL(fileOverride);
    img = await loadImage(resolvedUrl);
  } else {
    var url = tourBase + "/" + st.path + "/panorama.jpg";
    try {
      var blobUrl = await fetchWithProgress(url, onProgress || function () {});
      img = await loadImage(blobUrl);
      resolvedUrl = blobUrl;
    } catch (e) {
      // fetch() недоступен (обычно file://) — грузим напрямую через <img>,
      // без побайтового прогресса.
      if (onProgress) onProgress(-1);
      img = await loadImage(url);
      resolvedUrl = url;
      if (onProgress) onProgress(1);
    }
  }
  var tex = null;
  if (hasGL) {
    try {
      tex = createTexture(img);
    } catch (texErr) {
      /*
       * Chrome помечает <img>, загруженную напрямую с file://, как
       * "cross-origin" для WebGL — texImage2D отказывается её читать,
       * даже если страница и картинка лежат в одной папке. Это не
       * обходится в коде; единственный легальный путь — File API
       * (пользователь выбирает тот же файл вручную через системный
       * диалог), тогда браузер выдаёт полный доступ.
       */
      var err = new Error("TAINTED_IMAGE");
      throw err;
    }
  }
  var asset = { img: img, url: resolvedUrl, tex: tex };
  stationAssets.set(st.id, asset);
  return asset;
}

/* ================= Запасной путь: ручной выбор файла станции ================= */
var taintBox = document.getElementById("taintBox");
var filePicker = document.getElementById("filePicker");
var pendingTaintStation = null, pendingTaintResolve = null, pendingTaintReject = null;
document.getElementById("taintPickBtn").addEventListener("click", function () { filePicker.click(); });
filePicker.addEventListener("change", async function () {
  var file = filePicker.files[0];
  filePicker.value = "";
  taintBox.hidden = true;
  var st = pendingTaintStation, resolve = pendingTaintResolve, reject = pendingTaintReject;
  pendingTaintStation = null; pendingTaintResolve = null; pendingTaintReject = null;
  if (!file || !st) { if (reject) reject(new Error("Файл не выбран")); return; }
  try {
    var asset = await ensureStationAsset(st, null, file);
    if (resolve) resolve(asset);
  } catch (e) {
    if (reject) reject(e);
  }
});
async function loadStationOrPrompt(st, onProgress) {
  try {
    return await ensureStationAsset(st, onProgress);
  } catch (e) {
    if (e.message === "TAINTED_IMAGE") {
      document.getElementById("loader").classList.add("done");
      return await new Promise(function (resolve, reject) {
        pendingTaintStation = st; pendingTaintResolve = resolve; pendingTaintReject = reject;
        taintBox.hidden = false;
      });
    }
    throw e;
  }
}
function applyThumbIfCached(idx) {
  var st = STATIONS[idx];
  var asset = stationAssets.get(st.id);
  if (!asset) return;
  var el = document.querySelector('.thumb[data-idx="' + idx + '"]');
  if (el) el.style.backgroundImage = "url(" + asset.url + ")";
}

/* ================= Геометрия: bearing / project ================= */
function bearing(from, to) { return Math.atan2(to.x - from.x, -(to.z - from.z)); }
function dist(a, b) { var dx = b.x - a.x, dz = b.z - a.z; return Math.sqrt(dx * dx + dz * dz); }
function project(d) {
  var cy = Math.cos(yaw), sy = Math.sin(yaw);
  var x1 = cy * d.x - sy * d.z, z1 = sy * d.x + cy * d.z, y1 = d.y;
  var cp = Math.cos(pitch), sp = Math.sin(pitch);
  var y2 = cp * y1 + sp * z1, z2 = -sp * y1 + cp * z1, x2 = x1;
  if (z2 > -0.06) return null;
  var t = Math.tan(fovDeg * Math.PI / 360);
  var nx = (x2 / -z2) / (t * aspect), ny = (y2 / -z2) / t;
  if (nx < -1.35 || nx > 1.35) return null;
  return { x: (nx * .5 + .5) * W, y: (.5 - ny * .5) * H };
}
/*
 * Соседи станции = геометрический fallback (ближайшие K) ОБЪЕДИНЁННЫЙ с
 * явно расставленными дверями. Раньше двери влияли только на то, КАК
 * рисуется стрелка, а не на то, показывается ли она вообще — если станция
 * не попадала в geometric top-K (например, слишком много близких соседей),
 * дверь на неё молча не отображалась, хотя данные были верными. Теперь
 * явная дверь всегда побеждает, независимо от geometric K.
 */
/*
 * Если у станции есть явно прописанные двери — они ПОЛНОСТЬЮ заменяют
 * geometric fallback (не дополняют его). Раньше двери просто добавлялись
 * к ближайшим по расстоянию соседям, и если два соседних по координатам
 * места (например, санузел и ванная, стоящие рядом на заглушечной прямой)
 * оказывались в пределах maxDist — между ними появлялась незапланированная
 * стрелка в обход двери. Geometric fallback остаётся только для станций,
 * у которых дверей вообще нет — чтобы не оставлять их совсем без навигации.
 */
function neighbors(idx) {
  var cur = STATIONS[idx];
  if (cur.doorways && cur.doorways.length) {
    var out = [];
    cur.doorways.forEach(function (dw) {
      var j = STATIONS.findIndex(function (s) { return s.id === dw.toStationId; });
      if (j >= 0 && out.indexOf(j) === -1) out.push(j);
    });
    return out;
  }
  var out2 = [];
  EDGES.forEach(function (e) {
    if (e[0] === idx) out2.push(e[1]);
    if (e[1] === idx) out2.push(e[0]);
  });
  return out2;
}
/*
 * В manifest.json нет явного графа переходов между станциями — приложение
 * его не считает. Строим граф эвристикой "до K ближайших соседей в радиусе
 * maxDist", без учёта стен (геометрия комнаты из room.json пока не
 * парсится). Для реального контроля соединений граф в будущем стоит
 * считать на сервере с учётом планировки, а не только расстояния.
 */
function computeEdges(stations, K, maxDist) {
  K = K || 3; maxDist = maxDist || 10;
  var edges = new Set();
  stations.forEach(function (a, i) {
    var ds = stations
      .map(function (b, j) { return { j: j, d: Math.hypot(a.x - b.x, a.z - b.z) }; })
      .filter(function (o) { return o.j !== i && o.d <= maxDist; })
      .sort(function (p, q) { return p.d - q.d; })
      .slice(0, K);
    ds.forEach(function (o) {
      var key = i < o.j ? i + "_" + o.j : o.j + "_" + i;
      edges.add(key);
    });
  });
  return Array.from(edges).map(function (k) { return k.split("_").map(Number); });
}

/* ================= Хотспоты ================= */
var hsLayer = document.getElementById("hotspots");
var hotspots = [];
var CHEV = '<svg class="hs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 14 7-7 7 7"/><path d="m5 20 7-7 7 7" opacity=".45"/></svg>';
var ROOM_NAME_BY_STATION = {};
function roomDisplayName(st) {
  var r = ROOM_NAME_BY_STATION[st.id];
  return (r && r.name) || st.roomLabel;
}
/*
 * Направление "вниз к полу" для стрелки: pitchDip — насколько ниже
 * горизонта смотрит луч (положительное значение = вниз), как в исходном
 * shader-проекторе панорамы.
 */
function dirFromYawDip(yawRad, pitchDip) {
  return { x: Math.sin(yawRad) * Math.cos(pitchDip), y: -Math.sin(pitchDip), z: -Math.cos(yawRad) * Math.cos(pitchDip) };
}
var DOOR_DIP = 30 * Math.PI / 180, DOOR_DIP_DELTA = 10 * Math.PI / 180;
function findDoorway(fromSt, toSt) {
  return (fromSt.doorways || []).find(function (dw) { return dw.toStationId === toSt.id; }) || null;
}
function buildHotspots() {
  hsLayer.innerHTML = ""; hotspots = [];
  if (!hasGL) return;
  var cur = STATIONS[currentIdx];
  neighbors(currentIdx).forEach(function (nid) {
    var st = STATIONS[nid];
    var dw = findDoorway(cur, st);
    var isDoor = !!dw;
    var yawRad = isDoor ? dw.yaw * Math.PI / 180 : bearing(cur, st);
    var dipRad = isDoor ? (dw.pitch !== undefined ? dw.pitch * Math.PI / 180 : DOOR_DIP) : null;
    var d = dist(cur, st);
    /* Та же комната (совпадает roomLabel/имя из roomAreas) — голая стрелка без
       подписи, это просто другой ракурс той же точки. Другая комната — подпись
       с названием, как переход. */
    var sameRoom = roomDisplayName(cur) === roomDisplayName(st);
    var el = document.createElement("button");
    el.className = "hs";
    el.setAttribute("aria-label", sameRoom ? "Дальше" : "Перейти: " + roomDisplayName(st));
    el.innerHTML = (sameRoom ? "" : '<span class="hs-name">' + escapeHtml(roomDisplayName(st)) + '</span>') +
      '<span class="hs-pad">' + CHEV + '</span>';
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      if (el._justDragged) { el._justDragged = false; return; }
      goTo(nid);
    });
    if (adminMode) {
      var del = document.createElement("span");
      del.className = "hs-del"; del.textContent = "×";
      del.title = "Удалить дверь";
      del.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        cur.doorways = (cur.doorways || []).filter(function (d2) { return d2.toStationId !== st.id; });
        saveAdminDraft();
        buildHotspots();
      });
      el.appendChild(del);
      if (isDoor) {
        el.classList.add("hs-draggable");
        el.title = "Тащи, чтобы подвинуть · фокус + ←↑↓→ — точно подвинуть · фокус + Q/E — повернуть саму иконку";
        makeHotspotDraggable(el, dw);
      }
    }
    hsLayer.appendChild(el);
    hotspots.push({
      el: el, mode: isDoor ? "door" : "geo", yaw: yawRad, dip: dipRad,
      rotOffset: isDoor ? (dw.rotOffset || 0) : 0, bearing: yawRad, dist: d, idx: nid
    });
  });
}
function updateHotspots() {
  hotspots.forEach(function (h) {
    var dir1, dir2;
    if (h.mode === "door") {
      dir1 = dirFromYawDip(h.yaw, h.dip);
      dir2 = dirFromYawDip(h.yaw, h.dip - DOOR_DIP_DELTA);
    } else {
      var hd = Math.min(h.dist, 3.4);
      dir1 = dirFromYawDip(h.bearing, Math.atan2(1.35, hd));
      dir2 = dirFromYawDip(h.bearing, Math.atan2(1.35, hd + 0.9));
    }
    var p1 = project(dir1);
    if (!p1) { h.el.style.display = "none"; return; }
    var p2 = project(dir2) || { x: p1.x, y: p1.y - 40 };
    var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI + 90 + (h.rotOffset || 0);
    var scale = Math.max(.72, Math.min(1.15, 2.2 / h.dist));
    h.el.style.display = "";
    h.el.style.transform = "translate3d(" + p1.x.toFixed(1) + "px," + p1.y.toFixed(1) + "px,0) translate(-50%,-58%) scale(" + scale.toFixed(3) + ")";
    var pad = h.el.querySelector(".hs-pad");
    pad.style.transform = "rotate(" + ang.toFixed(1) + "deg) rotateX(46deg)";
  });
}
/*
 * Админ-режим: перетаскивание уже поставленной двери. Хватаем стрелку без
 * Shift, тащим — yaw/pitch пересчитываются из позиции курсора на лету (тот
 * же screenToYawDip, что и для новой двери), при отпускании — сохраняем в
 * doorways. Обычный тап (без сдвига) по-прежнему переходит на станцию —
 * отличаем по порогу смещения в пикселях.
 */
function makeHotspotDraggable(el, doorway) {
  el.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".hs-del")) return;
    e.stopPropagation();
    el.focus(); // на Safari/тач клик по <button> сам по себе фокус не даёт — без этого Q/E и стрелки не сработают
    el.setPointerCapture(e.pointerId);
    var startX = e.clientX, startY = e.clientY, moved = false;
    var rect = canvas.getBoundingClientRect();
    function onMove(ev) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) moved = true;
      if (!moved) return;
      var r = screenToYawDip(ev.clientX - rect.left, ev.clientY - rect.top);
      var h = hotspots.find(function (x) { return x.el === el; });
      if (h) { h.yaw = r.yaw; h.dip = r.dip; }
      updateHotspots();
    }
    function onUp(ev) {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (moved) {
        el._justDragged = true;
        var h = hotspots.find(function (x) { return x.el === el; });
        if (h) {
          doorway.yaw = Math.round(h.yaw * 180 / Math.PI * 10) / 10;
          doorway.pitch = Math.round(h.dip * 180 / Math.PI * 10) / 10;
          saveAdminDraft();
        }
      }
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });
  /*
   * Точная подстройка с клавиатуры (тап/клик фокусирует кнопку):
   * ←↑↓→ — двигают, КУДА стрелка ведёт (позиция на панораме, 0.5°/3° с Shift);
   * Q/E — крутят саму ИКОНКУ на месте (как она визуально развёрнута, 5°/15° с Shift) —
   * это отдельная от позиции вещь: показывает направление шага, а не только точку.
   */
  el.addEventListener("keydown", function (e) {
    var moveStep = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    var h = hotspots.find(function (x) { return x.el === el; });
    if (!h) return;
    if (moveStep) {
      e.preventDefault(); e.stopPropagation();
      var deg = e.shiftKey ? 3 : 0.5;
      h.yaw += moveStep[0] * deg * Math.PI / 180;
      h.dip += moveStep[1] * deg * Math.PI / 180;
      updateHotspots();
      doorway.yaw = Math.round(h.yaw * 180 / Math.PI * 10) / 10;
      doorway.pitch = Math.round(h.dip * 180 / Math.PI * 10) / 10;
      saveAdminDraft();
      return;
    }
    if (e.code === "KeyQ" || e.code === "KeyE") {
      e.preventDefault(); e.stopPropagation();
      var rdeg = e.shiftKey ? 15 : 5;
      var sign = e.code === "KeyQ" ? -1 : 1;
      h.rotOffset = (h.rotOffset || 0) + sign * rdeg;
      updateHotspots();
      doorway.rotOffset = h.rotOffset;
      saveAdminDraft();
    }
  });
}

/*
 * ================= Админ-режим (?admin=1) =================
 * Только для расстановки дверей вручную (MVP): Shift+клик по панораме —
 * куда смотрит дверной проём (запоминаются и yaw, и наклон к полу — точка
 * клика, а не фиксированный угол), выбор станции-цели из списка, сохраняется
 * в STATIONS[].doorways (в памяти) и сразу видно на стрелках. Уже
 * поставленную дверь можно перетащить (без Shift, просто хватаем стрелку) —
 * yaw/pitch пересчитываются под курсор на лету. "Экспорт" скачивает
 * JSON-патч — руками сливается в manifest.json при публикации.
 * Не часть клиентского бандла логики, просто читает query-параметр.
 */
var adminMode = new URLSearchParams(location.search).get("admin") === "1";
/* Из экранных координат — мировые yaw/dip луча (yaw для поворота, dip для наклона к полу), как у самих hotspot'ов */
function screenToYawDip(px, py) {
  var nx = (px / W - .5) * 2, ny = (.5 - py / H) * 2;
  var t = Math.tan(fovDeg * Math.PI / 360);
  var cx = nx * t * aspect, cy = ny * t, cz = -1;
  var len = Math.sqrt(cx * cx + cy * cy + cz * cz);
  cx /= len; cy /= len; cz /= len;
  var cp = Math.cos(pitch), sp = Math.sin(pitch);
  var px_ = cx, py_ = cp * cy - sp * cz, pz_ = sp * cy + cp * cz;
  var cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
  var wx = cyaw * px_ + syaw * pz_, wy = py_, wz = -syaw * px_ + cyaw * pz_;
  return { yaw: Math.atan2(wx, -wz), dip: -Math.asin(Math.max(-1, Math.min(1, wy))) };
}
var adminPicker = null;
function closeAdminPicker() {
  if (adminPicker) { adminPicker.remove(); adminPicker = null; }
}
function handleAdminClick(e) {
  e.preventDefault();
  closeAdminPicker();
  var rect = canvas.getBoundingClientRect();
  var rd = screenToYawDip(e.clientX - rect.left, e.clientY - rect.top);
  var cur = STATIONS[currentIdx];
  var others = STATIONS.filter(function (s) { return s.id !== cur.id; });
  if (!others.length) { toast("Больше нет других станций"); return; }
  var box = document.createElement("div");
  box.className = "admin-picker";
  box.style.left = Math.min(e.clientX, W - 210) + "px";
  box.style.top = Math.min(e.clientY, H - 44 * (others.length + 1)) + "px";
  box.innerHTML = '<div class="admin-picker-head">Дверь ведёт в:</div>';
  others.forEach(function (s) {
    var b = document.createElement("button");
    b.textContent = roomDisplayName(s);
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      cur.doorways = (cur.doorways || []).filter(function (dw) { return dw.toStationId !== s.id; });
      cur.doorways.push({
        toStationId: s.id,
        yaw: Math.round(rd.yaw * 180 / Math.PI * 10) / 10,
        pitch: Math.round(rd.dip * 180 / Math.PI * 10) / 10
      });
      saveAdminDraft();
      closeAdminPicker();
      buildHotspots();
      toast("Дверь → " + roomDisplayName(s));
    });
    box.appendChild(b);
  });
  document.body.appendChild(box);
  adminPicker = box;
  function onOutsideClick(ev) {
    if (adminPicker && !adminPicker.contains(ev.target)) closeAdminPicker();
  }
  setTimeout(function () {
    document.addEventListener("pointerdown", onOutsideClick, { capture: true, once: true });
  }, 0);
}
/*
 * Черновик двери живёт только в JS-памяти вкладки — при перезагрузке
 * пропадёт. Автосохраняем в localStorage ЭТОГО браузера (виден только
 * тому, кто редактирует, не публикуется никому другому). Чтобы правки
 * увидели остальные — нужен "Экспорт" и ручное слияние в manifest.json:
 * localStorage — черновик для себя, manifest.json — то, что видят все.
 */
function adminStorageKey() { return "vtour_admin_doorways_" + tourBase; }
function saveAdminDraft() {
  var data = {};
  STATIONS.forEach(function (s) {
    var entry = {};
    if (s.doorways && s.doorways.length) entry.doorways = s.doorways;
    if (s._renamed) entry.roomLabel = s.roomLabel;
    if (entry.doorways || entry.roomLabel) data[s.id] = entry;
  });
  try { localStorage.setItem(adminStorageKey(), JSON.stringify(data)); } catch (e) {}
}
function loadAdminDraft() {
  try {
    var raw = localStorage.getItem(adminStorageKey());
    if (!raw) return;
    var data = JSON.parse(raw);
    STATIONS.forEach(function (s) {
      var entry = data[s.id];
      if (!entry) return;
      if (entry.doorways) s.doorways = entry.doorways;
      if (entry.roomLabel) { s.roomLabel = entry.roomLabel; s._renamed = true; }
    });
    toast("Черновик восстановлен из этого браузера");
  } catch (e) {}
}
function exportDoorways() {
  var patch = STATIONS.filter(function (s) { return (s.doorways && s.doorways.length) || s._renamed; })
    .map(function (s) {
      var entry = { stationId: s.id };
      if (s.doorways && s.doorways.length) entry.doorways = s.doorways;
      if (s._renamed) entry.roomLabel = s.roomLabel;
      return entry;
    });
  var blob = new Blob([JSON.stringify(patch, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "doorways-patch.json";
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}
function renameCurrentStation() {
  var st = STATIONS[currentIdx];
  var next = window.prompt("Новое название станции:", st.roomLabel);
  if (next === null) return;
  next = next.trim();
  if (!next || next === st.roomLabel) return;
  st.roomLabel = next;
  st._renamed = true;
  saveAdminDraft();
  buildHotspots();
  buildThumbs();
  updateThumbActive();
  toast("Переименовано: " + next);
}
if (adminMode) {
  var adminBadge = document.createElement("div");
  adminBadge.className = "admin-badge";
  adminBadge.textContent = "АДМИН · Shift+клик — дверь · тащи или ←↑↓→ — позиция · Q/E — поворот иконки";
  var adminExportBtn = document.createElement("button");
  adminExportBtn.className = "admin-export";
  adminExportBtn.textContent = "Экспорт doorways.json (чтобы увидели все)";
  adminExportBtn.addEventListener("click", exportDoorways);
  var adminRenameBtn = document.createElement("button");
  adminRenameBtn.className = "admin-export admin-rename";
  adminRenameBtn.textContent = "✎ Переименовать станцию";
  adminRenameBtn.addEventListener("click", renameCurrentStation);
  app.appendChild(adminBadge);
  app.appendChild(adminExportBtn);
  app.appendChild(adminRenameBtn);
}

/* ================= Переход между станциями ================= */
var ZOOM_STEP = 7; // deg — лёгкий zoom-in "шаг вперёд" при переходе через дверь
async function goTo(idx) {
  if (transing || idx === currentIdx || idx < 0 || idx >= STATIONS.length) return;
  transing = true;
  var from = STATIONS[currentIdx], to = STATIONS[idx];
  var doorway = findDoorway(from, to);
  var newYaw = doorway ? doorway.yaw * Math.PI / 180 : bearing(from, to);
  var fovStart = fovDeg;
  var fovDip = Math.max(MIN_FOV, BASE_FOV - ZOOM_STEP);
  await animate(reduceMotion ? 0 : 300, function (k) {
    fadeVal = k;
    fovDeg = fovStart + (fovDip - fovStart) * k;
  });
  var asset;
  try {
    asset = await loadStationOrPrompt(to);
  } catch (e) {
    toast("Не удалось загрузить панораму станции");
    await animate(reduceMotion ? 0 : 200, function (k) { fadeVal = 1 - k; });
    transing = false;
    return;
  }
  currentIdx = idx; yaw = newYaw; pitch *= .4;
  activeAsset = asset;
  applyThumbIfCached(idx);
  buildHotspots(); updateMinimap(); updateThumbActive();
  toast(roomDisplayName(to));
  fovDeg = fovDip;
  await animate(reduceMotion ? 0 : 340, function (k) {
    fadeVal = 1 - k;
    fovDeg = fovDip + (BASE_FOV - fovDip) * k;
  });
  transing = false;
}

/* ================= Мини-план ================= */
var planScale = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
function computePlanBounds() {
  var xs = STATIONS.map(function (s) { return s.x; });
  var zs = STATIONS.map(function (s) { return s.z; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minZ = Math.min.apply(null, zs), maxZ = Math.max.apply(null, zs);
  if (maxX - minX < 2) { var cx = (maxX + minX) / 2; minX = cx - 1; maxX = cx + 1; }
  if (maxZ - minZ < 2) { var cz = (maxZ + minZ) / 2; minZ = cz - 1; maxZ = cz + 1; }
  var pad = 1.5;
  planScale = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}
function mapX(x) { return 14 + (x - planScale.minX) / (planScale.maxX - planScale.minX) * 196; }
function mapY(z) { return 14 + (z - planScale.minZ) / (planScale.maxZ - planScale.minZ) * 132; }
function buildGrid() {
  var svgns = "http://www.w3.org/2000/svg";
  var g = document.getElementById("grid");
  g.innerHTML = "";
  for (var i = 1; i < 6; i++) {
    var x = 14 + i * 196 / 6;
    var l = document.createElementNS(svgns, "line");
    l.setAttribute("class", "gridline");
    l.setAttribute("x1", x); l.setAttribute("y1", 14); l.setAttribute("x2", x); l.setAttribute("y2", 146);
    g.appendChild(l);
  }
  for (var j = 1; j < 4; j++) {
    var y = 14 + j * 132 / 4;
    var l2 = document.createElementNS(svgns, "line");
    l2.setAttribute("class", "gridline");
    l2.setAttribute("x1", 14); l2.setAttribute("y1", y); l2.setAttribute("x2", 210); l2.setAttribute("y2", y);
    g.appendChild(l2);
  }
}
function buildMinimap() {
  computePlanBounds(); buildGrid();
  var svgns = "http://www.w3.org/2000/svg";
  var planG = document.getElementById("stations-g");
  planG.innerHTML = "";
  var cone = document.createElementNS(svgns, "path");
  cone.id = "cone";
  planG.appendChild(cone);
  STATIONS.forEach(function (st, i) {
    var g = document.createElementNS(svgns, "g");
    g.setAttribute("class", "st"); g.dataset.idx = i;
    var ring = document.createElementNS(svgns, "circle");
    ring.setAttribute("class", "ring");
    ring.setAttribute("cx", mapX(st.x)); ring.setAttribute("cy", mapY(st.z)); ring.setAttribute("r", 9);
    var c = document.createElementNS(svgns, "circle");
    c.setAttribute("class", "c");
    c.setAttribute("cx", mapX(st.x)); c.setAttribute("cy", mapY(st.z)); c.setAttribute("r", 5.5);
    var hit = document.createElementNS(svgns, "circle");
    hit.setAttribute("cx", mapX(st.x)); hit.setAttribute("cy", mapY(st.z)); hit.setAttribute("r", 14);
    hit.setAttribute("fill", "transparent");
    g.appendChild(ring); g.appendChild(c); g.appendChild(hit);
    g.addEventListener("click", function () { goTo(i); });
    planG.appendChild(g);
  });
  document.getElementById("mapCount").textContent = STATIONS.length + " " + stationWord(STATIONS.length);
  updateMinimap();
}
function updateMinimap() {
  var st = STATIONS[currentIdx];
  var cx = mapX(st.x), cy = mapY(st.z);
  document.querySelectorAll("#plan .st").forEach(function (g) {
    g.classList.toggle("active", +g.dataset.idx === currentIdx);
  });
  var cone = document.getElementById("cone");
  var a = yaw, spread = .55, r = 17;
  var x1 = cx + Math.sin(a - spread) * r, y1 = cy - Math.cos(a - spread) * r;
  var x2 = cx + Math.sin(a + spread) * r, y2 = cy - Math.cos(a + spread) * r;
  cone.setAttribute("d", "M" + cx + " " + cy + " L" + x1.toFixed(1) + " " + y1.toFixed(1) +
    " A" + r + " " + r + " 0 0 1 " + x2.toFixed(1) + " " + y2.toFixed(1) + " Z");
}
var mapCard = document.getElementById("mapCard"), mapFab = document.getElementById("mapFab");
mapFab.addEventListener("click", function () {
  var open = mapCard.classList.toggle("hidden");
  mapFab.setAttribute("aria-pressed", String(!open));
});

/* ================= Нижняя панель (листинг) ================= */
function fillAgentActions(a, callEl, msgEl) {
  if (a.phone) callEl.href = "tel:" + a.phone; else callEl.hidden = true;
  if (a.whatsapp) msgEl.href = "https://wa.me/" + a.whatsapp; else msgEl.hidden = true;
}
function renderListing(manifest, listing) {
  var displayTitle = (listing && listing.title) || manifest.title || "Виртуальный тур";
  document.getElementById("tbTitle").textContent = displayTitle;
  document.getElementById("tbAddr").textContent = manifest.address || "";
  document.title = displayTitle;
  document.getElementById("ldSub").textContent = displayTitle;
  document.getElementById("ldAddr").textContent = manifest.address || "";

  var specs = listing && listing.specs;
  var chipVals = [];
  if (specs) {
    if (specs.rooms) chipVals.push(specs.rooms + " " + roomWord(specs.rooms));
    if (specs.totalArea) chipVals.push(specs.totalArea + " м²");
    if (specs.floor && specs.floorsTotal) chipVals.push(specs.floor + "/" + specs.floorsTotal + " этаж");
  }
  if (!chipVals.length) chipVals.push(STATIONS.length + " " + stationWord(STATIONS.length));
  document.getElementById("chips").innerHTML = chipVals.map(function (c) {
    return '<span class="chip">' + escapeHtml(c) + "</span>";
  }).join("");

  if (listing && listing.price && listing.price.amount) {
    document.getElementById("tbPrice").hidden = false;
    document.getElementById("tbPriceMain").textContent = formatPrice(listing.price.amount, listing.price.currency);
  }

  if (listing && listing.description) {
    document.getElementById("descBlock").hidden = false;
    document.getElementById("descText").textContent = listing.description;
  }

  if (specs) {
    var rows = [];
    if (specs.totalArea) rows.push(["Общая", specs.totalArea + " м²"]);
    if (specs.rooms) rows.push(["Комнаты", String(specs.rooms)]);
    if (specs.floor && specs.floorsTotal) rows.push(["Этаж", specs.floor + " из " + specs.floorsTotal]);
    if (listing.building && listing.building.year) rows.push(["Построен", String(listing.building.year)]);
    if (rows.length) {
      document.getElementById("specsBlock").hidden = false;
      document.getElementById("specs").innerHTML = rows.map(function (kv) {
        return '<div class="spec"><i>' + escapeHtml(kv[0]) + "</i><b>" + escapeHtml(kv[1]) + "</b></div>";
      }).join("");
    }
  }

  if (listing && listing.agent) {
    var a = listing.agent;
    document.getElementById("agentBlock").hidden = false;
    document.getElementById("agentAva").textContent = a.initials ||
      (a.name || "").split(" ").map(function (w) { return w[0] || ""; }).slice(0, 2).join("").toUpperCase();
    document.getElementById("agentName").textContent = a.name || "";
    document.getElementById("agentMeta").textContent = [a.org, a.hours].filter(Boolean).join(" · ");
    fillAgentActions(a, document.getElementById("agentCall"), document.getElementById("agentMsg"));
  }

  renderInfoCard(listing);
  renderRoomPanel(listing);
}

/* ================= Инфо-карточка объекта ================= */
var infoCard = document.getElementById("infoCard"), infoBackdrop = document.getElementById("infoCardBackdrop");
function openInfoCard() {
  infoCard.hidden = false; infoBackdrop.hidden = false;
  requestAnimationFrame(function () {
    infoCard.classList.add("open"); infoBackdrop.classList.add("show");
  });
  infoCard.setAttribute("aria-hidden", "false");
  topbar.setAttribute("aria-expanded", "true");
  app.classList.remove("zen");
}
function closeInfoCard() {
  infoCard.classList.remove("open"); infoBackdrop.classList.remove("show");
  infoCard.setAttribute("aria-hidden", "true");
  topbar.setAttribute("aria-expanded", "false");
  setTimeout(function () { infoCard.hidden = true; infoBackdrop.hidden = true; }, 350);
}
var topbar = document.getElementById("topbar");
topbar.addEventListener("click", openInfoCard);
topbar.addEventListener("keydown", function (e) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInfoCard(); }
});
document.getElementById("infoCardClose").addEventListener("click", function (e) { e.stopPropagation(); closeInfoCard(); });
infoBackdrop.addEventListener("click", closeInfoCard);
(function () {
  var startY = null;
  infoCard.addEventListener("touchstart", function (e) { startY = e.touches[0].clientY; }, { passive: true });
  infoCard.addEventListener("touchmove", function (e) {
    if (startY === null) return;
    if (e.touches[0].clientY - startY < -40) { closeInfoCard(); startY = null; }
  }, { passive: true });
})();

function renderInfoCard(listing) {
  if (!listing) return;
  if (listing.price && listing.price.amount) {
    document.getElementById("icPriceMain").textContent = formatPrice(listing.price.amount, listing.price.currency);
    var specs = listing.specs;
    if (specs && specs.totalArea) {
      var perSqm = Math.round(listing.price.amount / specs.totalArea);
      document.getElementById("icPricePerSqm").textContent = formatPrice(perSqm, listing.price.currency) + "/м²";
    }
  }
  var chipVals = [];
  if (listing.specs) {
    var s = listing.specs;
    if (s.rooms) chipVals.push(s.rooms + " " + roomWord(s.rooms));
    if (s.totalArea) chipVals.push(s.totalArea + " м²");
    if (s.floor && s.floorsTotal) chipVals.push(s.floor + "/" + s.floorsTotal + " этаж");
  }
  document.getElementById("icSpecs").innerHTML = chipVals.map(function (c) {
    return '<span class="chip">' + escapeHtml(c) + "</span>";
  }).join("");

  if (listing.building) {
    var b = listing.building;
    var parts = [];
    if (b.year) parts.push("построен в " + b.year);
    if (b.type) parts.push(b.type);
    if (b.district) parts.push("район «" + b.district + "»");
    if (parts.length) {
      document.getElementById("icBuildingBlock").hidden = false;
      document.getElementById("icBuildingText").textContent = parts.join(", ").replace(/^./, function (c) { return c.toUpperCase(); });
    }
    if (b.approxLocation) {
      document.getElementById("icMapBlock").hidden = false;
      var mapEl = document.getElementById("icMap");
      var built = false;
      var io = new IntersectionObserver(function (entries) {
        if (built) return;
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            built = true; io.disconnect();
            buildLocationMap(mapEl, b.approxLocation.lat, b.approxLocation.lng, b.approxLocation.radius || 300, b.district);
          }
        });
      });
      io.observe(mapEl);
    }
  }

  if (listing.agent) {
    fillAgentActions(listing.agent, document.getElementById("icAgentCall"), document.getElementById("icAgentMsg"));
  }
}

/*
 * Статичная мини-карта района без сторонних библиотек: собираем 3x3 тайла
 * OpenStreetMap вокруг точки, масштабируем так, чтобы точка всегда
 * оказывалась строго в центре контейнера, и рисуем поверх круг радиуса
 * approxLocation.radius (в метрах, переведён в пиксели по формуле
 * Web Mercator). Зум подбирается так, чтобы круг был разумного размера
 * независимо от того, 50 это метров или 2 километра.
 * Тайлы грузятся лениво (через IntersectionObserver) только когда карточка
 * открыта и карта попала во вьюпорт. tile.openstreetmap.org — публичный
 * сервис с политикой honest use; для продакшена с заметным трафиком стоит
 * подключить платного тайл-провайдера или прокси со своим кэшем.
 */
function lonToTileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
function latToTileY(lat, z) {
  var r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
}
function metersPerPixel(z, lat) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }
function pickZoomForRadius(lat, radiusM) {
  var targetPx = 46;
  var z = Math.log2(targetPx * 156543.03392 * Math.cos(lat * Math.PI / 180) / radiusM);
  return Math.max(3, Math.min(18, Math.round(z)));
}
function mapFallback(container, district) {
  container.innerHTML = '<div class="ic-map-fallback">' +
    (district ? "Район: " + escapeHtml(district) : "Карта района недоступна") + "</div>";
}
function buildLocationMap(container, lat, lng, radiusM, district) {
  var z = pickZoomForRadius(lat, radiusM);
  var txf = lonToTileX(lng, z), tyf = latToTileY(lat, z);
  var cx = Math.floor(txf), cy = Math.floor(tyf);
  var pxX = 256 * (1 + (txf - cx)), pxY = 256 * (1 + (tyf - cy));
  var maxTile = Math.pow(2, z);
  var grid = document.createElement("div");
  grid.style.position = "absolute";
  grid.style.width = "768px"; grid.style.height = "768px";
  grid.style.transformOrigin = "0 0";
  var loaded = 0, settled = 0;
  var done = false;
  var timeoutId = setTimeout(function () { if (!done) { done = true; mapFallback(container, district); } }, 5000);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      var tx = ((cx + dx) % maxTile + maxTile) % maxTile;
      var ty = cy + dy;
      var img = document.createElement("img");
      img.width = 256; img.height = 256;
      img.style.position = "absolute";
      img.style.left = (256 * (dx + 1)) + "px";
      img.style.top = (256 * (dy + 1)) + "px";
      img.alt = "";
      img.onload = function () { loaded++; settled++; check(); };
      img.onerror = function () { settled++; check(); };
      img.src = "https://tile.openstreetmap.org/" + z + "/" + tx + "/" + ty + ".png";
      grid.appendChild(img);
    }
  }
  function check() {
    if (done || settled < 9) return;
    done = true; clearTimeout(timeoutId);
    if (loaded === 0) { mapFallback(container, district); return; }
    var w = container.clientWidth, h = container.clientHeight;
    var scale = w / 768;
    grid.style.left = (w / 2 - pxX * scale) + "px";
    grid.style.top = (h / 2 - pxY * scale) + "px";
    grid.style.transform = "scale(" + scale + ")";
    var radiusPx = radiusM / metersPerPixel(z, lat) * scale;
    var circle = document.createElement("div");
    circle.className = "ic-map-circle";
    circle.style.left = "50%"; circle.style.top = "50%";
    circle.style.width = (radiusPx * 2) + "px"; circle.style.height = (radiusPx * 2) + "px";
    container.appendChild(circle);
  }
  container.appendChild(grid);
}

/* ================= Панель метража ================= */
var roomPanel = document.getElementById("roomPanel");
var ROOM_PANEL_KEY = "vtour_roomPanelOpen";
function renderRoomPanel(listing) {
  var areas = listing && listing.roomAreas;
  if (!areas || !areas.length) { roomPanel.style.display = "none"; return; }
  roomPanel.style.display = "";
  var list = document.getElementById("roomList");
  list.innerHTML = "";
  var sum = 0;
  areas.forEach(function (r) {
    ROOM_NAME_BY_STATION[r.stationId] = r;
    sum += r.area || 0;
    var li = document.createElement("li");
    li.dataset.stationId = r.stationId;
    var right = r.area + " м²" + (r.ceilingHeight ? " · " + r.ceilingHeight + " м" : "");
    li.innerHTML = "<b>" + escapeHtml(r.name) + "</b><span class=\"rp-area\">" + escapeHtml(right) + "</span>";
    li.addEventListener("click", function () {
      var idx = STATIONS.findIndex(function (s) { return s.id === r.stationId; });
      if (idx >= 0) goTo(idx);
    });
    list.appendChild(li);
  });
  document.getElementById("roomSum").innerHTML = "Итого<b>" + Math.round(sum * 10) / 10 + " м²</b>";
  updateRoomPanelActive();

  var open = sessionStorage.getItem(ROOM_PANEL_KEY) === "1";
  roomPanel.classList.toggle("collapsed", !open);
  document.getElementById("roomPanelTab").setAttribute("aria-expanded", String(open));
}
function updateRoomPanelActive() {
  var st = STATIONS[currentIdx];
  document.querySelectorAll("#roomList li").forEach(function (li) {
    li.classList.toggle("active", !!st && li.dataset.stationId === st.id);
  });
}
document.getElementById("roomPanelTab").addEventListener("click", function () {
  roomPanel.classList.remove("collapsed");
  document.getElementById("roomPanelTab").setAttribute("aria-expanded", "true");
  sessionStorage.setItem(ROOM_PANEL_KEY, "1");
});
document.getElementById("roomPanelClose").addEventListener("click", function () {
  roomPanel.classList.add("collapsed");
  sessionStorage.setItem(ROOM_PANEL_KEY, "0");
});
function buildThumbs() {
  var wrap = document.getElementById("thumbs");
  wrap.innerHTML = "";
  STATIONS.forEach(function (st, i) {
    var el = document.createElement("button");
    el.className = "thumb";
    el.dataset.idx = i;
    el.innerHTML = "<span>" + escapeHtml(st.roomLabel) + "</span>";
    el.addEventListener("click", function () { goTo(i); });
    wrap.appendChild(el);
    applyThumbIfCached(i);
  });
}
function updateThumbActive() {
  document.querySelectorAll(".thumb").forEach(function (el) {
    el.classList.toggle("active", +el.dataset.idx === currentIdx);
  });
  updateRoomPanelActive();
}
var sheet = document.getElementById("sheet"), handle = document.getElementById("sheetHandle");
handle.addEventListener("click", function () {
  var open = sheet.classList.toggle("open");
  handle.setAttribute("aria-expanded", String(open));
  if (open) app.classList.remove("zen");
});
document.getElementById("shareBtn").addEventListener("click", function () {
  var data = { title: document.title, url: location.href };
  if (navigator.share) navigator.share(data).catch(function () {});
  else if (navigator.clipboard) navigator.clipboard.writeText(data.url).then(function () { toast("Ссылка скопирована"); });
});

/* ================= Управление: drag / инерция / pinch / wheel ================= */
var pointers = {}, downPos = null, downT = 0, lastX = 0, lastY = 0, velX = 0, velY = 0, pinchD = 0, interacted = false;
function pxToRad() { return (fovDeg * Math.PI / 180) / H; }
canvas.addEventListener("pointerdown", function (e) {
  if (adminMode && e.shiftKey) { handleAdminClick(e); return; }
  interacted = true; wake();
  canvas.setPointerCapture(e.pointerId);
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var keys = Object.keys(pointers);
  if (keys.length === 1) {
    downPos = { x: e.clientX, y: e.clientY }; downT = performance.now();
    lastX = e.clientX; lastY = e.clientY; velX = 0; velY = 0;
    canvas.classList.add("grabbing");
  } else if (keys.length === 2) {
    var a = pointers[keys[0]], b = pointers[keys[1]];
    pinchD = Math.hypot(b.x - a.x, b.y - a.y);
    downPos = null;
  }
});
canvas.addEventListener("pointermove", function (e) {
  if (!pointers[e.pointerId]) return;
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var keys = Object.keys(pointers);
  if (keys.length === 1) {
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    var k = pxToRad();
    yaw -= dx * k; pitch += dy * k;
    pitch = Math.max(-1.25, Math.min(1.25, pitch));
    velX = dx; velY = dy;
    lastX = e.clientX; lastY = e.clientY;
  } else if (keys.length === 2) {
    var a = pointers[keys[0]], b = pointers[keys[1]];
    var d = Math.hypot(b.x - a.x, b.y - a.y);
    if (pinchD > 0) fovDeg = Math.max(MIN_FOV, Math.min(MAX_FOV, fovDeg * pinchD / d));
    pinchD = d;
  }
});
function pointerEnd(e) {
  delete pointers[e.pointerId];
  canvas.classList.remove("grabbing");
  if (downPos) {
    var dt = performance.now() - downT;
    var moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (dt < 280 && moved < 8) { app.classList.toggle("zen"); velX = 0; velY = 0; }
    downPos = null;
  }
}
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("wheel", function (e) {
  e.preventDefault(); interacted = true; wake();
  fovDeg = Math.max(MIN_FOV, Math.min(MAX_FOV, fovDeg + e.deltaY * .04));
}, { passive: false });
addEventListener("keydown", function (e) {
  var step = .06;
  if (e.key === "ArrowLeft") { yaw -= step; interacted = true; }
  if (e.key === "ArrowRight") { yaw += step; interacted = true; }
  if (e.key === "ArrowUp") { pitch = Math.min(1.25, pitch + step); interacted = true; }
  if (e.key === "ArrowDown") { pitch = Math.max(-1.25, pitch - step); interacted = true; }
});

/* ================= Автопритухание хрома ================= */
var idleT = null;
function wake() {
  app.classList.remove("idle");
  clearTimeout(idleT);
  idleT = setTimeout(function () { app.classList.add("idle"); }, 4500);
}
["pointerdown", "pointermove", "touchstart"].forEach(function (ev) {
  document.addEventListener(ev, wake, { passive: true });
});

/* ================= Данные станций из manifest.json ================= */
function buildStations(manifest) {
  STATIONS = manifest.stations.slice()
    .sort(function (a, b) { return a.index - b.index; })
    .map(function (s) {
      return {
        id: s.id, index: s.index, roomLabel: s.roomLabel || ("Станция " + s.index),
        x: s.worldPosition[0], y: s.worldPosition[1], z: s.worldPosition[2],
        path: s.path,
        doorways: (s.doorways || []).map(function (d) { return { toStationId: d.toStationId, yaw: d.yaw }; })
      };
    });
  EDGES = computeEdges(STATIONS);
}

/* ================= Главный цикл ================= */
var lastT = performance.now();
function loop(now) {
  var dt = now - lastT; lastT = now;
  if (!interacted && !reduceMotion) yaw += dt * .000045;
  if (Object.keys(pointers).length === 0 && (Math.abs(velX) > .1 || Math.abs(velY) > .1)) {
    var k = pxToRad();
    yaw -= velX * k; pitch = Math.max(-1.25, Math.min(1.25, pitch + velY * k));
    velX *= .94; velY *= .94;
  }
  draw();
  if (hasGL) updateHotspots();
  if (!mapCard.classList.contains("hidden")) updateMinimap();
  requestAnimationFrame(loop);
}

/* ================= Загрузка тура ================= */
async function boot() {
  wake();
  var params = new URLSearchParams(location.search);
  var slug = app.dataset.tourSlug || params.get("tour") || "demo";
  tourBase = "/tours/" + slug;

  hasGL = setupGL();
  resize();
  if (!hasGL) document.getElementById("hotspots").style.display = "none";

  var manifest;
  try {
    manifest = await loadJSONFlexible(
      tourBase + "/manifest.json", tourBase + "/manifest.js", "__TOUR_MANIFEST__"
    );
  } catch (e) {
    showError(
      "Не найден ни " + tourBase + "/manifest.json, ни " + tourBase + "/manifest.js. " +
      "Проверьте, что папка тура на месте рядом со страницей."
    );
    return;
  }
  var listing = null;
  try {
    listing = await loadJSONFlexible(
      tourBase + "/listing.json", tourBase + "/listing.js", "__TOUR_LISTING__"
    );
  } catch (e) { listing = null; }

  buildStations(manifest);
  if (!STATIONS.length) { showError("В manifest.json нет ни одной станции."); return; }
  if (adminMode) loadAdminDraft();

  renderListing(manifest, listing);
  buildMinimap();
  buildThumbs();

  var first = STATIONS[0];
  var asset;
  try {
    asset = await loadStationOrPrompt(first, updateLoaderProgress);
  } catch (e) {
    showError("Не удалось загрузить панораму первой станции: " + (e && e.message ? e.message : e));
    return;
  }
  if (!hasGL) {
    var f = document.getElementById("nogl");
    f.style.display = "block";
    f.style.backgroundImage = "url(" + asset.url + ")";
  }
  activeAsset = asset;
  currentIdx = 0;
  applyThumbIfCached(0);
  buildHotspots();
  updateMinimap();
  updateThumbActive();

  document.getElementById("loader").classList.add("done");
  requestAnimationFrame(loop);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

})();
