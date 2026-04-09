// app.js — Pokopia main application logic

// ============================================================
// CONSTANTS
// ============================================================

const POKEAPI       = 'https://pokeapi.co/api/v2';
const ARTWORK_BASE  = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
const SPRITE_BASE   = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const TOTAL_POKEMON = 1025;
const PAGE_SIZE     = 48;

// External data sources
const ZH_NAMES_URL    = 'https://raw.githubusercontent.com/sindresorhus/pokemon/main/data/zh-hant.json';
const POKOPIA_CSV_URL = 'https://raw.githubusercontent.com/JEschete/PokopiaPlanning/main/reference/Pokopia.csv';

// ── Pokopia habitat meta-categories ──────────────────────────
const HABITAT_NAMES_ZH = {
  bright: '明亮', cool: '清涼', dark: '黑暗',
  dry: '乾燥', humid: '潮濕', warm: '溫暖',
};
const HABITAT_COLORS = {
  bright: '#f5c842', cool: '#5ba3f5', dark: '#9b7fd4',
  dry: '#e8874a', humid: '#4ecdc4', warm: '#ff7043',
};

// ── Pokopia favourite category translations ───────────────────
const FAVORITE_ZH = {
  'strange stuff': '奇妙物品', 'wobbly stuff': '軟爛物品',
  'metal stuff': '金屬製品',  'soft stuff': '柔軟物品',
  'watching stuff': '觀賞用品', 'dry flavors': '乾燥口味',
  'stone stuff': '石製品',    'nice breezes': '涼爽微風',
  'hard stuff': '堅硬物品',   'shiny stuff': '閃亮物品',
  'group activities': '集體活動', 'containers': '容器類',
  'lots of nature': '自然植物', 'wooden stuff': '木製品',
  'garbage': '廢棄物',        'slender objects': '細長物品',
  'spinning stuff': '旋轉物品', 'spicy flavors': '辛辣口味',
  'sour flavors': '酸味口味', 'bitter flavors': '苦味口味',
  'sweet flavors': '甜味口味', 'lots of fire': '大量火焰',
  'lots of water': '大量水源', 'symbols': '符號標誌',
  'electronics': '電子製品',  'glass stuff': '玻璃製品',
  'cute stuff': '可愛物品',   'pretty flowers': '美麗花卉',
  'colorful stuff': '彩色物品', 'rides': '騎乘工具',
  'luxury': '奢華物品',       'letters and words': '文字書本',
  'complicated stuff': '複雜物品', 'exercise': '運動器材',
  'fabric': '布料織品',       'healing': '治療用品',
  'round stuff': '圓形物品',  'noisy stuff': '響亮物品',
};

const SPECIALTY_ZH = {
  teleport: '傳送', fly: '飛翔', burn: '燃燒', crush: '破碎',
  generate: '發電', search: '搜尋', litter: '散播', trade: '交換',
  chop: '砍伐',
};

