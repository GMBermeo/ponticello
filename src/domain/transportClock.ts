/**
 * The transport clock — where the music is, as a function of when you ask.
 *
 * The playhead used to be an accumulator: every frame added
 * `timeSincePreviousFrame × tempo` to the last position. That is exact only
 * while every frame is delivered, measured and summed without loss, and a
 * phone at 120 Hz does not promise any of those. A dropped or late frame, a
 * frame callback that is paused while React commits, a delta rounded
 * somewhere between the display link and the worklet — each costs a fraction
 * of a millisecond that is never paid back, and over a four-minute song they
 * add up to the notes arriving visibly after the audio, one note at a time.
 *
 * So the clock is not accumulated any more. It is *anchored*: one fact — "at
 * frame time A the score was at S, moving at rate R" — and every frame asks
 * what that fact implies for now. A frame that arrives late draws the right
 * position for the time it arrives; a frame that never arrives costs nothing at
 * all. Frame rate stops being an input.
 *
 * The anchor still runs on the display's clock, and the audio runs on the
 * sound card's. Those two drift apart by a few parts per million, and on
 * native a looped file can add a small gap at every repeat. So the adapter's
 * own position is sampled a few times a second and fed to `DriftEstimator`,
 * which turns the disagreement into a small correction of the anchor. The
 * audio is the reference; the picture follows it.
 *
 * Pure: no React, no React Native. The hot functions carry a `'worklet'`
 * directive so the UI-thread frame callback can call them directly; in Node
 * the directive is an inert string. See AGENTS.md.
 */

/**
 * Places a score time inside the loop `[startMs, endMs)`.
 *
 * Modular rather than clamped, because the playhead is a cycle: time that has
 * run past the end of bar 8 is time into bar 1 of the next pass, and throwing
 * the overshoot away is exactly the per-repeat loss this module exists to end.
 */
export function wrapIntoLoop(timeMs: number, startMs: number, endMs: number): number {
  'worklet';
  const span = endMs - startMs;
  if (Number.isNaN(span) || span <= 0) return startMs;
  const into = (timeMs - startMs) % span;
  return startMs + (into < 0 ? into + span : into);
}

/**
 * Score time at `nowMs`, given an anchor.
 *
 * `nowMs` before the anchor means playback has been scheduled but not reached
 * — the audio adapter's start lead — and the anchor position is held until it
 * arrives.
 */
export function scoreTimeAt(
  anchorAtMs: number,
  anchorScoreMs: number,
  rate: number,
  nowMs: number,
  startMs: number,
  endMs: number,
): number {
  'worklet';
  const elapsed = nowMs > anchorAtMs ? nowMs - anchorAtMs : 0;
  return wrapIntoLoop(anchorScoreMs + elapsed * rate, startMs, endMs);
}

/**
 * Signed shortest distance from `fromMs` to `toMs`, going round the loop.
 *
 * Positive means `toMs` is ahead. Needed because the audio and the picture
 * are compared near the loop point too, where "the audio is at 20 ms and the
 * picture at 7 980 ms of an 8 000 ms loop" is 40 ms of lag, not 8 seconds.
 */
export function loopDistance(
  fromMs: number, toMs: number, startMs: number, endMs: number,
): number {
  'worklet';
  const raw = toMs - fromMs;
  const span = endMs - startMs;
  if (Number.isNaN(span) || span <= 0) return raw;
  let distance = raw % span;
  if (distance > span / 2) distance -= span;
  else if (distance < -span / 2) distance += span;
  return distance;
}

export interface DriftPolicy {
  /** Errors this small are measurement noise and are left alone. */
  deadbandMs: number;
  /** Errors this large are a seek or a stall: jump, do not ease. */
  snapMs: number;
  /** Share of a mid-sized error removed per correction, 0–1. */
  gain: number;
  /** Samples whose median is trusted. Odd, so the median is a real sample. */
  window: number;
}

/**
 * Tuned against the two sources of noise that matter.
 *
 * The picture is sampled at most one frame stale (8 ms at 120 Hz, 17 at 60),
 * and an audio position is quantised to the audio device's render block — a
 * few milliseconds on web, up to a buffer on Android. A median of five inside
 * a 10 ms deadband rejects both, while a real drift of a few milliseconds a
 * minute is still caught long before anyone can hear it.
 */
export const DEFAULT_DRIFT_POLICY: DriftPolicy = {
  deadbandMs: 10,
  snapMs: 160,
  gain: 0.5,
  window: 5,
};

/**
 * Turns audio-versus-picture measurements into anchor corrections.
 *
 * Stateful by necessity — a median needs history — but free of any clock: the
 * caller supplies both positions, so the whole policy is testable by feeding it
 * numbers.
 */
export class DriftEstimator {
  private readonly samples: number[] = [];
  /** Frame the last sample was read from. */
  private sampledFrame = Number.NaN;
  /** Frame current when the last correction was applied. */
  private correctedFrame = Number.NaN;

  constructor(private readonly policy: DriftPolicy = DEFAULT_DRIFT_POLICY) {}

  /** Forget history, e.g. after a pause, restart or seek. */
  reset(): void {
    this.samples.length = 0;
  }

  /**
   * Records one measurement and returns how far to move the visual anchor, in
   * score milliseconds (positive = move the picture forward). Zero until
   * enough samples agree.
   *
   * `frame` is a counter the frame callback advances each time it redraws.
   * `visualMs` is only as fresh as the last frame, so a sample taken with no
   * new frame since the previous one — a hidden browser tab, a stalled UI
   * thread — measures a picture that has not moved. Using it would apply the
   * same correction again and again while nothing is drawn, and the anchor
   * would run away. Such samples are ignored, and after a correction nothing
   * more is applied until at least two frames have drawn the corrected clock.
   */
  push(
    visualMs: number, audioMs: number, startMs: number, endMs: number, frame?: number,
  ): number {
    if (frame !== undefined) {
      if (frame === this.sampledFrame) return 0;
      this.sampledFrame = frame;
      if (frame - this.correctedFrame < 2) return 0;
    }

    const error = loopDistance(visualMs, audioMs, startMs, endMs);
    // A single wild reading is a stall or a seek in progress, and waiting for a
    // median of five of them would leave the picture wrong for a second.
    if (Math.abs(error) >= this.policy.snapMs * 4) {
      this.reset();
      if (frame !== undefined) this.correctedFrame = frame;
      return error;
    }

    this.samples.push(error);
    if (this.samples.length > this.policy.window) this.samples.shift();
    if (this.samples.length < this.policy.window) return 0;

    const median = [...this.samples].sort((a, b) => a - b)[this.samples.length >> 1] ?? 0;
    const magnitude = Math.abs(median);
    if (magnitude <= this.policy.deadbandMs) return 0;

    // Whatever is applied now is already inside the history it was measured
    // from; keeping those samples would apply the same error twice.
    this.reset();
    if (frame !== undefined) this.correctedFrame = frame;
    return magnitude >= this.policy.snapMs ? median : median * this.policy.gain;
  }
}
