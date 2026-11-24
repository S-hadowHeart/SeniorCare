import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import {
  api,
  getAccessToken,
  setAccessToken,
  setSessionExpiredHandler,
} from "../lib/api";
import type { User } from "../lib/types";

/**
 * The API module is mocked, not fetch: these tests describe the auth state
 * machine (restore → anonymous/authenticated → login → logout), while the
 * HTTP client has its own responsibilities.
 */
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

const mockApi = api as unknown as {
  refresh: Mock<(...args: unknown[]) => Promise<unknown>>;
  get: Mock<(...args: unknown[]) => Promise<unknown>>;
  post: Mock<(...args: unknown[]) => Promise<unknown>>;
};

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

function AuthProbe() {
  const { status, user, login, register, logout } = useAuth();

  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.email ?? "none"}</p>
      <button
        type="button"
        onClick={() => void login("margaret@example.com", "SeniorCare2024")}
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={() =>
          void register({
            email: "david@example.com",
            password: "SeniorCare2024",
            name: "David Whitfield",
            role: "CAREGIVER",
            timeZone: "Europe/London",
          })
        }
      >
        Create account
      </button>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);
    setSessionExpiredHandler(null);
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    mockApi.refresh.mockResolvedValue(null);
  });

  it("starts in a loading state and settles on anonymous without a session", async () => {
    renderAuth();

    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(mockApi.refresh).toHaveBeenCalledTimes(1);
  });

  it("restores an existing session from the refresh cookie", async () => {
    mockApi.refresh.mockImplementation(async () => {
      setAccessToken("restored-token");
      return "restored-token";
    });
    mockApi.get.mockResolvedValue(SENIOR);

    renderAuth();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("margaret@example.com");
    expect(mockApi.get).toHaveBeenCalledWith("/auth/me");
    expect(getAccessToken()).toBe("restored-token");
  });

  it("becomes anonymous when the refresh call fails", async () => {
    mockApi.refresh.mockRejectedValue(new Error("network down"));

    renderAuth();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("stores the user and access token after signing in", async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ user: SENIOR, accessToken: "login-token" });

    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    });

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("margaret@example.com");
    expect(mockApi.post).toHaveBeenCalledWith("/auth/login", {
      email: "margaret@example.com",
      password: "SeniorCare2024",
    });
    expect(getAccessToken()).toBe("login-token");
  });

  it("stores the user and access token after registering", async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ user: CAREGIVER, accessToken: "register-token" });

    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    });

    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("david@example.com");
    expect(mockApi.post).toHaveBeenCalledWith("/auth/register", {
      email: "david@example.com",
      password: "SeniorCare2024",
      name: "David Whitfield",
      role: "CAREGIVER",
      timeZone: "Europe/London",
    });
    expect(getAccessToken()).toBe("register-token");
  });

  it("signs out locally even when the revoke request fails", async () => {
    const user = userEvent.setup();
    mockApi.refresh.mockImplementation(async () => {
      setAccessToken("restored-token");
      return "restored-token";
    });
    mockApi.get.mockResolvedValue(SENIOR);
    mockApi.post.mockRejectedValue(new Error("offline"));

    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(getAccessToken()).toBeNull();
    expect(mockApi.post).toHaveBeenCalledWith("/auth/logout");
  });

  it("refuses to be used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<AuthProbe />)).toThrow(
      "useAuth must be used inside an <AuthProvider>.",
    );

    consoleError.mockRestore();
  });
});
