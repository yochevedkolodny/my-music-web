'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {createHash} = require('node:crypto');
const assert = require('assert/strict');
const {Blob} = require('buffer');
const sandbox = {Blob, TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer, Map, Set};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backup.js'), 'utf8'), sandbox);
const backup = sandbox.MusicBackup;
const json = value => JSON.parse(JSON.stringify(value));
const encode = value => new TextEncoder().encode(value);
const pref = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => ['my-music-' + key, typeof value === 'string' ? value : JSON.stringify(value)]));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS:', name); }
function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// A deliberately independent ZIP fixture builder allows malformed central/local
// metadata without relying on the implementation under test to generate it.
function zip(files, options = {}) {
  const chunks = [], directories = [];
  let offset = 0;
  for (const item of files) {
    const name = encode(item.name), localName = encode(item.localName || item.name);
    const data = typeof item.data === 'string' ? encode(item.data) : new Uint8Array(item.data || []);
    const crc = item.crc === undefined ? crc32(data) : item.crc;
    const local = new Uint8Array(30 + localName.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
    view.setUint16(6, item.flags || 0x800, true); view.setUint16(8, item.method || 0, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, localName.length, true); local.set(localName, 30);
    const dir = new Uint8Array(46 + name.length), d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(8, item.flags || 0x800, true); d.setUint16(10, item.method || 0, true);
    d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, item.offset === undefined ? offset : item.offset, true);
    dir.set(name, 46);
    if (item.mutateLocal) item.mutateLocal(view);
    if (item.mutateDir) item.mutateDir(d);
    chunks.push(local, data); directories.push(dir); offset += local.length + data.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, directories.length, true); e.setUint16(10, directories.length, true);
  e.setUint32(12, directories.reduce((a, b) => a + b.length, 0), true); e.setUint32(16, offset, true);
  if (options.mutateEnd) options.mutateEnd(e);
  return new Blob([...chunks, ...directories, end]);
}
function manifest(metadata, version = 3) {
  return {version, exportedAt: '2026-10-14T15:00:00.000Z', preferences: {}, songs: metadata ? [{metadata, audio: {file: 'tracks/1.audio', type: 'audio/flac', size: 3}, artwork: null}] : []};
}
function fixture(info, extras = [], audio = [1, 2, 3]) {
  return zip([{name: 'tracks/1.audio', data: audio}, {name: 'library.json', data: JSON.stringify(info)}, ...extras]);
}
class NativeFileBlob {
  constructor(blob, log = [], start = 0, end = blob.size, type = blob.type) {
    this.original = blob; this.log = log; this.start = start; this.end = end; this.size = end - start; this.type = type;
  }
  slice(start = 0, end = this.size, type = '') {
    assert(start >= 0 && end >= start && end <= this.size, 'native slice bounds');
    return new NativeFileBlob(this.original, this.log, this.start + start, this.start + end, type);
  }
  async arrayBuffer() {
    this.log.push(this.size);
    assert(this.size <= backup.LIMITS.CHUNK_BYTES, 'no whole native audio/archive ArrayBuffer');
    return this.original.slice(this.start, this.end).arrayBuffer();
  }
  toString() { throw new Error('Native descriptors must never be passed to Blob constructor'); }
}
const audio = new Blob([Uint8Array.from([0, 255, 64, 128, 42])], {type: 'audio/flac'});
const art = new Blob([Uint8Array.from([1, 2, 3, 4])], {type: 'image/webp'});
const song = {id: 7, name: 'Björk / 日本語', artist: 'Björk', album: 'Album', favorite: true,
  duration: 42.25, trackNumber: 8, discNumber: 2, genre: 'Experimental', year: 2026,
  custom: {nested: [null, true, 'text', {source: 'user'}]}, file: 'metadata-field-not-a-path',
  blob: audio, art};
