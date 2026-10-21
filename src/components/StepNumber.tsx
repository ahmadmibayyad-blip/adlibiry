// AI Studio → Remake an ad numbers its steps (Why this video works, Write my version, Make the video).
export default function StepNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 mr-1.5 rounded-full bg-primary/10 text-primary text-xs align-middle">{n}</span>
  );
}
