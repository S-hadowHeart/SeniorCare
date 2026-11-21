import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Mail, Phone, Plus, Stethoscope, Trash2, User, Users } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { seniorNavItems } from "../../components/layout/navItems";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { SelectInput, TextInput } from "../../components/ui/Form";
import { api, ApiError } from "../../lib/api";
import type { EmergencyContact } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const RELATION_LABELS: Record<string, string> = {
  FAMILY: "Family",
  CAREGIVER: "Professional carer",
  DOCTOR: "Doctor",
  NEIGHBOUR: "Neighbour",
  OTHER: "Other",
};

export default function ContactsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const elderId = user?.elderId ?? undefined;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [relation, setRelation] = useState("FAMILY");

  const contacts = useQuery({
    queryKey: ["contacts", elderId],
    queryFn: () => api.get<EmergencyContact[]>(`/elders/${elderId}/contacts`),
    enabled: Boolean(elderId),
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.patch<EmergencyContact>(`/contacts/${editing.id}`, payload)
        : api.post<EmergencyContact>(`/elders/${elderId}/contacts`, payload),
    onSuccess: () => {
      setFormOpen(false);
      setEditing(null);
      setName("");
      setPhone("");
      setEmail("");
      toast.success(editing ? "Contact updated." : "Contact added.");
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["elders"] });
    },
    onError: (error) => {
      toast.error(
        "We could not save that contact.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/contacts/${id}`),
    onSuccess: () => {
      toast.success("Contact removed.");
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => toast.error("We could not remove that contact."),
  });

  const openForm = (contact?: EmergencyContact) => {
    setEditing(contact ?? null);
    setName(contact?.name ?? "");
    setPhone(contact?.phone ?? "");
    setEmail(contact?.email ?? "");
    setRelation(contact?.relation ?? "FAMILY");
    setFormOpen(true);
  };

  const submit = () => {
    save.mutate({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      relation,
      priority: 10,
    });
  };

  return (
    <AppShell navItems={seniorNavItems}>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Emergency contacts</h1>
            <p className="mt-1 text-ink-600">
              The people we contact if you press the emergency button.
            </p>
          </div>
          <Button leftIcon={<Plus className="size-4" aria-hidden="true" />} onClick={() => openForm()}>
            Add contact
          </Button>
        </header>

        {contacts.isLoading ? (
          <LoadingBlock label="Loading contacts…" />
        ) : contacts.isError ? (
          <ErrorState onRetry={() => void contacts.refetch()} />
        ) : contacts.data && contacts.data.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {contacts.data.map((contact) => (
              <Card key={contact.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                        {contact.isDoctor ? (
                          <Stethoscope className="size-5" aria-hidden="true" />
                        ) : (
                          <User className="size-5" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-900">{contact.name}</p>
                        <p className="text-sm text-ink-500">{RELATION_LABELS[contact.relation]}</p>
                      </div>
                    </div>
                    {contact.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <a
                      href={`tel:${contact.phone.replace(/\s/g, "")}`}
                      className="flex items-center gap-2 text-ink-700 hover:text-brand-700"
                    >
                      <Phone className="size-4 text-ink-400" aria-hidden="true" />
                      {contact.phone}
                    </a>
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-2 truncate text-ink-700 hover:text-brand-700"
                      >
                        <Mail className="size-4 text-ink-400" aria-hidden="true" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                    ) : null}
                  </div>

                  {contact.notes ? (
                    <p className="mt-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">{contact.notes}</p>
                  ) : null}

                  <div className="mt-4 flex gap-2 border-t border-ink-100 pt-3">
                    <Button size="sm" variant="outline" onClick={() => openForm(contact)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(contact.id)}
                      leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                    >
                      Remove
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Users className="size-6" aria-hidden="true" />}
                title="No emergency contacts yet"
                description="Add at least one family member so that we can reach someone if you need help."
                action={
                  <Button onClick={() => openForm()} leftIcon={<Plus className="size-4" aria-hidden="true" />}>
                    Add a contact
                  </Button>
                }
              />
            </CardBody>
          </Card>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? "Edit contact" : "Add an emergency contact"}
        description="They will be emailed if you trigger the emergency button."
        footer={
          <>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button size="lg" loading={save.isPending} onClick={submit}>
              {editing ? "Save changes" : "Add contact"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <TextInput
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sophie Chen"
            required
          />
          <TextInput
            label="Phone number"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+44 7700 900000"
            required
          />
          <TextInput
            label="E-mail address (optional)"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="sophie@example.com"
            hint="Needed if we want to send them an alert by e-mail."
          />
          <SelectInput
            label="Relationship"
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
          >
            {Object.entries(RELATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </div>
      </Modal>
    </AppShell>
  );
}
