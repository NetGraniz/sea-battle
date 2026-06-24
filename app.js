"use strict";

const N = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const K = {
  save: "battleship.currentGame.v1",
  stats: "battleship.stats.v1",
  prefs: "battleship.preferences.v1"
};
const C = { empty: "empty", ship: "ship", hit: "hit", miss: "miss", dead: "dead" };

class Store {
  static get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  static set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  static del(key) { localStorage.removeItem(key); }
  static stats() {
    return this.get(K.stats, { played: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0 });
  }
  static finish(result) {
    const s = this.stats();
    s.played += 1;
    if (result === "win") {
      s.wins += 1;
      s.currentStreak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
    } else {
      s.losses += 1;
      s.currentStreak = 0;
    }
    this.set(K.stats, s);
  }
}

class Sound {
  constructor() {
    this.enabled = Store.get(K.prefs, {}).sound !== false;
    this.ctx = null;
  }
  toggle() {
    this.enabled = !this.enabled;
    const p = Store.get(K.prefs, {});
    p.sound = this.enabled;
    Store.set(K.prefs, p);
    return this.enabled;
  }
  play(type) {
    if (!this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx ||= new AC();
    const map = {
      hit: [[190, .07], [90, .1]], miss: [[420, .05], [300, .08]],
      sunk: [[160, .08], [110, .13], [70, .16]],
      win: [[330, .08], [440, .08], [660, .16]], lose: [[210, .1], [160, .13], [110, .18]]
    };
    let t = 0;
    for (const [f, d] of map[type] || []) { this.tone(f, d, t); t += d + .03; }
  }
  tone(freq, dur, delay) {
    const at = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(.0001, at);
    g.gain.exponentialRampToValueAtTime(.13, at + .01);
    g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(at);
    o.stop(at + dur + .02);
  }
}

class Board {
  constructor() { this.grid = Board.grid(); this.ships = []; }
  static grid() { return Array.from({ length: N }, () => Array.from({ length: N }, () => ({ state: C.empty, shipId: null }))); }
  static in(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  static around(r, c, diag = true) {
    const a = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (!diag && Math.abs(dr) + Math.abs(dc) !== 1) continue;
      const nr = r + dr, nc = c + dc;
      if (Board.in(nr, nc)) a.push([nr, nc]);
    }
    return a;
  }
  cells(r, c, len, dir) { return Array.from({ length: len }, (_, i) => [r + (dir === "vertical" ? i : 0), c + (dir === "horizontal" ? i : 0)]); }
  can(r, c, len, dir) {
    for (const [x, y] of this.cells(r, c, len, dir)) {
      if (!Board.in(x, y) || this.grid[x][y].state === C.ship) return false;
      for (const [a, b] of Board.around(x, y)) if (this.grid[a][b].state === C.ship) return false;
    }
    return true;
  }
  place(r, c, len, dir, id = `${Date.now()}-${Math.random()}`) {
    if (!this.can(r, c, len, dir)) return null;
    const cells = this.cells(r, c, len, dir);
    const ship = { id, length: len, dir, cells, hits: [], sunk: false };
    this.ships.push(ship);
    for (const [x, y] of cells) this.grid[x][y] = { state: C.ship, shipId: id };
    return ship;
  }
  clear() { this.grid = Board.grid(); this.ships = []; }
  shot(r, c) {
    const cell = this.grid[r][c];
    if ([C.hit, C.miss, C.dead].includes(cell.state)) return { valid: false };
    if (cell.state === C.ship) {
      cell.state = C.hit;
      const ship = this.ships.find(s => s.id === cell.shipId);
      ship.hits.push([r, c]);
      ship.sunk = ship.hits.length === ship.length;
      if (ship.sunk) this.mark(ship);
      return { valid: true, hit: true, sunk: ship.sunk, ship };
    }
    cell.state = C.miss;
    return { valid: true, hit: false, sunk: false };
  }
  mark(ship) {
    for (const [r, c] of ship.cells) {
      this.grid[r][c].state = C.hit;
      for (const [x, y] of Board.around(r, c)) if (this.grid[x][y].state === C.empty) this.grid[x][y].state = C.dead;
    }
  }
  done() { return this.ships.length && this.ships.every(s => s.sunk); }
  data() { return { grid: this.grid, ships: this.ships }; }
  static from(data) { const b = new Board(); b.grid = data.grid; b.ships = data.ships; return b; }
}

class Placement {
  static random() {
    const b = new Board();
    for (const len of FLEET) {
      let ok = false;
      for (let i = 0; i < 600 && !ok; i++) ok = !!b.place(Math.random() * N | 0, Math.random() * N | 0, len, Math.random() > .5 ? "horizontal" : "vertical");
      if (!ok) return this.random();
    }
    return b;
  }
}

class AI {
  constructor(game) { this.g = game; }
  free() {
    const a = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (![C.hit, C.miss, C.dead].includes(this.g.player.grid[r][c].state)) a.push([r, c]);
    return a;
  }
  random() { const a = this.free(); return a[Math.random() * a.length | 0]; }
  hunt() {
    const hits = this.g.player.ships.filter(s => !s.sunk).flatMap(s => s.hits);
    if (!hits.length) return null;
    const cand = [];
    const rs = new Set(hits.map(h => h[0])), cs = new Set(hits.map(h => h[1]));
    if (hits.length > 1 && rs.size === 1) {
      const r = hits[0][0], cc = hits.map(h => h[1]).sort((a, b) => a - b);
      cand.push([r, cc[0] - 1], [r, cc.at(-1) + 1]);
    } else if (hits.length > 1 && cs.size === 1) {
      const c = hits[0][1], rr = hits.map(h => h[0]).sort((a, b) => a - b);
      cand.push([rr[0] - 1, c], [rr.at(-1) + 1, c]);
    } else hits.forEach(([r, c]) => cand.push(...Board.around(r, c, false)));
    const legal = cand.filter(([r, c]) => Board.in(r, c) && ![C.hit, C.miss, C.dead].includes(this.g.player.grid[r][c].state));
    return legal.length ? legal[Math.random() * legal.length | 0] : null;
  }
  hard() {
    const w = Array.from({ length: N }, () => Array(N).fill(0));
    const left = this.g.player.ships.filter(s => !s.sunk).map(s => s.length);
    for (const len of left) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const dir of ["horizontal", "vertical"]) {
      const cells = Array.from({ length: len }, (_, i) => [r + (dir === "vertical" ? i : 0), c + (dir === "horizontal" ? i : 0)]);
      if (cells.every(([x, y]) => Board.in(x, y) && ![C.miss, C.dead].includes(this.g.player.grid[x][y].state))) cells.forEach(([x, y]) => w[x][y]++);
    }
    let best = [], score = -1;
    for (const [r, c] of this.free()) {
      const s = w[r][c] + ((r + c) % 2 ? 0 : .15);
      if (s > score) { score = s; best = [[r, c]]; } else if (s === score) best.push([r, c]);
    }
    return best.length ? best[Math.random() * best.length | 0] : this.random();
  }
  pick() { return this.g.diff === "easy" ? this.random() : this.hunt() || (this.g.diff === "hard" ? this.hard() : this.random()); }
}

