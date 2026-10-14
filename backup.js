/* My Music portable backups, version 3. No storage mutations or dependencies.
 *
 * exportLibrary({ songs, preferences = capturePreferences(), sink? })
 *   Without sink: Promise<Blob> (application/zip).
 *   With async sink(Uint8Array): Promise<{version:3,size,entries}>. Each write is
 *   awaited and at most CHUNK_BYTES. The caller owns aborting a partial output.
 * readLibrary(file): Promise<{version,exportedAt?,songs,preferences,...legacy}>.
 *   All entries and metadata are validated before this resolves. Song blob/art
 *   are zero-copy Blob slices, or slices of the caller's Blob-like descriptor.
 *   Descriptors must implement size, type, slice(start,end,type), arrayBuffer().
 * mergePreferences(existing,incoming,idMap): a new raw-string storage dictionary.
 *   Incoming scalar settings win; playlists and ID collections merge additively;
 *   counts/times use maximums, so restoring the same backup is idempotent.
 *   Incoming current/resume win when their IDs map; unmapped imported IDs drop.
 *   Existing IDs are never remapped. Map keys may be numbers or numeric strings.
 * capturePreferences(storage = localStorage): all my-music-* raw-string values.
 * crc32(blobLike): Promise<unsigned32>, bounded reads for duplicate comparisons.
 *
 * ZIP32, stored entries only. Audio is read in bounded slices, never as a whole
 * archive ArrayBuffer. Native export requires sink to remain memory-bounded.
 */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({
    CHUNK_BYTES: 256 * 1024,
    MAX_ARCHIVE_BYTES: 0xffffffff - 1,
    MAX_ENTRY_BYTES: 0xffffffff - 1,
    MAX_ENTRIES: 65534,
    MAX_SONGS: 30000,
    MAX_MANIFEST_BYTES: 32 * 1024 * 1024,
    MAX_PREFERENCES_BYTES: 24 * 1024 * 1024,
    MAX_DIRECTORY_BYTES: 64 * 1024 * 1024,
    MAX_NAME_BYTES: 1024,
    MAX_JSON_DEPTH: 64,
    MAX_JSON_NODES: 2000000
  });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const id = value => Number.isSafeInteger(value) && value > 0;
  const numericKey = key => /^[1-9]\d*$/.test(key) && id(Number(key));
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', {fatal: true});
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function fail(message) { throw new Error(message); }
  // defineProperty preserves arbitrary JSON keys without invoking __proto__.
  function put(target, key, value) {
    Object.defineProperty(target, key, {value, enumerable: true, writable: true, configurable: true});
    return value;
  }
  function copy(value, depth = 0, state = {nodes: 0, seen: new Set()}) {
    if (++state.nodes > LIMITS.MAX_JSON_NODES || depth > LIMITS.MAX_JSON_DEPTH) fail('Backup metadata is too complex.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!object(value) && !Array.isArray(value)) fail('Backup metadata must contain only JSON-safe values.');
    if (Array.isArray(value) && value.length > LIMITS.MAX_JSON_NODES) fail('Backup metadata is too complex.');
    if (state.seen.has(value)) fail('Backup metadata contains a circular reference.');
    if (Object.prototype.toString.call(value) !== '[object Object]' && !Array.isArray(value)) fail('Backup metadata must contain only JSON-safe values.');
    state.seen.add(value);
    const result = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      if (value[key] === undefined && !Array.isArray(value)) continue;
      put(result, key, copy(value[key], depth + 1, state));
    }
    // Sparse arrays have no JSON-safe value for a hole; JSON represents it as null.
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!own(result, i)) result[i] = null;
    state.seen.delete(value);
    return result;
  }
  function mergeObject(a, b) {
    const result = copy(object(a) ? a : {});
    if (object(b)) for (const [key, value] of Object.entries(b)) put(result, key, copy(value));
    return result;
  }
  function validSource(source, label, max = LIMITS.MAX_ENTRY_BYTES) {
    if (!source || !Number.isSafeInteger(source.size) || source.size < 0 || source.size > max || typeof source.slice !== 'function') fail(label + ' is missing, too large, or is not a readable file.');
  }
  async function bytes(source, begin, length) {
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(length) || begin < 0 || length < 0 || length > LIMITS.CHUNK_BYTES || begin + length > source.size) fail('Backup contains invalid file bounds.');
    const part = source.slice(begin, begin + length);
    if (!part || part.size !== length || typeof part.arrayBuffer !== 'function') fail('File reader returned an invalid slice.');
    const buffer = await part.arrayBuffer();
    const data = new Uint8Array(buffer);
    if (data.byteLength !== length) fail('Backup is incomplete or the file changed while reading.');
    return data;
  }
  async function eachChunk(source, visit) {
    for (let start = 0; start < source.size; start += LIMITS.CHUNK_BYTES) {
      await visit(await bytes(source, start, Math.min(LIMITS.CHUNK_BYTES, source.size - start)));
    }
  }
  async function checksum(source) {
    validSource(source, 'Backup file');
    let crc = 0xffffffff;
    await eachChunk(source, chunk => { for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); });
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function smallText(source, max) {
    if (source.size > max) fail('Backup metadata exceeds the size limit.');
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let text = '';
    await eachChunk(source, chunk => { text += decoder.decode(chunk, {stream: true}); });
    return text + decoder.decode();
  }
  function nameBytes(name) {
    if (typeof name !== 'string' || !name || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) fail('Backup contains an unsafe file path.');
    const result = enc.encode(name);
    if (result.length > LIMITS.MAX_NAME_BYTES) fail('Backup file name is too long.');
    return result;
  }
  function validMime(type) {
    if (typeof type !== 'string' || type.length > 255 || /[^\x20-\x7e]/.test(type)) fail('Invalid backup media type.');
  }
  function validSong(meta) {
    if (!object(meta) || !id(meta.id) || typeof meta.name !== 'string') fail('Invalid song metadata in backup.');
    if (own(meta, 'blob') || own(meta, 'art')) fail('Backup song metadata contains a reserved media property.');
    for (const key of ['artist', 'album']) if (own(meta, key) && typeof meta[key] !== 'string') fail('Invalid song ' + key + ' in backup.');
    if (own(meta, 'favorite') && typeof meta.favorite !== 'boolean') fail('Invalid song favorite in backup.');
    for (const key of ['duration', 'trackNumber', 'discNumber']) if (own(meta, key) && meta[key] !== null && !finite(meta[key])) fail('Invalid song ' + key + ' in backup.');
  }
  function kind(key) {
    if (/^my-music-playlists(?:-v\d+)?$/.test(key)) return 'playlists';
    if (/^my-music-playback(?:-v\d+)?$/.test(key)) return 'playback';
    if (/^my-music-manual-queue(?:-v\d+)?$/.test(key)) return 'queue';
    if (/^my-music-(?:manual-played|recent)(?:-v\d+)?$/.test(key)) return 'ids';
    if (/^my-music-resume(?:-v\d+)?$/.test(key)) return 'resume';
    if (/^my-music-play-counts(?:-v\d+)?$/.test(key)) return 'counts';
    if (/^my-music-favorite-listening(?:-v\d+)?$/.test(key)) return 'favorites';
    if (/^my-music-listening-seconds(?:-v\d+)?$/.test(key)) return 'seconds';
    if (/^my-music-(?:artist-photos|local-profile)(?:-v\d+)?$/.test(key)) return 'object';
    if (/^my-music-hidden-(?:builtins|personal-playlists)(?:-v\d+)?$/.test(key)) return 'names';
    return 'raw';
  }
  function jsonPreference(raw, key) {
    try { return JSON.parse(raw); } catch (_) { fail('Invalid saved preference in backup: ' + key); }
  }
  function validIDs(values) { return Array.isArray(values) && values.every(id); }
  function validPreference(key, raw) {
    const type = kind(key);
    if (type === 'raw') return;
    const value = jsonPreference(raw, key);
    copy(value);
    let good = true;
    if (type === 'playlists') good = Array.isArray(value) && value.every(p => object(p) && typeof p.name === 'string' && p.name.trim() && validIDs(p.ids));
    if (type === 'ids' || type === 'queue') good = validIDs(value);
    if (type === 'names') good = Array.isArray(value) && value.every(v => typeof v === 'string');
    if (type === 'playback') {
      good = object(value);
      if (good) {
        for (const k of ['queue', 'history', 'manualQueue', 'manualPlayed']) if (own(value, k) && !validIDs(value[k])) good = false;
        if (own(value, 'current') && value.current !== null && !id(value.current)) good = false;
        if (own(value, 'queuePos') && (!Number.isSafeInteger(value.queuePos) || value.queuePos < -1 || (Array.isArray(value.queue) && value.queuePos >= value.queue.length))) good = false;
        if (own(value, 'shuffle') && typeof value.shuffle !== 'boolean') good = false;
      }
    }
    if (type === 'resume') good = object(value) && (!own(value, 'id') || value.id === null || id(value.id)) && (!own(value, 'position') || finite(value.position));
    if (type === 'counts') good = object(value) && Object.entries(value).every(([k, v]) => numericKey(k) && finite(v));
    if (type === 'favorites') good = object(value) && Object.entries(value).every(([k, v]) => numericKey(k) && object(v) && ['favoritedAt', 'lastListened'].every(field => !own(v, field) || finite(v[field])));
    if (type === 'seconds') good = finite(value);
    if (type === 'object') {
      good = object(value);
      if (good && key.includes('artist-photos')) good = Object.values(value).every(v => typeof v === 'string');
      if (good && key.includes('local-profile')) good = ['name', 'photo'].every(field => !own(value, field) || typeof value[field] === 'string');
    }
    if (!good) fail('Invalid saved preference in backup: ' + key);
  }
  function validatePreferences(preferences, validateValues = true) {
    if (!object(preferences)) fail('Backup preferences must be a storage dictionary.');
    const result = {};
    let size = 0;
    for (const [key, value] of Object.entries(preferences)) {
      if (!key.startsWith('my-music-') || typeof value !== 'string') fail('Invalid preference key or value in backup.');
      size += enc.encode(key).length + enc.encode(value).length;
      if (size > LIMITS.MAX_PREFERENCES_BYTES) fail('Backup preferences exceed the size limit.');
      if (validateValues) validPreference(key, value);
      put(result, key, value);
    }
    return result;
  }
  function capturePreferences(storage) {
    if (storage === undefined) storage = root.localStorage;
    const result = {};
    if (!storage) return result;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith('my-music-')) {
        const value = storage.getItem(key);
        if (value !== null) put(result, key, value);
      }
    }
    return validatePreferences(result);
  }
  function validateAudioSources(songs) {
    if (!Array.isArray(songs)) fail('Invalid music library.');
    for (const song of songs) {
      if (!object(song)) fail('Invalid song in backup.');
      if (song.missingFile || !song.blob || !(song.blob.size > 0)) fail('Song "' + String(song.name || 'Untitled') + '" has missing or empty audio. Restore or reimport the missing audio first, then back up again.');
    }
  }
  function dataView(size) { return new DataView(new ArrayBuffer(size)); }
  async function exportLibrary(options) {
    if (!object(options) || !Array.isArray(options.songs) || options.songs.length > LIMITS.MAX_SONGS) fail('Invalid or oversized music library.');
    const {songs, sink} = options;
    validateAudioSources(songs);
    if (sink !== undefined && typeof sink !== 'function') fail('The backup sink must be a function.');
    const preferences = options.preferences === undefined ? capturePreferences() : validatePreferences(options.preferences);
    const items = [], files = [], seenIDs = new Set();
    for (const song of songs) {
      if (!object(song)) fail('Invalid song in backup.');
      const metadata = {};
      for (const key of Object.keys(song)) if (key !== 'blob' && key !== 'art' && song[key] !== undefined) put(metadata, key, copy(song[key]));
      validSong(metadata);
      if (seenIDs.has(metadata.id)) fail('Duplicate song ID in backup.');
      seenIDs.add(metadata.id);
      validSource(song.blob, 'Song audio');
      const audio = {file: 'tracks/' + metadata.id + '.audio', type: song.blob.type || '', size: song.blob.size};
      validMime(audio.type);
      files.push({name: audio.file, source: song.blob});
      let artwork = null;
      if (song.art !== null && song.art !== undefined) {
        const originalArt = song.art.nativeOriginal || song.art;
        validSource(originalArt, 'Song artwork');
        if (originalArt.native && !(originalArt.size > 0)) fail('Original artwork for "' + metadata.name + '" is unavailable. Recover the original artwork before backing up.');
        artwork = {file: 'artwork/' + metadata.id + '.image', type: originalArt.type || '', size: originalArt.size};
        validMime(artwork.type);
        files.push({name: artwork.file, source: originalArt});
      }
      items.push({metadata, audio, artwork});
    }
    const manifest = new Blob([JSON.stringify({version: 3, exportedAt: new Date().toISOString(), songs: items, preferences})], {type: 'application/json'});
    if (manifest.size > LIMITS.MAX_MANIFEST_BYTES) fail('Backup metadata exceeds the size limit.');
    files.push({name: 'library.json', source: manifest});
    if (files.length > LIMITS.MAX_ENTRIES) fail('Too many files for a ZIP32 backup.');
    let projected = 22;
    for (const file of files) projected += 76 + 2 * nameBytes(file.name).length + file.source.size;
    if (projected > LIMITS.MAX_ARCHIVE_BYTES) fail('This library exceeds the 4 GB ZIP32 backup limit.');
    const parts = [], central = [];
    let offset = 0;
    async function write(data) {
      if (sink) await sink(data); else parts.push(data);
      offset += data.byteLength === undefined ? data.size : data.byteLength;
    }
    for (const file of files) {
      const name = nameBytes(file.name), size = file.source.size, localOffset = offset;
      const crc = await checksum(file.source);
      const local = dataView(30 + name.length);
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); local.setUint32(14, crc, true);
      local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
      new Uint8Array(local.buffer, 30).set(name);
      await write(new Uint8Array(local.buffer));
      if (!sink && typeof Blob !== 'undefined' && file.source instanceof Blob) await write(file.source);
      else {
        let writtenCRC = 0xffffffff;
        await eachChunk(file.source, async chunk => {
          for (const b of chunk) writtenCRC = crcTable[(writtenCRC ^ b) & 255] ^ (writtenCRC >>> 8);
          await write(chunk);
        });
        if (((writtenCRC ^ 0xffffffff) >>> 0) !== crc) fail('A media file changed while creating the backup.');
      }
      const dir = dataView(46 + name.length);
      dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true); dir.setUint32(16, crc, true);
      dir.setUint32(20, size, true); dir.setUint32(24, size, true);
      dir.setUint16(28, name.length, true); dir.setUint32(42, localOffset, true);
      new Uint8Array(dir.buffer, 46).set(name); central.push(new Uint8Array(dir.buffer));
    }
    const centralOffset = offset;
    for (const directory of central) await write(directory);
    const end = dataView(22);
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length, true); end.setUint16(10, central.length, true);
    end.setUint32(12, offset - centralOffset, true); end.setUint32(16, centralOffset, true);
    await write(new Uint8Array(end.buffer));
    return sink ? {version: 3, size: offset, entries: files.length} : new Blob(parts, {type: 'application/zip'});
  }

  async function directory(file) {
    validSource(file, 'Backup', LIMITS.MAX_ARCHIVE_BYTES);
    if (file.size < 22) fail('Backup is incomplete.');
    const tailStart = Math.max(0, file.size - 65557), tail = await bytes(file, tailStart, file.size - tailStart);
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let endAt = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === 0x06054b50 && i + 22 + tailView.getUint16(i + 20, true) === tail.length) { endAt = i; break; }
    }
    if (endAt < 0) fail('Backup is incomplete or not a ZIP archive.');
    const get16 = n => tailView.getUint16(endAt + n, true), get32 = n => tailView.getUint32(endAt + n, true);
    const count = get16(10), centralSize = get32(12), centralOffset = get32(16), endOffset = tailStart + endAt;
    if (get16(4) !== 0 || get16(6) !== 0 || get16(8) !== count) fail('Multi-disk backups are not supported.');
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64 backups are not supported.');
    if (!count || count > LIMITS.MAX_ENTRIES || centralSize > LIMITS.MAX_DIRECTORY_BYTES || centralOffset + centralSize !== endOffset) fail('Invalid backup directory bounds.');
    const entries = new Map(), canonicalNames = new Set(), ranges = [];
    let cursor = centralOffset;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > endOffset) fail('Backup directory is incomplete.');
      const header = await bytes(file, cursor, 46), view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (view.getUint32(0, true) !== 0x02014b50) fail('Invalid backup directory entry.');
      const flags = view.getUint16(8, true), method = view.getUint16(10, true), crc = view.getUint32(16, true);
      const compressed = view.getUint32(20, true), size = view.getUint32(24, true), nameLength = view.getUint16(28, true);
      const extra = view.getUint16(30, true), comment = view.getUint16(32, true), start = view.getUint32(42, true);
      if (method !== 0) fail('Unsupported compressed backup format. Use a My Music stored ZIP backup.');
      if (flags & ~0x0800) fail('Encrypted or streaming-descriptor ZIP entries are not supported.');
      if (view.getUint16(34, true) !== 0 || view.getUint16(6, true) > 20) fail('Unsupported ZIP entry version or disk.');
      if (size > LIMITS.MAX_ENTRY_BYTES || compressed !== size || start === 0xffffffff) fail('Invalid backup entry size.');
      if (!nameLength || nameLength > LIMITS.MAX_NAME_BYTES || cursor + 46 + nameLength + extra + comment > endOffset) fail('Invalid backup file name bounds.');
      const rawName = await bytes(file, cursor + 46, nameLength), name = dec.decode(rawName);
      nameBytes(name);
      const canonical = name.normalize('NFC');
      if (entries.has(name) || canonicalNames.has(canonical)) fail('Duplicate file name in backup.');
      canonicalNames.add(canonical);
      if ((view.getUint32(38, true) >>> 16 & 0xf000) === 0xa000) fail('Symbolic links are not supported in backups.');
      if (start + 30 > centralOffset) fail('Invalid backup file bounds.');
      const localHeader = await bytes(file, start, 30), local = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
      if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(4, true) > 20 || local.getUint16(6, true) !== flags || local.getUint16(8, true) !== method || local.getUint32(14, true) !== crc || local.getUint32(18, true) !== compressed || local.getUint32(22, true) !== size || local.getUint16(26, true) !== nameLength) fail('Backup file header does not match its directory.');
      const dataStart = start + 30 + nameLength + local.getUint16(28, true), dataEnd = dataStart + size;
      if (dataStart > centralOffset || dataEnd > centralOffset) fail('Invalid backup file bounds.');
      const localName = await bytes(file, start + 30, nameLength);
      if (localName.some((b, at) => b !== rawName[at])) fail('Backup file name does not match its directory.');
      entries.set(name, {name, crc, size, start: dataStart, end: dataEnd});
      ranges.push([start, dataEnd]);
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== endOffset) fail('Invalid backup directory length.');
    ranges.sort((a, b) => a[0] - b[0]);
    let boundary = 0;
    for (const [start, end] of ranges) {
      if (start !== boundary) fail('Backup contains overlapping files or unexpected data.');
      boundary = end;
    }
    if (boundary !== centralOffset) fail('Backup file bounds do not match the directory.');
    return entries;
  }
  function inferMime(path, art) {
    const ext = path.split('.').pop().toLowerCase();
    return (art ? {png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg'} : {mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus'})[ext] || (art ? 'image/jpeg' : 'audio/mpeg');
  }
  function legacyPreferences(info) {
    const prefs = info.preferences === undefined ? {} : validatePreferences(info.preferences);
    const fields = {playlists: 'my-music-playlists-v1', playCounts: 'my-music-play-counts-v1', totalListeningSeconds: 'my-music-listening-seconds-v1', recentIDs: 'my-music-recent', favoriteListening: 'my-music-favorite-listening-v1'};
    for (const [field, key] of Object.entries(fields)) if (own(info, field) && !own(prefs, key)) put(prefs, key, JSON.stringify(info[field]));
    return validatePreferences(prefs);
  }
  async function readLibrary(file) {
    const entries = await directory(file), manifestEntry = entries.get('library.json');
    if (!manifestEntry) fail('This is not a My Music backup.');
    if (manifestEntry.size > LIMITS.MAX_MANIFEST_BYTES) fail('Backup metadata exceeds the size limit.');
    const manifestFile = file.slice(manifestEntry.start, manifestEntry.end, 'application/json');
    if (await checksum(manifestFile) !== manifestEntry.crc) fail('Backup checksum failed: library.json');
    let info;
    try { info = JSON.parse(await smallText(manifestFile, LIMITS.MAX_MANIFEST_BYTES)); }
    catch (_) { fail('Backup contains invalid library metadata.'); }
    info = copy(info);
    if (!object(info) || !Array.isArray(info.songs) || info.songs.length > LIMITS.MAX_SONGS) fail('Invalid backup library.');
    const version = info.version === undefined ? 1 : info.version;
    if (![1, 2, 3].includes(version)) fail('Unsupported My Music backup version.');
    if (own(info, 'exportedAt') && (typeof info.exportedAt !== 'string' || !Number.isFinite(Date.parse(info.exportedAt)))) fail('Invalid backup export date.');
    const preferences = version === 3 ? validatePreferences(info.preferences) : legacyPreferences(info);
    const songs = [], seenIDs = new Set(), mediaRefs = new Set();
    function media(ref, art) {
      if (!object(ref) || typeof ref.file !== 'string') fail('Invalid backup media reference.');
      nameBytes(ref.file);
      const entry = entries.get(ref.file);
      if (!entry || ref.file === 'library.json') fail('Backup is missing a referenced media file: ' + ref.file);
      if (mediaRefs.has(ref.file)) fail('Backup reuses a media file reference.');
      mediaRefs.add(ref.file);
      if (version === 3 && (!Number.isSafeInteger(ref.size) || ref.size !== entry.size)) fail('Backup media size does not match its manifest.');
      const type = version === 3 ? ref.type : inferMime(ref.file, art);
      validMime(type);
      const result = file.slice(entry.start, entry.end, type);
      validSource(result, 'Backup media');
      if (result.size !== entry.size || typeof result.arrayBuffer !== 'function') fail('File reader returned invalid backup media.');
      return result;
    }
    for (const item of info.songs) {
      if (!object(item)) fail('Invalid backup song.');
      let metadata, audio, artwork;
      if (version === 3) {
        metadata = item.metadata;
        audio = item.audio;
        if (!own(item, 'artwork')) fail('Backup song is missing its artwork descriptor.');
        artwork = item.artwork;
      } else {
        metadata = {};
        for (const [key, value] of Object.entries(item)) if (key !== 'file' && key !== 'artFile') put(metadata, key, value);
        audio = {file: item.file};
        artwork = item.artFile == null ? null : {file: item.artFile};
      }
      validSong(metadata);
      if (seenIDs.has(metadata.id)) fail('Duplicate song ID in backup.');
      seenIDs.add(metadata.id);
      const song = copy(metadata);
      put(song, 'blob', media(audio, false));
      put(song, 'art', artwork === null ? null : media(artwork, true));
      songs.push(song);
    }
    // Validate every entry, including unreferenced extras, before callers commit.
    for (const entry of entries.values()) {
      if (entry === manifestEntry) continue;
      if (await checksum(file.slice(entry.start, entry.end)) !== entry.crc) fail('Backup checksum failed: ' + entry.name);
    }
    return {...info, version, songs, preferences};
  }

  function mergePreferences(existing, incoming, idMap) {
    const result = validatePreferences(existing || {}, false);
    const source = validatePreferences(incoming || {});
    if (!idMap || !(typeof idMap.get === 'function' || object(idMap))) fail('A song ID map is required to restore preferences.');
    function remap(oldID) {
      if (!id(oldID)) return null;
      let value;
      if (typeof idMap.get === 'function') value = idMap.has(oldID) ? idMap.get(oldID) : idMap.get(String(oldID));
      else if (own(idMap, oldID)) value = idMap[oldID];
      return id(value) ? value : null;
    }
    const mapped = values => (values || []).map(remap).filter(value => value !== null);
    function previous(key, fallback) {
      if (!own(result, key)) return copy(fallback);
      try { validPreference(key, result[key]); return JSON.parse(result[key]); }
      catch (_) { return copy(fallback); }
    }
    function union(a, b) { return [...new Set([...a, ...b])]; }
    // Preserve meaningful repeated queue/history entries without multiplying them
    // every time the same backup is restored.
    function sequence(a, b) {
      const result = a.slice(), counts = new Map(), used = new Map();
      for (const value of a) counts.set(value, (counts.get(value) || 0) + 1);
      for (const value of b) {
        const count = (used.get(value) || 0) + 1; used.set(value, count);
        if (count > (counts.get(value) || 0)) result.push(value);
      }
      return result;
    }
    for (const [key, raw] of Object.entries(source)) {
      const type = kind(key);
      if (type === 'raw') { put(result, key, raw); continue; }
      const value = JSON.parse(raw);
      let merged;
      if (type === 'playlists') {
        merged = previous(key, []);
        for (const incomingPlaylist of value) {
          const ids = union([], mapped(incomingPlaylist.ids));
          const index = merged.findIndex(p => p.name.toLocaleLowerCase() === incomingPlaylist.name.toLocaleLowerCase());
          if (index < 0) merged.push({...incomingPlaylist, ids});
          else merged[index] = {...mergeObject(merged[index], incomingPlaylist), name: merged[index].name, ids: union(merged[index].ids, ids)};
        }
      } else if (type === 'ids' || type === 'queue') {
        merged = (type === 'queue' ? sequence : union)(previous(key, []), mapped(value));
      } else if (type === 'names') {
        merged = union(previous(key, []), value);
      } else if (type === 'playback') {
        const old = previous(key, {});
        merged = mergeObject(old, value);
        for (const field of ['queue', 'history', 'manualQueue', 'manualPlayed']) {
          if (own(value, field)) merged[field] = (field === 'manualPlayed' ? union : sequence)(old[field] || [], mapped(value[field]));
        }
        const current = remap(value.current);
        merged.current = current !== null ? current : (old.current || null);
        if (Array.isArray(merged.queue)) merged.queuePos = merged.current === null ? -1 : merged.queue.indexOf(merged.current);
        else merged.queuePos = -1;
      } else if (type === 'resume') {
        const nextID = remap(value.id);
        merged = nextID === null ? previous(key, {}) : {...value, id: nextID};
      } else if (type === 'counts' || type === 'favorites') {
        merged = previous(key, {});
        for (const [oldID, entry] of Object.entries(value)) {
          const nextID = remap(Number(oldID));
          if (nextID === null) continue;
          const target = String(nextID);
          if (type === 'counts') put(merged, target, Math.max(merged[target] || 0, entry));
          else {
            const old = own(merged, target) ? merged[target] : {};
            const next = mergeObject(old, entry);
            for (const field of ['favoritedAt', 'lastListened']) if (own(old, field) || own(entry, field)) put(next, field, Math.max(old[field] || 0, entry[field] || 0));
            put(merged, target, next);
          }
        }
      } else if (type === 'seconds') {
        merged = Math.max(previous(key, 0), value);
      } else if (type === 'object') {
        merged = mergeObject(previous(key, {}), value);
      }
      put(result, key, JSON.stringify(merged));
    }
    return result;
  }
  root.MusicBackup = Object.freeze({version: 3, LIMITS, exportLibrary, readLibrary, mergePreferences, capturePreferences, validateAudioSources, crc32: checksum});
})(typeof globalThis !== 'undefined' ? globalThis : window);
