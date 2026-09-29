"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "./actions";

// Eén formulier voor alle acties: pending-staat op de knop (genesis en afscheid duren seconden)
// en een foutmelding als de actie niets deed. `confirm`: destructieve actie, eerst bevestigen.
export function ActionForm({
  action,
  label,
  pendingLabel,
  id,
  confirmName,
  confirm,
  danger,
  stacked,
  disabled,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  id?: number;
  confirmName?: boolean;
  /** Vraag vóór het uitvoeren (browserbevestiging); bv. bij verwijderen of samenvoegen. */
  confirm?: string;
  danger?: boolean;
  /** Velden onder elkaar i.p.v. op één regel (formulieren met schuifjes). */
  stacked?: boolean;
  disabled?: boolean;
  /** Extra velden van de actie (boven de knop). */
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={stacked ? "action-stack" : "action"}
      onSubmit={confirm ? (event) => void (!window.confirm(confirm) && event.preventDefault()) : undefined}
    >
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {confirmName && (
        <input name="name" placeholder="Typ de exacte naam" aria-label="Naam ter bevestiging" required />
      )}
      {children}
      <button type="submit" disabled={pending || disabled} className={danger ? "button-danger" : undefined}>
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
