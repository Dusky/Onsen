/**
 * The completion chime (SPEC §5, "Background UX").
 *
 * Synthesised rather than a file. Two short sine tones through WebAudio is a
 * dozen lines and no asset, and an asset would have to be committed, served and
 * cached for a sound that plays for a third of a second.
 *
 * Autoplay policy is the reason for `unlock`. A browser will not let a page make
 * a sound until the person has interacted with it, and an AudioContext created
 * before that starts suspended and stays suspended — so the context is built on
 * the first gesture the app sees, and nothing before then can ring.
 */

let context: AudioContext | null = null;

/** Called from the first pointer or key event. Idempotent. */
export function unlockAudio(): void {
  if (context !== null) return;
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    context = new Ctor();
    void context.resume();
  } catch {
    // No audio available. A missing chime is not worth a broken screen.
    context = null;
  }
}

/** A quiet two-note figure. Deliberately not a notification-sounding beep. */
export function playChime(): void {
  if (context === null) return;
  try {
    void context.resume();
    const now = context.currentTime;
    for (const [index, frequency] of [523.25, 783.99].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.12;
      // Shaped rather than switched: a square-edged gain change is a click.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    }
  } catch {
    /* Never worth an error. */
  }
}

/**
 * Whether the reader asked for a chime.
 *
 * Held here rather than read through a query at the moment of playing: a turn
 * finishing is not a good time to make a request, and the preference changes
 * about once ever. The screen that owns the setting keeps this in step.
 */
let wanted = false;

export function setChimeWanted(value: boolean): void {
  wanted = value;
}

export function chimeIfWanted(): void {
  if (wanted) playChime();
}
