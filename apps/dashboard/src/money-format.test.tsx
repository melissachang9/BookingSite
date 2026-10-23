import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildMoneyFormat, MoneyFormatProvider, useMoneyFormat, zonedDayStartIso } from "./money-format";

function Probe() {
  const fmt = useMoneyFormat();
  return (
    <p>
      {fmt.money(12345)}|{fmt.signed(-500)}|{fmt.dateTime("2026-10-20T16:30:00Z")}
    </p>
  );
}

describe("money format", () => {
  it("uses the business's currency and timezone", () => {
    render(
      <MoneyFormatProvider currency="CAD" timeZone="America/Vancouver">
        <Probe />
      </MoneyFormatProvider>,
    );
    expect(screen.getByText(/\$123\.45\|−\$5\.00\|Oct 20, 9:30 AM/)).toBeInTheDocument();
  });

  it("formats other currencies with their own symbol", () => {
    expect(buildMoneyFormat("EUR", "Europe/Paris").money(1000)).toBe("€10.00");
    expect(buildMoneyFormat("GBP", "Europe/London").money(1000)).toBe("£10.00");
  });

  it("falls back to a safe timezone when the stored one is not valid", () => {
    expect(buildMoneyFormat("USD", "Mars/Olympus").timeZone).toBe("America/Los_Angeles");
  });

  it("finds midnight in the business timezone, including across daylight saving", () => {
    expect(zonedDayStartIso("2026-10-20", "America/Vancouver")).toBe("2026-10-20T07:00:00.000Z");
    expect(zonedDayStartIso("2026-12-01", "America/Vancouver")).toBe("2026-12-01T08:00:00.000Z");
    // Clocks go back on 2026-11-01 in Vancouver: that midnight is still daylight time, the next is not.
    expect(zonedDayStartIso("2026-11-01", "America/Vancouver")).toBe("2026-11-01T07:00:00.000Z");
    expect(zonedDayStartIso("2026-11-02", "America/Vancouver")).toBe("2026-11-02T08:00:00.000Z");
    expect(zonedDayStartIso("2026-10-20", "Asia/Tokyo")).toBe("2026-10-19T15:00:00.000Z");
  });

  it("returns undefined for an empty day and an exclusive end after the day", () => {
    const fmt = buildMoneyFormat("USD", "America/Vancouver");
    expect(fmt.dayStart("")).toBeUndefined();
    expect(fmt.dayEnd("")).toBeUndefined();
    expect(fmt.dayEnd("2026-10-20")).toBe("2026-10-21T07:00:00.000Z");
  });
});
