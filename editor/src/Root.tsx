import { Composition } from "remotion";
import { Quiz, type QuizProps } from "./Quiz";

const FPS = 30;

const sample: QuizProps = {
  answer: "BMW M4",
  hook: ["GUESS THE", "CAR"],
  emoji: "👀",
  clips: [],
  plan: { length: 17, drop: 9, beats: [], downbeats: [], strong: [], energy: [] },
};

export const Root = () => (
  <Composition
    id="Quiz"
    component={Quiz}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={17 * FPS}
    defaultProps={sample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.plan.length * FPS) })}
  />
);
