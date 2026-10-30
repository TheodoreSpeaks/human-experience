import { useEffect, useRef, useState } from "react";
import { prepareTranscription, type LiveTranscription, type PreparedTranscription } from "./live-transcribe";

// onSubmit resolves once the dump is accepted and its first event is saved (or it had none).
export function Composer({ onSubmit }: { onSubmit: (dump: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [live, setLive] = useState("");
  const [phase, setPhase] = useState<"idle" | "connecting" | "recording" | "finishing" | "reading">("idle");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<LiveTranscription | null>(null);
  // A connection opened ahead of time so Speak starts instantly; replaced after every recording.
  const prepared = useRef<Promise<PreparedTranscription> | null>(null);

  function prepare() {
    const next = prepareTranscription();
    // Warming up is speculative; a failure here only matters if Speak is pressed (handled there).
    next.catch(() => {});
    prepared.current = next;
  }

  useEffect(() => {
    prepare();
    return () => {
      prepared.current?.then((p) => p.close()).catch(() => {});
    };
  }, []);

  // The warm connection, or a fresh one if warming failed or it has since dropped.
  async function takeConnection(): Promise<PreparedTranscription> {
    const warm = prepared.current;
    prepared.current = null;
    const ready = warm && (await warm.catch(() => null));
    if (ready?.isOpen()) return ready;
    ready?.close();
    return prepareTranscription();
  }

  const joined = (base: string, extra: string) => [base.trim(), extra.trim()].filter(Boolean).join(" ");
  const listening = phase === "connecting" || phase === "recording" || phase === "finishing";

  function failed(e: Error) {
    session.current = null;
    setLive("");
    setPhase("idle");
    setError(e.message);
    prepare();
  }

  async function startRecording() {
    setError(null);
    setPhase("connecting");
    try {
      const connection = await takeConnection();
      session.current = await connection.start({ onText: setLive, onError: failed });
      setPhase("recording");
    } catch (e) {
      failed(e as Error);
    }
  }

  async function stopRecording() {
    setPhase("finishing");
    try {
      const heard = await session.current!.stop();
      session.current = null;
      const full = joined(text, heard);
      setText(full);
      setLive("");
      setPhase("idle");
      prepare();
      return full;
    } catch (e) {
      failed(e as Error);
      return null;
    }
  }

  function discard() {
    if (session.current) {
      session.current.cancel();
      prepare();
    }
    session.current = null;
    setText("");
    setLive("");
    setError(null);
    setPhase("idle");
  }

  // Done while recording stops first, waits for the last words, then submits everything.
  async function submit() {
    setError(null);
    const dump = phase === "recording" ? await stopRecording() : text;
    if (dump === null || !dump.trim()) return;
    setPhase("reading");
    try {
      await onSubmit(dump);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  return (
    <section>
      <textarea
        value={listening ? joined(text, live) : text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell me everything."
        readOnly={listening}
        disabled={phase === "reading"}
        autoFocus
      />
      <div className="actions">
        {phase === "reading" ? (
          <span className="status">Reading your day…</span>
        ) : (
          <>
            {(text.trim() || listening) && (
              <button className="link quiet" onClick={discard}>
                Discard
              </button>
            )}
            <span className="spacer" />
            {phase === "connecting" && <span className="status">Connecting…</span>}
            {phase === "finishing" && <span className="status">Finishing…</span>}
            {phase === "recording" && (
              <button className="link recording" onClick={stopRecording}>
                Stop
              </button>
            )}
            {phase === "idle" && (
              <button className="link" onClick={startRecording}>
                Speak
              </button>
            )}
            <button
              className="link"
              onClick={submit}
              disabled={phase === "connecting" || phase === "finishing" || (phase === "idle" && !text.trim())}
            >
              Done
            </button>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
