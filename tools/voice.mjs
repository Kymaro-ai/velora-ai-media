// VELORA — automatic voice-over for social media.
// For every voice/scripts/<id>.json without voice/out/<id>.wav, asks Gemini TTS
// (same model, voices and styles as the VELORA app) and saves a WAV file.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const MODEL = "gemini-3.8-flash-lite-tts";
const VOICES = ["Kore", "Aoede", "Sulafat", "Charon", "Orus", "Achird"];
const STYLES = {
  natural: "natural, warm and conversational, like a helpful personal assistant",
  calm: "calm, soft and reassuring, relaxed and unhurried",
  professional: "clear, confident and professional, like a premium concierge",
  warm: "warm, friendly and caring, with a gentle smile in the voice",
  energetic: "upbeat, energetic and enthusiastic"
};
const SPEEDS = { slow: "speaking slowly and clearly", normal: "speaking at a natural pace", fast: "speaking at a brisk, efficient pace" };
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error("GEMINI_API_KEY is missing"); process.exit(1); }

function wavFromPcm(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function speak(text, voice, style) {
  const attempt = voiceConfig => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text, speech_metadata: { style } }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig } }
    })
  });
  let res = await attempt({ voice });
  if (res.status === 400) res = await attempt({ prebuiltVoiceConfig: { voiceName: voice } });
  if (!res.ok) throw new Error("TTS_HTTP_" + res.status + " " + (await res.text()).slice(0, 300));
  const data = await res.json();
  const part = (data?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new Error("TTS_NO_AUDIO");
  const bytes = Buffer.from(part.inlineData.data, "base64");
  if (bytes.subarray(0, 4).toString() === "RIFF") return bytes;
  const rate = Number(String(part.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1] || 24000);
  return wavFromPcm(bytes, rate);
}

let made = 0, failed = 0;
for (const file of readdirSync("voice/scripts").filter(f => f.endsWith(".json")).sort()) {
  const id = file.replace(/\.json$/, "");
  const out = `voice/out/${id}.wav`;
  if (existsSync(out)) continue;
  const s = JSON.parse(readFileSync(`voice/scripts/${file}`, "utf8"));
  const voice = VOICES.includes(s.voice) ? s.voice : "Kore";
  const style = (STYLES[s.style] || STYLES.warm) + ", " + (SPEEDS[s.speed] || SPEEDS.normal);
  try {
    writeFileSync(out, await speak(String(s.text).slice(0, 1500), voice, style));
    console.log("made", out); made++;
  } catch (e) { console.error("failed", id, e.message); failed++; }
}
console.log(`done: ${made} made, ${failed} failed`);
if (failed) process.exit(1);
