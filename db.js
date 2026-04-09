// db.js — IndexedDB wrapper using Dexie.js
// Tables:
//   pokemonList    : { id, name }               — full list of all Pokemon
//   pokemonDetails : { id, types, stats, ... }  — fetched detail data
//   typeCache      : { typeName, pokemonIds[] }  — cached type → IDs mapping
//   collection     : { id, status, updatedAt }  — user's caught/seen records

const db = new Dexie('PokopiaDB');

db.version(1).stores({
  pokemonList:    'id, name',
  pokemonDetails: 'id',
  typeCache:      'typeName',
  collection:     'id, status',
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
};
