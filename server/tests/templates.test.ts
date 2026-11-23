import { describe, expect, it } from "vitest";
import { missedCheckInEmail, needsHelpEmail } from "../src/notifications/templates.js";

describe("check-in e-mail templates", () => {
  it("announces a help request without pretending the check-in was missed", () => {
    const email = needsHelpEmail({
      elderName: "Margaret Whitfield",
      note: "I have fallen",
    });

    expect(email.subject).toBe("Margaret Whitfield asked for help");
    expect(email.text).toContain("asked for help");
    expect(email.text).toContain("I have fallen");
    expect(email.text).not.toContain("No safety check-in");
    expect(email.html).toContain("I have fallen");
  });

  it("omits the note when none was left", () => {
    const email = needsHelpEmail({ elderName: "Margaret Whitfield", note: null });

    expect(email.text).not.toContain("Message:");
    expect(email.html).not.toContain("border-left:4px solid #dc2626");
  });

  it("still describes a genuinely missed check-in", () => {
    const email = missedCheckInEmail({
      elderName: "Margaret Whitfield",
      deadlineHour: 20,
    });

    expect(email.subject).toBe("No safety check-in from Margaret Whitfield");
    expect(email.text).toContain("No safety check-in");
    expect(email.text).toContain("20:00");
  });
});
