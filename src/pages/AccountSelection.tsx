import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { CreateBusinessDialog } from "@/components/CreateBusinessDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountSelection() {
  const { user, signOut } = useAuth();
  const { businesses, loading, setActive, refresh, error } = useBusinessContext();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  if (loading) return <p role="status" className="p-8 text-center">Loading your business accounts...</p>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Choose a business account</CardTitle>
          <CardDescription>Signed in as {user?.email}. Your personal account is ready.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {params.get("invite") && (
            <p role="status">Your invitation is saved. Verification does not accept it or grant access.</p>
          )}
          {error ? (
            <div role="alert" className="space-y-3">
              <p>We couldn't load your business accounts. Please try again.</p>
              <Button variant="outline" onClick={() => void refresh()}>Retry</Button>
            </div>
          ) : businesses.length === 0 ? (
            <div className="space-y-2">
              <p>You don't belong to a business account yet.</p>
              <p className="text-sm text-muted-foreground">Ask a business account owner for an invitation, or create your own business account when you're ready.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {businesses.map((business) => (
                <li key={business.id}>
                  <Button variant="outline" className="w-full justify-start" onClick={async () => {
                    if (await setActive(business.id)) navigate("/", { replace: true });
                  }}>{business.name}</Button>
                </li>
              ))}
            </ul>
          )}
          {!error && <Button onClick={() => setCreating(true)}>Create a business account</Button>}
          <Button variant="ghost" onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}>Sign out</Button>
          {creating && <CreateBusinessDialog open={creating} onOpenChange={setCreating} />}
        </CardContent>
      </Card>
    </div>
  );
}
