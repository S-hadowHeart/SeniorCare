import { useState } from "react";
import { AlertTriangle, MapPin, PhoneCall, ShieldCheck } from "lucide-react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { TextArea } from "./ui/Form";
import { useSos } from "../features/sos/useSos";
import { cn } from "../lib/cn";

/**
 * The SOS button.
 *
 * The button is deliberately enormous (a 64 px tall target) and isolated from
 * the other controls so that it can never be pressed by accident — a false
 * alarm desensitises the family and is worse than a slightly slower alert.
 */
export function SosButton({
  elderId,
  className,
  size = "lg",
  captionClassName = "text-ink-500",
}: {
  elderId: string | undefined;
  className?: string;
  size?: "lg" | "xl";
  /** The hint sits on whatever surface the button is placed on. */
  captionClassName?: string;
}) {
  const { state, trigger, cancel, reset } = useSos(elderId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");

  const openConfirm = () => {
    setMessage("");
    setConfirmOpen(true);
  };

  const send = async () => {
    setConfirmOpen(false);
    await trigger(message.trim() || undefined);
  };

  return (
    <>
      <div className={cn("flex flex-col items-center gap-3", className)}>
        <button
          type="button"
          onClick={openConfirm}
          disabled={state.phase === "sending"}
          aria-label="Send an emergency alert"
          className={cn(
            "group relative flex w-full items-center justify-center gap-3 rounded-2xl font-bold text-white shadow-lg",
            "bg-danger-600 transition hover:bg-danger-700 active:scale-[0.98]",
            "focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-danger-300",
            "disabled:opacity-60",
            size === "xl" ? "h-24 text-2xl" : "h-20 text-xl",
          )}
        >
          <span className="absolute inset-0 rounded-2xl bg-danger-500 opacity-40 blur-md transition group-hover:opacity-70" aria-hidden="true" />
          <PhoneCall className="relative size-7" aria-hidden="true" />
          <span className="relative">Emergency help</span>
        </button>

        <p className={cn("text-center text-xs", captionClassName)}>
          Alerts your family and emergency contacts immediately.
        </p>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Pre-send confirmation                                          */}
      {/* ------------------------------------------------------------- */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Send an emergency alert?"
        description="Your family and emergency contacts will be notified straight away."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setConfirmOpen(false)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="lg"
              onClick={() => void send()}
              leftIcon={<PhoneCall className="size-5" aria-hidden="true" />}
            >
              Send alert now
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl bg-danger-50 p-4 text-sm text-danger-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>
              If someone is with you now, ask them to call for help directly. Use this button only if
              you need assistance.
            </p>
          </div>

          <TextArea
            label="Add a message (optional)"
            placeholder="For example: I have fallen in the kitchen and cannot get up."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>
      </Modal>

      {/* ------------------------------------------------------------- */}
      {/* Post-send confirmation                                         */}
      {/* ------------------------------------------------------------- */}
      <Modal
        open={state.phase === "sent"}
        onClose={reset}
        title="Your alert has been sent"
        description={
          state.alert
            ? `Sent at ${new Date(state.alert.createdAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" size="lg" onClick={reset}>
              Close
            </Button>
            {state.alert?.status === "ACTIVE" ? (
              <Button variant="danger" size="lg" onClick={() => void cancel()}>
                Cancel alert
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl bg-success-50 p-4 text-sm text-success-700">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>
              Everyone in your care circle has been notified by e-mail and in the app. If you are in
              immediate danger, please also call the emergency services.
            </p>
          </div>

          {state.geoNote ? (
            <p className="text-sm text-ink-500">{state.geoNote}</p>
          ) : null}

          {state.alert?.mapUrl ? (
            <a
              href={state.alert.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-ink-200 p-3 text-sm font-medium text-brand-700 hover:bg-ink-50"
            >
              <MapPin className="size-4" aria-hidden="true" />
              Your location was shared — open the map
            </a>
          ) : null}
        </div>
      </Modal>

      {/* ------------------------------------------------------------- */}
      {/* Failure                                                       */}
      {/* ------------------------------------------------------------- */}
      <Modal
        open={state.phase === "error"}
        onClose={reset}
        title="The alert could not be sent"
        footer={
          <Button size="lg" onClick={reset}>
            Close
          </Button>
        }
      >
        <p className="text-sm text-ink-600">{state.error}</p>
        <p className="mt-3 text-sm font-semibold text-danger-700">
          If this is an emergency, please call the emergency services now.
        </p>
      </Modal>
    </>
  );
}
