const STEPS = ["Service", "Provider", "Date & time", "Details", "Confirmed"] as const;

type BookingStepsProps = {
  /** 1 Service · 2 Provider · 3 Date & time · 4 Details · 5 Confirmed */
  current: 1 | 2 | 3 | 4 | 5;
};

/** The five-step progress pills shown at the top of every booking page. */
export function BookingSteps({ current }: BookingStepsProps) {
  return (
    <ol className="sf-steps" aria-label="Booking progress">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "current" : "todo";
        return (
          <li
            key={label}
            className={`sf-step sf-step--${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="sf-step__mark" aria-hidden="true">
              {state === "done" ? "✓" : number}
            </span>
            <span className="sf-step__label">
              {label}
              {state === "done" ? <span className="sf-visually-hidden"> (completed)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
