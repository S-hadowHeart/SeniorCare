import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Shared test bootstrap.
 *
 * jsdom implements most of the DOM but not `matchMedia`, which the theme
 * provider uses to follow the operating system preference. The polyfill
 * reports "light" and exposes the listener API the provider expects.
 */
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Testing Library can only auto-register cleanup when Vitest globals are on.
// They are off deliberately (tests import what they use), so clean up here.
afterEach(() => {
  cleanup();
});
