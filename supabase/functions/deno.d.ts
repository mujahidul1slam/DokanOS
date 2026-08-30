// Type declarations for Supabase Edge Functions (Deno runtime)

declare const Deno: {
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
    options?: { port?: number; onListen?: (params: { port: number; hostname: string }) => void }
  ) => void;
  env: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
    delete: (key: string) => void;
    toObject: () => Record<string, string>;
  };
};

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

declare module "npm:*" {
  const content: any;
  export = content;
}

declare module "npm:@supabase/supabase-js@*" {
  export * from "@supabase/supabase-js";
}

declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "npm:@supabase/supabase-js@2.49.4" {
  export * from "@supabase/supabase-js";
}

declare module "npm:@supabase/supabase-js@2.38.4" {
  export * from "@supabase/supabase-js";
}

declare module "https://*" {
  const content: any;
  export = content;
}