class Game {
  constructor(ui) { this.ui = ui; this.sound = new Sound(); this.reset(); }
  reset() { this.player = new Board(); this.comp = new Board(); this.turn = "player"; this.phase = "setup"; this.diff = "medium"; this.ended = false; this.ai = new AI(this); }
  start(player, diff) { this.player = player; this.comp = Placement.random(); this.turn = "player"; this.phase = "battle"; this.diff = diff; this.ended = false; this.ai = new AI(this); this.save(); }
  playerShot(r, c) { if (this.phase !== "battle" || this.turn !== "player" || this.ended) return; const res = this.comp.shot(r, c); if (res.valid) this.after("player", res); }
  computerShot() { if (this.phase !== "battle" || this.turn !== "computer" || this.ended) return; const [r, c] = this.ai.pick(); this.after("computer", this.player.shot(r, c)); }
  after(who, res) {
    if (res.hit && res.sunk) { this.ui.note(`${who === "player" ? "Вы уничтожили" : "Компьютер уничтожил"} корабль на ${res.ship.length} клетки.`); this.sound.play("sunk"); }
    else if (res.hit) { this.ui.note(who === "player" ? "Попадание! Стреляйте ещё." : "Компьютер попал и ходит снова."); this.sound.play("hit"); }
    else { this.ui.note(who === "player" ? "Промах. Ход компьютера." : "Компьютер промахнулся. Ваш ход."); this.sound.play("miss"); this.turn = who === "player" ? "computer" : "player"; }
    this.ui.renderBattle();
    if (this.over()) return;
    this.save();
    if (this.turn === "computer") setTimeout(() => this.computerShot(), res.hit ? 650 : 850);
  }
  over() {
    if (this.comp.done()) return this.finish("win"), true;
    if (this.player.done()) return this.finish("lose"), true;
    return false;
  }
  finish(result) { this.ended = true; this.phase = "finished"; Store.del(K.save); Store.finish(result); this.sound.play(result === "win" ? "win" : "lose"); this.ui.result(result); this.ui.renderStats(); }
  save() { if (this.phase === "battle" && !this.ended) Store.set(K.save, { player: this.player.data(), comp: this.comp.data(), turn: this.turn, diff: this.diff, phase: this.phase }); }
  load(s) { this.player = Board.from(s.player); this.comp = Board.from(s.comp); this.turn = s.turn; this.diff = s.diff; this.phase = s.phase; this.ended = false; this.ai = new AI(this); }
}

