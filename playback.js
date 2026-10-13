/* Local-only audio scheduling. Standard playback remains the default/fallback. */
(function (global) {
  class MusicAudio extends EventTarget {
    constructor(element, Context = global.AudioContext || global.webkitAudioContext) {
      super(); this.element = element; this.Context = Context;
      this.mode = 'standard'; this.fade = 0; this.context = null;
      this.active = false; this.stopped = true; this.position = 0;
      this.source = ''; this.generation = 0; this.buffers = new Map();
      this.current = null; this.pending = null; this.tails = [];
      this.nextTrack = () => null; this.scheduling = false;
      this.level = 1; this.timer = null; this.failedNext = null;
      this.metadataLoaded = false;
      for (const name of ['play', 'pause', 'ended', 'loadedmetadata', 'error', 'timeupdate', 'seeking', 'seeked']) {
        element.addEventListener(name, () => { if (!this.active) this.emit(name); });
      }
    }
    emit(name, detail) {
      const event = new Event(name); event.detail = detail;
      this.dispatchEvent(event); if (typeof this['on' + name] === 'function') this['on' + name](event);
    }
    configure(mode, fade = 0) {
      const position = this.currentTime, playing = !this.paused;
      this.pause(); this.mode = ['gapless', 'crossfade'].includes(mode) ? mode : 'standard';
      this.fade = this.mode === 'crossfade' ? Math.max(0, Math.min(12, Number(fade) || 3)) : 0;
      this.active = !!this.Context && this.mode !== 'standard';
      this.position = position; this.element.src = this.source;
      if (!this.active && this.source) {
        const seek = () => { this.element.currentTime = position; };
        if (this.element.readyState >= 1) seek(); else this.element.addEventListener('loadedmetadata', seek, { once: true });
      }
      if (playing) this.play().catch(() => {});
    }
    get src() { return this.active ? this.source : this.element.src; }
    set src(value) {
      this.pause(); this.cancel(); this.generation++; this.position = 0;
      this.source = String(value || ''); this.buffers.clear();
      this.metadataLoaded = false;
      this.active = !!this.Context && this.mode !== 'standard';
      this.element.src = this.source;
    }
    getAttribute(name) { return name === 'src' ? this.source || null : this.element.getAttribute(name); }
    removeAttribute(name) { if (name === 'src') { this.src = ''; this.element.removeAttribute(name); } else this.element.removeAttribute(name); }
    load() { if (!this.active) this.element.load(); }
    get paused() { return this.active ? this.stopped : this.element.paused; }
    get seeking() { return this.active ? false : this.element.seeking; }
    get playbackRate() { return this.active ? 1 : this.element.playbackRate; }
    get duration() { return this.active ? (this.current?.buffer.duration || this.buffers.get(this.source)?.duration || NaN) : this.element.duration; }
    get currentTime() {
      if (!this.active) return this.element.currentTime;
      if (!this.current || this.stopped) return this.position;
      return Math.min(this.current.buffer.duration, this.current.offset + Math.max(0, this.context.currentTime - this.current.start));
    }
    set currentTime(value) {
      if (!this.active) { this.element.currentTime = value; return; }
      const playing = !this.stopped, buffer = this.current?.buffer || this.buffers.get(this.source);
      this.pause(); this.position = Math.max(0, Math.min(Number(value) || 0, buffer?.duration || Infinity));
      this.emit('seeking'); if (playing) this.play().catch(() => {}); this.emit('seeked'); this.emit('timeupdate');
    }
    get volume() { return this.level; }
    set volume(value) { this.level = Math.max(0, Math.min(1, Number(value) || 0)); this.element.volume = this.level; if (this.master) this.master.gain.setValueAtTime(this.level, this.context.currentTime); }
    ensureContext() {
      if (this.context) return;
      this.context = new this.Context(); this.master = this.context.createGain();
      this.master.gain.value = this.level; this.master.connect(this.context.destination);
    }
    async decode(url) {
      if (this.buffers.has(url)) return this.buffers.get(url);
      // Only browser-local object URLs enter this engine; no audio is uploaded.
      if (!url.startsWith('blob:')) throw Error('Local audio required');
      const response = await fetch(url), bytes = await response.arrayBuffer();
      if (bytes.byteLength > 32 * 1024 * 1024) throw Error('Track exceeds scheduling memory limit');
      const buffer = await this.context.decodeAudioData(bytes);
      if (buffer.length * buffer.numberOfChannels * 4 > 96 * 1024 * 1024) throw Error('Decoded track exceeds scheduling memory limit');
      this.buffers.set(url, buffer);
      while (this.buffers.size > 2) this.buffers.delete(this.buffers.keys().next().value);
      return buffer;
    }
    node(buffer, start, offset = 0) {
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer; source.connect(gain); gain.connect(this.master);
      const track = { source, gain, buffer, start, offset, url: this.source };
      source.start(start, offset); return track;
    }
    async play() {
      if (!this.active) return this.element.play();
      if (!this.stopped && this.current) return this.context.resume();
      this.ensureContext(); const generation = ++this.generation;
      const resume = this.context.resume(); this.stopped = false;
      try {
        const buffer = await this.decode(this.source); await resume;
        if (generation !== this.generation || this.stopped) return;
        this.cancelNodes(); this.current = this.node(buffer, this.context.currentTime, Math.min(this.position, Math.max(0, buffer.duration - .001)));
        this.current.url = this.source; this.watchEnd(this.current);
        if (!this.metadataLoaded) { this.metadataLoaded = true; this.emit('loadedmetadata'); }
        if (generation !== this.generation) return;
        this.emit('play');
        // restorePosition may seek during loadedmetadata, replacing this source.
        if (generation !== this.generation) return;
        clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 100); this.tick();
      } catch (error) {
        if (generation !== this.generation || this.stopped) return;
        // Unsupported codecs and long recordings keep their normal streaming player.
        this.active = false; this.stopped = true; this.element.src = this.source;
        this.element.addEventListener('loadedmetadata', () => { this.element.currentTime = this.position; }, { once: true });
        this.emit('fallback', { message: error.message }); return this.element.play();
      }
    }
    pause() {
      if (!this.active) { this.element.pause(); return; }
      const wasPlaying = !this.stopped; this.position = this.currentTime;
      this.stopped = true; this.generation++; this.cancel(); if (wasPlaying) this.emit('pause');
    }
    stopNode(track) {
      if (!track) return; track.source.onended = null;
      try { track.source.stop(); } catch {} track.source.disconnect(); track.gain.disconnect();
    }
    cancelNodes() { this.stopNode(this.current); this.stopNode(this.pending); this.tails.forEach(t => this.stopNode(t)); this.current = null; this.pending = null; this.tails = []; }
    cancel() { clearInterval(this.timer); this.timer = null; this.cancelNodes(); this.scheduling = false; }
    invalidateUpcoming() {
      if (!this.active || !this.pending) return;
      if (this.context.currentTime >= this.pending.start) { this.adopt(); return; }
      this.stopNode(this.pending); this.pending = null;
      if (this.current) { this.current.gain.gain.cancelScheduledValues(this.context.currentTime); this.current.gain.gain.setValueAtTime(1, this.context.currentTime); }
    }
    watchEnd(track) {
      track.source.onended = () => {
        if (track !== this.current) { this.stopNode(track); this.tails = this.tails.filter(t => t !== track); return; }
        if (this.pending) { this.adopt(); return; }
        this.position = track.buffer.duration; this.stopped = true; this.cancel(); this.emit('timeupdate'); this.emit('ended');
      };
    }
    tick() {
      if (!this.active || this.stopped || !this.current) return;
      if (this.pending && this.context.currentTime >= this.pending.start) this.adopt();
      this.emit('timeupdate'); if (!this.pending && !this.scheduling) this.plan();
    }
    async plan() {
      const next = this.nextTrack(); if (!next || !this.current || this.stopped || this.failedNext === this.generation + ':' + next.url) return;
      const generation = this.generation, current = this.current; this.scheduling = true;
      try {
        const buffer = await this.decode(next.url);
        if (generation !== this.generation || this.current !== current || this.stopped) return;
        const latest = this.nextTrack(); if (!latest || latest.id !== next.id || latest.url !== next.url) return;
        const end = current.start + current.buffer.duration - current.offset;
        const overlap = Math.min(this.fade, current.buffer.duration / 2, buffer.duration / 2, Math.max(0, end - this.context.currentTime));
        const start = Math.max(this.context.currentTime, end - overlap);
        const pending = this.node(buffer, start); pending.url = next.url; pending.id = next.id; pending.manual = next.manual;
        if (overlap > 0) {
          pending.gain.gain.setValueAtTime(0, start); pending.gain.gain.linearRampToValueAtTime(1, start + overlap);
          current.gain.gain.setValueAtTime(1, start); current.gain.gain.linearRampToValueAtTime(0, start + overlap);
        }
        this.pending = pending; this.watchEnd(pending);
      } catch { if (generation === this.generation) this.failedNext = generation + ':' + next.url; /* Fall back at the natural end. */ }
      finally { if (generation === this.generation) this.scheduling = false; }
    }
    adopt() {
      if (!this.pending) return;
      const old = this.current, next = this.pending; this.pending = null;
      this.current = next; this.source = next.url; this.position = 0;
      if (old && this.context.currentTime < old.start + old.buffer.duration - old.offset) this.tails.push(old); else this.stopNode(old);
      this.emit('trackchange', { id: next.id, manual: next.manual }); this.emit('loadedmetadata');
    }
  }
  global.MusicAudio = MusicAudio;
})(globalThis);
