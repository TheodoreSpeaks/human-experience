// Streams mic audio to OpenAI's realtime transcription over WebRTC and reports the running transcript.
//
// Connecting takes ~0.75-1s (key ~230ms, offer/answer ~350ms, channel open ~230ms), so it happens
// ahead of time: prepareTranscription() opens the connection with an empty audio slot and no mic,
// and start() only has to get the mic and drop its track in.

import { api } from "./lib";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type RealtimeEvent =
  | { type: "input_audio_buffer.committed"; item_id: string }
  | { type: "conversation.item.input_audio_transcription.delta"; item_id: string; delta?: string }
  | { type: "conversation.item.input_audio_transcription.completed"; item_id: string; transcript: string }
  | { type: "conversation.item.input_audio_transcription.failed"; item_id: string; error: { message: string } }
  | { type: "error"; error: { code?: string; message: string } }
  | { type: string };

export type LiveTranscription = {
  /** Flushes the last bit of speech, waits for every chunk to finish, and returns the full transcript. */
  stop: () => Promise<string>;
  /** Tears down immediately and drops whatever was said. */
  cancel: () => void;
};

// An open connection to OpenAI with no mic attached yet. Single use: start() it once, or close() it.
export type PreparedTranscription = {
  /** False once the connection has dropped (e.g. the tab sat open long enough for the session to end). */
  isOpen: () => boolean;
  start: (opts: { onText: (text: string) => void; onError: (error: Error) => void }) => Promise<LiveTranscription>;
  close: () => void;
};

export async function prepareTranscription(): Promise<PreparedTranscription> {
  const { secret } = await api<{ secret: string }>("/api/transcribe/session", { method: "POST" });

  const pc = new RTCPeerConnection();
  // An audio slot without a track: negotiates the audio stream now, the mic is swapped in later.
  const sender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
  const channel = pc.createDataChannel("oai-events");
  const opened = new Promise<void>((resolve) => (channel.onopen = () => resolve()));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(REALTIME_CALLS_URL, {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/sdp" },
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`Realtime connection failed (${res.status}): ${await res.text()}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  await opened;

  let used = false;
  return {
    isOpen: () => channel.readyState === "open",
    close: () => {
      channel.close();
      pc.close();
    },
    start: async (opts) => {
      if (used) throw new Error("A prepared transcription can only be started once");
      used = true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("No microphone track");
      await sender.replaceTrack(track);
      return listen({ pc, channel, stream, track, ...opts });
    },
  };
}

// Turns the data channel's events into a running transcript.
function listen(opts: {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  stream: MediaStream;
  track: MediaStreamTrack;
  onText: (text: string) => void;
  onError: (error: Error) => void;
}): LiveTranscription {
  const { pc, channel, stream, track } = opts;

  // Chunks in the order they were committed; text fills in as deltas arrive.
  const order: string[] = [];
  const text = new Map<string, string>();
  const completed = new Set<string>();
  let awaitingFinalCommit = false;
  let settle: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  const transcript = () =>
    order
      .map((id) => text.get(id)?.trim() ?? "")
      .filter(Boolean)
      .join(" ");

  const teardown = () => {
    channel.close();
    pc.close();
    stream.getTracks().forEach((t) => t.stop());
  };

  const fail = (error: Error) => {
    teardown();
    if (settle) settle.reject(error);
    else opts.onError(error);
  };

  const maybeSettle = () => {
    if (settle && !awaitingFinalCommit && order.every((id) => completed.has(id))) {
      teardown();
      settle.resolve(transcript());
    }
  };

  const track_ = (id: string) => {
    if (!order.includes(id)) order.push(id);
  };

  channel.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as RealtimeEvent;
    switch (event.type) {
      case "input_audio_buffer.committed": {
        const e = event as { item_id: string };
        track_(e.item_id);
        awaitingFinalCommit = false;
        break;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const e = event as { item_id: string; delta?: string };
        track_(e.item_id);
        text.set(e.item_id, (text.get(e.item_id) ?? "") + (e.delta ?? ""));
        opts.onText(transcript());
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const e = event as { item_id: string; transcript: string };
        track_(e.item_id);
        text.set(e.item_id, e.transcript);
        completed.add(e.item_id);
        opts.onText(transcript());
        break;
      }
      case "conversation.item.input_audio_transcription.failed": {
        const e = event as { error: { message: string } };
        return fail(new Error(`Transcription failed: ${e.error.message}`));
      }
      case "error": {
        const e = event as { error: { code?: string; message: string } };
        // Stopping during a pause: VAD already committed everything, so the final commit has nothing to send.
        if (awaitingFinalCommit && e.error.code === "input_audio_buffer_commit_empty") {
          awaitingFinalCommit = false;
          break;
        }
        return fail(new Error(`Realtime error: ${e.error.message}`));
      }
    }
    maybeSettle();
  };

  return {
    stop: () =>
      new Promise<string>((resolve, reject) => {
        settle = { resolve, reject };
        track.enabled = false;
        awaitingFinalCommit = true;
        channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }),
    cancel: teardown,
  };
}
