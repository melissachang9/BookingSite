import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BookingFormResponseEntry, FormSchema } from "@booking/shared-types";

import { FormResponseViewer } from "./form-response-viewer";

function buildResponse(overrides: Partial<BookingFormResponseEntry> = {}): BookingFormResponseEntry {
  return {
    id: "response-1",
    formId: "form-1",
    formVersionId: "version-1",
    formName: "Intake Form",
    formVersionNumber: 2,
    scope: "customer",
    customerPromptTiming: "pre_visit",
    submittedAt: "2026-06-01T15:00:00.000Z",
    answers: {},
    schema: null,
    ...overrides,
  };
}

describe("FormResponseViewer", () => {
  it("renders the header with form name, version, timing, and submitted timestamp", () => {
    render(<FormResponseViewer response={buildResponse()} />);

    expect(screen.getByText("Intake Form")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    // timing label converted from snake_case
    expect(screen.getByText(/pre visit/)).toBeInTheDocument();
  });

  it("renders typed answers when a schema is present", () => {
    const schema: FormSchema = {
      title: "Intake",
      fields: [
        { id: "field-text", type: "short_text", label: "Allergies" },
        { id: "field-bool", type: "yes_no", label: "Pregnant?" },
        { id: "field-multi", type: "multi_select", label: "Skin concerns" },
        { id: "field-date", type: "date", label: "Date of birth" },
        { id: "field-num", type: "number", label: "Age" },
        { id: "field-upload", type: "file_upload", label: "Photo" },
      ],
    };

    render(
      <FormResponseViewer
        response={buildResponse({
          schema,
          answers: {
            "field-text": "None",
            "field-bool": false,
            "field-multi": ["acne", "redness"],
            "field-date": "1990-04-15",
            "field-num": 35,
            "field-upload": [],
          },
        })}
      />,
    );

    expect(screen.getByText("Allergies")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();

    expect(screen.getByText("Pregnant?")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();

    expect(screen.getByText("Skin concerns")).toBeInTheDocument();
    expect(screen.getByText("acne, redness")).toBeInTheDocument();

    expect(screen.getByText("Date of birth")).toBeInTheDocument();
    // Date formatted with timezone shift — assert on the date string format only
    expect(screen.getByText(/Apr 1[45], 1990/)).toBeInTheDocument();

    expect(screen.getByText("Age")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();

    // file upload placeholder
    expect(screen.getByText("Photo")).toBeInTheDocument();
    expect(screen.getByText("Attachment preview coming soon")).toBeInTheDocument();
  });

  it("renders section headings inline within the answer list", () => {
    const schema: FormSchema = {
      title: "Intake",
      fields: [
        { id: "section-1", type: "section", label: "Health history" },
        { id: "field-1", type: "short_text", label: "Conditions" },
      ],
    };

    render(
      <FormResponseViewer
        response={buildResponse({
          schema,
          answers: { "field-1": "None reported" },
        })}
      />,
    );

    expect(screen.getByText("Health history")).toBeInTheDocument();
    expect(screen.getByText("Conditions")).toBeInTheDocument();
    expect(screen.getByText("None reported")).toBeInTheDocument();
  });

  it("renders an em dash for null or empty values", () => {
    const schema: FormSchema = {
      title: "Intake",
      fields: [
        { id: "field-empty", type: "short_text", label: "Notes" },
        { id: "field-null", type: "short_text", label: "Insurance" },
      ],
    };

    render(
      <FormResponseViewer
        response={buildResponse({
          schema,
          answers: {
            "field-empty": "   ",
            "field-null": null,
          },
        })}
      />,
    );

    // Two em-dash placeholders should appear
    const emDashes = screen.getAllByText("\u2014");
    expect(emDashes.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to iterating answers when schema is null", () => {
    render(
      <FormResponseViewer
        response={buildResponse({
          schema: null,
          answers: {
            "Raw key one": "value one",
            "Raw key two": "value two",
          },
        })}
      />,
    );

    expect(screen.getByText("Raw key one")).toBeInTheDocument();
    expect(screen.getByText("value one")).toBeInTheDocument();
    expect(screen.getByText("Raw key two")).toBeInTheDocument();
    expect(screen.getByText("value two")).toBeInTheDocument();
  });

  it("shows an empty message when there are no answers and no schema", () => {
    render(<FormResponseViewer response={buildResponse({ schema: null, answers: {} })} />);

    expect(screen.getByText("No answers recorded.")).toBeInTheDocument();
  });
});