// ── Type / Stat colours ───────────────────────────────────────
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
function padNum(id)      { return `#${String(id).padStart(4, '0')}`; }
function capitalize(s)   { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ============================================================
// STATE
// ============================================================

const state = {
  allPokemon:  [],
  filtered:    [],
  collection:  {},
  zhNames:     [],     // index 0 = Pokemon ID 1 (Traditional Chinese)
  pokopiaData: {},     // keyed by lowercase normalized name
  currentView: 'pokedex',
  filters: { search: '', type: 'all', gen: 'all', status: 'all' },
  page:        0,
  typeIdCache: {},
};

// ============================================================
// CSV PARSER
// ============================================================

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Normalise CSV Pokemon name → PokeAPI key (e.g. "Mr. Mime" → "mr-mime")
function pokopiaNameKey(name) {
  return name
    .toLowerCase()
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m')
    .replace(/['.]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function parsePokopiaCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return {};

  // Header: Number,Name,Primary Location,Specialty 1,Specialty 2,
  //         Ideal Habitat,Favorite 1…6,Habitat 1…
  const result = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[0] || !cols[1]) continue;

    const key = pokopiaNameKey(cols[1]);
    const favorites = cols.slice(6, 12)
      .map(f => f.toLowerCase().trim())
      .filter(Boolean);
    const favZh = favorites.map(f => FAVORITE_ZH[f] || capitalize(f));

    result[key] = {
      idealHabitat: cols[5].toLowerCase().trim(),  // 'dark','bright',…
      favorites: favZh,
      specialty1: SPECIALTY_ZH[cols[3].toLowerCase().trim()] || cols[3].trim(),
      specialty2: SPECIALTY_ZH[cols[4].toLowerCase().trim()] || cols[4].trim(),
      primaryLocation: cols[2].trim(),
    };
  }
  return result;
}

// ============================================================
// API & EXTERNAL DATA LOADERS
// ============================================================

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// Load Traditional Chinese names (array, index 0 = ID 1)
async function loadZhNames() {
  const cached = await DB.getCacheEntry('zhNames');
  if (cached) { state.zhNames = cached; return; }

  try {
    const arr = await fetchJSON(ZH_NAMES_URL);
    state.zhNames = arr;
    await DB.setCacheEntry('zhNames', arr);
  } catch (_) {
    // Non-fatal — fall back to English names
  }
}

// Load Pokopia game data (habitats, favourites, specialties)
async function loadPokopiaData() {
  const cached = await DB.getCacheEntry('pokopiaData');
  if (cached) { state.pokopiaData = cached; return; }

  try {
    const text = await fetchText(POKOPIA_CSV_URL);
    const data = parsePokopiaCSV(text);
    state.pokopiaData = data;
    await DB.setCacheEntry('pokopiaData', data);
  } catch (_) {
    // Non-fatal — app works without Pokopia data
  }
}

async function loadPokemonList() {
  if (await DB.hasPokemonList()) return DB.getPokemonList();

  const data = await fetchJSON(`${POKEAPI}/pokemon?limit=${TOTAL_POKEMON}&offset=0`);
  const list = data.results.map(p => {
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
    } finally {
      showTypeLoading(false);
    }
  }

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(p => {
      // Match English name, ID number, or Chinese name
      const zh = state.zhNames[p.id - 1] || '';
      return p.name.includes(q) ||
             String(p.id).includes(q) ||
             String(p.id).padStart(4, '0').includes(q) ||
             zh.includes(q);
    });
  }

  state.filtered = list;
  state.page = 0;
  renderGrid();
}

// ============================================================
// UI — GRID
// ============================================================

