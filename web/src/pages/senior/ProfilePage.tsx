import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound, Monitor, Moon, Save, Sun, UserPlus, Users } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { caregiverNavItems, seniorNavItems } from "../../components/layout/navItems";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, LoadingBlock } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { SelectInput, TextArea, TextInput } from "../../components/ui/Form";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { CareLink } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useToast } from "../../context/ToastContext";

const THEME_OPTIONS = [
  { value: "light", label: "Light", description: "Always bright", icon: Sun },
  { value: "dark", label: "Dark", description: "Easier at night", icon: Moon },
  { value: "system", label: "System", description: "Follows your device", icon: Monitor },
] as const;

interface ElderProfile {
  id: string;
  displayName: string;
  dateOfBirth: string | null;
  bloodType: string | null;
  conditions: string[];
  allergies: string[];
  medicalNotes: string | null;
  photoUrl: string | null;
  checkInDeadlineHour: number;
  canTriggerSos: boolean;
  permissions: {
    canViewVitals: boolean;
    canManageMedicines: boolean;
    canManageContacts: boolean;
    canAcknowledgeSos: boolean;
  };
}

const BLOOD_TYPES = ["UNKNOWN", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export default function ProfilePage() {
  const { user, refreshProfile } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const elderId = user?.elderId;
  const isSenior = user?.role === "SENIOR";

  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [bloodType, setBloodType] = useState("UNKNOWN");
  const [conditions, setConditions] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [deadlineHour, setDeadlineHour] = useState("21");
  const [timeZone, setTimeZone] = useState(user?.timeZone ?? "UTC");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRelation, setInviteRelation] = useState("FAMILY");

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [removingLink, setRemovingLink] = useState<CareLink | null>(null);

  const profile = useQuery({
    queryKey: ["elder-profile", elderId],
    queryFn: () => api.get<ElderProfile>(`/elders/${elderId}`),
    enabled: Boolean(elderId),
  });

  const careLinks = useQuery({
    queryKey: ["care-links", elderId],
    queryFn: () => api.get<CareLink[]>(`/elders/${elderId}/care-links`),
    enabled: Boolean(elderId),
  });

  // Populate the form once the profile has loaded.
  useEffect(() => {
    if (!profile.data) return;
    setDisplayName(profile.data.displayName);
    setDateOfBirth(profile.data.dateOfBirth ? profile.data.dateOfBirth.slice(0, 10) : "");
    setBloodType(profile.data.bloodType ?? "UNKNOWN");
    setConditions(profile.data.conditions.join(", "));
    setAllergies(profile.data.allergies.join(", "));
    setMedicalNotes(profile.data.medicalNotes ?? "");
    setDeadlineHour(String(profile.data.checkInDeadlineHour));
  }, [profile.data]);

  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch<ElderProfile>(`/elders/${elderId}`, {
        displayName: displayName.trim(),
        dateOfBirth: dateOfBirth || null,
        bloodType,
        conditions: conditions
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        allergies: allergies
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        medicalNotes: medicalNotes.trim() || null,
        checkInDeadlineHour: Number(deadlineHour),
        timeZone,
      }),
    onSuccess: () => {
      toast.success("Profile saved.");
      void queryClient.invalidateQueries({ queryKey: ["elder-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["elders"] });
      void refreshProfile();
    },
    onError: (error) => {
      toast.error(
        "We could not save your profile.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const invite = useMutation({
    mutationFn: () =>
      api.post(`/elders/${elderId}/care-links`, {
        email: inviteEmail.trim(),
        relation: inviteRelation,
        canViewVitals: true,
        canAcknowledgeSos: true,
        canManageMedicines: false,
        canManageContacts: false,
      }),
    onSuccess: () => {
      setInviteOpen(false);
      setInviteEmail("");
      toast.success("Invitation recorded.", "They will be able to follow the care record.");
      void queryClient.invalidateQueries({ queryKey: ["care-links"] });
    },
    onError: (error) => {
      toast.error(
        "We could not add that person.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const removeLink = useMutation({
    mutationFn: (linkId: string) => api.patch(`/care-links/${linkId}`, { status: "REVOKED" }),
    onSuccess: () => {
      setRemovingLink(null);
      toast.success("Access removed.", "They can no longer see your care record.");
      void queryClient.invalidateQueries({ queryKey: ["care-links"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      toast.error(
        "We could not remove that person.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const changePassword = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword, newPassword }),
    onSuccess: () => {
      setPasswordOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed.", "Use your new password the next time you sign in.");
    },
    onError: (error) => {
      toast.error(
        "We could not change your password.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const navItems = isSenior ? seniorNavItems : caregiverNavItems;

  if (profile.isLoading) {
    return (
      <AppShell navItems={navItems}>
        <LoadingBlock label="Loading your profile…" />
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Profile & settings</h1>
          <p className="mt-1 text-ink-600">Keep your details and your care circle up to date.</p>
        </header>

        {/* ------------------------------------------------------- */}
        {/* Account                                                */}
        {/* ------------------------------------------------------- */}
        <Card>
          <CardHeader title="Your account" description={user?.email} />
          <CardBody className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Name</dt>
                <dd className="mt-1 font-medium text-ink-900">{user?.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Role</dt>
                <dd className="mt-1 font-medium text-ink-900">
                  {user?.role === "SENIOR" ? "Person receiving care" : "Family member / carer"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Time zone</dt>
                <dd className="mt-1 font-medium text-ink-900">{user?.timeZone}</dd>
              </div>
            </dl>

            <Button
              variant="outline"
              leftIcon={<KeyRound className="size-4" aria-hidden="true" />}
              onClick={() => setPasswordOpen(true)}
            >
              Change password
            </Button>
          </CardBody>
        </Card>

        {/* ------------------------------------------------------- */}
        {/* Appearance                                             */}
        {/* ------------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Appearance"
            description="Choose how SeniorCare looks on this device"
            icon={<Sun className="size-5" aria-hidden="true" />}
          />
          <CardBody>
            <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
              {THEME_OPTIONS.map(({ value, label, description, icon: Icon }) => {
                const active = preference === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPreference(value)}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 text-left transition",
                      active
                        ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600"
                        : "border-ink-200 bg-surface text-ink-700 hover:border-ink-300 hover:bg-ink-50",
                    )}
                  >
                    <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block font-semibold">{label}</span>
                      <span className="mt-0.5 block text-sm text-ink-500">{description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-ink-500">
              System follows the light or dark setting of your phone, tablet or computer.
            </p>
          </CardBody>
        </Card>

        {/* ------------------------------------------------------- */}
        {/* Health profile                                        */}
        {/* ------------------------------------------------------- */}
        {elderId && profile.data?.permissions ? (
          <Card>
            <CardHeader
              title="Health profile"
              description="Shared with the people in your care circle"
            />
            <CardBody>
              <form
                className="grid gap-5 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveProfile.mutate();
                }}
              >
                <TextInput
                  label="Name shown to your carers"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
                <TextInput
                  label="Date of birth"
                  type="date"
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                />
                <SelectInput
                  label="Blood type"
                  value={bloodType}
                  onChange={(event) => setBloodType(event.target.value)}
                >
                  {BLOOD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === "UNKNOWN" ? "Not known" : type}
                    </option>
                  ))}
                </SelectInput>
                <SelectInput
                  label="Check-in deadline"
                  value={deadlineHour}
                  onChange={(event) => setDeadlineHour(event.target.value)}
                  hint="Your family is told if you have not checked in by this hour."
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </SelectInput>

                <TextInput
                  label="Time zone"
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                  hint="IANA name, for example Europe/London. Reminders use this."
                />

                <TextInput
                  label="Ongoing conditions"
                  value={conditions}
                  onChange={(event) => setConditions(event.target.value)}
                  hint="Separate them with commas."
                />
                <TextInput
                  label="Allergies"
                  value={allergies}
                  onChange={(event) => setAllergies(event.target.value)}
                  hint="Separate them with commas."
                />

                <div className="sm:col-span-2">
                  <TextArea
                    label="Notes for your carers"
                    value={medicalNotes}
                    onChange={(event) => setMedicalNotes(event.target.value)}
                    hint="Anything a carer should know — how you like to be contacted, mobility, hearing, preferred routines."
                    rows={4}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    loading={saveProfile.isPending}
                    leftIcon={<Save className="size-4" aria-hidden="true" />}
                  >
                    Save profile
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : null}

        {/* ------------------------------------------------------- */}
        {/* Care circle                                           */}
        {/* ------------------------------------------------------- */}
        {elderId ? (
          <Card>
            <CardHeader
              title="Your care circle"
              description="People with a SeniorCare account who can follow your health"
              icon={<Users className="size-5" aria-hidden="true" />}
              action={
                profile.data?.permissions.canManageContacts ? (
                  <Button
                    size="sm"
                    leftIcon={<UserPlus className="size-4" aria-hidden="true" />}
                    onClick={() => setInviteOpen(true)}
                  >
                    Invite
                  </Button>
                ) : null
              }
            />
            <CardBody>
              {careLinks.isLoading ? (
                <LoadingBlock label="Loading your care circle…" />
              ) : careLinks.data && careLinks.data.length > 0 ? (
                <ul className="divide-y divide-ink-100">
                  {careLinks.data.map((link) => (
                    <li key={link.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">
                          {link.caregiver?.name ?? link.invitedEmail ?? "Pending invitation"}
                        </p>
                        <p className="text-sm text-ink-500">
                          {link.caregiver?.email ?? link.invitedEmail}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {link.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                        <Badge
                          tone={
                            link.status === "ACTIVE"
                              ? "success"
                              : link.status === "PENDING"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {link.status.toLowerCase()}
                        </Badge>
                        {link.status !== "REVOKED" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-700 hover:bg-danger-50 active:bg-danger-100"
                            aria-label={`Remove ${link.caregiver?.name ?? link.invitedEmail ?? "invitation"}`}
                            onClick={() => setRemovingLink(link)}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<Users className="size-6" aria-hidden="true" />}
                  title="Nobody else can follow your record yet"
                  description="Invite a family member so that somebody is told when you need help."
                />
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- */}
      {/* Invite dialog                                              */}
      {/* ----------------------------------------------------------- */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite someone to your care circle"
        description="They will be able to see your check-ins, readings and medicine schedule."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" loading={invite.isPending} onClick={() => invite.mutate()}>
              Send invitation
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <TextInput
            label="E-mail address"
            type="email"
            inputMode="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="sophie@example.com"
            required
          />
          <SelectInput
            label="Relationship"
            value={inviteRelation}
            onChange={(event) => setInviteRelation(event.target.value)}
          >
            <option value="FAMILY">Family member</option>
            <option value="CAREGIVER">Professional carer</option>
            <option value="DOCTOR">Doctor</option>
            <option value="NEIGHBOUR">Neighbour</option>
          </SelectInput>
          <p className="text-sm text-ink-500">
            They will see the invitation when they sign in or create an account with this
            e-mail address.
          </p>
        </div>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* Remove care link dialog                                    */}
      {/* ----------------------------------------------------------- */}
      <Modal
        open={Boolean(removingLink)}
        onClose={() => setRemovingLink(null)}
        title="Remove from your care circle?"
        description="They will lose access to your check-ins, readings and medicines straight away."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setRemovingLink(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={removeLink.isPending}
              onClick={() => removingLink && removeLink.mutate(removingLink.id)}
            >
              Remove access
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-700">
          {removingLink?.caregiver?.name ?? removingLink?.invitedEmail ?? "This person"} will no
          longer see your record or be notified when you need help.
        </p>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* Change password dialog                                     */}
      {/* ----------------------------------------------------------- */}
      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Change your password"
        description="Changing your password signs you out of every other device."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setPasswordOpen(false)}>
              Cancel
            </Button>
            <Button
              size="lg"
              loading={changePassword.isPending}
              onClick={() => changePassword.mutate()}
            >
              Change password
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <TextInput
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <TextInput
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters, including a number."
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </div>
      </Modal>
    </AppShell>
  );
}
