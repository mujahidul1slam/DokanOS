import { useEffect, useState } from "react";
import { CheckCircle, MapPin, RefreshCw, Loader2, Eye, EyeOff, Trash2, Pencil, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface PathaoIntegration {
  id: string;
  name: string;
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
  environment: string;
  is_active: boolean;
}

interface Props {
  integration: PathaoIntegration;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

const PathaoDetail = ({ integration, onDelete, onRefresh }: Props) => {
  const [cityCount, setCityCount] = useState(0);
  const [zoneCount, setZoneCount] = useState(0);
  const [areaCount, setAreaCount] = useState(0);
  const [storeCount, setStoreCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: integration.name,
    client_id: integration.client_id,
    client_secret: integration.client_secret,
    username: integration.username,
    password: integration.password,
  });
  const { toast } = useToast();

  const loadStats = async () => {
    const [cities, zones, areas, stores] = await Promise.all([
      supabase.from("pathao_cities").select("city_id", { count: "exact", head: true }),
      supabase.from("pathao_zones").select("zone_id", { count: "exact", head: true }),
      supabase.from("pathao_areas").select("area_id", { count: "exact", head: true }),
      supabase.from("pathao_stores").select("id", { count: "exact", head: true }),
    ]);
    setCityCount(cities.count || 0);
    setZoneCount(zones.count || 0);
    setAreaCount(areas.count || 0);
    setStoreCount(stores.count || 0);
  };

  useEffect(() => { loadStats(); }, []);

  const handleRefreshLocations = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("pathao-courier", {
        body: { action: "get_cities" },
      });
      if (error) throw error;
      toast({ title: "Pathao data refreshed" });
      loadStats();
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("pathao_integrations").update({
      name: form.name,
      client_id: form.client_id,
      client_secret: form.client_secret,
      username: form.username,
      password: form.password,
    }).eq("id", integration.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pathao integration updated" });
      setEditing(false);
      onRefresh();
    }
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const credentials = [
    { key: "client_id", label: "Client ID", value: integration.client_id },
    { key: "client_secret", label: "Client Secret", value: integration.client_secret },
    { key: "username", label: "Username", value: integration.username },
    { key: "password", label: "Password", value: integration.password },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Connection Status */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Connection Details</h2>
          <Badge className="bg-success/15 text-success border-0 text-xs">
            <CheckCircle className="h-3 w-3 mr-1" /> Connected
          </Badge>
        </div>

        <div className="grid gap-3 text-sm">
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">API Environment</span>
            <span className="font-medium capitalize">{integration.environment}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Status</span>
            <span className={`font-medium ${integration.is_active ? "text-success" : "text-muted-foreground"}`}>
              {integration.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Features</span>
            <span className="font-medium">Bulk Dispatch, Auto-tracking, Address Lookup</span>
          </div>
        </div>
      </div>

      {/* API Credentials */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">API Credentials</h2>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Integration Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Client ID</Label>
              <Input value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Client Secret</Label>
              <Input type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setForm({ name: integration.name, client_id: integration.client_id, client_secret: integration.client_secret, username: integration.username, password: integration.password }); }}>
                <X className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            {credentials.map((cred) => (
              <div key={cred.key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-muted-foreground text-xs">{cred.label}</span>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono max-w-[200px] truncate">
                    {showSecrets[cred.key] ? cred.value : "••••••••••••"}
                  </code>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleSecret(cred.key)}>
                    {showSecrets[cred.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cached Location Data */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-heading text-lg font-semibold">Location Data</h2>
          </div>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={handleRefreshLocations} className="gap-1.5">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Cities", value: cityCount },
            { label: "Zones", value: zoneCount },
            { label: "Areas", value: areaCount },
            { label: "Pathao Stores", value: storeCount },
          ].map((stat) => (
            <div key={stat.label} className="rounded-md border border-border p-3 text-center">
              <p className="font-heading text-xl font-semibold text-card-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-1.5">
              <Trash2 className="h-4 w-4" /> Remove Integration
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Pathao Integration</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove this Pathao connection. Cached location data will remain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(integration.id)}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default PathaoDetail;
