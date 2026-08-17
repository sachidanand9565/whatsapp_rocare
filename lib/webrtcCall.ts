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

export class WhatsAppCallSession {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private events: CallSessionEvents;
  private closed = false;
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
      if (this.remoteAudio) { this.remoteAudio.srcObject = stream; this.remoteAudio.play().catch(() => {}); }
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

  get connectionState(): RTCPeerConnectionState | 'none' {
    return this.pc?.connectionState ?? 'none';
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.pc?.getSenders().forEach((s) => s.track?.stop()); } catch { /* ignore */ }
    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    if (this.remoteAudio) {
      try { this.remoteAudio.pause(); this.remoteAudio.srcObject = null; this.remoteAudio.remove(); } catch { /* ignore */ }
    }
    this.pc = null; this.localStream = null; this.remoteAudio = null;
  }
}
