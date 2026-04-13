const statusStyles: Record<string, string> = {
  processing: "bg-primary/15 text-primary",
  ready_to_ship: "bg-cyan-500/15 text-cyan-500",
  shipped: "bg-warning/15 text-warning",
  delivered: "bg-success/15 text-success",
  completed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  pending: "bg-muted text-muted-foreground",
  returned: "bg-destructive/15 text-destructive",
  "in stock": "bg-success/15 text-success",
  "low stock": "bg-warning/15 text-warning",
  "out of stock": "bg-destructive/15 text-destructive",
  connected: "bg-success/15 text-success",
  disconnected: "bg-destructive/15 text-destructive",
  syncing: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
};

const StatusBadge = ({ status }: { status: string }) => {
  const key = status.toLowerCase();
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[key] || "bg-muted text-muted-foreground"}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
