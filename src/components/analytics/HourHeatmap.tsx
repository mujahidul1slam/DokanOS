interface Props {
  data: number[][]; // [day][hour] = orders count
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const HourHeatmap = ({ data }: Props) => {
  const max = Math.max(1, ...data.flat());

  const intensity = (v: number) => {
    if (v === 0) return "hsl(var(--muted) / 0.3)";
    const pct = v / max;
    return `hsl(217, 91%, ${Math.max(20, 60 - pct * 35)}%)`;
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Order Heatmap</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Best hours to staff your team</p>
      </div>
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="flex items-center gap-1 mb-1 pl-10">
            {HOURS.map((h) => (
              <div key={h} className="w-5 text-center text-[9px] text-muted-foreground">
                {h % 3 === 0 ? h : ""}
              </div>
            ))}
          </div>
          {DAYS.map((day, di) => (
            <div key={day} className="flex items-center gap-1 mb-0.5">
              <div className="w-9 text-xs text-muted-foreground">{day}</div>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="w-5 h-5 rounded-sm transition-transform hover:scale-110"
                  style={{ backgroundColor: intensity(data[di]?.[h] || 0) }}
                  title={`${day} ${h}:00 — ${data[di]?.[h] || 0} orders`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-muted-foreground">
        <span>Low</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 1].map((p) => (
            <div key={p} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `hsl(217, 91%, ${60 - p * 35}%)` }} />
          ))}
        </div>
        <span>High</span>
      </div>
    </div>
  );
};

export default HourHeatmap;
