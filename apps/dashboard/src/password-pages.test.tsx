import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordPage, ResetPasswordPage } from "./password-pages";
import { platformApi } from "./platform-api";

afterEach(() => vi.restoreAllMocks());

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>Sign in page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("ForgotPasswordPage", () => {
  it("sends the request and gives the same confirmation either way", async () => {
    const spy = vi.spyOn(platformApi, "forgotPassword").mockResolvedValue({ ok: true });
    renderAt("/forgot-password");
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: " Owner@Example.com " } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ email: "owner@example.com" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/if that email has an account/i);
  });

  it("shows the server's message when the request is refused", async () => {
    vi.spyOn(platformApi, "forgotPassword").mockRejectedValue(new Error("Too many requests. Please wait a moment and try again."));
    renderAt("/forgot-password");
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many requests/i);
  });
});

describe("ResetPasswordPage", () => {
  it("sets the password from the emailed token, then points to sign in", async () => {
    const spy = vi.spyOn(platformApi, "resetPassword").mockResolvedValue({ ok: true });
    renderAt("/reset-password?token=abc.def.ghi");
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPass456" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "BrandNewPass456" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ token: "abc.def.ghi", newPassword: "BrandNewPass456" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/password was changed/i);
    fireEvent.click(screen.getByRole("button", { name: /go to sign in/i }));
    expect(await screen.findByText("Sign in page")).toBeInTheDocument();
  });

  it("welcomes an invited person and words the result accordingly", async () => {
    vi.spyOn(platformApi, "resetPassword").mockResolvedValue({ ok: true });
    renderAt("/reset-password?token=abc&invite=1");
    expect(screen.getByRole("heading", { name: /welcome/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "MyOwnPassword9" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "MyOwnPassword9" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/your password is set/i);
  });

  it("won't submit mismatched passwords", () => {
    const spy = vi.spyOn(platformApi, "resetPassword");
    renderAt("/reset-password?token=abc");
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPass456" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "different-one" } });
    expect(screen.getByText(/don't match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change password/i })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("offers a new link when the link is expired or already used", async () => {
    vi.spyOn(platformApi, "resetPassword").mockRejectedValue(new Error("This link is invalid or has expired. Request a new one."));
    renderAt("/reset-password?token=stale");
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPass456" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "BrandNewPass456" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute("href", "/forgot-password");
  });

  it("explains a link with no token instead of showing a form", () => {
    renderAt("/reset-password");
    expect(screen.getByRole("alert")).toHaveTextContent(/incomplete/i);
    expect(screen.queryByLabelText(/^new password/i)).toBeNull();
  });
});
