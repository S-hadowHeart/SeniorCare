import { Link } from "react-router-dom";
import {
  Activity,
  BellRing,
  CalendarCheck,
  HeartPulse,
  MapPin,
  Pill,
  ShieldAlert,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/ui/ThemeToggle";

const FEATURES = [
  {
    icon: ShieldAlert,
    title: "One-tap emergency help",
    body: "A single press alerts every registered family member and caregiver by e-mail and in the app, with your location attached when it is available.",
  },
  {
    icon: CalendarCheck,
    title: "Daily safety check-in",
    body: "Confirm you are safe once a day. If nobody checks in, the care circle is told — silence is treated as a signal, not as reassurance.",
  },
  {
    icon: Activity,
    title: "Health readings",
    body: "Blood pressure, blood sugar, heart rate and temperature, recorded in seconds and shared with the people you choose.",
  },
  {
    icon: Pill,
    title: "Medicine reminders",
    body: "Scheduled doses arrive as a gentle reminder, with a clear record of what was taken, skipped or missed.",
  },
  {
    icon: MapPin,
    title: "Location when it matters",
    body: "Your position is only shared when you ask for help — never tracked in the background.",
  },
  {
    icon: BellRing,
    title: "Live updates for carers",
    body: "Dashboards update the moment something changes, so you are never checking a stale screen.",
  },
];

const STEPS = [
  { step: "01", title: "Create the account", body: "The senior signs up and completes a short health profile." },
  { step: "02", title: "Add the care circle", body: "Family members, professional carers and the GP are invited and given exactly the access they need." },
  { step: "03", title: "Live with confidence", body: "Check-ins, readings and reminders run quietly in the background; SOS is always one tap away." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-surface">
      <a href="#features" className="skip-link">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-700 text-white">
            <HeartPulse className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-bold text-ink-900">SeniorCare</span>

          <nav className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login">
              <Button variant="ghost" size="md">
                Sign in
              </Button>
            </Link>
            <Link to="/register">
              <Button size="md">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* Hero                                                          */}
      {/* ------------------------------------------------------------- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
              <span className="size-1.5 rounded-full bg-brand-600" aria-hidden="true" />
              Safety, dignity and independence
            </span>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]">
              Looking after someone,
              <span className="block text-brand-700">without hovering.</span>
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
              SeniorCare gives older people a calm, simple way to confirm they are safe, keep track
              of their health and call for help in one tap — and gives the people who care about
              them the reassurance that everything is fine.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register">
                <Button size="lg" fullWidth className="sm:w-auto">
                  Create a free account
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" fullWidth className="sm:w-auto">
                  Sign in
                </Button>
              </Link>
            </div>

            <p className="mt-5 text-sm text-ink-500">
              Free while in beta · No card required · Works on any phone or tablet
            </p>
          </div>

          {/* Phone mock-up — pure CSS so the page ships almost no JavaScript. */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="rounded-[2rem] border border-ink-200 bg-inverse p-3 shadow-2xl">
              <div className="overflow-hidden rounded-[1.6rem] bg-ink-50">
                <div className="bg-brand-700 px-5 pb-6 pt-5 text-white">
                  <p className="text-sm opacity-90">Good morning, Margaret</p>
                  <p className="mt-1 text-2xl font-bold">You are safe ✓</p>
                  <p className="mt-1 text-xs opacity-80">Checked in today at 09:15</p>
                </div>

                <div className="-mt-3 space-y-3 px-4 pb-4">
                  <div className="rounded-2xl bg-surface p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Today&rsquo;s medicines
                    </p>
                    <div className="mt-3 space-y-2">
                      {["Amlodipine 5 mg", "Metformin 500 mg"].map((item) => (
                        <div key={item} className="flex items-center gap-2 text-sm text-ink-700">
                          <span className="size-2 rounded-full bg-success-500" aria-hidden="true" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-surface p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Blood pressure
                    </p>
                    <p className="tabular mt-1 text-3xl font-bold text-ink-900">
                      124<span className="text-lg text-ink-400">/78</span>
                    </p>
                    <p className="text-xs text-success-700">Within your usual range</p>
                  </div>

                  <div className="rounded-2xl bg-danger-600 p-5 text-center text-white shadow-lg">
                    <p className="text-xl font-bold">Emergency help</p>
                    <p className="text-xs opacity-90">One tap alerts your family</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* Features                                                      */}
      {/* ------------------------------------------------------------- */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            Everything that matters, nothing that does not
          </h2>
          <p className="mt-4 text-lg text-ink-600">
            Six simple tools that work together to keep someone safe at home and keep their family
            informed.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card card-pad transition hover:shadow-md">
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <feature.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ink-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* How it works                                                  */}
      {/* ------------------------------------------------------------- */}
      <section className="border-y border-ink-200 bg-ink-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            Set up in minutes
          </h2>

          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map((item) => (
              <li key={item.step} className="relative">
                <span className="tabular text-sm font-bold text-brand-600">{item.step}</span>
                <h3 className="mt-2 text-lg font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* CTA                                                           */}
      {/* ------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="card overflow-hidden bg-brand-700 p-8 text-center text-white sm:p-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Give your family something to worry less about
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-brand-50">
            Set up the daily check-in in under two minutes. The family side updates itself.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/register">
              <Button size="lg" className="bg-surface text-brand-800 hover:bg-brand-50" fullWidth>
                Get started
              </Button>
            </Link>
            <Link to="/login">
              <Button
                size="lg"
                variant="outline"
                className="border-white/60 bg-transparent text-white hover:bg-white/10"
                fullWidth
              >
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-200 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} SeniorCare</p>
          <p>Built for families caring for older people.</p>
        </div>
      </footer>
    </div>
  );
}
