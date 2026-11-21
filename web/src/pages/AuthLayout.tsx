import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { HeartPulse } from "lucide-react";
import { ThemeToggle } from "../components/ui/ThemeToggle";

/** Split-screen shell shared by the sign-in and sign-up pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Form side */}
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="inline-flex items-center gap-2.5 font-bold text-ink-900">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-700 text-white">
                <HeartPulse className="size-5" aria-hidden="true" />
              </span>
              SeniorCare
            </Link>
            <ThemeToggle />
          </div>

          <h1 className="mt-8 text-3xl font-bold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-2 text-ink-600">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {footer ? <div className="mt-8 text-center text-sm text-ink-600">{footer}</div> : null}
        </div>
      </div>

      {/* Brand side */}
      <div className="relative hidden overflow-hidden bg-brand-800 lg:block">
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #5eead4 0, transparent 45%), radial-gradient(circle at 80% 70%, #0d9488 0, transparent 50%)",
          }}
          aria-hidden="true"
        />
        <div className="relative flex h-full flex-col justify-center px-16 py-12 text-white">
          <blockquote className="max-w-md">
            <p className="text-2xl font-semibold leading-snug">
              “The daily check-in changed everything. We stopped calling every evening, and my
              mother stopped worrying about us worrying.”
            </p>
            <footer className="mt-6 text-brand-100">
              <p className="font-semibold">Sophie</p>
              <p className="text-sm text-brand-200">Daughter and primary carer</p>
            </footer>
          </blockquote>

          <dl className="mt-14 grid max-w-md grid-cols-3 gap-6 border-t border-white/15 pt-8">
            {[
              { value: "1 tap", label: "to get help" },
              { value: "24/7", label: "monitoring" },
              { value: "0", label: "background tracking" },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="tabular text-2xl font-bold">{stat.value}</dt>
                <dd className="mt-1 text-sm text-brand-200">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
