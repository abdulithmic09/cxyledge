import { createFileRoute } from "@tanstack/react-router";
import { Cylinder } from "lucide-react";
import { authEnabled } from "@/lib/auth/client";
import { SignInPanel } from "@/components/yard/sign-in-panel";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 py-10 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-ink text-paper">
            <Cylinder className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-display text-3xl leading-none">Cxyledge</p>
            <p className="mt-1 text-sm text-muted">Shared cylinder book</p>
          </div>
        </div>
        <h1 className="font-display text-2xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          The same account opens this yard on a phone, a laptop, or another desk. Share the yard code so someone else’s entry shows up on every device.
        </p>
        {authEnabled ? (
          <div className="mt-5">
            <SignInPanel />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
