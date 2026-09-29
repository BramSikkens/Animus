import { EMOTION_GROUPS, type Emotion } from "@animus/core/emotion";

// Stemmingsstrook: een paar (ADR-0015) als tegengestelde balk vanuit het midden, losse emoties als gewoon balkje.
export function MoodStrip({ values, dominant }: { values: Record<Emotion, number>; dominant?: Emotion }) {
  const pairs = EMOTION_GROUPS.filter((group) => group.length === 2);
  const singles = EMOTION_GROUPS.filter((group) => group.length === 1).map(([emotion]) => emotion!);
  const label = (emotion: Emotion) => <span className={emotion === dominant ? "mood-dominant" : undefined}>{emotion}</span>;
  const track = (emotion: Emotion, toLeft = false) => {
    const value = Math.round(Math.min(100, Math.max(0, values[emotion])));
    return (
      <div className={toLeft ? "mood-track to-left" : "mood-track"} role="meter" aria-label={emotion} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <div className="mood-fill" style={{ width: `${value}%` }} />
      </div>
    );
  };
  return (
    <div className="mood">
      <div className="mood-pairs">
        {pairs.map(([left, right]) => (
          <div key={left} className="mood-pair">
            {label(left!)}
            {track(left!, true)}
            {track(right!)}
            {label(right!)}
          </div>
        ))}
      </div>
      <div className="mood-singles">
        {singles.map((emotion) => (
          <div key={emotion} className="mood-single">
            {label(emotion)}
            {track(emotion)}
          </div>
        ))}
      </div>
    </div>
  );
}
