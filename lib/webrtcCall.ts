/**
 * lib/webrtcCall.ts — browser-side WebRTC session for WhatsApp Business Calling.
 *
 * Meta's Calling API uses plain SDP offer/answer over HTTP (no trickle ICE):
 *   inbound : webhook gives us the caller's SDP OFFER → we answer with a
 *             complete SDP (all ICE candidates gathered) via pre_accept, then
 *             accept once the peer connection is up.
 *   outbound: we send a complete SDP OFFER via action=connect; the callee's SDP
 *             ANSWER arrives in the connect webhook when they pick up.
 *
 * Runs only in the browser (uses RTCPeerConnection / getUserMedia).
 */

export interface CallSessionEvents {
  onConnected?:    () => void;
  onDisconnected?: (reason: string) => void;
  onRemoteStream?: (stream: MediaStream) => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Wait until ICE gathering is complete (non-trickle SDP), with a safety timeout. */
function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeoutMs); // never hang the call on a slow candidate
  });
}

/**
 * Records both sides of the call in the browser: local mic + remote track are
 * mixed through a Web Audio graph into one MediaStream → MediaRecorder
 * (webm/opus, ~24 kbps → ~180 KB per minute). Call stop() to get the Blob.
 */
export class CallRecorder {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stoppedPromise: Promise<Blob> | null = null;
  mimeType = 'audio/webm;codecs=opus';

  start(local: MediaStream, remote?: MediaStream) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx  = new AC();
    this.dest = this.ctx.createMediaStreamDestination();
    this.ctx.createMediaStreamSource(local).connect(this.dest);
    if (remote) this.addRemote(remote);
    if (!MediaRecorder.isTypeSupported(this.mimeType)) this.mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(this.mimeType)) this.mimeType = ''; // browser default
    this.rec = new MediaRecorder(this.dest.stream, this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 24_000 } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    this.rec.start(1000); // 1s timeslices so a crash still leaves partial data
    this.startedAt = Date.now();
  }

  /** Remote track can arrive after start() — wire it in when it does. */
  addRemote(remote: MediaStream) {
    if (!this.ctx || !this.dest) return;
    try { this.ctx.createMediaStreamSource(remote).connect(this.dest); } catch { /* already added / ended */ }
  }

  get seconds(): number { return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0; }
  get active(): boolean { return !!this.rec && this.rec.state === 'recording'; }

  /** Stop and resolve the final Blob (empty Blob if nothing was captured). */
  stop(): Promise<Blob> {
    if (this.stoppedPromise) return this.stoppedPromise;
    const rec = this.rec;
    this.stoppedPromise = new Promise<Blob>((resolve) => {
      const finish = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
        try { this.ctx?.close(); } catch { /* ignore */ }
        resolve(blob);
      };
      if (!rec || rec.state === 'inactive') { finish(); return; }
      rec.onstop = finish;
      try { rec.stop(); } catch { finish(); }
    });
    return this.stoppedPromise;
  }
}

export class WhatsAppCallSession {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private events: CallSessionEvents;
  private closed = false;
  private recorder: CallRecorder | null = null;
  muted = false;

  constructor(events: CallSessionEvents = {}) {
    this.events = events;
  }

  private async setup(): Promise<RTCPeerConnection> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    // Remote audio → hidden <audio> element (autoplay works because the agent
    // clicked Answer/Call — a user gesture)
    this.remoteAudio = document.createElement('audio');
    this.remoteAudio.autoplay = true;
    this.remoteAudio.setAttribute('playsinline', 'true');
    document.body.appendChild(this.remoteAudio);
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      this.remoteStream = stream;
      if (this.remoteAudio) { this.remoteAudio.srcObject = stream; this.remoteAudio.play().catch(() => {}); }
      this.recorder?.addRemote(stream);   // recorder may have started before the remote track arrived
      this.events.onRemoteStream?.(stream);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.events.onConnected?.();
      else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        if (!this.closed) this.events.onDisconnected?.(s);
      }
    };
    this.pc = pc;
    return pc;
  }

  /** Inbound: build a complete SDP answer for the caller's offer. */
  async answerOffer(offerSdp: string): Promise<string> {
    const pc = await this.setup();
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);
    return pc.localDescription!.sdp;
  }

  /** Outbound: build a complete SDP offer to send with action=connect. */
  async createOffer(): Promise<string> {
    const pc = await this.setup();
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    return pc.localDescription!.sdp;
  }

  /** Outbound: apply the callee's SDP answer once they pick up. */
  async applyAnswer(answerSdp: string): Promise<void> {
    if (!this.pc) throw new Error('No peer connection');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = !m; });
  }

  /** Start recording both sides (call once the call is active). */
  startRecording(): boolean {
    if (!this.localStream || this.recorder) return false;
    try {
      this.recorder = new CallRecorder();
      this.recorder.start(this.localStream, this.remoteStream || undefined);
      return true;
    } catch (e) {
      console.warn('[call] recording unavailable:', (e as Error).message);
      this.recorder = null;
      return false;
    }
  }
  get recording(): boolean { return !!this.recorder?.active; }
  get recordingSeconds(): number { return this.recorder?.seconds ?? 0; }

  /** Stop recording and hand back the audio blob (null if never recorded). */
  async stopRecording(): Promise<{ blob: Blob; seconds: number; mime: string } | null> {
    if (!this.recorder) return null;
    const rec = this.recorder;
    this.recorder = null;
    const seconds = rec.seconds;
    const blob = await rec.stop();
    if (!blob.size) return null;
    return { blob, seconds, mime: rec.mimeType || 'audio/webm' };
  }

  get connectionState(): RTCPeerConnectionState | 'none' {
    return this.pc?.connectionState ?? 'none';
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    // Caller should stopRecording() first to get the blob; this just makes sure
    // the recorder graph is torn down if they didn't.
    if (this.recorder) { this.recorder.stop().catch(() => {}); this.recorder = null; }
    try { this.pc?.getSenders().forEach((s) => s.track?.stop()); } catch { /* ignore */ }
    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    if (this.remoteAudio) {
      try { this.remoteAudio.pause(); this.remoteAudio.srcObject = null; this.remoteAudio.remove(); } catch { /* ignore */ }
    }
    this.pc = null; this.localStream = null; this.remoteAudio = null;
  }
}
