// db.js — IndexedDB wrapper using Dexie.js
// Tables:
//   pokemonList    : { id, name }
//   pokemonDetails : { id, types, stats, ... }
//   typeCache      : { typeName, pokemonIds[] }
//   collection     : { id, status, updatedAt }
//   appCache       : { key, data, cachedAt }  ← general-purpose cache

const db = new Dexie('PokopiaDB');

db.version(1).stores({
  pokemonList:    'id, name',
  pokemonDetails: 'id',
  typeCache:      'typeName',
  collection:     'id, status',
});

// Version 2: add appCache table for zh names + Pokopia game data
db.version(2).stores({
  pokemonList:    'id, name',
  pokemonDetails: 'id',
  typeCache:      'typeName',
  collection:     'id, status',
  appCache:       'key',
});

const DB = {
  // ── Pokemon List ──────────────────────────────────────────────────────────

  async getPokemonList() {
    return db.pokemonList.orderBy('id').toArray();
  },

  async savePokemonList(list) {
    await db.pokemonList.bulkPut(list);
  },

  async hasPokemonList() {
    return (await db.pokemonList.count()) > 0;
  },

  // ── Pokemon Details ───────────────────────────────────────────────────────

  async getPokemonDetails(id) {
    return db.pokemonDetails.get(id);
  },

  async savePokemonDetails(details) {
    await db.pokemonDetails.put(details);
  },

  // ── Type Cache ────────────────────────────────────────────────────────────

  async getTypeCache(typeName) {
    const entry = await db.typeCache.get(typeName);
    return entry ? entry.pokemonIds : null;
  },

  async saveTypeCache(typeName, pokemonIds) {
    await db.typeCache.put({ typeName, pokemonIds });
  },

  // ── Collection ────────────────────────────────────────────────────────────

  async getCollection() {
    const entries = await db.collection.toArray();
    const map = {};
    for (const e of entries) map[e.id] = e.status;
    return map;
  },

  async setCollection(id, status) {
    if (status === null) {
      await db.collection.delete(id);
    } else {
      await db.collection.put({ id, status, updatedAt: Date.now() });
    }
  },

  async getCollectionCounts() {
    const caught = await db.collection.where('status').equals('caught').count();
    const seen   = await db.collection.where('status').equals('seen').count();
    return { caught, seen };
  },

  async getCollectionIds(status) {
    if (status === 'any') {
      return (await db.collection.toArray()).map(e => e.id);
    }
    return db.collection.where('status').equals(status).primaryKeys();
  },

  // ── App Cache (zh names, Pokopia data) ───────────────────────────────────

  async getCacheEntry(key) {
    const entry = await db.appCache.get(key);
    return entry ? entry.data : null;
  },

  async setCacheEntry(key, data) {
    await db.appCache.put({ key, data, cachedAt: Date.now() });
  },
};
