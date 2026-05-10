import { LoginForm } from "./login-form";

export const metadata = {
  title: "Operator login — BookingSite",
};

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Operator sign in</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            BookingSite admin
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
