import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StoreLite {
  id: string;
  name: string;
}

export const useStoresList = () => {
  const [stores, setStores] = useState<StoreLite[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.from("stores").select("id, name").order("name");
      if (active) setStores((data as StoreLite[]) || []);
    })();
    return () => {
      active = false;
    };
  }, []);

  return stores;
};
