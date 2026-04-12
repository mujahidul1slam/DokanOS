import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserPlus, Shield, Mail, Loader2, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { TableSkeleton, EmptyState } from "@/components/ui/loading-states";

interface TeamMember {
  user_id: string;
  full_name: string | null;
  role: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  accepted_at: string | null;
  created_at: string;
}

const TeamManagement = () => {
  const { isAdmin, session } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("staff");
  const [inviting, setInviting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteInviteId, setDeleteInviteId] = useState<string | null>(null);

  const fetchTeam = async () => {
    setLoading(true);
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    if (roles) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name");
      const memberList: TeamMember[] = roles.map((r) => {
        const profile = profiles?.find((p) => p.user_id === r.user_id);
        return {
          user_id: r.user_id,
          full_name: profile?.full_name || null,
          role: r.role,
        };
      });
      setMembers(memberList);
    }
    const { data: invites } = await supabase
      .from("invitations")
      .select("*")
      .order("created_at", { ascending: false });
    if (invites) setInvitations(invites);
    setLoading(false);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);

    try {
      const { data, error } = await supabase.functions.invoke("team-manage", {
        body: { action: "invite", email: inviteEmail, role: inviteRole },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteRole("staff");
      setDialogOpen(false);
      fetchTeam();
    } catch (err: any) {
      toast.error(err.message || "Failed to send invitation");
    }
    setInviting(false);
  };

  const handleDeleteInvite = async (id: string) => {
    await supabase.from("invitations").delete().eq("id", id);
    toast.success("Invitation removed");
    setDeleteInviteId(null);
    fetchTeam();
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("team-manage", {
        body: { action: "update_role", user_id: userId, role: newRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Role updated");
      fetchTeam();
    } catch (err: any) {
      toast.error(err.message || "Failed to update role");
    }
  };

  if (!isAdmin) {
    return (
      <EmptyState
        icon={Shield}
        title="Access Denied"
        description="You don't have permission to manage the team. Contact an admin."
      />
    );
  }

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "default";
      case "staff": return "secondary";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Management</h1>
          <p className="text-sm text-muted-foreground">Manage team members and invitations</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="mr-2 h-4 w-4" />Invite Member</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleInvite} className="w-full" disabled={inviting}>
                {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Invitation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Shield className="h-5 w-5" />Team Members</CardTitle>
          <CardDescription>Current team members and their roles</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={3} cols={3} />
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No team members yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">{m.full_name || m.user_id.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant={roleBadgeVariant(m.role) as any}>{m.role}</Badge></TableCell>
                    <TableCell>
                      <Select value={m.role} onValueChange={(v) => handleRoleChange(m.user_id, v)}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="staff">Staff</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Mail className="h-5 w-5" />Invitations</CardTitle>
          <CardDescription>Pending and accepted invitations</CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No invitations yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant={roleBadgeVariant(inv.role) as any}>{inv.role}</Badge></TableCell>
                    <TableCell>
                      {inv.accepted_at ? (
                        <Badge variant="outline" className="text-success">Accepted</Badge>
                      ) : (
                        <Badge variant="outline" className="text-warning">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!inv.accepted_at && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteInviteId(inv.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteInviteId}
        onOpenChange={(open) => { if (!open) setDeleteInviteId(null); }}
        title="Remove Invitation"
        description="This will revoke the pending invitation. The user will not be able to join."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => deleteInviteId && handleDeleteInvite(deleteInviteId)}
      />
    </div>
  );
};

export default TeamManagement;
