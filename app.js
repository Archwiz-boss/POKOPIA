// app.js — Pokopia main application logic

// ============================================================
// CONSTANTS
// ============================================================

const POKEAPI       = 'https://pokeapi.co/api/v2';
const ARTWORK_BASE  = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
const SPRITE_BASE   = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const TOTAL_POKEMON = 1025;
const PAGE_SIZE     = 48;

const TYPE_NAMES_ZH = {
  normal:'一般', fire:'火', water:'水', electric:'電', grass:'草', ice:'冰',
  fighting:'格鬥', poison:'毒', ground:'地面', flying:'飛行', psychic:'超能力',
  bug:'蟲', rock:'岩石', ghost:'幽靈', dragon:'龍', dark:'惡', steel:'鋼', fairy:'妖精',
};

const STAT_NAMES = {
  hp:'HP', attack:'攻擊', defense:'防禦',
  'special-attack':'特攻', 'special-defense':'特防', speed:'速度',
};

const STAT_COLORS = {
  hp:'#ff5959', attack:'#f5ac78', defense:'#fae078',
  'special-attack':'#9db7f5', 'special-defense':'#a7db8d', speed:'#fa92b2',
};

const GEN_RANGES = [
  [1, 151], [152, 251], [252, 386], [387, 493],
  [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025],
];

const TYPE_BG_COLORS = {
  normal:'#9099a1', fire:'#ff6b35', water:'#4d90fe', electric:'#f0c040',
  grass:'#49d0b0', ice:'#74cec0', fighting:'#ce4257', poison:'#ab7ac8',
  ground:'#d97845', flying:'#89aae6', psychic:'#f05282', bug:'#a2b831',
  rock:'#c5b78c', ghost:'#6e5994', dragon:'#6253be', dark:'#595761',
  steel:'#5a8ea2', fairy:'#ec8fe6',
};

function getGeneration(id) {
  for (let i = 0; i < GEN_RANGES.length; i++) {
    const [lo, hi] = GEN_RANGES[i];
    if (id >= lo && id <= hi) return i + 1;
  }
  return 9;
}

