// app.js — Pokopia main application logic

// ============================================================
// CONSTANTS
// ============================================================

const POKEAPI          = 'https://pokeapi.co/api/v2';
const ARTWORK_BASE     = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
const SPRITE_BASE      = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const POKOPIA_GUIDE    = 'https://hanchoonie.github.io/pokopia_guide';
const ZH_NAMES_URL     = 'https://raw.githubusercontent.com/sindresorhus/pokemon/main/data/zh-hant.json';
const TOTAL_POKEMON    = 1025;
const PAGE_SIZE        = 48;

// ── Habitat environment colours (Chinese names from hanchoonie data) ─────────
const HABITAT_COLORS = {
  '明亮': '#f5c842', '清涼': '#5ba3f5', '黑暗': '#9b7fd4',
  '乾燥': '#e8874a', '潮濕': '#4ecdc4', '溫暖': '#ff7043',
};

// ── Type / Stat constants ──────────────────────────────────────────────────────
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
  [1,151],[152,251],[252,386],[387,493],
  [494,649],[650,721],[722,809],[810,905],[906,1025],
];
const TYPE_BG_COLORS = {
  normal:'#9099a1', fire:'#ff6b35', water:'#4d90fe', electric:'#f0c040',
  grass:'#49d0b0', ice:'#74cec0', fighting:'#ce4257', poison:'#ab7ac8',
  ground:'#d97845', flying:'#89aae6', psychic:'#f05282', bug:'#a2b831',
  rock:'#c5b78c', ghost:'#6e5994', dragon:'#6253be', dark:'#595761',
  steel:'#5a8ea2', fairy:'#ec8fe6',
};

