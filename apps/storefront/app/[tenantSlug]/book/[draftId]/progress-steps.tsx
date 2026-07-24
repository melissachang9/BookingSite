type ProgressStepsProps = {
  steps: { label: string; active: boolean; complete: boolean }[];
};

export default function ProgressSteps({ steps }: ProgressStepsProps) {
  return (
    <nav className="progress-steps" aria-label="Booking progress">
      {steps.map((step, i) => (
        <div
          key={step.label}
          className={`progress-steps__step${step.active ? " is-active" : ""}${step.complete ? " is-complete" : ""}`}
        >
          <span className="progress-steps__dot" aria-hidden="true">
            {step.complete ? "✓" : i + 1}
          </span>
          <span className="progress-steps__label">{step.label}</span>
        </div>
      ))}
    </nav>
  );
}