function artworkUrl(id)  { return `${ARTWORK_BASE}/${id}.png`; }
function spriteUrl(id)   { return `${SPRITE_BASE}/${id}.png`; }
function padNum(id)       { return `#${String(id).padStart(4, '0')}`; }
function capitalize(s)    { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ============================================================
// STATE
// ============================================================

const state = {
  allPokemon:  [],    // [{id, name}] — full list
  filtered:    [],    // after applying current filters
  collection:  {},    // {id: 'caught'|'seen'}
  currentView: 'pokedex',
  filters: { search: '', type: 'all', gen: 'all', status: 'all' },
  page:        0,
  loading:     false,
  typeIdCache: {},    // {typeName: Set<id>}
};

// ============================================================
// API HELPERS
// ============================================================

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function loadPokemonList() {
  if (await DB.hasPokemonList()) {
    return DB.getPokemonList();
  }
  const data = await fetchJSON(`${POKEAPI}/pokemon?limit=${TOTAL_POKEMON}&offset=0`);
  const list = data.results.map((p, i) => {
    // URL is like https://pokeapi.co/api/v2/pokemon/1/
    const parts = p.url.split('/').filter(Boolean);
    const id = parseInt(parts[parts.length - 1], 10);
    return { id, name: p.name };
  }).filter(p => p.id <= TOTAL_POKEMON);
  await DB.savePokemonList(list);
  return list;
}

async function loadPokemonDetails(id) {
  const cached = await DB.getPokemonDetails(id);
  if (cached) return cached;

  const [pokemon, species] = await Promise.all([
    fetchJSON(`${POKEAPI}/pokemon/${id}`),
    fetchJSON(`${POKEAPI}/pokemon-species/${id}`).catch(() => null),
  ]);

  const nameZh = species
    ? (species.names.find(n => n.language.name === 'zh-Hant') ||
       species.names.find(n => n.language.name === 'zh-Hans'))?.name || null
    : null;

  const details = {
    id,
    name:   pokemon.name,
    nameZh,
    types:  pokemon.types.map(t => t.type.name),
    stats:  pokemon.stats.map(s => ({ name: s.stat.name, base: s.base_stat })),
    height: pokemon.height,
    weight: pokemon.weight,
    abilities: pokemon.abilities.map(a => ({
      name:     a.ability.name,
      isHidden: a.is_hidden,
    })),
    evoChainUrl: species?.evolution_chain?.url || null,
    genera: species
      ? (species.genera.find(g => g.language.name === 'zh-Hant') ||
         species.genera.find(g => g.language.name === 'en'))?.genus || ''
      : '',
  };

  await DB.savePokemonDetails(details);
  return details;
}

async function loadTypeIds(typeName) {
  if (state.typeIdCache[typeName]) return state.typeIdCache[typeName];

  let ids = await DB.getTypeCache(typeName);
  if (!ids) {
    const data = await fetchJSON(`${POKEAPI}/type/${typeName}`);
    ids = data.pokemon
      .map(p => {
        const parts = p.pokemon.url.split('/').filter(Boolean);
        return parseInt(parts[parts.length - 1], 10);
      })
      .filter(id => id <= TOTAL_POKEMON);
    await DB.saveTypeCache(typeName, ids);
  }

  state.typeIdCache[typeName] = new Set(ids);
  return state.typeIdCache[typeName];
}

async function loadEvolutionChain(url) {
  try {
    const data = await fetchJSON(url);
    const chain = [];
    let node = data.chain;
    while (node) {
      const parts = node.species.url.split('/').filter(Boolean);
      const id = parseInt(parts[parts.length - 1], 10);
      chain.push({ id, name: node.species.name });
      node = node.evolves_to?.[0] || null;
    }
    return chain;
  } catch (_) {
    return null;
  }
}

// ============================================================
// FILTERS
// ============================================================

async function applyFilters() {
  const { search, type, gen, status } = state.filters;
  let list = state.allPokemon;

  // Generation filter (by ID range, instant)
  if (gen !== 'all') {
    const g = parseInt(gen, 10);
    const [lo, hi] = GEN_RANGES[g - 1];
    list = list.filter(p => p.id >= lo && p.id <= hi);
  }

  // Collection view: only show collected Pokemon
  if (state.currentView === 'collection') {
    const collectionIds = new Set(Object.keys(state.collection).map(Number));
    list = list.filter(p => collectionIds.has(p.id));
  }

  // Status filter
  if (status !== 'all') {
    list = list.filter(p => state.collection[p.id] === status);
  }

  // Type filter (async — may need API call)
  if (type !== 'all') {
    showTypeLoading(true);
    try {
      const typeIds = await loadTypeIds(type);
      list = list.filter(p => typeIds.has(p.id));
    } finally {
      showTypeLoading(false);
    }
  }

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    // Also match padded number like "001"
    list = list.filter(p =>
      p.name.includes(q) ||
      String(p.id).includes(q) ||
      String(p.id).padStart(4, '0').includes(q)
    );
  }

  state.filtered = list;
  state.page = 0;
  renderGrid();
}

// ============================================================
// UI — GRID
// ============================================================

