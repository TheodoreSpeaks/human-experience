import OpenAI from "openai";

const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const SECRET_TTL_SECONDS = 60;

const client = new OpenAI();

// Short-lived key the browser uses to open a transcription-only realtime session over WebRTC.
// Server VAD splits speech at pauses; each chunk streams back as transcription deltas.
export async function createTranscriptionSecret(): Promise<string> {
  const res = await client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: SECRET_TTL_SECONDS },
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL },
          turn_detection: { type: "server_vad", silence_duration_ms: 500 },
          noise_reduction: { type: "near_field" },
        },
      },
    },
  });
  return res.value;
}