class UI {
  constructor() {
    const q = s => document.querySelector(s);
    this.d = {
      setupPanel: q("#setupPanel"), gamePanel: q("#gamePanel"), setupBoard: q("#setupBoard"), playerBoard: q("#playerBoard"), computerBoard: q("#computerBoard"),
      fleetPicker: q("#fleetPicker"), rotateShip: q("#rotateShip"), randomPlacement: q("#randomPlacement"), clearPlacement: q("#clearPlacement"), startGame: q("#startGame"), difficultySelect: q("#difficultySelect"), orientationLabel: q("#orientationLabel"), turnStatus: q("#turnStatus"), messageLog: q("#messageLog"), playerShipsLeft: q("#playerShipsLeft"), computerShipsLeft: q("#computerShipsLeft"), playerFleetStatus: q("#playerFleetStatus"), computerFleetStatus: q("#computerFleetStatus"), statsGrid: q("#statsGrid"), themeToggle: q("#themeToggle"), soundToggle: q("#soundToggle"), resumeModal: q("#resumeModal"), resumeGame: q("#resumeGame"), discardSave: q("#discardSave"), resultModal: q("#resultModal"), resultKicker: q("#resultKicker"), resultTitle: q("#resultTitle"), resultText: q("#resultText"), newGameResult: q("#newGameResult"), newGameTop: q("#newGameTop")
    };
    this.game = new Game(this); this.setup = new Board(); this.dir = "horizontal"; this.index = 0; this.preview = [];
    this.theme(); this.bind(); this.renderSetup(); this.renderStats(); if (Store.get(K.save, null)) this.d.resumeModal.hidden = false;
  }
  bind() {
    this.d.rotateShip.onclick = () => this.rotate();
    this.d.randomPlacement.onclick = () => { this.setup = Placement.random(); this.index = FLEET.length; this.renderSetup(); };
    this.d.clearPlacement.onclick = () => { this.setup.clear(); this.index = 0; this.renderSetup(); };
    this.d.startGame.onclick = () => this.start();
    this.d.themeToggle.onclick = () => this.toggleTheme();
    this.d.soundToggle.onclick = () => this.soundButton(this.game.sound.toggle());
    this.d.resumeGame.onclick = () => this.resume();
    this.d.discardSave.onclick = () => { Store.del(K.save); this.d.resumeModal.hidden = true; this.newGame(); };
    this.d.newGameResult.onclick = () => this.newGame();
    this.d.newGameTop.onclick = () => this.newGame();
    document.addEventListener("keydown", e => { if (e.key.toLowerCase() === "r" && this.game.phase === "setup") this.rotate(); });
  }
  theme() {
    const p = Store.get(K.prefs, {}), dark = matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = p.theme || (dark ? "dark" : "light");
    this.d.themeToggle.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
    this.soundButton(this.game.sound.enabled);
  }
  toggleTheme() { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; const p = Store.get(K.prefs, {}); p.theme = next; Store.set(K.prefs, p); this.d.themeToggle.textContent = next === "dark" ? "☀" : "☾"; }
  soundButton(on) { this.d.soundToggle.textContent = on ? "♪" : "×"; this.d.soundToggle.title = on ? "Звук включён" : "Звук выключен"; }
  rotate() { this.dir = this.dir === "horizontal" ? "vertical" : "horizontal"; this.d.orientationLabel.textContent = this.dir === "horizontal" ? "Горизонтально" : "Вертикально"; }
  start() { if (this.setup.ships.length !== FLEET.length) return this.note("Сначала разместите все корабли."); this.game.start(Board.from(this.setup.data()), this.d.difficultySelect.value); this.d.setupPanel.hidden = true; this.d.gamePanel.hidden = false; this.renderBattle(); this.note("Бой начался. Вы стреляете первым."); }
  resume() { const s = Store.get(K.save, null); if (!s) return; this.game.load(s); this.d.resumeModal.hidden = true; this.d.setupPanel.hidden = true; this.d.gamePanel.hidden = false; this.renderBattle(); this.note("Партия восстановлена."); if (this.game.turn === "computer") setTimeout(() => this.game.computerShot(), 650); }
  newGame() { Store.del(K.save); this.game.reset(); this.setup = new Board(); this.index = 0; this.d.resultModal.hidden = true; this.d.setupPanel.hidden = false; this.d.gamePanel.hidden = true; this.renderSetup(); this.note("Новая партия готова к расстановке."); }
  renderSetup() { this.board(this.d.setupBoard, this.setup, { reveal: true, click: (r, c) => this.place(r, c), enter: (r, c) => this.showPreview(r, c), leave: () => this.clearPreview() }); this.fleet(); this.d.startGame.disabled = this.setup.ships.length !== FLEET.length; }
  fleet() { this.d.fleetPicker.innerHTML = `<div class="fleet-list">${FLEET.map((l, i) => `<button class="fleet-item ${i === this.index ? "is-active" : ""} ${i < this.setup.ships.length ? "is-done" : ""}" type="button" data-i="${i}"><span>${l}-палубный</span><span class="ship-dots">${"<i></i>".repeat(l)}</span></button>`).join("")}</div>`; this.d.fleetPicker.querySelectorAll("button").forEach(b => b.onclick = () => { const i = +b.dataset.i; if (i === this.setup.ships.length) { this.index = i; this.fleet(); } }); }
  place(r, c) { const len = FLEET[this.index]; if (!len) return; if (!this.setup.place(r, c, len, this.dir)) { this.bad(r, c, len); this.note("Так поставить корабль нельзя: проверьте границы и соседние клетки."); return; } this.index = this.setup.ships.length; this.clearPreview(); this.renderSetup(); }
  showPreview(r, c) { this.clearPreview(); const len = FLEET[this.index]; if (!len) return; const ok = this.setup.can(r, c, len, this.dir); for (const [x, y] of this.setup.cells(r, c, len, this.dir)) if (Board.in(x, y)) { const n = this.cell(this.d.setupBoard, x, y); n.classList.add(ok ? "cell--preview" : "cell--invalid"); this.preview.push(n); } }
  clearPreview() { this.preview.forEach(n => n.classList.remove("cell--preview", "cell--invalid")); this.preview = []; }
  bad(r, c, len) { for (const [x, y] of this.setup.cells(r, c, len, this.dir)) if (Board.in(x, y)) { const n = this.cell(this.d.setupBoard, x, y); n.classList.add("cell--invalid"); this.preview.push(n); } setTimeout(() => this.clearPreview(), 350); }
  renderBattle() { this.board(this.d.playerBoard, this.game.player, { reveal: true }); this.board(this.d.computerBoard, this.game.comp, { click: (r, c) => this.game.playerShot(r, c) }); this.d.turnStatus.textContent = this.game.turn === "player" ? "Ваш ход" : "Ход компьютера"; const pa = this.game.player.ships.filter(s => !s.sunk).length, ca = this.game.comp.ships.filter(s => !s.sunk).length; this.d.playerShipsLeft.textContent = this.ships(pa); this.d.computerShipsLeft.textContent = this.ships(ca); this.status(this.d.playerFleetStatus, this.game.player); this.status(this.d.computerFleetStatus, this.game.comp); }
  board(el, b, o = {}) { el.innerHTML = ""; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const cell = b.grid[r][c], n = document.createElement("button"); n.type = "button"; n.className = "cell"; n.dataset.row = r; n.dataset.col = c; n.setAttribute("aria-label", `Клетка ${r + 1}-${c + 1}`); if (cell.state === C.ship && o.reveal) n.classList.add("cell--ship"); if (cell.state === C.hit) { const s = b.ships.find(x => x.id === cell.shipId); n.classList.add(s?.sunk ? "cell--sunk" : "cell--hit"); } if (cell.state === C.miss) n.classList.add("cell--miss"); if (cell.state === C.dead) n.classList.add("cell--dead-zone"); if (o.click) n.onclick = () => o.click(r, c); if (o.enter) n.onpointerenter = () => o.enter(r, c); if (o.leave) n.onpointerleave = o.leave; el.append(n); } }
  status(el, b) { el.innerHTML = [4, 3, 2, 1].map(l => { const t = b.ships.filter(s => s.length === l).length, a = b.ships.filter(s => s.length === l && !s.sunk).length; return `<div class="fleet-status__item"><strong>${a}/${t}</strong>${l}-пал.</div>`; }).join(""); }
  renderStats() { const s = Store.stats(), wr = s.played ? Math.round(s.wins / s.played * 100) : 0; this.d.statsGrid.innerHTML = [["Партий", s.played], ["Побед", s.wins], ["Поражений", s.losses], ["Процент побед", wr + "%"], ["Серия", s.currentStreak], ["Лучшая серия", s.bestStreak]].map(([l, v]) => `<div class="stat-card"><span>${l}</span><strong>${v}</strong></div>`).join(""); }
  result(r) { const win = r === "win"; this.d.resultKicker.textContent = win ? "Победа" : "Поражение"; this.d.resultTitle.textContent = win ? "Флот противника уничтожен" : "Ваш флот потоплен"; this.d.resultText.textContent = win ? "Отличная партия. Можно начинать новую битву." : "Компьютер оказался сильнее в этой партии. Реванш уже ждёт."; this.d.resultModal.hidden = false; }
  note(m) { this.d.messageLog.textContent = m; }
  ships(n) { return n === 1 ? "1 корабль" : n > 1 && n < 5 ? `${n} корабля` : `${n} кораблей`; }
  cell(el, r, c) { return el.querySelector(`[data-row="${r}"][data-col="${c}"]`); }
}

if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
addEventListener("DOMContentLoaded", () => new UI());
