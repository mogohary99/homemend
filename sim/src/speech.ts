/** Browser speech: TTS for Alexa's replies, push-to-talk STT for the person's turn. Both local, no keys. */
export class Speech {
  enabled = true;
  private voice: SpeechSynthesisVoice | undefined;
  constructor() {
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        voices.find((v) => /en-US/i.test(v.lang) && /Samantha|Google US English|Aria|Jenny|Zira/i.test(v.name)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        voices[0];
    };
    if ("speechSynthesis" in window) {
      pick();
      speechSynthesis.addEventListener("voiceschanged", pick);
    }
  }
  speak(text: string): Promise<void> {
    if (!this.enabled || !("speechSynthesis" in window) || !text) return Promise.resolve();
    speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = 1.03;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
  stop() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  get canListen() {
    return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  }
  listen(onInterim: (t: string) => void): Promise<string> {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) return Promise.reject(new Error("Speech recognition is not available in this browser."));
    return new Promise((resolve, reject) => {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let final = "";
      rec.onresult = (e: any) => {
        let interim = "";
        for (const r of e.results) {
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        onInterim(final || interim);
      };
      rec.onerror = (e: any) => reject(new Error(e.error ?? "speech error"));
      rec.onend = () => resolve(final.trim());
      rec.start();
    });
  }
}
