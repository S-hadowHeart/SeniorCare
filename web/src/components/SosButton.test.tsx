import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SosButton } from "./SosButton";
import { GeoError, type GeoPosition } from "../lib/geolocation";
import type { SosAlert } from "../lib/types";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getCurrentPosition: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, post: mocks.post },
  };
});

vi.mock("../lib/geolocation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geolocation")>();
  return { ...actual, getCurrentPosition: mocks.getCurrentPosition };
});

const ALERT: SosAlert = {
  id: "alert-1",
  elderId: "elder-1",
  triggeredByUserId: "user-1",
  status: "ACTIVE",
  message: "I have fallen",
  cancelledAt: null,
  acknowledgedAt: null,
  resolvedAt: null,
  resolutionNote: null,
  latitude: null,
  longitude: null,
  accuracy: null,
  locationSource: null,
  locationLabel: null,
  createdAt: "2026-11-24T10:00:00.000Z",
  mapUrl: null,
};

async function openAndSend(message?: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Send an emergency alert" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  // The dialog focuses the safe action (Cancel), never the destructive one.
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
  if (message) {
    await user.type(screen.getByLabelText("Add a message (optional)"), message);
  }
  await user.click(screen.getByRole("button", { name: "Send alert now" }));
  return user;
}

describe("SosButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentPosition.mockReset();
    mocks.post.mockReset();
    mocks.getCurrentPosition.mockResolvedValue({
      latitude: 51.5,
      longitude: -0.12,
      accuracy: 8,
    } satisfies GeoPosition);
    mocks.post.mockImplementation((path: string) => {
      if (path.endsWith("/sos")) return Promise.resolve(ALERT);
      return Promise.resolve(undefined);
    });
  });

  it("asks for confirmation and sends nothing when cancelled", async () => {
    const user = userEvent.setup();
    render(<SosButton elderId="elder-1" />);

    await user.click(screen.getByRole("button", { name: "Send an emergency alert" }));
    expect(await screen.findByText("Send an emergency alert?")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("sends the alert immediately and attaches the location when it arrives", async () => {
    let resolvePosition!: (position: GeoPosition) => void;
    mocks.getCurrentPosition.mockReturnValue(
      new Promise<GeoPosition>((resolve) => {
        resolvePosition = resolve;
      }),
    );

    render(<SosButton elderId="elder-1" />);
    await openAndSend("I have fallen");

    // The alert must not wait for a GPS fix.
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });
    expect(mocks.post).toHaveBeenNthCalledWith(1, "/elders/elder-1/sos", {
      message: "I have fallen",
    });
    expect(await screen.findByText("Your alert has been sent")).toBeInTheDocument();

    await act(async () => {
      resolvePosition({ latitude: 51.5, longitude: -0.12, accuracy: 8 });
    });

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(2);
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, "/elders/elder-1/sos", {
      message: "I have fallen",
      location: {
        latitude: 51.5,
        longitude: -0.12,
        accuracy: 8,
        source: "GPS",
      },
    });
  });

  it("still sends the alert when location permission is denied", async () => {
    mocks.getCurrentPosition.mockRejectedValue(
      new GeoError("permission_denied", "User denied geolocation."),
    );

    render(<SosButton elderId="elder-1" />);
    await openAndSend("I need help");

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Your alert has been sent")).toBeInTheDocument();
    expect(
      await screen.findByText(/Location sharing is blocked/),
    ).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("shows a clear failure state when the alert cannot be sent", async () => {
    mocks.post.mockRejectedValue(new Error("The network is down."));

    render(<SosButton elderId="elder-1" />);
    await openAndSend();

    expect(await screen.findByText("The alert could not be sent")).toBeInTheDocument();
    expect(screen.getByText("The network is down.")).toBeInTheDocument();
    expect(
      screen.getByText(/call the emergency services now/i),
    ).toBeInTheDocument();
  });

  it("cancels an active alert and closes the confirmation", async () => {
    render(<SosButton elderId="elder-1" />);
    const user = await openAndSend();

    expect(await screen.findByText("Your alert has been sent")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel alert" }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/sos/alert-1/cancel");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does not send a second update when the alert already has coordinates", async () => {
    mocks.post.mockResolvedValue({
      ...ALERT,
      latitude: 51.5,
      longitude: -0.12,
      accuracy: 8,
      locationSource: "GPS",
    });

    render(<SosButton elderId="elder-1" />);
    await openAndSend();

    expect(await screen.findByText("Your alert has been sent")).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the account has no elder profile", async () => {
    render(<SosButton elderId={undefined} />);
    await openAndSend();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
