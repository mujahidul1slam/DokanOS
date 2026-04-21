import { ReactNode } from "react";
import { usePermissions, type AppPermission } from "@/hooks/usePermissions";
import { ShieldOff } from "lucide-react";

interface Props {
  permission?: AppPermission;
  anyOf?: AppPermission[];
  children: ReactNode;
  fallback?: ReactNode;
}

const DefaultFallback = () => (
  <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
    <ShieldOff className="h-10 w-10 text-muted-foreground" />
    <div>
      <p className="font-semibold text-foreground">Access denied</p>
      <p className="text-sm text-muted-foreground">You don't have permission to view this page.</p>
    </div>
  </div>
);

export const PermissionGuard = ({ permission, anyOf, children, fallback }: Props) => {
  const { can, canAny, loading } = usePermissions();
  if (loading) return null;
  const allowed = permission ? can(permission) : anyOf ? canAny(anyOf) : true;
  if (!allowed) return <>{fallback ?? <DefaultFallback />}</>;
  return <>{children}</>;
};

export default PermissionGuard;
