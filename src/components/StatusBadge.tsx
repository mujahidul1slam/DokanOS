const statusStyles: Record<string, string> = {
  Processing: "bg-primary/15 text-primary",
  Shipped: "bg-warning/15 text-warning",
  Delivered: "bg-success/15 text-success",
  Completed: "bg-success/15 text-success",
  Cancelled: "bg-destructive/15 text-destructive",
  "In Stock": "bg-success/15 text-success",
  "Low Stock": "bg-warning/15 text-warning",
  "Out of Stock": "bg-destructive/15 text-destructive",
};

const StatusBadge = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status] || "bg-muted text-muted-foreground"}`}>
    {status}
  </span>
);

export default StatusBadge;
