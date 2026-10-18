// The panels around the sky: laws, meters, goals, the archive.
(function (MOTE) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  function fmt(n) {
    if (n < 1000) return Math.floor(n).toString();
    const units = ['k', 'M', 'B', 'T'];
    let u = -1;
    while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
    return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + units[u];
  }

  function roman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out;
  }

  function cardHTML(item) {
    return `<button class="card" data-id="${item.id}">
      <div class="top"><span class="name"></span><span class="lvl"></span></div>
      <div class="desc"></div>
      <div class="bottom"><span class="effect"></span><span class="cost"></span></div>
    </button>`;
  }

  class UI {
    constructor(game, renderer) {
      this.game = game;
      this.renderer = renderer;
      this.timeScale = 1;
      this.buildLaws();
      this.buildConstants();
      this.bind();
      game.on((type, data) => this.onEvent(type, data));
      this.update();
      this.renderGallery();
    }

    buildLaws() {
      const list = $('#law-list');
      list.innerHTML = MOTE.LAWS.map(cardHTML).join('');
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (card && this.game.buyLaw(card.dataset.id)) this.update();
      });
    }

    buildConstants() {
      const list = $('#constant-list');
      list.innerHTML = MOTE.CONSTANTS.map(cardHTML).join('');
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (card && this.game.buyConstant(card.dataset.id)) this.updateArchive();
      });
    }

    bind() {
      const archive = $('#archive'), confirm = $('#confirm-crystal');
      document.querySelectorAll('[data-close]').forEach((b) =>
        b.addEventListener('click', () => b.closest('dialog').close()));
      $('#archive-btn').addEventListener('click', () => { this.updateArchive(); archive.showModal(); });
      $('#crystallize').addEventListener('click', () => {
        if (!this.game.canCrystallize()) return;
        $('#cc-name').textContent = MOTE.classify(this.game.metrics);
        $('#cc-gain').textContent = fmt(this.game.stardustGain());
        confirm.showModal();
      });
      $('#cc-go').addEventListener('click', () => {
        confirm.close();
        this.game.crystallize(this.renderer.snapshot());
      });
      $('#speed').addEventListener('click', () => {
        const speeds = [1, 2, 4];
        const s = this.game.state;
        s.speed = speeds[(speeds.indexOf(s.speed) + 1) % speeds.length];
        this.update();
      });
      $('#hand-mode').addEventListener('click', () => {
        this.scatter = !this.scatter;
        $('#hand-mode').textContent = this.scatter ? 'Scatter' : 'Gather';
        $('#hand-mode').classList.toggle('scatter', this.scatter);
      });
      $('#laws-toggle').addEventListener('click', () => {
        const open = $('#laws').classList.toggle('open');
        document.body.classList.toggle('laws-open', open);
      });
      $('#reset').addEventListener('click', () => $('#confirm-reset').showModal());
      $('#reset-go').addEventListener('click', () => {
        this.game.reset();
        $('#confirm-reset').close();
        archive.close();
        this.renderGallery();
        this.update();
      });
    }

    onEvent(type, data) {
      if (type === 'milestone') this.toast(`<b>${data.name}</b> · +${fmt(data.reward)} order`);
      if (type === 'unlock') {
        this.toast(`New law: <b>${data.name}</b>`, 'unlock');
        const card = document.querySelector(`#law-list [data-id="${data.id}"]`);
        if (card) { card.classList.remove('fresh'); void card.offsetWidth; card.classList.add('fresh'); }
      }
      if (type === 'crystallize') {
        this.toast(`Crystallized <b>${data.name}</b> · +${fmt(data.stardust)} stardust`);
        this.renderGallery();
        this.renderer.resize();
      }
      this.update();
    }

    toast(html, cls = '') {
      const el = document.createElement('div');
      el.className = `toast ${cls}`;
      el.innerHTML = html;
      $('#toasts').appendChild(el);
      setTimeout(() => el.remove(), 4600);
      const all = $('#toasts').children;
      if (all.length > 4) all[0].remove();
    }

    fillCard(card, item, level, price, wallet, unlocked) {
      const maxed = level >= item.max;
      card.classList.toggle('locked', !unlocked);
      card.classList.toggle('maxed', unlocked && maxed);
      card.classList.toggle('poor', unlocked && !maxed && wallet < price);
      card.disabled = !unlocked || maxed || wallet < price;
      card.querySelector('.name').textContent = unlocked ? item.name : 'Unknown law';
      card.querySelector('.lvl').textContent = unlocked ? `${level} / ${item.max}` : '';
      card.querySelector('.desc').textContent = unlocked ? item.desc : (item.hint || '');
      card.querySelector('.effect').textContent = unlocked && item.effect ? item.effect(level) : '';
      card.querySelector('.cost').textContent = !unlocked ? '' : maxed ? 'max' : fmt(price);
    }

    update() {
      const g = this.game, s = g.state, m = g.metrics;
      $('#order').textContent = fmt(s.order);
      $('#rate').textContent = `+${(g.orderRate() * this.timeScale * s.speed).toFixed(1)} / s`;
      $('#cosmos-name').textContent = `Cosmos ${roman(s.cosmos)}`;
      $('#speed').textContent = `${s.speed}×`;
      if (m) {
        $('#structure').textContent = MOTE.classify(m);
        document.querySelectorAll('.meter').forEach((el) => {
          el.querySelector('i').style.width = `${Math.round(m[el.dataset.key] * 100)}%`;
        });
        const dust = g.sim.n - m.bodies - m.stars - m.holes;
        $('#census').innerHTML = `${dust} dust · ${m.bodies} bodies<br>${m.stars} stars · ${m.holes} holes`;
      }
      for (const law of MOTE.LAWS) {
        const card = document.querySelector(`#law-list [data-id="${law.id}"]`);
        this.fillCard(card, law, g.level(law.id), g.lawCost(law), s.order, !!s.unlocked[law.id]);
      }
      const next = g.nextMilestone();
      $('#goal').innerHTML = next ? `Next: <strong>${next.name}</strong> · ${next.hint}` : 'Every milestone reached. Crystallize, and find a new shape.';
      const cr = $('#crystallize');
      cr.disabled = !g.canCrystallize();
      cr.textContent = g.canCrystallize() ? `Crystallize +${fmt(g.stardustGain())}` : `Crystallize · ${fmt(s.cosmosOrder)}/200`;
    }

    updateArchive() {
      const g = this.game;
      $('#stardust').textContent = fmt(g.state.stardust);
      for (const c of MOTE.CONSTANTS) {
        const card = document.querySelector(`#constant-list [data-id="${c.id}"]`);
        this.fillCard(card, c, g.constant(c.id), g.constantCost(c), g.state.stardust, true);
      }
    }

    renderGallery() {
      const gallery = this.game.state.gallery;
      const el = $('#gallery');
      if (!gallery.length) {
        el.innerHTML = '<p class="empty">Nothing yet. Bring a cosmos to order, then crystallize it.</p>';
        return;
      }
      el.innerHTML = '';
      for (const g of gallery) {
        const fig = document.createElement('figure');
        fig.className = 'plate';
        const img = document.createElement('img');
        img.src = g.img; img.alt = g.name;
        const cap = document.createElement('figcaption');
        cap.textContent = g.name;
        const meta = document.createElement('span');
        meta.textContent = `Cosmos ${roman(g.cosmos)} · order ${g.order}% · ${g.stars}★`;
        cap.appendChild(meta);
        fig.append(img, cap);
        el.appendChild(fig);
      }
    }
  }

  MOTE.UI = UI;
  MOTE.fmt = fmt;
})(window.MOTE);
