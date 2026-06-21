"use client";

import { useRef, useState, useCallback } from "react";

type SignatureFieldProps = {
  name: string;
  label: string;
  required?: boolean;
  helpText?: string;
};

export default function SignatureField({ name, label, required, helpText }: SignatureFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      if ("touches" in e) {
        const touch = e.touches[0] ?? e.changedTouches[0];
        return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
      }
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    },
    [],
  );

  const syncToFileInput = useCallback(() => {
    const canvas = canvasRef.current;
    const input = fileInputRef.current;
    if (!canvas || !input) return;
    canvas.toBlob((blob) => {
      if (!blob || !input) return;
      const file = new File([blob], "signature.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, "image/png");
  }, []);

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getCanvasPoint(e);
      if (!point) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      setIsDrawing(true);
      setHasSignature(true);
    },
    [getCanvasPoint],
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (!isDrawing) return;
      const point = getCanvasPoint(e);
      if (!point) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    },
    [isDrawing, getCanvasPoint],
  );

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    syncToFileInput();
  }, [syncToFileInput]);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div className="requirement-form-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {helpText ? <small>{helpText}</small> : null}
      <div className="signature-pad">
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          className="signature-pad__canvas"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasSignature ? (
          <span className="signature-pad__placeholder">Sign here</span>
        ) : null}
        <button
          type="button"
          className="ghost-link signature-pad__clear"
          onClick={clearSignature}
        >
          Clear
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        name={name}
        accept="image/*"
        required={required}
        className="signature-pad__file-input"
      />
    </div>
  );
}