const preferences = pref({
  'playlists-v1': [{name: 'Night', ids: [7], color: 'purple'}],
  'play-counts-v1': {'7': 18}, 'listening-seconds-v1': 412.5,
  recent: [7], 'playback-v2': {shuffle: true, queue: [7], queuePos: 0, current: 7, history: [7]},
  'manual-queue-v1': [7, 7], 'manual-played-v1': [7], 'resume-v1': {id: 7, position: 11.5},
  'favorite-listening-v1': {'7': {favoritedAt: 20, lastListened: 50}},
  'local-profile-v1': {name: 'Ada', photo: 'data:image/png;base64,profile'},
  'artist-photos-v1': {'björk': 'data:image/webp;base64,artist'},
  'appearance-v1': 'dark', 'hidden-builtins-v1': ['Most Played'],
  'unknown-future-key': ' raw string\nnot JSON ', 'future-json': '{"unrelated":true}'
});
(async () => {
  await test('web upgrade preserves exact baseline HTML/CSS and existing IndexedDB identity', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    // Baseline: my-music-web e90b6ac0eb5c9f417a452aa5be752a8946ca5c52.
    // Removing complete script elements permits the backup implementation change
    // while every byte of the existing HTML/CSS remains protected.
    const staticUI = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, '');
    assert.equal(createHash('sha256').update(staticUI, 'utf8').digest('hex'), '448f2d9bbc77012a57dc87848d5a1187f2de327f4bda2f177f9aa16d0500f473');
    assert.equal((html.match(/indexedDB\.open\(/g) || []).length, 1);
    assert.match(html, /indexedDB\.open\('my-music-local-v1',1\)/);
    assert.match(html, /createObjectStore\('tracks',\{keyPath:'id',autoIncrement:true\}\)/);
    const source = html + '\n' + fs.readFileSync(path.join(__dirname, '../backup.js'), 'utf8');
    assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\s*\.\s*clear\s*\(|indexedDB\s*\.\s*deleteDatabase\s*\(|\bdeleteObjectStore\s*\(/, 'No destructive web storage migration');
  });
  await test('v3 round trip preserves all metadata, binary contents, MIME types, and every raw preference', async () => {
    const archive = await backup.exportLibrary({songs: [song], preferences});
    assert(archive instanceof Blob); assert.equal(archive.type, 'application/zip');
    const result = await backup.readLibrary(archive);
    assert.equal(result.version, 3); assert.equal(result.songs.length, 1);
    const {blob, art: artwork, ...metadata} = result.songs[0];
    const {blob: ignored, art: ignoredArt, ...originalMetadata} = song;
    assert.deepEqual(json(metadata), originalMetadata);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(await audio.arrayBuffer()));
    assert.deepEqual(new Uint8Array(await artwork.arrayBuffer()), new Uint8Array(await art.arrayBuffer()));
    assert.equal(blob.type, audio.type); assert.equal(artwork.type, art.type);
    assert.deepEqual(json(result.preferences), preferences);
  });
  await test('empty library exports and reads profile/preferences backup', async () => {
    const result = await backup.readLibrary(await backup.exportLibrary({songs: [], preferences}));
    assert.equal(result.songs.length, 0); assert.deepEqual(json(result.preferences), preferences);
  });
  await test('all my-music-* storage values captured; unrelated app storage excluded', async () => {
    const data = {...preferences, 'other-app-secret': 'excluded'};
    const storage = {length: Object.keys(data).length, key: i => Object.keys(data)[i], getItem: key => data[key]};
    assert.deepEqual(json(backup.capturePreferences(storage)), preferences);
    sandbox.localStorage = storage;
    const result = await backup.readLibrary(await backup.exportLibrary({songs: []}));
    assert.deepEqual(json(result.preferences), preferences);
    delete sandbox.localStorage;
  });
  await test('v1/v2 compatibility retains additional legacy metadata and statistics', async () => {
    for (const version of [undefined, 1, 2]) {
      const info = {songs: [{id: 1, name: 'Legacy', artist: '', album: '', favorite: true, file: 'tracks/a.m4a', artFile: 'artwork/a.png', duration: 99, extra: {value: true}}],
        playlists: [{name: 'Old', ids: [1]}], playCounts: {'1': 4}, totalListeningSeconds: 123, recentIDs: [1]};
      if (version !== undefined) info.version = version;
      const archive = zip([{name: 'tracks/a.m4a', data: [1, 2, 3]}, {name: 'artwork/a.png', data: [5, 6]}, {name: 'library.json', data: JSON.stringify(info)}]);
      const result = await backup.readLibrary(archive);
      assert.equal(result.version, version || 1); assert.equal(result.songs[0].blob.type, 'audio/mp4');
      assert.equal(result.songs[0].art.type, 'image/png'); assert.equal(result.songs[0].duration, 99);
      assert.deepEqual(json(result.songs[0].extra), {value: true});
      assert.equal(result.preferences['my-music-listening-seconds-v1'], '123');
      assert.deepEqual(json(result.playlists), info.playlists);
    }
  });
  await test('additive preference merge remaps every known ID and is idempotent', async () => {
    const existing = pref({
      'playlists-v1': [{name: 'night', ids: [100], note: 'keep'}, {name: 'Existing', ids: [100]}],
      'play-counts-v1': {'100': 30, '200': 2}, 'listening-seconds-v1': 900,
      recent: [100], 'playback-v2': {shuffle: false, queue: [100], queuePos: 0, current: 100, history: [100]},
      'manual-queue-v1': [100], 'manual-played-v1': [100], 'resume-v1': {id: 100, position: 4},
      'favorite-listening-v1': {'200': {favoritedAt: 30, lastListened: 40, extra: 'keep'}},
      'local-profile-v1': {name: 'Before', extra: 'keep'}, 'artist-photos-v1': {other: 'data:image/png;base64,other'},
      'hidden-builtins-v1': ['Recently Added'], 'existing-custom': 'unchanged'
    });
    const existingSnapshot = json(existing);
    const map = new Map([[7, 200]]), merged = backup.mergePreferences(existing, preferences, map);
    const get = key => JSON.parse(merged['my-music-' + key]);
    assert.deepEqual(json(get('playlists-v1')), [{name: 'night', ids: [100, 200], note: 'keep', color: 'purple'}, {name: 'Existing', ids: [100]}]);
    assert.deepEqual(get('play-counts-v1'), {'100': 30, '200': 18}); assert.equal(get('listening-seconds-v1'), 900);
    assert.deepEqual(get('recent'), [100, 200]); assert.deepEqual(get('manual-queue-v1'), [100, 200, 200]);
    assert.deepEqual(get('manual-played-v1'), [100, 200]);
    assert.deepEqual(get('playback-v2'), {shuffle: true, queue: [100, 200], queuePos: 1, current: 200, history: [100, 200]});
    assert.deepEqual(get('resume-v1'), {id: 200, position: 11.5});
    assert.deepEqual(get('favorite-listening-v1'), {'200': {favoritedAt: 30, lastListened: 50, extra: 'keep'}});
    assert.equal(get('local-profile-v1').photo, 'data:image/png;base64,profile'); assert.equal(get('local-profile-v1').extra, 'keep');
    assert.equal(Object.keys(get('artist-photos-v1')).length, 2);
    assert.deepEqual(get('hidden-builtins-v1'), ['Recently Added', 'Most Played']);
    assert.equal(merged['my-music-existing-custom'], 'unchanged');
    assert.equal(merged['my-music-unknown-future-key'], preferences['my-music-unknown-future-key']);
    assert.deepEqual(json(backup.mergePreferences(merged, preferences, map)), json(merged));
    assert.deepEqual(json(backup.mergePreferences(existing, preferences, {'7': 200})), json(merged));
    assert.deepEqual(json(existing), existingSnapshot, 'input remains untouched');
  });
  await test('unmapped incoming IDs drop rather than collide with unrelated existing IDs', async () => {
    const old = pref({'playback-v2': {current: 99, queue: [99], queuePos: 0}, 'resume-v1': {id: 99, position: 8}});
    const result = backup.mergePreferences(old, preferences, new Map());
    assert.deepEqual(JSON.parse(result['my-music-manual-queue-v1']), []);
    assert.equal(JSON.parse(result['my-music-playback-v2']).current, 99);
    assert.equal(JSON.parse(result['my-music-resume-v1']).id, 99);
    assert.deepEqual(JSON.parse(result['my-music-play-counts-v1']), {});
  });
  await test('native sink writes bounded chunks with backpressure; restore stays lazy and typed', async () => {
    const big = new Blob([new Uint8Array(backup.LIMITS.CHUNK_BYTES * 3 + 99).fill(173)], {type: 'audio/wav'});
    const log = [], native = new NativeFileBlob(big, log), chunks = [];
    let writes = 0, active = false;
    const summary = await backup.exportLibrary({songs: [{id: 1, name: 'Native', blob: native, art: null}], preferences,
      sink: async chunk => {assert(chunk instanceof Uint8Array); assert(chunk.length <= backup.LIMITS.CHUNK_BYTES); assert(!active); active = true; await new Promise(resolve => setImmediate(resolve)); chunks.push(chunk); writes++; active = false;}});
    const archive = new Blob(chunks); assert.equal(summary.size, archive.size); assert.equal(summary.version, 3); assert.equal(summary.entries, 2); assert(writes > 5);
    assert(log.length >= 8); assert(log.every(size => size <= backup.LIMITS.CHUNK_BYTES));
    const restoreLog = [], result = await backup.readLibrary(new NativeFileBlob(archive, restoreLog));
    assert(result.songs[0].blob instanceof NativeFileBlob); assert.equal(result.songs[0].blob.type, 'audio/wav');
    assert.equal(result.songs[0].blob.size, big.size); assert(restoreLog.every(size => size <= backup.LIMITS.CHUNK_BYTES));
    assert.equal(await backup.crc32(result.songs[0].blob), await backup.crc32(big));
    // The no-sink path must also avoid stringifying native descriptors.
    const buffered = await backup.exportLibrary({songs: [{id: 1, name: 'Native', blob: native}], preferences: {}});
    assert.equal((await backup.readLibrary(buffered)).songs[0].blob.size, big.size);
  });
  await test('browser archive reader never requests a whole-archive ArrayBuffer', async () => {
    const big = new Blob([new Uint8Array(backup.LIMITS.CHUNK_BYTES * 2 + 100)], {type: 'audio/flac'});
    const archive = await backup.exportLibrary({songs: [{id: 1, name: 'Large', blob: big}], preferences: {}});
    archive.arrayBuffer = () => {throw Error('whole archive read');};
    const result = await backup.readLibrary(archive); assert.equal(result.songs[0].blob.size, big.size);
  });
  await test('export rejects changed native files and propagates sink failures', async () => {
    let reads = 0;
    const changing = {size: 3, type: 'audio/mpeg', slice: (start, end) => new Blob([new Uint8Array(end - start).fill(++reads)])};
    await assert.rejects(backup.exportLibrary({songs: [{id: 1, name: 'Changing', blob: changing}], preferences: {}, sink: async () => {}}), /changed/);
    await assert.rejects(backup.exportLibrary({songs: [song], preferences, sink: async () => {throw Error('disk full');}}), /disk full/);
  });
  await test('CRC32 matches a known vector and rejects corrupt audio, artwork, manifest, and extras', async () => {
    assert.equal(await backup.crc32(new Blob(['123456789'])), 0xcbf43926);
    for (const target of ['tracks/1.audio', 'artwork/1.image', 'library.json', 'extra.bin']) {
      const info = manifest({id: 1, name: 'CRC'}); info.songs[0].artwork = {file: 'artwork/1.image', type: 'image/png', size: 3};
      const files = [{name: 'tracks/1.audio', data: [1, 2, 3]}, {name: 'artwork/1.image', data: [3, 2, 1]}, {name: 'library.json', data: JSON.stringify(info)}, {name: 'extra.bin', data: [4, 5]}];
      files.find(file => file.name === target).crc = 123;
      await assert.rejects(backup.readLibrary(zip(files)), /checksum/i);
    }
  });
  await test('rejects duplicate ZIP names, unsafe paths, compressed/encrypted entries, and symlinks', async () => {
    const base = {name: 'library.json', data: JSON.stringify(manifest())};
    await assert.rejects(backup.readLibrary(zip([base, base])), /Duplicate file/);
    await assert.rejects(backup.readLibrary(zip([base, {name: 'café', data: []}, {name: 'cafe\u0301', data: []}])), /Duplicate file/);
    for (const name of ['../escape', '/absolute', 'a/../b', 'a\\b', 'C:/escape', 'a//b', 'a/./b', 'a\0b']) {
      await assert.rejects(backup.readLibrary(zip([base, {name, data: [0]}])), /unsafe file path/);
    }
    await assert.rejects(backup.readLibrary(zip([base, {name: 'compressed', data: [0], method: 8}])), /compressed/);
    await assert.rejects(backup.readLibrary(zip([base, {name: 'encrypted', data: [0], flags: 0x801}])), /Encrypted/);
    await assert.rejects(backup.readLibrary(zip([base, {name: 'link', data: [0], mutateDir: view => view.setUint32(38, 0xa1ff0000, true)}])), /Symbolic/);
  });
  await test('rejects truncation, trailing bytes, directory/header mismatch, overlap, and invalid bounds', async () => {
    const good = fixture(manifest({id: 1, name: 'Valid'}));
    for (const length of [0, 10, good.size - 1, good.size - 22]) await assert.rejects(backup.readLibrary(good.slice(0, length)));
    await assert.rejects(backup.readLibrary(new Blob([good, 'trailing'])));
    const base = {name: 'library.json', data: JSON.stringify(manifest())};
    await assert.rejects(backup.readLibrary(zip([{...base, localName: 'librarz.json'}])), /name does not match/);
    await assert.rejects(backup.readLibrary(zip([{...base, mutateLocal: view => view.setUint32(22, 123456, true)}])), /header does not match/);
    await assert.rejects(backup.readLibrary(zip([{...base, offset: 0xfffffffe}])), /bounds/);
    const overlappingSize = 3 + 30 + encode(base.name).length + encode(base.data).length;
    const inflate = view => {view.setUint32(18, overlappingSize, true); view.setUint32(22, overlappingSize, true);};
    const inflateDir = view => {view.setUint32(20, overlappingSize, true); view.setUint32(24, overlappingSize, true);};
    await assert.rejects(backup.readLibrary(zip([{name: 'audio', data: [1, 2, 3], mutateLocal: inflate, mutateDir: inflateDir}, base])), /overlapping/);
    await assert.rejects(backup.readLibrary(zip([base], {mutateEnd: view => view.setUint32(16, 0xffffff00, true)})), /bounds/);
    await assert.rejects(backup.readLibrary(zip([base], {mutateEnd: view => view.setUint16(4, 1, true)})), /Multi-disk/);
    await assert.rejects(backup.readLibrary(zip([base], {mutateEnd: view => view.setUint16(10, 0xffff, true)})), /Multi-disk|ZIP64/);
  });
  await test('manifest rejects duplicate IDs, missing media, bad size/MIME, unsupported versions, and invalid preferences', async () => {
    const variations = [
      info => {info.songs.push(info.songs[0]);},
      info => {info.songs[0].metadata.id = '1';},
      info => {info.songs[0].metadata.name = 123;},
      info => {info.songs[0].metadata.favorite = 'yes';},
      info => {info.songs[0].metadata.duration = -1;},
      info => {info.songs[0].audio.file = 'tracks/missing';},
      info => {info.songs[0].audio.file = 'library.json';},
      info => {info.songs[0].audio.size = 9;},
      info => {info.songs[0].audio.type = 'audio/flac\ninvalid';},
      info => {delete info.songs[0].artwork;},
      info => {info.version = 99;},
      info => {info.exportedAt = 'bad date';},
      info => {info.preferences['not-my-music'] = 'value';},
      info => {info.preferences['my-music-sort'] = 7;},
      info => {info.preferences['my-music-playlists-v1'] = '{"wrong":"shape"}';},
      info => {info.preferences['my-music-manual-queue-v1'] = '["bad"]';},
      info => {info.preferences['my-music-play-counts-v1'] = '{"1":-5}';},
      info => {info.preferences['my-music-resume-v1'] = '{"id":1,"position":-5}';},
      info => {info.preferences['my-music-playback-v2'] = '{"current":"oops"}';},
      info => {info.preferences['my-music-playback-v2'] = '{"queue":[],"queuePos":2}';},
      info => {info.preferences['my-music-artist-photos-v1'] = '{"artist":true}';}
    ];
    for (const mutate of variations) {
      const info = manifest({id: 1, name: 'Validation'}); mutate(info);
      await assert.rejects(backup.readLibrary(fixture(info)), undefined, mutate.toString());
    }
    await assert.rejects(backup.readLibrary(zip([{name: 'library.json', data: '{invalid json'}])), /invalid library metadata/);
  });
  await test('JSON-safe magic property names survive without prototype pollution', async () => {
    const metadata = JSON.parse('{"id":1,"name":"Keys","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    const result = await backup.readLibrary(fixture(manifest(metadata)));
    assert.equal(Object.prototype.polluted, undefined); assert.equal(result.songs[0].__proto__.polluted, true);
    const restored = await backup.readLibrary(await backup.exportLibrary({songs: result.songs, preferences: {}}));
    assert.equal(restored.songs[0].__proto__.polluted, true); assert.equal(Object.prototype.polluted, undefined);
  });
  await test('missing, absent, and zero-byte audio reject before any backup output', async () => {
    let writes = 0;
    for (const invalid of [{...song, missingFile: true}, {...song, blob: null}, {...song, blob: new Blob([])}]) {
      await assert.rejects(backup.exportLibrary({songs: [invalid], preferences: {}, sink: async () => {writes++;}}), /Restore or reimport the missing audio first/);
    }
    assert.equal(writes, 0);
    assert.equal((await backup.readLibrary(await backup.exportLibrary({songs: [], preferences: {}}))).songs.length, 0);
  });
  await test('export validates before writing and enforces ZIP32, metadata, and song limits', async () => {
    let writes = 0;
    const sink = async () => {writes++;};
    const huge = {size: backup.LIMITS.MAX_ARCHIVE_BYTES, type: 'audio/flac', slice() {throw Error('must not read');}};
    await assert.rejects(backup.exportLibrary({songs: [{id: 1, name: 'Too big', blob: huge}], preferences: {}, sink}), /4 GB/);
    assert.equal(writes, 0);
    await assert.rejects(backup.exportLibrary({songs: [{id: 1, name: 'Missing'}], preferences: {}, sink}), /missing/);
    await assert.rejects(backup.exportLibrary({songs: [song, song], preferences: {}, sink}), /Duplicate/);
    await assert.rejects(backup.exportLibrary({songs: new Array(backup.LIMITS.MAX_SONGS + 1), preferences: {}, sink}), /oversized/);
    const circular = {}; circular.self = circular;
    await assert.rejects(backup.exportLibrary({songs: [{...song, circular}], preferences: {}, sink}), /circular/);
    await assert.rejects(backup.exportLibrary({songs: [{...song, bigint: 1n}], preferences: {}, sink}), /JSON-safe/);
    let deep = {}; for (let i = 0; i < 70; i++) deep = {nested: deep};
    await assert.rejects(backup.exportLibrary({songs: [{...song, deep}], preferences: {}, sink}), /complex/);
    assert.equal(writes, 0);
    await assert.rejects(backup.exportLibrary({songs: [{...song, sparse: new Array(backup.LIMITS.MAX_JSON_NODES + 1)}], preferences: {}, sink}), /complex/);
    await assert.rejects(backup.readLibrary({size: backup.LIMITS.MAX_ARCHIVE_BYTES + 1, slice() {throw Error('not reached');}}), /too large/);
  });
  console.log('\n' + passed + ' backup suites passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