function artworkUrl(id) { return `${ARTWORK_BASE}/${id}.png`; }
function spriteUrl(id)  { return `${SPRITE_BASE}/${id}.png`; }
function padNum(id)     { return `#${String(id).padStart(4, '0')}`; }
function capitalize(s)  { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ============================================================
// STATE
// ============================================================

const state = {
  allPokemon:       [],
  filtered:         [],
  collection:       {},
  zhNames:          [],   // [null, '妙蛙種子', ...] — index 0 = national ID 1
  pokopiaPokemons:  {},   // { Chinese name → pokopia data }
  pokopiaItems:     [],   // POKEMON_FAVORITE_THINGS
  pokopiaHabitats:  [],   // HABITATS
  currentView:      'pokedex',
  filters: { search: '', type: 'all', gen: 'all', status: 'all' },
  page:             0,
  typeIdCache:      {},
  habSearchQuery:   '',
};

// ============================================================
// SCRIPT LOADER
// ============================================================

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ============================================================
// DATA LOADERS
// ============================================================

async function loadZhNames() {
  const cached = await DB.getCacheEntry('zhNames');
  if (cached) { state.zhNames = cached; return; }
  try {
    const res = await fetch(ZH_NAMES_URL);
    const arr = await res.json();
    state.zhNames = arr;
    await DB.setCacheEntry('zhNames', arr);
  } catch (_) {}
}

async function loadHancoonieData() {
  // Try IndexedDB cache first
  const cached = await DB.getCacheEntry('pokopiaData_v3');
  if (cached) {
    buildPokopiaLookup(cached.pokemons, cached.habitats, cached.items);
    return;
  }

  // Load external scripts (only if not already loaded this session)
  try {
    if (typeof POKEMONS === 'undefined') {
      await loadScript(`${POKOPIA_GUIDE}/js/shared/data.js`);
    }
    if (typeof POKEMON_FAVORITE_THINGS === 'undefined') {
      await loadScript(`${POKOPIA_GUIDE}/js/shared/favorite_things_data.js`);
    }
  } catch (_) {
    return; // Offline or unavailable — non-fatal
  }

  /* global POKEMONS, HABITATS, POKEMON_FAVORITE_THINGS */
  const pokemons = typeof POKEMONS               !== 'undefined' ? POKEMONS               : [];
  const habitats = typeof HABITATS               !== 'undefined' ? HABITATS               : [];
  const items    = typeof POKEMON_FAVORITE_THINGS !== 'undefined' ? POKEMON_FAVORITE_THINGS : [];

  if (pokemons.length && habitats.length && items.length) {
    await DB.setCacheEntry('pokopiaData_v3', { pokemons, habitats, items });
  }
  buildPokopiaLookup(pokemons, habitats, items);
}

function buildPokopiaLookup(pokemons, habitats, items) {
  state.pokopiaHabitats = habitats;
  state.pokopiaItems    = items;
  state.pokopiaPokemons = {};
  for (const p of pokemons) {
    state.pokopiaPokemons[p.name] = p;
  }
}

async function loadPokemonList() {
  if (await DB.hasPokemonList()) return DB.getPokemonList();
  const data = await fetch(`${POKEAPI}/pokemon?limit=${TOTAL_POKEMON}&offset=0`).then(r => r.json());
  const list = data.results.map(p => {
    const parts = p.url.split('/').filter(Boolean);
    return { id: parseInt(parts[parts.length - 1], 10), name: p.name };
  }).filter(p => p.id <= TOTAL_POKEMON);
  await DB.savePokemonList(list);
  return list;
}

async function loadPokemonDetails(id) {
  const cached = await DB.getPokemonDetails(id);
  if (cached) return cached;

  const [pokemon, species] = await Promise.all([
    fetch(`${POKEAPI}/pokemon/${id}`).then(r => r.json()),
    fetch(`${POKEAPI}/pokemon-species/${id}`).then(r => r.json()).catch(() => null),
  ]);
  const nameZh = species
    ? (species.names.find(n => n.language.name === 'zh-Hant') ||
       species.names.find(n => n.language.name === 'zh-Hans'))?.name || null
    : null;

  const details = {
    id, name: pokemon.name, nameZh,
    types:     pokemon.types.map(t => t.type.name),
    stats:     pokemon.stats.map(s => ({ name: s.stat.name, base: s.base_stat })),
    height:    pokemon.height,
    weight:    pokemon.weight,
    abilities: pokemon.abilities.map(a => ({ name: a.ability.name, isHidden: a.is_hidden })),
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
    const data = await fetch(`${POKEAPI}/type/${typeName}`).then(r => r.json());
    ids = data.pokemon
      .map(p => { const parts = p.pokemon.url.split('/').filter(Boolean); return parseInt(parts[parts.length - 1], 10); })
      .filter(id => id <= TOTAL_POKEMON);
    await DB.saveTypeCache(typeName, ids);
  }
  state.typeIdCache[typeName] = new Set(ids);
  return state.typeIdCache[typeName];
}

async function loadEvolutionChain(url) {
  try {
    const data = await fetch(url).then(r => r.json());
    const chain = [];
    let node = data.chain;
    while (node) {
      const parts = node.species.url.split('/').filter(Boolean);
      chain.push({ id: parseInt(parts[parts.length - 1], 10), name: node.species.name });
      node = node.evolves_to?.[0] || null;
    }
    return chain;
  } catch (_) { return null; }
}

// ============================================================
// FILTERS
// ============================================================

async function applyFilters() {
  const { search, type, gen, status } = state.filters;
  let list = state.allPokemon;

  if (gen !== 'all') {
    const [lo, hi] = GEN_RANGES[parseInt(gen, 10) - 1];
    list = list.filter(p => p.id >= lo && p.id <= hi);
  }
  if (state.currentView === 'collection') {
    const ids = new Set(Object.keys(state.collection).map(Number));
    list = list.filter(p => ids.has(p.id));
  }
  if (status !== 'all') {
    list = list.filter(p => state.collection[p.id] === status);
  }
  if (type !== 'all') {
    showTypeLoading(true);
    try {
      const typeIds = await loadTypeIds(type);
      list = list.filter(p => typeIds.has(p.id));
    } finally { showTypeLoading(false); }
  }
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(p => {
      const zh = state.zhNames[p.id - 1] || '';
      return p.name.includes(q) || String(p.id).includes(q) ||
             String(p.id).padStart(4,'0').includes(q) || zh.includes(q);
    });
  }
  state.filtered = list;
  state.page = 0;
  renderGrid();
}

// ============================================================
// UI — POKEMON GRID
// ============================================================

