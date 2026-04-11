export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          slug: string
          store_id: string | null
          updated_at: string
          woo_category_id: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          slug?: string
          store_id?: string | null
          updated_at?: string
          woo_category_id?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          store_id?: string | null
          updated_at?: string
          woo_category_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          area: string | null
          city: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          store_id: string | null
          updated_at: string
          woo_customer_id: number | null
          zone: string | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          store_id?: string | null
          updated_at?: string
          woo_customer_id?: number | null
          zone?: string | null
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          store_id?: string | null
          updated_at?: string
          woo_customer_id?: number | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total?: number
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          notes: string | null
          order_id: string
          trx_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          method: string
          notes?: string | null
          order_id: string
          trx_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          order_id?: string
          trx_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_timeline: {
        Row: {
          created_at: string
          description: string
          event: string
          id: string
          metadata: Json | null
          order_id: string
        }
        Insert: {
          created_at?: string
          description: string
          event: string
          id?: string
          metadata?: Json | null
          order_id: string
        }
        Update: {
          created_at?: string
          description?: string
          event?: string
          id?: string
          metadata?: Json | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_timeline_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_to_collect: number | null
          consignment_id: string | null
          created_at: string
          customer_id: string | null
          delivery_type: number | null
          discount: number | null
          id: string
          item_qty: number | null
          item_type: number | null
          item_weight: number | null
          notes: string | null
          order_number: string
          pathao_recipient_area: number | null
          pathao_recipient_city: number | null
          pathao_recipient_zone: number | null
          pathao_store_id: number | null
          payment_method: string | null
          payment_status: string
          shipping_cost: number | null
          source: string
          special_instruction: string | null
          status: string
          store_id: string | null
          subtotal: number
          total: number
          tracking_status: string | null
          updated_at: string
          woo_order_id: number | null
        }
        Insert: {
          amount_to_collect?: number | null
          consignment_id?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_type?: number | null
          discount?: number | null
          id?: string
          item_qty?: number | null
          item_type?: number | null
          item_weight?: number | null
          notes?: string | null
          order_number: string
          pathao_recipient_area?: number | null
          pathao_recipient_city?: number | null
          pathao_recipient_zone?: number | null
          pathao_store_id?: number | null
          payment_method?: string | null
          payment_status?: string
          shipping_cost?: number | null
          source?: string
          special_instruction?: string | null
          status?: string
          store_id?: string | null
          subtotal?: number
          total?: number
          tracking_status?: string | null
          updated_at?: string
          woo_order_id?: number | null
        }
        Update: {
          amount_to_collect?: number | null
          consignment_id?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_type?: number | null
          discount?: number | null
          id?: string
          item_qty?: number | null
          item_type?: number | null
          item_weight?: number | null
          notes?: string | null
          order_number?: string
          pathao_recipient_area?: number | null
          pathao_recipient_city?: number | null
          pathao_recipient_zone?: number | null
          pathao_store_id?: number | null
          payment_method?: string | null
          payment_status?: string
          shipping_cost?: number | null
          source?: string
          special_instruction?: string | null
          status?: string
          store_id?: string | null
          subtotal?: number
          total?: number
          tracking_status?: string | null
          updated_at?: string
          woo_order_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pathao_areas: {
        Row: {
          area_id: number
          area_name: string
          fetched_at: string
          zone_id: number
        }
        Insert: {
          area_id: number
          area_name: string
          fetched_at?: string
          zone_id: number
        }
        Update: {
          area_id?: number
          area_name?: string
          fetched_at?: string
          zone_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "pathao_areas_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "pathao_zones"
            referencedColumns: ["zone_id"]
          },
        ]
      }
      pathao_cities: {
        Row: {
          city_id: number
          city_name: string
          fetched_at: string
        }
        Insert: {
          city_id: number
          city_name: string
          fetched_at?: string
        }
        Update: {
          city_id?: number
          city_name?: string
          fetched_at?: string
        }
        Relationships: []
      }
      pathao_stores: {
        Row: {
          city_id: number | null
          fetched_at: string
          hub_id: number | null
          id: string
          is_active: boolean | null
          pathao_store_id: number
          store_address: string | null
          store_name: string
          zone_id: number | null
        }
        Insert: {
          city_id?: number | null
          fetched_at?: string
          hub_id?: number | null
          id?: string
          is_active?: boolean | null
          pathao_store_id: number
          store_address?: string | null
          store_name: string
          zone_id?: number | null
        }
        Update: {
          city_id?: number | null
          fetched_at?: string
          hub_id?: number | null
          id?: string
          is_active?: boolean | null
          pathao_store_id?: number
          store_address?: string | null
          store_name?: string
          zone_id?: number | null
        }
        Relationships: []
      }
      pathao_zones: {
        Row: {
          city_id: number
          fetched_at: string
          zone_id: number
          zone_name: string
        }
        Insert: {
          city_id: number
          fetched_at?: string
          zone_id: number
          zone_name: string
        }
        Update: {
          city_id?: number
          fetched_at?: string
          zone_id?: number
          zone_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "pathao_zones_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "pathao_cities"
            referencedColumns: ["city_id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          id: string
          product_id: string
        }
        Insert: {
          category_id: string
          id?: string
          product_id: string
        }
        Update: {
          category_id?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variations: {
        Row: {
          attributes: Json
          barcode: string | null
          created_at: string
          id: string
          manage_stock: boolean
          name: string
          price: number
          product_id: string
          sku: string | null
          stock_quantity: number
          stock_status: string
          updated_at: string
          woo_variation_id: number | null
        }
        Insert: {
          attributes?: Json
          barcode?: string | null
          created_at?: string
          id?: string
          manage_stock?: boolean
          name?: string
          price?: number
          product_id: string
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          updated_at?: string
          woo_variation_id?: number | null
        }
        Update: {
          attributes?: Json
          barcode?: string | null
          created_at?: string
          id?: string
          manage_stock?: boolean
          name?: string
          price?: number
          product_id?: string
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          updated_at?: string
          woo_variation_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          backorders: string
          barcode: string | null
          category: string | null
          cost_price: number | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          manage_stock: boolean
          name: string
          price: number
          sku: string | null
          stock_quantity: number
          stock_status: string
          store_id: string | null
          updated_at: string
          woo_product_id: number | null
        }
        Insert: {
          backorders?: string
          barcode?: string | null
          category?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          manage_stock?: boolean
          name: string
          price?: number
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          store_id?: string | null
          updated_at?: string
          woo_product_id?: number | null
        }
        Update: {
          backorders?: string
          barcode?: string | null
          category?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          manage_stock?: boolean
          name?: string
          price?: number
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          store_id?: string | null
          updated_at?: string
          woo_product_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          consumer_key: string | null
          consumer_secret: string | null
          created_at: string
          id: string
          last_synced_at: string | null
          name: string
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name: string
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
