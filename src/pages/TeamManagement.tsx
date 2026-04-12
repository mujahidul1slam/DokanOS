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

interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string;
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
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("staff");
  const [inviting, setInviting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchTeam = async () => {
    setLoading(true);
    // Fetch members with roles
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    if (roles) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name");
      const memberList: TeamMember[] = roles.map((r) => {
        const profile = profiles?.find((p) => p.user_id === r.user_id);
        return {
          user_id: r.user_id,
          full_name: profile?.full_name || null,
          email: profile?.full_name || r.user_id, // fallback
          role: r.role,
        };
      });
      setMembers(memberList);
    }

    // Fetch invitations
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

    // Check if already invited
    const { data: existing } = await supabase
      .from("invitations")
      .select("id")
      .eq("email", inviteEmail)
      .is("accepted_at", null)
      .single();

    if (existing) {
      toast.error("This email already has a pending invitation");
      setInviting(false);
      return;
    }

    // Create invitation
    const { error: invError } = await supabase.from("invitations").insert({
      email: inviteEmail,
      role: inviteRole as any,
    });

    if (invError) {
      toast.error("Failed to create invitation");
      setInviting(false);
      return;
    }

    // Send invite via Supabase Auth (inviteUserByEmail is admin-only, use edge function or just create the user)
    const { error: authError } = await supabase.auth.signUp({
      email: inviteEmail,
      password: crypto.randomUUID(), // random password, user will reset
      options: {
        data: { invited: true },
      },
    });

    if (authError && !authError.message.includes("already registered")) {
      toast.error("Failed to send invite: " + authError.message);
    } else {
      toast.success(`Invitation sent to ${inviteEmail}`);
    }

    setInviteEmail("");
    setInviteRole("staff");
    setDialogOpen(false);
    setInviting(false);
    fetchTeam();
  };

  const handleDeleteInvite = async (id: string) => {
    await supabase.from("invitations").delete().eq("id", id);
    toast.success("Invitation removed");
    fetchTeam();
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole as any })
      .eq("user_id", userId);
    if (error) {
      toast.error("Failed to update role");
    } else {
      toast.success("Role updated");
      fetchTeam();
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">You don't have permission to manage the team.</p>
      </div>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Management</h1>
          <p className="text-sm text-muted-foreground">Manage team members and invitations</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" />
            Team Members
          </CardTitle>
          <CardDescription>Current team members and their roles</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
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
                    <TableCell>
                      <Badge variant={roleBadgeVariant(m.role) as any}>{m.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(v) => handleRoleChange(m.user_id, v)}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
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

      {/* Invitations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" />
            Invitations
          </CardTitle>
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
                    <TableCell>
                      <Badge variant={roleBadgeVariant(inv.role) as any}>{inv.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {inv.accepted_at ? (
                        <Badge variant="outline" className="text-green-600">Accepted</Badge>
                      ) : (
                        <Badge variant="outline" className="text-yellow-600">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!inv.accepted_at && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteInvite(inv.id)}
                        >
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
    </div>
  );
};

export default TeamManagement;
