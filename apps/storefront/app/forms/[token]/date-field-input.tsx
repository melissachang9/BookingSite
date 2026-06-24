"use client";

type DateFieldInputProps = {
  name: string;
  required?: boolean;
};

function openNativeDatePicker(input: HTMLInputElement) {
  const pickerCapableInput = input as HTMLInputElement & {
    showPicker?: () => void;
  };

  pickerCapableInput.showPicker?.();
}

export default function DateFieldInput({ name, required = false }: DateFieldInputProps) {
  return (
    <input
      name={name}
      type="date"
      required={required}
      onClick={(event) => {
        const input = event.currentTarget;
        if (!input.value) {
          openNativeDatePicker(input);
        }
      }}
    />
  );
}