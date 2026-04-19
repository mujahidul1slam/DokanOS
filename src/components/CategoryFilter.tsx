import { useMemo } from "react";
import { Tags, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface CategoryItem {
  id: string;
  name: string;
  parent_id?: string | null;
  store_id?: string | null;
}

export interface StoreItem {
  id: string;
  name: string;
}

interface CategoryNode extends CategoryItem {
  children: CategoryNode[];
  depth: number;
}

interface BaseProps {
  categories: CategoryItem[];
  stores?: StoreItem[];
  /** When set, only categories belonging to this store id will be shown ("all" = all stores grouped). */
  storeFilter?: string;
  /** Trigger button className passthrough */
  className?: string;
  /** Trigger size */
  size?: "default" | "sm";
  /** Placeholder when nothing selected */
  placeholder?: string;
  /** Hide the icon */
  hideIcon?: boolean;
  /** Force align of dropdown content */
  align?: "start" | "center" | "end";
}

type SingleProps = BaseProps & {
  mode: "single";
  /** category id or "all" */
  value: string;
  onChange: (id: string) => void;
};

type MultiProps = BaseProps & {
  mode: "multi";
  value: Set<string>;
  onChange: (ids: Set<string>) => void;
};

type Props = SingleProps | MultiProps;

function buildTree(cats: CategoryItem[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  cats.forEach((c) => map.set(c.id, { ...c, children: [], depth: 0 }));
  const roots: CategoryNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (n: CategoryNode, depth: number) => {
    n.depth = depth;
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach((c) => sortRec(c, depth + 1));
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach((r) => sortRec(r, 0));
  return roots;
}

function flatten(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (n: CategoryNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

const CategoryRowLabel = ({ depth, name }: { depth: number; name: string }) => (
  <span className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
    {depth > 0 && <span className="text-muted-foreground/60">└</span>}
    <span className="truncate">{name}</span>
  </span>
);

const CategoryFilter = (props: Props) => {
  const {
    categories,
    stores = [],
    storeFilter = "all",
    className,
    size = "default",
    placeholder = "Categories",
    hideIcon = false,
    align = "start",
  } = props;

  // Scope to the selected store first
  const scoped = useMemo(
    () => (storeFilter === "all" ? categories : categories.filter((c) => c.store_id === storeFilter)),
    [categories, storeFilter]
  );

  // Group by store (only used when storeFilter === "all")
  const groups = useMemo(() => {
    const storeNameMap = new Map(stores.map((s) => [s.id, s.name]));
    const byStore = new Map<string, { storeId: string | null; storeName: string; cats: CategoryItem[] }>();
    scoped.forEach((c) => {
      const key = c.store_id ?? "__none__";
      const storeName = c.store_id ? storeNameMap.get(c.store_id) || "Unknown Store" : "Uncategorized";
      if (!byStore.has(key)) byStore.set(key, { storeId: c.store_id ?? null, storeName, cats: [] });
      byStore.get(key)!.cats.push(c);
    });
    return Array.from(byStore.values())
      .map((g) => ({ ...g, tree: buildTree(g.cats) }))
      .sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [scoped, stores]);

  // Single-store flat tree
  const singleStoreFlat = useMemo(() => flatten(buildTree(scoped)), [scoped]);

  const isMulti = props.mode === "multi";

  // Trigger label
  const triggerLabel = (() => {
    if (isMulti) {
      const size = props.value.size;
      if (size === 0) return placeholder;
      return `${size} ${size === 1 ? "Category" : "Categories"}`;
    }
    if (props.value === "all") return placeholder;
    const found = categories.find((c) => c.id === props.value);
    return found ? found.name : placeholder;
  })();

  const isChecked = (id: string) =>
    isMulti ? props.value.has(id) : props.value === id;

  const toggle = (id: string) => {
    if (isMulti) {
      const next = new Set(props.value);
      next.has(id) ? next.delete(id) : next.add(id);
      props.onChange(next);
    } else {
      props.onChange(props.value === id ? "all" : id);
    }
  };

  const clearAll = () => {
    if (isMulti) props.onChange(new Set());
    else props.onChange("all");
  };

  const renderItem = (n: CategoryNode) => {
    if (isMulti) {
      return (
        <DropdownMenuCheckboxItem
          key={n.id}
          checked={isChecked(n.id)}
          onCheckedChange={() => toggle(n.id)}
          onSelect={(e) => e.preventDefault()}
        >
          <CategoryRowLabel depth={n.depth} name={n.name} />
        </DropdownMenuCheckboxItem>
      );
    }
    return (
      <DropdownMenuItem
        key={n.id}
        onClick={() => toggle(n.id)}
        className={cn(isChecked(n.id) && "bg-accent")}
      >
        <span className="mr-2 flex h-3.5 w-3.5 items-center justify-center">
          {isChecked(n.id) && <Check className="h-3.5 w-3.5" />}
        </span>
        <CategoryRowLabel depth={n.depth} name={n.name} />
      </DropdownMenuItem>
    );
  };

  const showGrouped = storeFilter === "all" && groups.length > 1;
  const hasSelection = isMulti ? props.value.size > 0 : props.value !== "all";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={cn("gap-2 font-normal", className)}
        >
          {!hideIcon && <Tags className="h-4 w-4" />}
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72 max-h-96 overflow-y-auto">
        {scoped.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No categories available</div>
        ) : (
          <>
            {hasSelection && (
              <>
                <DropdownMenuItem
                  onClick={clearAll}
                  className="text-xs text-muted-foreground"
                >
                  Clear {isMulti ? "all" : "selection"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {!isMulti && !hasSelection && (
              <DropdownMenuItem
                onClick={() => (props as SingleProps).onChange("all")}
                className={cn(props.value === "all" && "bg-accent")}
              >
                <span className="mr-2 flex h-3.5 w-3.5 items-center justify-center">
                  {props.value === "all" && <Check className="h-3.5 w-3.5" />}
                </span>
                All Categories
              </DropdownMenuItem>
            )}
            {showGrouped
              ? groups.map((group, idx) => (
                  <div key={group.storeId ?? `none-${idx}`}>
                    {idx > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                      {group.storeName}
                    </DropdownMenuLabel>
                    {flatten(group.tree).map(renderItem)}
                  </div>
                ))
              : singleStoreFlat.map(renderItem)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CategoryFilter;
