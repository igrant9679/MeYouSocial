"""words.py — word-level timestamps for a narration WAV using local openai-whisper (GPU if available).

usage: python words.py <in.wav> <out.json> [model]
writes: {"words": [{"w": "Hello", "s": 0.12, "e": 0.41}, ...], "duration": 8.4}
"""
import json, sys
import whisper

src, out = sys.argv[1], sys.argv[2]
model_name = sys.argv[3] if len(sys.argv) > 3 else "small.en"
model = whisper.load_model(model_name)
result = model.transcribe(src, word_timestamps=True, language="en", fp16=True, condition_on_previous_text=False)
words = []
for seg in result["segments"]:
    for w in seg.get("words", []):
        t = w["word"].strip()
        if t:
            words.append({"w": t, "s": round(float(w["start"]), 3), "e": round(float(w["end"]), 3)})
dur = words[-1]["e"] if words else 0
with open(out, "w", encoding="utf8") as f:
    json.dump({"words": words, "duration": dur}, f, ensure_ascii=False)
print(f"{len(words)} words, {dur:.2f}s")
