import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Button } from "@/components/ui/button";
import {
  acceptanceMessage,
  acceptanceOutcomeFromError,
  describeInvitation,
  parseAcceptanceResult,
  type AcceptanceOutcome,
  type InvitationDescription,
} from "@/lib/accounts/businessInvitations";
import { Loader2 } from "lucide-react";

/**
 * Issue #13: the arrival surface for an invitation link.
 *
 * Opening the link only describes the invitation. Joining is an explicit click
 * by the verified identity the owner invited; personal registration and email
 * verification never accept on their own. On success the business context is
 * refreshed so the account appears immediately without a reload.
 */
export function AcceptInvitationCard({ token }: { token: string }) {
  const { refresh } = useBusinessContext();
  const [description, setDescription] = useState<InvitationDescription | null>(null);
  const [outcome, setOutcome] = useState<AcceptanceOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDescription(null);
    setOutcome(null);

    void (async () => {
      const { data, error } = await supabase.rpc("describe_business_invitation", { p_token: token });
      if (cancelled) return;
      setDescription(describeInvitation(error ? null : data));
    })();

    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_business_invitation", { p_token: token });
    const result = error
      ? acceptanceOutcomeFromError(error)
      : parseAcceptanceResult(data).outcome;
    setOutcome(result);
    setBusy(false);
    if (result === "joined" || result === "already_member") {
      await refresh();
    }
  };

  if (description === null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking this invitation…
      </p>
    );
  }

  const joined = outcome === "joined" || outcome === "already_member";

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-4">
      {!joined && <p className="text-sm font-medium">{description.message}</p>}
      {outcome && <p role="status" className="text-sm">{acceptanceMessage(outcome)}</p>}
      {description.canAccept && !joined && (
        <Button onClick={() => void accept()} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Accept invitation
        </Button>
      )}
    </div>
  );
}
