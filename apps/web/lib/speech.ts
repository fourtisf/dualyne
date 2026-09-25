/** Voice input and read-aloud with the browser's own speech features (nothing is sent to us). */

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canDictate = () => recognitionCtor() !== null;
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Start dictation. `onText` gets the text heard so far (final plus the current guess) each time
 * it changes; `onEnd` runs when listening stops. Returns a stop function.
 */
export function dictate(onText: (text: string) => void, onEnd: (error?: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onEnd("unsupported");
    return () => undefined;
  }
  const r = new Ctor();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = true;
  let finalText = "";
  r.onresult = (e) => {
    let guess = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) finalText += res[0]!.transcript;
      else guess += res[0]!.transcript;
    }
    onText((finalText + guess).trim());
  };
  let failed: string | undefined;
  r.onerror = (e) => {
    failed = e.error;
  };
  r.onend = () => onEnd(failed);
  r.start();
  return () => r.stop();
}

/** Markdown to plain words for reading aloud. */
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Read text aloud; calls onEnd when finished or stopped. */
export function speak(text: string, onEnd: () => void): void {
  if (!canSpeak()) return onEnd();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain(text));
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
}

export const stopSpeaking = () => {
  if (canSpeak()) window.speechSynthesis.cancel();
};
