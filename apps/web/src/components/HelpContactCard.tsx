"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Person = { id: string; name: string; phone: string | null };

// Who the parent's Help button calls (after alerting everyone).
export function HelpContactCard({ elderId, elderName, people, chosenId }: { elderId: string; elderName: string; people: Person[]; chosenId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const callable = people.filter((p) => p.phone);
  const current = callable.find((p) => p.id === chosenId) ?? callable[0];
  const [choice, setChoice] = useState(current?.id ?? "");
  const [busy, setBusy] = useState(false);
  const first = elderName.split(" ")[0];

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/elders/${elderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ helpCaregiverId: choice || null }) });
    setBusy(false);
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? "Couldn't save", "bad");
    toast(`${first}'s Help button will call ${callable.find((p) => p.id === choice)?.name.split(" ")[0]}`);
    router.refresh();
  }

  return (
    <Card title="Help button" icon={PhoneCall} description={`When ${first} presses Help, everyone gets an alert and the phone calls this person.`}>
      {callable.length === 0 ? (
        <p className="text-sm text-muted">
          Nobody has added a phone number yet.{" "}
          <Link href="/settings" className="font-medium text-accent underline underline-offset-2">
            Add yours in Settings
          </Link>{" "}
          so {first}&apos;s Help button can call you.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field label="Calls" htmlFor="help-contact">
              <select id="help-contact" value={choice} onChange={(e) => setChoice(e.target.value)} className={inputClass}>
                {callable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.phone}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button onClick={save} loading={busy} disabled={choice === current?.id}>
            Save
          </Button>
        </div>
      )}
      {people.some((p) => !p.phone) && callable.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Not listed: {people.filter((p) => !p.phone).map((p) => p.name.split(" ")[0]).join(", ")} (no phone number in their Settings yet).
        </p>
      )}
    </Card>
  );
}
