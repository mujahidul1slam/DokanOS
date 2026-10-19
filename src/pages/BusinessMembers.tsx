import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  isValidInviteEmail,
  normalizeInvitationRows,
  normalizeInviteEmail,
  normalizeMemberRows,
  type InvitationRow,
  type MemberRow,
} from "@/lib/accounts/businessInvitations";
import { Loader2, Mail, UserPlus, UsersRound } from "lucide-react";

/**
 * Issue #13: owner-only membership management.
 *
 * Any account member may see who operates the account. Only the owner may
 * invite, revoke an open invitation, or remove a member — the server enforces
 * this, and this surface simply does not offer the controls to anyone else.
 * Removing an owner is a deliberately separate ownership-transfer act (#14),
 * so no ordinary removal control is rendered for an owner row.
 */
export default function BusinessMembers() {
  const { active, myRole } = useBusinessContext();
  const isOwner = myRole === "owner";

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [busyInvitation, setBusyInvitation] = useState<string | null>(null);

  useEffect(() => {
    if (!active?.id) {
      setMembers([]);
      setInvitations([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const { data, error: memberError } = await supabase.rpc("list_business_members", {
        p_business_id: active.id,
      });
      if (cancelled) return;
      if (memberError) {
        setError(memberError.message);
        setMembers([]);
        setInvitations([]);
        setLoading(false);
        return;
      }
      setMembers(normalizeMemberRows(data));

      if (isOwner) {
        const { data: invitations, error: invitationError } = await supabase.rpc(
          "list_business_invitations",
          { p_business_id: active.id },
        );
        if (cancelled) return;
        if (invitationError) {
          setError(invitationError.message);
          setInvitations([]);
        } else {
          setInvitations(normalizeInvitationRows(invitations));
        }
      } else {
        setInvitations([]);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [active?.id, isOwner, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);

  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!active || inviting) return;
    const email = normalizeInviteEmail(inviteEmail);
    if (!isValidInviteEmail(email)) {
      setActionError("Enter a valid email address for the person you're inviting.");
      return;
    }

    setInviting(true);
    setActionError(null);
    const { error: inviteError } = await supabase.rpc("invite_business_member", {
      p_business_id: active.id,
      p_email: email,
    });
    setInviting(false);

    if (inviteError) {
      setActionError(inviteErrorMessage(inviteError.message));
      return;
    }
    setInviteEmail("");
    reload();
  };

  const revokeInvitation = async (invitation: InvitationRow) => {
    setBusyInvitation(invitation.id);
    setActionError(null);
    const { error: revokeError } = await supabase.rpc("revoke_business_invitation", {
      p_invitation_id: invitation.id,
    });
    setBusyInvitation(null);
    if (revokeError) {
      setActionError(revokeError.message);
      return;
    }
    reload();
  };

  const removeMember = async (member: MemberRow) => {
    if (!active) return;
    setBusyMember(member.userId);
    setActionError(null);
    const { error: removeError } = await supabase.rpc("remove_business_member", {
      p_business_id: active.id,
      p_user_id: member.userId,
    });
    setBusyMember(null);
    if (removeError) {
      setActionError(removeErrorMessage(removeError.message));
      return;
    }
    reload();
  };

  if (!active) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">No business account is selected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
            <UsersRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Business Account</p>
            <h1 className="font-heading text-xl font-semibold">Members</h1>
          </div>
          <div className="ml-auto">
            <Badge variant="secondary">
              {`${members.length} ${members.length === 1 ? "member" : "members"} under ${active.name}`}
            </Badge>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={reload}>Retry</Button>
        </div>
      )}

      {isOwner && (
        <form onSubmit={sendInvitation} className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-heading text-sm font-semibold">Invite a member</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            They join with their own verified personal account. Inviting them does not
            create a business account or grant a platform role.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="person@example.com"
                maxLength={254}
              />
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Send invitation
            </Button>
          </div>
          {actionError && <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p>}
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-heading text-sm font-semibold">People with access</h2>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {members.map((member) => (
                <div key={member.userId} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.fullName ?? member.email ?? "Unknown person"}
                    </p>
                    {member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                  </div>
                  <Badge variant={member.isOwner ? "secondary" : "outline"}>
                    {member.isOwner ? "Owner" : "Member"}
                  </Badge>
                  {isOwner && !member.isOwner && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${member.email ?? "member"}`}
                      disabled={busyMember === member.userId}
                      onClick={() => void removeMember(member)}
                    >
                      {busyMember === member.userId && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {isOwner && (
            <section className="space-y-3">
              <h2 className="font-heading text-sm font-semibold">Invitations</h2>
              {invitations.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-6">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No invitations yet. Invite someone by email above.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {invitations.map((invitation) => (
                    <div key={invitation.id} className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">{invitation.email}</p>
                        <Badge variant={invitation.status === "pending" ? "secondary" : "outline"}>
                          {statusLabel(invitation.status)}
                        </Badge>
                        {invitation.status === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Revoke invitation for ${invitation.email}`}
                            disabled={busyInvitation === invitation.id}
                            onClick={() => void revokeInvitation(invitation)}
                          >
                            {busyInvitation === invitation.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                            Revoke
                          </Button>
                        )}
                      </div>
                      {invitation.status === "pending" && invitation.token && (
                        <p className="text-xs text-muted-foreground">
                          Share this link with the invited person:{" "}
                          <code className="break-all rounded bg-secondary/60 px-1.5 py-0.5">
                            {`${window.location.origin}/accounts?invite=${invitation.token}`}
                          </code>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function inviteErrorMessage(message: string): string {
  if (message.includes("ALREADY_MEMBER")) return "That person already operates this account.";
  if (message.includes("INVITATION_EXISTS")) return "An open invitation already exists for that email address.";
  if (message.includes("OWNER_REQUIRED")) return "Only the account owner can invite members.";
  if (message.includes("EMAIL_INVALID") || message.includes("EMAIL_REQUIRED")) {
    return "Enter a valid email address for the person you're inviting.";
  }
  return "Could not send the invitation. Please try again.";
}

function removeErrorMessage(message: string): string {
  if (message.includes("OWNER_NOT_REMOVABLE")) return "An owner cannot be removed as an ordinary member.";
  if (message.includes("MEMBER_NOT_FOUND")) return "That person is not a member of this account.";
  if (message.includes("OWNER_REQUIRED")) return "Only the account owner can remove members.";
  return "Could not remove that member. Please try again.";
}
