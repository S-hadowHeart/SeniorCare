import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Button } from "../components/ui/Button";
import { SelectInput, TextInput } from "../components/ui/Form";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { homePath } from "../lib/routes";

const registerSchema = z
  .object({
    role: z.enum(["SENIOR", "CAREGIVER"]),
    name: z.string().trim().min(2, "Enter your name.").max(80),
    email: z.string().trim().min(1, "Enter your e-mail address.").email("Enter a valid e-mail address."),
    phone: z
      .string()
      .trim()
      .max(32)
      .optional()
      .refine((value) => !value || /^[+()\-\s\d]+$/.test(value), "Enter a valid phone number."),
    password: z
      .string()
      .min(10, "Use at least 10 characters.")
      .max(200)
      .regex(/[a-zA-Z]/, "Include at least one letter.")
      .regex(/\d/, "Include at least one number."),
    confirmPassword: z.string(),
    displayName: z.string().trim().max(80).optional(),
    dateOfBirth: z.string().optional(),
    bloodType: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "UNKNOWN"]),
    conditions: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match.",
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function Register() {
  const { register: createAccount } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: "SENIOR",
      name: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
      displayName: "",
      dateOfBirth: "",
      bloodType: "UNKNOWN",
      conditions: "",
    },
  });

  const role = watch("role");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await createAccount({
        role: values.role,
        name: values.name,
        email: values.email,
        phone: values.phone || undefined,
        password: values.password,
        timeZone,
        ...(values.role === "SENIOR"
          ? {
              elder: {
                displayName: values.displayName || values.name,
                ...(values.dateOfBirth ? { dateOfBirth: new Date(values.dateOfBirth) } : {}),
                bloodType: values.bloodType,
                conditions: values.conditions
                  ? values.conditions
                      .split(",")
                      .map((condition) => condition.trim())
                      .filter(Boolean)
                  : [],
              },
            }
          : {}),
      });

      toast.success("Your account is ready.", "You can add your care circle straight away.");
      navigate(homePath(user), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("We could not create your account. Please try again.");
      }
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes about two minutes. You can change everything later."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-900">
            Sign in
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

        {/* Role selector */}
        <fieldset>
          <legend className="label">I am signing up as</legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                value: "SENIOR" as const,
                title: "A person receiving care",
                body: "You want to keep track of your own health.",
              },
              {
                value: "CAREGIVER" as const,
                title: "A family member or carer",
                body: "You want to follow someone's health.",
              },
            ].map((option) => (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-xl border-2 p-4 transition",
                  role === option.value
                    ? "border-brand-600 bg-brand-50"
                    : "border-ink-200 bg-surface hover:border-ink-300",
                )}
              >
                <input
                  type="radio"
                  value={option.value}
                  className="sr-only"
                  {...register("role")}
                />
                <span className="block text-sm font-semibold text-ink-900">{option.title}</span>
                <span className="mt-1 block text-xs text-ink-500">{option.body}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <TextInput
          label="Full name"
          autoComplete="name"
          placeholder="Margaret Chen"
          error={errors.name?.message}
          {...register("name")}
        />

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
          label="Mobile number (optional)"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+44 7700 900000"
          hint="Used by the care circle to contact you."
          error={errors.phone?.message}
          {...register("phone")}
        />

        {role === "SENIOR" ? (
          <div className="space-y-5 rounded-xl border border-ink-200 bg-ink-50 p-4">
            <p className="text-sm font-semibold text-ink-900">About you</p>

            <TextInput
              label="Preferred name"
              placeholder="Margaret"
              hint="Optional — how the care circle will see you."
              error={errors.displayName?.message}
              {...register("displayName")}
            />

            <TextInput
              label="Date of birth"
              type="date"
              error={errors.dateOfBirth?.message}
              {...register("dateOfBirth")}
            />

            <SelectInput
              label="Blood type"
              error={errors.bloodType?.message}
              {...register("bloodType")}
            >
              {[
                "UNKNOWN",
                "A+",
                "A-",
                "B+",
                "B-",
                "AB+",
                "AB-",
                "O+",
                "O-",
              ].map((type) => (
                <option key={type} value={type}>
                  {type === "UNKNOWN" ? "Not known" : type}
                </option>
              ))}
            </SelectInput>

            <TextInput
              label="Ongoing conditions"
              placeholder="Hypertension, Type 2 diabetes"
              hint="Separate them with commas."
              error={errors.conditions?.message}
              {...register("conditions")}
            />
          </div>
        ) : null}

        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters, including a number."
          error={errors.password?.message}
          {...register("password")}
        />

        <TextInput
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={isSubmitting}
          leftIcon={<UserPlus className="size-4" aria-hidden="true" />}
        >
          Create account
        </Button>

        <p className="text-center text-xs text-ink-500">
          By creating an account you agree to look after the personal information you enter.
          <br />
          Your timezone is set to <span className="font-medium text-ink-700">{timeZone}</span>.
          <button
            type="button"
            className="ml-1 font-medium text-brand-700 hover:underline"
            onClick={() => setValue("displayName", undefined)}
          >
            Change later in your profile.
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
