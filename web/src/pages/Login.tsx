import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LogIn } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Button } from "../components/ui/Button";
import { TextInput } from "../components/ui/Form";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../lib/api";
import { homePath } from "../lib/routes";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your e-mail address.").email("Enter a valid e-mail address."),
  password: z.string().min(1, "Enter your password."),
});

type LoginForm = z.infer<typeof loginSchema>;

const DEMO_ACCOUNTS = [
  { label: "Margaret (senior)", email: "margaret@example.com" },
  { label: "David (son / carer)", email: "david@example.com" },
  { label: "Dr. Okafor (read-only)", email: "dr.okafor@example.com" },
];

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values.email, values.password);
      toast.success(`Welcome back, ${user.name.split(" ")[0]}.`);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? homePath(user), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("We could not sign you in. Please try again.");
      }
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Your care circle is waiting."
      footer={
        <>
          New to SeniorCare?{" "}
          <Link to="/register" className="font-semibold text-brand-700 hover:text-brand-900">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError ? (
          <div role="alert" className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
            {formError}
          </div>
        ) : null}

        <TextInput
          label="E-mail address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register("email")}
        />

        <TextInput
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••"
          error={errors.password?.message}
          {...register("password")}
        />

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={isSubmitting}
          leftIcon={<LogIn className="size-4" aria-hidden="true" />}
        >
          Sign in
        </Button>
      </form>

      <div className="mt-8 rounded-xl border border-ink-200 bg-ink-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Demo accounts</p>
        <p className="mt-1 text-xs text-ink-500">
          Password for all demo accounts: <code className="font-semibold">SeniorCare2024</code>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setValue("email", account.email);
                setValue("password", "SeniorCare2024");
              }}
              className="rounded-lg border border-ink-300 bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-400 hover:text-brand-800"
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