function renderGrid() {
  const grid      = document.getElementById('pokemon-grid');
  const loadMore  = document.getElementById('load-more');
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

  // Chinese name (main) — show if available
  if (zhName) {
    const zhEl = document.createElement('div');
    zhEl.className = 'poke-name-zh';
    zhEl.textContent = zhName;
    card.appendChild(zhEl);
  }

  // English name (secondary)
  const nameEl = document.createElement('div');
  nameEl.className = `poke-name${zhName ? ' poke-name-secondary' : ''}`;
  nameEl.textContent = capitalize(name);
  card.appendChild(nameEl);

  // Type badges (from cache, lazy)
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
// UI — DETAIL MODAL
// ============================================================

async function openDetail(id) {
  const modal   = document.getElementById('detail-modal');
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

    // Back-fill type badges on card
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
        <button onclick="openDetail(${id})" style="
          margin-top:12px;padding:10px 20px;background:var(--accent);
          border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;">
          重試</button>
      </div>`;
  }
}

function renderDetailContent(details) {
  const content = document.getElementById('detail-content');
  const { id, name, nameZh, types, stats, height, weight, abilities, evoChainUrl, genera } = details;
  const status      = state.collection[id];
  const primaryType = types[0] || 'normal';
  const bgColor     = TYPE_BG_COLORS[primaryType] || '#666';

  // Use PokeAPI zh name if available, otherwise fall back to sindresorhus array
  const displayZh = nameZh || state.zhNames[id - 1] || '';

  // Pokopia game data for this Pokemon
  const pokKey     = pokopiaNameKey(name);
  const pokopiaInfo = state.pokopiaData[pokKey] || null;

  // ── Hero ─────────────────────────────────────────────────
  const heroHtml = `
    <div class="detail-hero">
      <div class="detail-hero-bg" style="background:${bgColor}"></div>
      <img src="${artworkUrl(id)}" alt="${displayZh || name}"
           onerror="this.src='${spriteUrl(id)}'">
      <div class="detail-num">${padNum(id)}${genera ? ' · ' + genera : ''}</div>
      <div class="detail-name">${displayZh || capitalize(name)}</div>
      ${displayZh ? `<div class="detail-name-zh">${capitalize(name)}</div>` : ''}
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

  // ── Pokopia game section ──────────────────────────────────
  let pokopiaHtml = '';
  if (pokopiaInfo) {
    const habitatKey   = pokopiaInfo.idealHabitat;
    const habitatLabel = HABITAT_NAMES_ZH[habitatKey] || capitalize(habitatKey);
    const habitatColor = HABITAT_COLORS[habitatKey]   || '#888';

    const favTags = pokopiaInfo.favorites
      .filter(Boolean)
      .map(f => `<span class="fav-tag">${f}</span>`)
      .join('');

    const specialties = [pokopiaInfo.specialty1, pokopiaInfo.specialty2]
      .filter(Boolean).join(' / ');

    pokopiaHtml = `
      <div class="detail-section pokopia-section">
        <div class="detail-section-title">🎮 Pokopia 遊戲資訊</div>
        <div class="pokopia-row">
          <span class="pokopia-label">理想環境</span>
          <span class="habitat-badge" style="background:${habitatColor}20;color:${habitatColor};border-color:${habitatColor}40">
            ${habitatLabel}
          </span>
        </div>
        ${pokopiaInfo.primaryLocation ? `
        <div class="pokopia-row">
          <span class="pokopia-label">主要地點</span>
          <span class="pokopia-value">${pokopiaInfo.primaryLocation}</span>
        </div>` : ''}
        ${specialties ? `
        <div class="pokopia-row">
          <span class="pokopia-label">專長技能</span>
          <span class="pokopia-value">${specialties}</span>
        </div>` : ''}
        ${favTags ? `
        <div class="pokopia-fav-wrap">
          <div class="pokopia-label" style="margin-bottom:6px">喜愛道具</div>
          <div class="fav-tags">${favTags}</div>
        </div>` : ''}
      </div>`;
  }

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
        const pct   = Math.min(100, Math.round(s.base / 255 * 100));
        const color = STAT_COLORS[s.name] || '#aaa';
        return `
          <div class="stat-row">
            <div class="stat-name">${STAT_NAMES[s.name] || s.name}</div>
            <div class="stat-val">${s.base}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  // ── Evolution placeholder ─────────────────────────────────
  const evoHtml = evoChainUrl ? `
    <div class="detail-section" id="evo-section">
      <div class="detail-section-title">進化鏈</div>
      <div id="evo-content" style="color:var(--text-muted);font-size:13px">載入進化鏈...</div>
    </div>` : '';

  content.innerHTML = heroHtml + collectHtml + pokopiaHtml + infoHtml + statsHtml + evoHtml;

  // Animate stat bars
  requestAnimationFrame(() => {
    document.querySelectorAll('.stat-bar-fill').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  });

  // Load evolution chain async
  if (evoChainUrl) {
    loadEvolutionChain(evoChainUrl).then(chain => {
      const evoContent = document.getElementById('evo-content');
      if (!evoContent || !chain) return;
      if (chain.length <= 1) { evoContent.textContent = '此寶可夢無進化'; return; }

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
        const evoZh = state.zhNames[evo.id - 1] || '';
        evoPoke.innerHTML = `
          <img src="${artworkUrl(evo.id)}" alt="${evo.name}"
               onerror="this.src='${spriteUrl(evo.id)}'">
          <span>${evoZh || capitalize(evo.name)}</span>`;
        evoPoke.addEventListener('click', () => openDetail(evo.id));
        wrap.appendChild(evoPoke);
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
    const el = document.getElementById('catch-progress');
    el.innerHTML = `<span class="caught">${caught}</span> / ${TOTAL_POKEMON}`;
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
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const statusFilter = document.getElementById('status-filter');
  statusFilter.parentElement.style.display = view === 'collection' ? 'none' : '';
  applyFilters();
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

    // Load zh names and Pokopia data in parallel (before rendering)
    await Promise.all([loadZhNames(), loadPokopiaData()]);

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
          margin-top:16px;padding:10px 20px;background:var(--accent);
          border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;">
          重新整理</button>
      </div>`;
  }

  // ── Event listeners ────────────────────────────────────────

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
    window.scrollBy({ top: 200, behavior: 'smooth' });
  });

  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeDetail();
  });

  document.getElementById('modal-close-btn').addEventListener('click', closeDetail);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

document.addEventListener('DOMContentLoaded', init);
