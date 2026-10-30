// In-game voice: WebRTC mesh between the 3-4 players, mixed in WebAudio.
// Radio (hold V) reaches the whole crew unless someone is in a jammer zone.
// Field players also hear each other by proximity (open mic); whisper (hold X) shrinks that range.
import { sound } from './audio.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const FLAG_TALK = 32, FLAG_WHISPER = 64, FLAG_RADIO = 128;

export class Voice {
  constructor(net) {
    this.net = net;
    this.peers = new Map();
    this.stream = null;
    this.muted = false;
    this.radio = false;
    this.whisper = false;
    this.level = 0;
    this.talking = false;
    this.enabled = false;
    this.speaking = new Map();
    this.queue = [];
    net.on('rtc', (m) => { if (this.enabled && this.ready) this.onSignal(m.from, m.data); else this.queue.push(m); });
  }

  async getMic() {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      sound.init();
      const src = sound.ctx.createMediaStreamSource(this.stream);
      this.analyser = sound.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      return true;
    } catch (e) {
      console.warn('mic unavailable', e);
      return false;
    }
  }

  async start(myId, roster) {
    this.myId = myId;
    this.enabled = true;
    await this.getMic();
    this.ready = true;
    for (const p of roster) if (p.id !== myId && myId < p.id) this.connect(p.id, true);
    const q = this.queue; this.queue = [];
    for (const m of q) await this.onSignal(m.from, m.data);
  }

  makePeer(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { id, pc, gains: null };
    this.peers.set(id, peer);
    if (this.stream) for (const tr of this.stream.getAudioTracks()) pc.addTrack(tr, this.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ type: 'rtc', to: id, data: { ice: e.candidate } }); };
    pc.ontrack = (e) => this.attach(peer, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce?.(); };
    return peer;
  }

  async connect(id, initiator) {
    const peer = this.makePeer(id);
    if (initiator) {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.net.send({ type: 'rtc', to: id, data: { sdp: peer.pc.localDescription } });
    }
    return peer;
  }

  async onSignal(from, data) {
    if (!this.enabled) return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp) {
        if (!peer) peer = this.makePeer(from);
        await peer.pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const ans = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(ans);
          this.net.send({ type: 'rtc', to: from, data: { sdp: peer.pc.localDescription } });
        }
        for (const c of peer.pending || []) await peer.pc.addIceCandidate(c);
        peer.pending = [];
      } else if (data.ice) {
        if (!peer || !peer.pc.remoteDescription) { (peer ||= this.makePeer(from)).pending = [...(peer.pending || []), data.ice]; return; }
        await peer.pc.addIceCandidate(data.ice);
      }
    } catch (e) { console.warn('rtc', e); }
  }

  attach(peer, stream) {
    sound.init();
    const ctx = sound.ctx;
    // Chrome only plays remote WebRTC audio through WebAudio if a media element holds the stream.
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    peer.el = el;
    const src = ctx.createMediaStreamSource(stream);
    const prox = ctx.createGain(); prox.gain.value = 0;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'linear'; panner.refDistance = 1; panner.maxDistance = 16; panner.rolloffFactor = 1;
    src.connect(prox).connect(panner).connect(sound.master);
    // Radio chain: band-limited + light crunch
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    const radio = ctx.createGain(); radio.gain.value = 0;
    src.connect(hp).connect(lp).connect(shaper).connect(radio).connect(sound.master);
    // Speaking detector for UI
    const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
    peer.gains = { prox, radio, panner, an, buf: new Float32Array(256) };
  }

  setMuted(m) {
    this.muted = m;
    if (this.stream) for (const tr of this.stream.getAudioTracks()) tr.enabled = !m;
  }

  // Local mic level (for the TALK flag guards can hear).
  sample() {
    if (!this.analyser || this.muted) { this.level = 0; this.talking = false; return; }
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0; for (const v of this.buf) s += v * v;
    const rms = Math.sqrt(s / this.buf.length);
    this.level = this.level * 0.7 + rms * 0.3;
    this.talking = this.level > 0.025;
  }

  flags() {
    let f = 0;
    if (this.talking && !this.radio) f |= FLAG_TALK;
    if (this.whisper) f |= FLAG_WHISPER;
    if (this.radio && !this.muted) f |= FLAG_RADIO;
    return f;
  }

  // listener: {id, role, x, y, z, yaw, jammed}; others: Map id -> {role, x, y, z, f, jammed, down}
  update(listener, others) {
    if (!sound.ctx) return;
    const ctx = sound.ctx, t = ctx.currentTime;
    if (listener.role !== 'overwatch' && ctx.listener.positionX) {
      ctx.listener.positionX.setTargetAtTime(listener.x, t, 0.05);
      ctx.listener.positionY.setTargetAtTime(listener.y, t, 0.05);
      ctx.listener.positionZ.setTargetAtTime(listener.z, t, 0.05);
      ctx.listener.forwardX.setTargetAtTime(-Math.sin(listener.yaw), t, 0.05);
      ctx.listener.forwardY.setTargetAtTime(0, t, 0.05);
      ctx.listener.forwardZ.setTargetAtTime(-Math.cos(listener.yaw), t, 0.05);
    }
    for (const [id, peer] of this.peers) {
      const g = peer.gains;
      const o = others.get(id);
      if (!g || !o) continue;
      const radioOn = !!(o.f & FLAG_RADIO) && !o.jammed && !listener.jammed;
      let radioGain = radioOn ? 1 : 0;
      let proxGain = 0;
      if (listener.van) {
        // Everyone is in the van together: plain, close voice.
        proxGain = radioOn ? 0 : 1.2;
        g.panner.positionX.setTargetAtTime(listener.x, t, 0.05);
        g.panner.positionY.setTargetAtTime(listener.y + 1.6, t, 0.05);
        g.panner.positionZ.setTargetAtTime(listener.z - 0.5, t, 0.05);
        g.panner.maxDistance = 16;
      } else if (listener.role !== 'overwatch' && o.role !== 'overwatch') {
        const d = Math.hypot(o.x - listener.x, o.z - listener.z);
        const range = o.f & FLAG_WHISPER ? 3.2 : 16;
        proxGain = d < range ? 1.4 * (o.f & FLAG_WHISPER ? 0.8 : 1) : 0;
        if (radioOn) proxGain *= 0.4;
        g.panner.positionX.setTargetAtTime(o.x, t, 0.05);
        g.panner.positionY.setTargetAtTime(o.y + 1.6, t, 0.05);
        g.panner.positionZ.setTargetAtTime(o.z, t, 0.05);
        g.panner.maxDistance = range;
      }
      g.prox.gain.setTargetAtTime(proxGain, t, 0.08);
      g.radio.gain.setTargetAtTime(radioGain * 1.3, t, 0.04);
      g.an.getFloatTimeDomainData(g.buf);
      let s = 0; for (const v of g.buf) s += v * v;
      const lv = Math.sqrt(s / g.buf.length);
      this.speaking.set(id, (lv > 0.02) && (proxGain > 0 || radioGain > 0) ? (radioOn ? 'radio' : 'near') : null);
    }
  }

  stop() {
    this.enabled = false; this.ready = false; this.queue = [];
    for (const p of this.peers.values()) { try { p.pc.close(); } catch { /* ignore */ } if (p.el) p.el.srcObject = null; }
    this.peers.clear();
    this.speaking.clear();
  }
}
