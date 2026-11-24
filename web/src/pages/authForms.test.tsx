import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import Login from "./Login";
import Register from "./Register";
import { ThemeProvider } from "../context/ThemeContext";
import { ApiError } from "../lib/api";
import type { User } from "../lib/types";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  success: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    login: mocks.login,
    register: mocks.register,
    logout: vi.fn(),
    refreshProfile: vi.fn(),
    user: null,
    status: "anonymous",
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({
    success: mocks.success,
    error: vi.fn(),
    info: vi.fn(),
    toast: vi.fn(),
  }),
}));

const SENIOR: User = {
  id: "user-1",
  email: "margaret@example.com",
  name: "Margaret Whitfield",
  role: "SENIOR",
  timeZone: "Europe/London",
  elderId: "elder-1",
};

const CAREGIVER: User = {
  id: "user-2",
  email: "david@example.com",
  name: "David Whitfield",
  role: "CAREGIVER",
  timeZone: "Europe/London",
  elderId: null,
};

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function renderPage(ui: ReactElement, initialEntry: { pathname: string; state?: unknown } = { pathname: "/login" }) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

async function fillLogin(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-mail address"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

describe("Login form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an e-mail address and a password", async () => {
    renderPage(<Login />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your e-mail address.")).toBeInTheDocument();
    expect(await screen.findByText("Enter your password.")).toBeInTheDocument();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("rejects a malformed e-mail address", async () => {
    renderPage(<Login />);

    await fillLogin("not-an-email", "SeniorCare2024");

    expect(await screen.findByText("Enter a valid e-mail address.")).toBeInTheDocument();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("signs in, greets the user and navigates to the senior home", async () => {
    mocks.login.mockResolvedValue(SENIOR);
    renderPage(<Login />);

    await fillLogin("margaret@example.com", "SeniorCare2024");

    await waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith("margaret@example.com", "SeniorCare2024");
    });
    expect(mocks.success).toHaveBeenCalledWith("Welcome back, Margaret.");
    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/app");
    });
  });

  it("honours the page the user was trying to reach", async () => {
    mocks.login.mockResolvedValue(SENIOR);
    renderPage(<Login />, { pathname: "/login", state: { from: "/medications" } });

    await fillLogin("margaret@example.com", "SeniorCare2024");

    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/medications");
    });
  });

  it("shows the API's message when the credentials are rejected", async () => {
    mocks.login.mockRejectedValue(
      new ApiError(401, { detail: "Invalid e-mail or password." }),
    );
    renderPage(<Login />);

    await fillLogin("margaret@example.com", "wrong-password");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid e-mail or password.");
    expect(screen.getByTestId("path")).toHaveTextContent("/login");
  });

  it("fills the form from a demo account shortcut", async () => {
    const user = userEvent.setup();
    renderPage(<Login />);

    await user.click(screen.getByRole("button", { name: "Margaret (senior)" }));

    expect(screen.getByLabelText("E-mail address")).toHaveValue("margaret@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("SeniorCare2024");
  });
});

async function fillRegistration(options: {
  role?: "SENIOR" | "CAREGIVER";
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
} = {}) {
  const user = userEvent.setup();
  const {
    role = "SENIOR",
    name = "Margaret Whitfield",
    email = "margaret@example.com",
    password = "SeniorCare2024",
    confirmPassword = password,
  } = options;

  if (role === "CAREGIVER") {
    await user.click(screen.getByRole("radio", { name: /A family member or carer/ }));
  }

  await user.type(screen.getByLabelText("Full name"), name);
  await user.type(screen.getByLabelText("E-mail address"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmPassword);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  return user;
}

describe("Register form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a name, an e-mail address and a valid password", async () => {
    renderPage(<Register />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(await screen.findByText("Enter your e-mail address.")).toBeInTheDocument();
    expect(await screen.findByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("requires a number in the password", async () => {
    renderPage(<Register />);

    await fillRegistration({ password: "onlyletters", confirmPassword: "onlyletters" });

    expect(await screen.findByText("Include at least one number.")).toBeInTheDocument();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("requires a letter in the password", async () => {
    renderPage(<Register />);

    await fillRegistration({ password: "1234567890", confirmPassword: "1234567890" });

    expect(await screen.findByText("Include at least one letter.")).toBeInTheDocument();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    renderPage(<Register />);

    await fillRegistration({
      password: "SeniorCare2024",
      confirmPassword: "SeniorCare2025",
    });

    expect(await screen.findByText("The passwords do not match.")).toBeInTheDocument();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number", async () => {
    const user = userEvent.setup();
    renderPage(<Register />);

    await user.type(screen.getByLabelText("Mobile number (optional)"), "call me");
    await fillRegistration();

    expect(await screen.findByText("Enter a valid phone number.")).toBeInTheDocument();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("hides the elder profile for caregivers and submits no elder payload", async () => {
    mocks.register.mockResolvedValue(CAREGIVER);
    renderPage(<Register />);

    expect(screen.getByText("About you")).toBeInTheDocument();

    await fillRegistration({
      role: "CAREGIVER",
      name: "David Whitfield",
      email: "david@example.com",
    });

    expect(screen.queryByText("About you")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.register).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.register.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      role: "CAREGIVER",
      name: "David Whitfield",
      email: "david@example.com",
      password: "SeniorCare2024",
    });
    expect(payload).not.toHaveProperty("elder");
    expect(mocks.success).toHaveBeenCalledWith(
      "Your account is ready.",
      "You can add your care circle straight away.",
    );
  });

  it("submits the senior profile with parsed conditions and dates", async () => {
    mocks.register.mockResolvedValue(SENIOR);
    const user = userEvent.setup();
    renderPage(<Register />);

    await user.type(screen.getByLabelText("Full name"), "Margaret Whitfield");
    await user.type(screen.getByLabelText("E-mail address"), "margaret@example.com");
    await user.type(screen.getByLabelText("Preferred name"), "Margaret");
    fireEvent.change(screen.getByLabelText("Date of birth"), {
      target: { value: "1948-03-02" },
    });
    fireEvent.change(screen.getByLabelText("Blood type"), { target: { value: "A+" } });
    await user.type(
      screen.getByLabelText("Ongoing conditions"),
      "Hypertension, Type 2 diabetes",
    );
    await user.type(screen.getByLabelText("Password"), "SeniorCare2024");
    await user.type(screen.getByLabelText("Confirm password"), "SeniorCare2024");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(mocks.register).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.register.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      role: "SENIOR",
      name: "Margaret Whitfield",
      email: "margaret@example.com",
      password: "SeniorCare2024",
      elder: {
        displayName: "Margaret",
        dateOfBirth: new Date("1948-03-02"),
        bloodType: "A+",
        conditions: ["Hypertension", "Type 2 diabetes"],
      },
    });
    expect(payload.timeZone).toEqual(expect.any(String));
  });
});
