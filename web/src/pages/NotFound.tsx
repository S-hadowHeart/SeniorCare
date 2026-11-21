import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "../components/ui/Button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
        <Compass className="size-8" aria-hidden="true" />
      </span>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink-900">Page not found</h1>
      <p className="mt-2 max-w-md text-ink-600">
        The page you were looking for does not exist or has moved.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/">
          <Button size="lg">Back to the home page</Button>
        </Link>
        <Link to="/app">
          <Button size="lg" variant="outline">
            Go to my dashboard
          </Button>
        </Link>
      </div>
    </main>
  );
}
