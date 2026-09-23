"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

// Eén formulier voor alle acties: pending-staat op de knop (genesis en afscheid duren seconden)
// en een foutmelding als de actie niets deed.
export function ActionForm({
  action,
  label,
  pendingLabel,
  id,
  confirmName,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  id?: number;
  confirmName?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="action">
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {confirmName && (
        <input name="name" placeholder="Typ de exacte naam" aria-label="Naam ter bevestiging" required />
      )}
      <button type="submit" disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
    </form>
  );
}