function renderGrid() {
  const grid      = document.getElementById('pokemon-grid');
  const loadMore  = document.getElementById('load-more');
  const emptyState = document.getElementById('empty-state');

  grid.innerHTML = '';
  if (state.filtered.length === 0) {
    grid.classList.add('hidden'); loadMore.classList.add('hidden');
    emptyState.classList.remove('hidden'); return;
  }
  emptyState.classList.add('hidden'); grid.classList.remove('hidden');

  const end   = (state.page + 1) * PAGE_SIZE;
  const slice = state.filtered.slice(0, end);
  for (const p of slice) grid.appendChild(renderCard(p));

  if (end < state.filtered.length) {
    loadMore.classList.remove('hidden');
    loadMore.textContent = `載入更多 (還有 ${state.filtered.length - end} 隻)`;
  } else {
    loadMore.classList.add('hidden');
  }
}

function renderCard(pokemon) {
  const { id, name } = pokemon;
  const status = state.collection[id];
  const zhName = state.zhNames[id - 1] || '';

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
  img.alt = zhName || name;
  img.loading = 'lazy';
  img.onerror = () => { img.src = spriteUrl(id); };
  wrap.appendChild(img);
  card.appendChild(wrap);

  if (zhName) {
    const zhEl = document.createElement('div');
    zhEl.className = 'poke-name-zh';
    zhEl.textContent = zhName;
    card.appendChild(zhEl);
  }
  const nameEl = document.createElement('div');
  nameEl.className = `poke-name${zhName ? ' poke-name-secondary' : ''}`;
  nameEl.textContent = capitalize(name);
  card.appendChild(nameEl);

  DB.getPokemonDetails(id).then(details => {
    if (details?.types?.length && card.isConnected) {
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
// UI — POKEMON DETAIL MODAL
// ============================================================

async function openDetail(id) {
  const modal   = document.getElementById('detail-modal');
  const content = document.getElementById('detail-content');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  content.innerHTML = `<div class="detail-loading"><div class="pokeball-spinner"></div><p>載入中...</p></div>`;

  try {
    const details = await loadPokemonDetails(id);
    renderDetailContent(details);
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
  } catch (_) {
    content.innerHTML = `
      <div class="detail-loading">
        <p>載入失敗，請確認網路連線</p>
        <button onclick="openDetail(${id})" style="margin-top:12px;padding:10px 20px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;">重試</button>
      </div>`;
  }
}

function renderDetailContent(details) {
  const content = document.getElementById('detail-content');
  const { id, name, nameZh, types, stats, height, weight, abilities, evoChainUrl, genera } = details;
  const status      = state.collection[id];
  const primaryType = types[0] || 'normal';
  const bgColor     = TYPE_BG_COLORS[primaryType] || '#666';
  const displayZh   = nameZh || state.zhNames[id - 1] || '';

  // Look up Pokopia game data by Chinese name
  const pokeInfo = state.pokopiaPokemons[displayZh] || null;

  // ── Hero ────────────────────────────────────────────────────
  const heroHtml = `
    <div class="detail-hero">
      <div class="detail-hero-bg" style="background:${bgColor}"></div>
      <img src="${artworkUrl(id)}" alt="${displayZh || name}" onerror="this.src='${spriteUrl(id)}'">
      <div class="detail-num">${padNum(id)}${genera ? ' · ' + genera : ''}</div>
      <div class="detail-name">${displayZh || capitalize(name)}</div>
      ${displayZh ? `<div class="detail-name-zh">${capitalize(name)}</div>` : ''}
      <div class="detail-types">
        ${types.map(t => `<span class="detail-type-badge type-${t}">${TYPE_NAMES_ZH[t] || t}</span>`).join('')}
      </div>
    </div>`;

  // ── Collect buttons ──────────────────────────────────────────
  const collectHtml = `
    <div class="collect-row">
      <button class="collect-btn ${status === 'caught' ? 'active-caught' : ''}" id="btn-caught" onclick="toggleCollection(${id},'caught')">
        <span>✓</span> 捕獲
      </button>
      <button class="collect-btn ${status === 'seen' ? 'active-seen' : ''}" id="btn-seen" onclick="toggleCollection(${id},'seen')">
        <span>👁</span> 已見
      </button>
    </div>`;

  // ── Pokopia section (if data available) ─────────────────────
  let pokopiaHtml = '';
  if (pokeInfo) {
    const envTags = (pokeInfo.favorite_environment || []).map(env => {
      const color = HABITAT_COLORS[env] || '#888';
      return `<span class="habitat-badge" style="background:${color}20;color:${color};border-color:${color}40">${env}</span>`;
    }).join('');

    const skillTags = (pokeInfo.skills || []).map(s =>
      `<span class="fav-tag skill-tag">${s}</span>`
    ).join('');

    const foodTags = (pokeInfo.favorite_food || []).map(f =>
      `<span class="fav-tag">${f}</span>`
    ).join('');

    const thingBtns = (pokeInfo.favorite_things || []).map(t =>
      `<button class="fav-tag fav-tag-clickable" onclick="showFavoriteItems('${t.replace(/'/g,"\\'")}')">
        ${t} <span class="fav-arrow">›</span>
      </button>`
    ).join('');

    const habLink = pokeInfo.habitat
      ? `<button class="pokopia-hab-link" onclick="jumpToHabitat('${pokeInfo.habitat.replace(/'/g,"\\'")}')">🏕️ ${pokeInfo.habitat}</button>`
      : '';

    pokopiaHtml = `
      <div class="detail-section pokopia-section">
        <div class="detail-section-title">🎮 Pokopia 遊戲資訊</div>
        ${habLink ? `<div class="pokopia-row"><span class="pokopia-label">棲息地</span>${habLink}</div>` : ''}
        ${envTags ? `<div class="pokopia-row"><span class="pokopia-label">環境</span><div class="fav-tags">${envTags}</div></div>` : ''}
        ${skillTags ? `<div class="pokopia-row"><span class="pokopia-label">技能</span><div class="fav-tags">${skillTags}</div></div>` : ''}
        ${pokeInfo.flavor && pokeInfo.flavor !== '--' ? `<div class="pokopia-row"><span class="pokopia-label">口味</span><span class="pokopia-value">${pokeInfo.flavor}</span></div>` : ''}
        ${foodTags ? `<div class="pokopia-row"><span class="pokopia-label">喜愛食物</span><div class="fav-tags">${foodTags}</div></div>` : ''}
        ${thingBtns ? `
          <div class="pokopia-fav-wrap">
            <div class="pokopia-label" style="margin-bottom:6px">
              喜歡事物 <span style="color:var(--text-muted);font-size:10px;font-weight:400">點擊查看對應道具</span>
            </div>
            <div class="fav-tags">${thingBtns}</div>
          </div>` : ''}
      </div>`;
  }

  // ── Info grid ────────────────────────────────────────────────
  const infoHtml = `
    <div class="detail-section">
      <div class="detail-section-title">基本資訊</div>
      <div class="info-grid">
        <div class="info-item"><div class="info-label">身高</div><div class="info-value">${(height/10).toFixed(1)} m</div></div>
        <div class="info-item"><div class="info-label">體重</div><div class="info-value">${(weight/10).toFixed(1)} kg</div></div>
        ${abilities.map(a => `
          <div class="info-item">
            <div class="info-label">${a.isHidden ? '隱藏特性' : '特性'}</div>
            <div class="info-value">${capitalize(a.name.replace(/-/g,' '))}</div>
          </div>`).join('')}
      </div>
    </div>`;

  // ── Stats ────────────────────────────────────────────────────
  const statsHtml = `
    <div class="detail-section">
      <div class="detail-section-title">基礎能力值</div>
      ${stats.map(s => {
        const pct = Math.min(100, Math.round(s.base/255*100));
        return `
          <div class="stat-row">
            <div class="stat-name">${STAT_NAMES[s.name] || s.name}</div>
            <div class="stat-val">${s.base}</div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%;background:${STAT_COLORS[s.name]||'#aaa'}"></div></div>
          </div>`;
      }).join('')}
    </div>`;

  // ── Evolution ────────────────────────────────────────────────
  const evoHtml = evoChainUrl ? `
    <div class="detail-section" id="evo-section">
      <div class="detail-section-title">進化鏈</div>
      <div id="evo-content" style="color:var(--text-muted);font-size:13px">載入進化鏈...</div>
    </div>` : '';

  content.innerHTML = heroHtml + collectHtml + pokopiaHtml + infoHtml + statsHtml + evoHtml;

  requestAnimationFrame(() => {
    document.querySelectorAll('.stat-bar-fill').forEach(bar => {
      const w = bar.style.width; bar.style.width = '0';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  });

  if (evoChainUrl) {
    loadEvolutionChain(evoChainUrl).then(chain => {
      const evoContent = document.getElementById('evo-content');
      if (!evoContent || !chain) return;
      if (chain.length <= 1) { evoContent.textContent = '此寶可夢無進化'; return; }
      evoContent.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'evo-chain';
      chain.forEach((evo, i) => {
        if (i > 0) { const a = document.createElement('div'); a.className = 'evo-arrow'; a.textContent = '→'; wrap.appendChild(a); }
        const el = document.createElement('div');
        el.className = 'evo-pokemon';
        const evoZh = state.zhNames[evo.id - 1] || '';
        el.innerHTML = `<img src="${artworkUrl(evo.id)}" alt="${evo.name}" onerror="this.src='${spriteUrl(evo.id)}'"><span>${evoZh || capitalize(evo.name)}</span>`;
        el.addEventListener('click', () => openDetail(evo.id));
        wrap.appendChild(el);
      });
      evoContent.appendChild(wrap);
    });
  }
}

function closeDetail() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('detail-content').innerHTML = '';
}

// ============================================================
// UI — FAVOURITE ITEMS POPUP
// ============================================================

function showFavoriteItems(category) {
  const popup   = document.getElementById('items-popup');
  const title   = document.getElementById('items-popup-title');
  const grid    = document.getElementById('items-popup-grid');

  title.textContent = `「${category}」的道具`;

  const matching = state.pokopiaItems.filter(item =>
    (item.categories || []).includes(category)
  );

  grid.innerHTML = '';
  if (matching.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px">找不到對應道具</p>`;
  } else {
    for (const item of matching) {
      const card = document.createElement('div');
      card.className = 'items-popup-card';
      const tagHtml = (item.tags || []).map(t => `<span class="fav-tag item-type-tag">${t}</span>`).join('');
      card.innerHTML = `<div class="items-popup-name">${item.name}</div>${tagHtml ? `<div class="fav-tags" style="margin-top:4px">${tagHtml}</div>` : ''}`;
      grid.appendChild(card);
    }
  }

  popup.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeFavoriteItems() {
  document.getElementById('items-popup').classList.add('hidden');
  document.body.style.overflow = '';
}

// ============================================================
// UI — HABITATS PAGE
// ============================================================

function parseMaterial(str) {
  const parts = str.replace(/\\\*/g, '*').split('*');
  return { name: parts[0].trim(), qty: parseInt(parts[1] || '1', 10) };
}

function renderHabitatsPage(query) {
  const grid = document.getElementById('habitats-grid');
  if (!grid) return;

  const q = (query || '').trim().toLowerCase();

  const list = q
    ? state.pokopiaHabitats.filter(h =>
        h.name.toLowerCase().includes(q) ||
        h.contents.join(' ').toLowerCase().includes(q) ||
        h.pokemons.map(p => p.name).join(' ').toLowerCase().includes(q)
      )
    : state.pokopiaHabitats;

  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">找不到符合的棲息地</div>`;
    return;
  }

  for (const h of list) {
    const imgUrl  = `${POKOPIA_GUIDE}/${h.img}`;
    const matHtml = h.contents.map(c => {
      const { name, qty } = parseMaterial(c);
      return `<span class="mat-chip">${name}<span class="mat-qty">×${qty}</span></span>`;
    }).join('');
    const pokeHtml = h.pokemons.map(p => {
      const stars = '★'.repeat(p.stars);
      const cls   = p.stars === 3 ? 'rare' : p.stars === 2 ? 'uncommon' : '';
      return `<span class="hab-poke-chip ${cls}">${p.name}<span class="hab-stars">${stars}</span></span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'hab-card';
    card.innerHTML = `
      <div class="hab-img-wrap">
        <img src="${imgUrl}" alt="${h.name}" onerror="this.parentElement.innerHTML='<div class=hab-img-fallback>🏕️</div>'">
        <span class="hab-num-badge">No.${h.num}${h.activity ? '<span class="activity-badge">活動</span>' : ''}</span>
      </div>
      <div class="hab-body">
        <div class="hab-name">${h.name}</div>
        <div class="hab-label">所需材料</div>
        <div class="hab-mats">${matHtml || '<span style="color:var(--text-muted)">—</span>'}</div>
        <div class="hab-label" style="margin-top:8px">出沒寶可夢</div>
        <div class="hab-pokes">${pokeHtml || '<span style="color:var(--text-muted)">—</span>'}</div>
      </div>`;
    grid.appendChild(card);
  }
}

function jumpToHabitat(habitatName) {
  closeDetail();
  switchView('habitats');
  const input = document.getElementById('hab-search');
  if (input) {
    input.value = habitatName;
    state.habSearchQuery = habitatName;
    renderHabitatsPage(habitatName);
    // Scroll to top of habitats section
    document.getElementById('habitats-section').scrollIntoView({ behavior: 'smooth' });
  }
}

// ============================================================
// COLLECTION
// ============================================================

async function toggleCollection(id, action) {
  const current = state.collection[id];
  let next = null;
  if (action === 'caught') {
    next = current === 'caught' ? null : 'caught';
  } else if (action === 'seen') {
    if (current === 'caught') return;
    next = current === 'seen' ? null : 'seen';
  }
  await DB.setCollection(id, next);
  if (next === null) delete state.collection[id];
  else state.collection[id] = next;

  const btnCaught = document.getElementById('btn-caught');
  const btnSeen   = document.getElementById('btn-seen');
  if (btnCaught) btnCaught.className = `collect-btn ${next === 'caught' ? 'active-caught' : ''}`;
  if (btnSeen)   btnSeen.className   = `collect-btn ${next === 'seen'   ? 'active-seen'   : ''}`;
  updateCardStatus(id);
  updateProgressBadge();
}

// ============================================================
// UI HELPERS
// ============================================================

function updateProgressBadge() {
  DB.getCollectionCounts().then(({ caught }) => {
    document.getElementById('catch-progress').innerHTML =
      `<span class="caught">${caught}</span> / ${TOTAL_POKEMON}`;
  });
}

function showTypeLoading(on) {
  document.getElementById('filter-bar').style.opacity = on ? '0.6' : '';
}

function showMainLoading(on) {
  document.getElementById('loading-state').classList.toggle('hidden', !on);
  document.getElementById('pokemon-grid').classList.toggle('hidden', on);
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );

  const isHabitats = view === 'habitats';
  document.getElementById('filter-bar').classList.toggle('hidden', isHabitats);
  document.getElementById('main-content').classList.toggle('hidden', isHabitats);
  document.getElementById('habitats-section').classList.toggle('hidden', !isHabitats);

  if (isHabitats) {
    if (state.pokopiaHabitats.length === 0) {
      document.getElementById('habitats-grid').innerHTML =
        `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">棲息地資料載入中，請確認網路連線</div>`;
    } else {
      renderHabitatsPage(state.habSearchQuery);
    }
  } else {
    document.getElementById('status-filter').parentElement.style.display =
      view === 'collection' ? 'none' : '';
    applyFilters();
  }
}

// ============================================================
// INIT
// ============================================================

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  showMainLoading(true);

  try {
    state.collection = await DB.getCollection();
    updateProgressBadge();

    // Load all external data in parallel
    await Promise.all([loadZhNames(), loadHancoonieData()]);

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
        <button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;">重新整理</button>
      </div>`;
  }

  // ── Event listeners ───────────────────────────────────────────
  document.getElementById('search-input').addEventListener('input', e => {
    state.filters.search = e.target.value.trim().toLowerCase();
    applyFilters();
  });
  document.getElementById('gen-filter').addEventListener('change', e => {
    state.filters.gen = e.target.value; applyFilters();
  });
  document.getElementById('type-filter').addEventListener('change', e => {
    state.filters.type = e.target.value; applyFilters();
  });
  document.getElementById('status-filter').addEventListener('change', e => {
    state.filters.status = e.target.value; applyFilters();
  });
  document.getElementById('load-more').addEventListener('click', () => {
    state.page++; renderGrid();
    window.scrollBy({ top: 200, behavior: 'smooth' });
  });

  // Detail modal
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeDetail();
  });
  document.getElementById('modal-close-btn').addEventListener('click', closeDetail);

  // Habitats search
  document.getElementById('hab-search').addEventListener('input', e => {
    state.habSearchQuery = e.target.value;
    renderHabitatsPage(e.target.value);
  });

  // Items popup
  document.getElementById('items-popup').addEventListener('click', e => {
    if (e.target.classList.contains('items-popup-backdrop')) closeFavoriteItems();
  });
  document.getElementById('items-popup-close').addEventListener('click', closeFavoriteItems);

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );
}

document.addEventListener('DOMContentLoaded', init);