function renderGrid() {
  const grid = document.getElementById('pokemon-grid');
  const loadMore = document.getElementById('load-more');
  const emptyState = document.getElementById('empty-state');

  grid.innerHTML = '';

  if (state.filtered.length === 0) {
    grid.classList.add('hidden');
    loadMore.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  grid.classList.remove('hidden');

  const end = (state.page + 1) * PAGE_SIZE;
  const slice = state.filtered.slice(0, end);

  for (const p of slice) {
    grid.appendChild(renderCard(p));
  }

  if (end < state.filtered.length) {
    loadMore.classList.remove('hidden');
    loadMore.textContent = `載入更多 (${state.filtered.length - end} 剩餘)`;
  } else {
    loadMore.classList.add('hidden');
  }
}

function renderCard(pokemon) {
  const { id, name } = pokemon;
  const status = state.collection[id];

  const card = document.createElement('div');
  card.className = `poke-card${status === 'caught' ? ' caught' : status === 'seen' ? ' seen' : ''}`;
  card.dataset.id = id;

  if (status) {
    const dot = document.createElement('div');
    dot.className = 'status-dot';
    card.appendChild(dot);
  }

  const num = document.createElement('div');
  num.className = 'poke-num';
  num.textContent = padNum(id);
  card.appendChild(num);

  const wrap = document.createElement('div');
  wrap.className = 'poke-img-wrap';

  const img = document.createElement('img');
  img.src = artworkUrl(id);
  img.alt = name;
  img.loading = 'lazy';
  img.onerror = () => { img.src = spriteUrl(id); };
  wrap.appendChild(img);
  card.appendChild(wrap);

  const nameEl = document.createElement('div');
  nameEl.className = 'poke-name';
  nameEl.textContent = capitalize(name);
  card.appendChild(nameEl);

  // Show cached types if available
  DB.getPokemonDetails(id).then(details => {
    if (details?.types?.length) {
      const badges = document.createElement('div');
      badges.className = 'type-badges';
      for (const t of details.types) {
        const b = document.createElement('span');
        b.className = `type-badge type-${t}`;
        b.textContent = TYPE_NAMES_ZH[t] || t;
        badges.appendChild(b);
      }
      card.appendChild(badges);
    }
  });

  card.addEventListener('click', () => openDetail(id));
  return card;
}

function updateCardStatus(id) {
  const card = document.querySelector(`.poke-card[data-id="${id}"]`);
  if (!card) return;

  const status = state.collection[id];
  card.classList.toggle('caught', status === 'caught');
  card.classList.toggle('seen',   status === 'seen');

  const oldDot = card.querySelector('.status-dot');
  if (oldDot) oldDot.remove();

  if (status) {
    const dot = document.createElement('div');
    dot.className = 'status-dot';
    card.prepend(dot);
  }
}

// ============================================================
// UI — DETAIL MODAL
// ============================================================

async function openDetail(id) {
  const modal = document.getElementById('detail-modal');
  const content = document.getElementById('detail-content');

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  content.innerHTML = `
    <div class="detail-loading">
      <div class="pokeball-spinner"></div>
      <p>載入中...</p>
    </div>`;

  try {
    const details = await loadPokemonDetails(id);
    renderDetailContent(details);

    // Update card to show type badges now that we have details
    const card = document.querySelector(`.poke-card[data-id="${id}"]`);
    if (card && !card.querySelector('.type-badges') && details.types?.length) {
      const badges = document.createElement('div');
      badges.className = 'type-badges';
      for (const t of details.types) {
        const b = document.createElement('span');
        b.className = `type-badge type-${t}`;
        b.textContent = TYPE_NAMES_ZH[t] || t;
        badges.appendChild(b);
      }
      card.appendChild(badges);
    }
  } catch (err) {
    content.innerHTML = `
      <div class="detail-loading">
        <p>載入失敗，請確認網路連線</p>
        <button onclick="openDetail(${id})" style="
          margin-top:12px; padding:10px 20px;
          background:var(--accent); border:none; border-radius:8px;
          color:#fff; font-size:14px; cursor:pointer;">重試</button>
      </div>`;
  }
}

function renderDetailContent(details) {
  const modal   = document.getElementById('detail-modal');
  const content = document.getElementById('detail-content');
  const { id, name, nameZh, types, stats, height, weight, abilities, evoChainUrl, genera } = details;
  const status  = state.collection[id];

  const primaryType = types[0] || 'normal';
  const bgColor     = TYPE_BG_COLORS[primaryType] || '#666';

  // ── Hero section ──────────────────────────────────────────
  const heroHtml = `
    <div class="detail-hero">
      <div class="detail-hero-bg" style="background:${bgColor}"></div>
      <img src="${artworkUrl(id)}" alt="${name}"
           onerror="this.src='${spriteUrl(id)}'">
      <div class="detail-num">${padNum(id)}${genera ? ' · ' + genera : ''}</div>
      <div class="detail-name">${capitalize(name)}</div>
      ${nameZh ? `<div class="detail-name-zh">${nameZh}</div>` : ''}
      <div class="detail-types">
        ${types.map(t => `<span class="detail-type-badge type-${t}">${TYPE_NAMES_ZH[t] || t}</span>`).join('')}
      </div>
    </div>`;

  // ── Collect buttons ───────────────────────────────────────
  const collectHtml = `
    <div class="collect-row">
      <button class="collect-btn ${status === 'caught' ? 'active-caught' : ''}"
              id="btn-caught" onclick="toggleCollection(${id}, 'caught')">
        <span>✓</span> 捕獲
      </button>
      <button class="collect-btn ${status === 'seen' ? 'active-seen' : ''}"
              id="btn-seen" onclick="toggleCollection(${id}, 'seen')">
        <span>👁</span> 已見
      </button>
    </div>`;

  // ── Info grid ─────────────────────────────────────────────
  const infoHtml = `
    <div class="detail-section">
      <div class="detail-section-title">基本資訊</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">身高</div>
          <div class="info-value">${(height / 10).toFixed(1)} m</div>
        </div>
        <div class="info-item">
          <div class="info-label">體重</div>
          <div class="info-value">${(weight / 10).toFixed(1)} kg</div>
        </div>
        ${abilities.map(a => `
          <div class="info-item">
            <div class="info-label">${a.isHidden ? '隱藏特性' : '特性'}</div>
            <div class="info-value">${capitalize(a.name.replace(/-/g, ' '))}</div>
          </div>`).join('')}
      </div>
    </div>`;

  // ── Stats ─────────────────────────────────────────────────
  const statsHtml = `
    <div class="detail-section">
      <div class="detail-section-title">基礎能力值</div>
      ${stats.map(s => {
        const pct = Math.min(100, Math.round(s.base / 255 * 100));
        const color = STAT_COLORS[s.name] || '#aaa';
        return `
          <div class="stat-row">
            <div class="stat-name">${STAT_NAMES[s.name] || s.name}</div>
            <div class="stat-val">${s.base}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill"
                   style="width:${pct}%;background:${color}"></div>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  // ── Evolution placeholder (loaded async) ──────────────────
  const evoHtml = `
    <div class="detail-section" id="evo-section">
      <div class="detail-section-title">進化鏈</div>
      <div id="evo-content" style="color:var(--text-muted);font-size:13px">
        載入進化鏈...</div>
    </div>`;

  content.innerHTML = heroHtml + collectHtml + infoHtml + statsHtml +
    (evoChainUrl ? evoHtml : '');

  // Animate stat bars on next frame
  requestAnimationFrame(() => {
    document.querySelectorAll('.stat-bar-fill').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  });

  // Load evolution chain asynchronously
  if (evoChainUrl) {
    loadEvolutionChain(evoChainUrl).then(chain => {
      const evoContent = document.getElementById('evo-content');
      if (!evoContent || !chain) return;
      if (chain.length <= 1) {
        evoContent.textContent = '此寶可夢無進化';
        return;
      }
      evoContent.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'evo-chain';

      chain.forEach((evo, i) => {
        if (i > 0) {
          const arrow = document.createElement('div');
          arrow.className = 'evo-arrow';
          arrow.textContent = '→';
          wrap.appendChild(arrow);
        }
        const evoPoke = document.createElement('div');
        evoPoke.className = 'evo-pokemon';
        evoPoke.innerHTML = `
          <img src="${artworkUrl(evo.id)}" alt="${evo.name}"
               onerror="this.src='${spriteUrl(evo.id)}'">
          <span>${capitalize(evo.name)}</span>`;
        evoPoke.addEventListener('click', () => openDetail(evo.id));
        wrap.appendChild(evoPoke);
      });

      evoContent.appendChild(wrap);
    });
  }
}

function closeDetail() {
  const modal = document.getElementById('detail-modal');
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('detail-content').innerHTML = '';
}

// ============================================================
// COLLECTION MANAGEMENT
// ============================================================

async function toggleCollection(id, action) {
  const current = state.collection[id];
  let next = null;

  if (action === 'caught') {
    next = current === 'caught' ? null : 'caught';
  } else if (action === 'seen') {
    // 'seen' only if not already caught; if caught, clicking seen does nothing
    if (current === 'caught') return;
    next = current === 'seen' ? null : 'seen';
  }

  await DB.setCollection(id, next);

  if (next === null) {
    delete state.collection[id];
  } else {
    state.collection[id] = next;
  }

  // Update collection buttons inside modal
  const btnCaught = document.getElementById('btn-caught');
  const btnSeen   = document.getElementById('btn-seen');
  if (btnCaught) {
    btnCaught.className = `collect-btn ${next === 'caught' ? 'active-caught' : ''}`;
  }
  if (btnSeen) {
    btnSeen.className = `collect-btn ${next === 'seen' ? 'active-seen' : ''}`;
  }

  updateCardStatus(id);
  updateProgressBadge();
}

// ============================================================
// UI — HELPERS
// ============================================================

function updateProgressBadge() {
  DB.getCollectionCounts().then(({ caught, seen }) => {
    const el = document.getElementById('catch-progress');
    el.innerHTML = `<span class="caught">${caught}</span> / ${TOTAL_POKEMON}`;
  });
}

function showTypeLoading(on) {
  const bar = document.getElementById('filter-bar');
  if (on) bar.style.opacity = '0.6';
  else    bar.style.opacity = '';
}

function showMainLoading(on) {
  document.getElementById('loading-state').classList.toggle('hidden', !on);
  document.getElementById('pokemon-grid').classList.toggle('hidden', on);
}

// ============================================================
// NAVIGATION & FILTERS
// ============================================================

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // Adjust filter-bar visibility for collection view
  const statusFilter = document.getElementById('status-filter');
  if (view === 'collection') {
    statusFilter.parentElement.style.display = 'none';
  } else {
    statusFilter.parentElement.style.display = '';
  }

  applyFilters();
}

// ============================================================
// INIT
// ============================================================

async function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  showMainLoading(true);

  try {
    // Load collection first (instant from DB)
    state.collection = await DB.getCollection();
    updateProgressBadge();

    // Load Pokemon list
    state.allPokemon = await loadPokemonList();

    showMainLoading(false);
    await applyFilters();
  } catch (err) {
    showMainLoading(false);
    document.getElementById('pokemon-grid').classList.remove('hidden');
    document.getElementById('pokemon-grid').innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--text-muted)">
        <div style="font-size:40px;margin-bottom:12px">⚠️</div>
        <p>載入失敗，請確認網路連線後重新整理</p>
        <button onclick="location.reload()" style="
          margin-top:16px;padding:10px 20px;
          background:var(--accent);border:none;border-radius:8px;
          color:#fff;font-size:14px;cursor:pointer;">重新整理</button>
      </div>`;
  }

  // ── Event listeners ──────────────────────────────────────

  document.getElementById('search-input').addEventListener('input', e => {
    state.filters.search = e.target.value.trim().toLowerCase();
    applyFilters();
  });

  document.getElementById('gen-filter').addEventListener('change', e => {
    state.filters.gen = e.target.value;
    applyFilters();
  });

  document.getElementById('type-filter').addEventListener('change', e => {
    state.filters.type = e.target.value;
    applyFilters();
  });

  document.getElementById('status-filter').addEventListener('change', e => {
    state.filters.status = e.target.value;
    applyFilters();
  });

  document.getElementById('load-more').addEventListener('click', () => {
    state.page++;
    renderGrid();
    // Scroll to newly added content
    window.scrollBy({ top: 200, behavior: 'smooth' });
  });

  // Detail modal close
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeDetail();
  });

  document.getElementById('modal-close-btn').addEventListener('click', closeDetail);

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

document.addEventListener('DOMContentLoaded', init);
