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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
          woo_store_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
          woo_store_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
          woo_store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_woo_store_id_fkey"
            columns: ["woo_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_woo_store_id_fkey"
            columns: ["woo_store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          created_at: string
          currency: string
          email: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          phone: string | null
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          phone?: string | null
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          phone?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
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
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          brand_id: string | null
          business_id: string
          category: string
          config: Json
          created_at: string
          id: string
          is_active: boolean
          last_error: string | null
          last_sync_at: string | null
          name: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          business_id: string
          category?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          name: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          business_id?: string
          category?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          name?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connectors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connectors_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_integrations: {
        Row: {
          allowed_courier_store_ids: Json | null
          created_at: string
          credentials: Json
          id: string
          is_active: boolean
          provider: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_courier_store_ids?: Json | null
          created_at?: string
          credentials: Json
          id?: string
          is_active?: boolean
          provider: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_courier_store_ids?: Json | null
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          provider?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_integrations_provider_fkey"
            columns: ["provider"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "courier_integrations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_integrations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_providers: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          max_requests_per_minute: number
          name: string
          track_interval_minutes: number
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          max_requests_per_minute?: number
          name: string
          track_interval_minutes?: number
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          max_requests_per_minute?: number
          name?: string
          track_interval_minutes?: number
        }
        Relationships: []
      }
      courier_shipments: {
        Row: {
          canonical_status: string | null
          consignment_id: string
          created_at: string
          dispatched_at: string
          id: string
          integration_id: string | null
          last_tracked_at: string | null
          order_id: string
          provider: string
          raw_status: string | null
          updated_at: string
        }
        Insert: {
          canonical_status?: string | null
          consignment_id: string
          created_at?: string
          dispatched_at?: string
          id?: string
          integration_id?: string | null
          last_tracked_at?: string | null
          order_id: string
          provider: string
          raw_status?: string | null
          updated_at?: string
        }
        Update: {
          canonical_status?: string | null
          consignment_id?: string
          created_at?: string
          dispatched_at?: string
          id?: string
          integration_id?: string | null
          last_tracked_at?: string | null
          order_id?: string
          provider?: string
          raw_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_shipments_provider_fkey"
            columns: ["provider"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["code"]
          },
        ]
      }
      courier_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          integration_id: string | null
          provider: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          integration_id?: string | null
          provider?: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          integration_id?: string | null
          provider?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_tokens_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_tokens_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          permissions: Database["public"]["Enums"]["app_permission"][]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          permissions?: Database["public"]["Enums"]["app_permission"][]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          permissions?: Database["public"]["Enums"]["app_permission"][]
          updated_at?: string
        }
        Relationships: []
      }
      customer_aliases: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          source_store_id: string | null
          type: string
          value: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          source_store_id?: string | null
          type: string
          value: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          source_store_id?: string | null
          type?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_aliases_source_store_id_fkey"
            columns: ["source_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_aliases_source_store_id_fkey"
            columns: ["source_store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sources: {
        Row: {
          brand_id: string | null
          business_id: string
          config: Json
          created_at: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          name: string
          status: string
          sync_direction: string
          type: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          business_id: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name: string
          status?: string
          sync_direction?: string
          type: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          business_id?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name?: string
          status?: string
          sync_direction?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_sources_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          source: string
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
          source?: string
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
          source?: string
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
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      held_carts: {
        Row: {
          cart_data: Json
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          held_by: string | null
          id: string
          label: string
          notes: string | null
          store_id: string | null
          updated_at: string
        }
        Insert: {
          cart_data?: Json
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          held_by?: string | null
          id?: string
          label?: string
          notes?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          cart_data?: Json
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          held_by?: string | null
          id?: string
          label?: string
          notes?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_carts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_carts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      invoice_settings: {
        Row: {
          address: string | null
          business_name: string
          created_at: string
          default_print_format: string
          email: string | null
          footer_text: string | null
          id: string
          invoice_template: Json
          logo_url: string | null
          manual_order_prefix: string
          manual_order_suffix: string
          measurement_slip_template: Json
          phone: string | null
          pickup_slip_print_format: string
          pickup_slip_template: Json
          pos_custom_measurements_enabled: boolean
          pos_order_prefix: string
          pos_order_suffix: string
          shipping_inside_dhaka: number
          shipping_outside_dhaka: number
          shipping_presets: Json
          tagline: string | null
          terms_text: string | null
          updated_at: string
          woo_order_prefix: string
          woo_order_suffix: string
        }
        Insert: {
          address?: string | null
          business_name?: string
          created_at?: string
          default_print_format?: string
          email?: string | null
          footer_text?: string | null
          id?: string
          invoice_template?: Json
          logo_url?: string | null
          manual_order_prefix?: string
          manual_order_suffix?: string
          measurement_slip_template?: Json
          phone?: string | null
          pickup_slip_print_format?: string
          pickup_slip_template?: Json
          pos_custom_measurements_enabled?: boolean
          pos_order_prefix?: string
          pos_order_suffix?: string
          shipping_inside_dhaka?: number
          shipping_outside_dhaka?: number
          shipping_presets?: Json
          tagline?: string | null
          terms_text?: string | null
          updated_at?: string
          woo_order_prefix?: string
          woo_order_suffix?: string
        }
        Update: {
          address?: string | null
          business_name?: string
          created_at?: string
          default_print_format?: string
          email?: string | null
          footer_text?: string | null
          id?: string
          invoice_template?: Json
          logo_url?: string | null
          manual_order_prefix?: string
          manual_order_suffix?: string
          measurement_slip_template?: Json
          phone?: string | null
          pickup_slip_print_format?: string
          pickup_slip_template?: Json
          pos_custom_measurements_enabled?: boolean
          pos_order_prefix?: string
          pos_order_suffix?: string
          shipping_inside_dhaka?: number
          shipping_outside_dhaka?: number
          shipping_presets?: Json
          tagline?: string | null
          terms_text?: string | null
          updated_at?: string
          woo_order_prefix?: string
          woo_order_suffix?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          address: string | null
          area: string | null
          brand_id: string | null
          business_id: string
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          type: string
          updated_at: string
          zone: string | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          brand_id?: string | null
          business_id: string
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          type?: string
          updated_at?: string
          zone?: string | null
        }
        Update: {
          address?: string | null
          area?: string | null
          brand_id?: string | null
          business_id?: string
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          type?: string
          updated_at?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_assignments: {
        Row: {
          category_id: string | null
          created_at: string
          group_id: string
          id: string
          product_id: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          group_id: string
          id?: string
          product_id?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          group_id?: string
          id?: string
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_assignments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "measurement_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_assignments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_fields: {
        Row: {
          created_at: string
          group_id: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "measurement_fields_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "measurement_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_groups: {
        Row: {
          created_at: string
          display_format: string
          id: string
          name: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_format?: string
          id?: string
          name: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_format?: string
          id?: string
          name?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      measurement_size_presets: {
        Row: {
          created_at: string
          group_id: string
          id: string
          product_id: string | null
          size_label: string
          updated_at: string
          values: Json
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          product_id?: string | null
          size_label: string
          updated_at?: string
          values?: Json
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          product_id?: string | null
          size_label?: string
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "measurement_size_presets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "measurement_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_size_presets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_measurements: {
        Row: {
          created_at: string
          display_format: string
          group_name: string
          id: string
          notes: string | null
          order_id: string
          order_item_id: string | null
          source: string
          unit: string
          values: Json
        }
        Insert: {
          created_at?: string
          display_format?: string
          group_name: string
          id?: string
          notes?: string | null
          order_id: string
          order_item_id?: string | null
          source?: string
          unit?: string
          values?: Json
        }
        Update: {
          created_at?: string
          display_format?: string
          group_name?: string
          id?: string
          notes?: string | null
          order_id?: string
          order_item_id?: string | null
          source?: string
          unit?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_item_measurements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_measurements_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          discount: number | null
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
          discount?: number | null
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
          discount?: number | null
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
      order_sources: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
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
          customer_address: string | null
          customer_city: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          deleted_at: string | null
          delivery_type: number | null
          discount: number | null
          fulfillment_type: string
          id: string
          is_exchange: boolean
          item_qty: number | null
          item_type: number | null
          item_weight: number | null
          last_tracked_at: string | null
          location_id: string | null
          measurement_slip_printed_at: string | null
          notes: string | null
          order_number: string
          parent_order_id: string | null
          pathao_integration_id: string | null
          pathao_recipient_area: number | null
          pathao_recipient_city: number | null
          pathao_recipient_zone: number | null
          pathao_store_id: number | null
          payment_meta: Json | null
          payment_method: string | null
          payment_status: string
          pickup_slip_printed_at: string | null
          salesperson_id: string | null
          salesperson_name: string | null
          selling_point_id: string | null
          shipping_cost: number | null
          source: string
          special_instruction: string | null
          status: string
          store_id: string | null
          subtotal: number
          tax_amount: number | null
          total: number
          tracking_status: string | null
          updated_at: string
          woo_order_id: number | null
          woo_updated_at: string | null
        }
        Insert: {
          amount_to_collect?: number | null
          consignment_id?: string | null
          created_at?: string
          customer_address?: string | null
          customer_city?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deleted_at?: string | null
          delivery_type?: number | null
          discount?: number | null
          fulfillment_type?: string
          id?: string
          is_exchange?: boolean
          item_qty?: number | null
          item_type?: number | null
          item_weight?: number | null
          last_tracked_at?: string | null
          location_id?: string | null
          measurement_slip_printed_at?: string | null
          notes?: string | null
          order_number: string
          parent_order_id?: string | null
          pathao_integration_id?: string | null
          pathao_recipient_area?: number | null
          pathao_recipient_city?: number | null
          pathao_recipient_zone?: number | null
          pathao_store_id?: number | null
          payment_meta?: Json | null
          payment_method?: string | null
          payment_status?: string
          pickup_slip_printed_at?: string | null
          salesperson_id?: string | null
          salesperson_name?: string | null
          selling_point_id?: string | null
          shipping_cost?: number | null
          source?: string
          special_instruction?: string | null
          status?: string
          store_id?: string | null
          subtotal?: number
          tax_amount?: number | null
          total?: number
          tracking_status?: string | null
          updated_at?: string
          woo_order_id?: number | null
          woo_updated_at?: string | null
        }
        Update: {
          amount_to_collect?: number | null
          consignment_id?: string | null
          created_at?: string
          customer_address?: string | null
          customer_city?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deleted_at?: string | null
          delivery_type?: number | null
          discount?: number | null
          fulfillment_type?: string
          id?: string
          is_exchange?: boolean
          item_qty?: number | null
          item_type?: number | null
          item_weight?: number | null
          last_tracked_at?: string | null
          location_id?: string | null
          measurement_slip_printed_at?: string | null
          notes?: string | null
          order_number?: string
          parent_order_id?: string | null
          pathao_integration_id?: string | null
          pathao_recipient_area?: number | null
          pathao_recipient_city?: number | null
          pathao_recipient_zone?: number | null
          pathao_store_id?: number | null
          payment_meta?: Json | null
          payment_method?: string | null
          payment_status?: string
          pickup_slip_printed_at?: string | null
          salesperson_id?: string | null
          salesperson_name?: string | null
          selling_point_id?: string | null
          shipping_cost?: number | null
          source?: string
          special_instruction?: string | null
          status?: string
          store_id?: string | null
          subtotal?: number
          tax_amount?: number | null
          total?: number
          tracking_status?: string | null
          updated_at?: string
          woo_order_id?: number | null
          woo_updated_at?: string | null
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
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pathao_integration_id_fkey"
            columns: ["pathao_integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pathao_integration_id_fkey"
            columns: ["pathao_integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_selling_point_id_fkey"
            columns: ["selling_point_id"]
            isOneToOne: false
            referencedRelation: "selling_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
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
      pathao_integrations: {
        Row: {
          allowed_store_ids: Json
          client_id: string
          client_secret: string
          created_at: string
          environment: string
          id: string
          is_active: boolean
          name: string
          password: string
          updated_at: string
          username: string
        }
        Insert: {
          allowed_store_ids?: Json
          client_id: string
          client_secret: string
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          name?: string
          password: string
          updated_at?: string
          username: string
        }
        Update: {
          allowed_store_ids?: Json
          client_id?: string
          client_secret?: string
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          name?: string
          password?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      pathao_store_links: {
        Row: {
          created_at: string
          default_pathao_store_id: number | null
          id: string
          pathao_integration_id: string
          updated_at: string
          woo_store_id: string
        }
        Insert: {
          created_at?: string
          default_pathao_store_id?: number | null
          id?: string
          pathao_integration_id: string
          updated_at?: string
          woo_store_id: string
        }
        Update: {
          created_at?: string
          default_pathao_store_id?: number | null
          id?: string
          pathao_integration_id?: string
          updated_at?: string
          woo_store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pathao_store_links_pathao_integration_id_fkey"
            columns: ["pathao_integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pathao_store_links_pathao_integration_id_fkey"
            columns: ["pathao_integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pathao_store_links_woo_store_id_fkey"
            columns: ["woo_store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pathao_store_links_woo_store_id_fkey"
            columns: ["woo_store_id"]
            isOneToOne: true
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pathao_stores: {
        Row: {
          city_id: number | null
          fetched_at: string
          hub_id: number | null
          id: string
          integration_id: string | null
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
          integration_id?: string | null
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
          integration_id?: string | null
          is_active?: boolean | null
          pathao_store_id?: number
          store_address?: string | null
          store_name?: string
          zone_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pathao_stores_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pathao_stores_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "pathao_integrations_safe"
            referencedColumns: ["id"]
          },
        ]
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
      permission_settings: {
        Row: {
          created_at: string
          enforce_store_scoping: boolean
          id: string
          large_discount_amount: number | null
          large_discount_percent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enforce_store_scoping?: boolean
          id?: string
          large_discount_amount?: number | null
          large_discount_percent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enforce_store_scoping?: boolean
          id?: string
          large_discount_amount?: number | null
          large_discount_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      pos_returns: {
        Row: {
          created_at: string
          id: string
          items: Json
          notes: string | null
          order_id: string | null
          processed_by: string | null
          reason: string | null
          refund_amount: number
          refund_method: string
          restock: boolean
          return_number: string
          store_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          order_id?: string | null
          processed_by?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: string
          restock?: boolean
          return_number: string
          store_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          order_id?: string | null
          processed_by?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: string
          restock?: boolean
          return_number?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_returns_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_returns_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_shifts: {
        Row: {
          bank_sales: number
          bkash_sales: number
          card_sales: number
          cash_sales: number
          closed_at: string | null
          closing_balance: number | null
          expected_balance: number | null
          id: string
          notes: string | null
          opened_at: string
          opening_float: number
          selling_point_id: string | null
          status: string
          store_id: string | null
          total_returns: number
          total_sales: number
          transaction_count: number
          user_email: string | null
          user_id: string
        }
        Insert: {
          bank_sales?: number
          bkash_sales?: number
          card_sales?: number
          cash_sales?: number
          closed_at?: string | null
          closing_balance?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_float?: number
          selling_point_id?: string | null
          status?: string
          store_id?: string | null
          total_returns?: number
          total_sales?: number
          transaction_count?: number
          user_email?: string | null
          user_id: string
        }
        Update: {
          bank_sales?: number
          bkash_sales?: number
          card_sales?: number
          cash_sales?: number
          closed_at?: string | null
          closing_balance?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_float?: number
          selling_point_id?: string | null
          status?: string
          store_id?: string | null
          total_returns?: number
          total_sales?: number
          transaction_count?: number
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_shifts_selling_point_id_fkey"
            columns: ["selling_point_id"]
            isOneToOne: false
            referencedRelation: "selling_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
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
      product_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          product_id: string
          stock_quantity: number
          stock_status: string
          updated_at: string
          variation_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          product_id: string
          stock_quantity?: number
          stock_status?: string
          updated_at?: string
          variation_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          product_id?: string
          stock_quantity?: number
          stock_status?: string
          updated_at?: string
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_locations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_locations_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "product_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sources: {
        Row: {
          brand_id: string | null
          business_id: string
          config: Json
          created_at: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          name: string
          status: string
          sync_direction: string
          type: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          business_id: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name: string
          status?: string
          sync_direction?: string
          type: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          business_id?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name?: string
          status?: string
          sync_direction?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sources_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          regular_price: number | null
          sale_price: number | null
          sku: string | null
          stock_quantity: number
          stock_status: string
          updated_at: string
          woo_updated_at: string | null
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
          regular_price?: number | null
          sale_price?: number | null
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          updated_at?: string
          woo_updated_at?: string | null
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
          regular_price?: number | null
          sale_price?: number | null
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          updated_at?: string
          woo_updated_at?: string | null
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
          attributes: Json | null
          backorders: string
          barcode: string | null
          category: string | null
          cost_price: number | null
          created_at: string
          description: string | null
          dimensions: Json | null
          id: string
          image_url: string | null
          image_urls: Json
          is_active: boolean
          is_featured: boolean
          manage_stock: boolean
          name: string
          price: number
          regular_price: number | null
          sale_price: number | null
          sale_price_from: string | null
          sale_price_to: string | null
          sales_count: number
          short_description: string | null
          sku: string | null
          stock_quantity: number
          stock_status: string
          store_id: string | null
          tags: Json | null
          updated_at: string
          weight: number | null
          woo_product_id: number | null
          woo_updated_at: string | null
        }
        Insert: {
          attributes?: Json | null
          backorders?: string
          barcode?: string | null
          category?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          dimensions?: Json | null
          id?: string
          image_url?: string | null
          image_urls?: Json
          is_active?: boolean
          is_featured?: boolean
          manage_stock?: boolean
          name: string
          price?: number
          regular_price?: number | null
          sale_price?: number | null
          sale_price_from?: string | null
          sale_price_to?: string | null
          sales_count?: number
          short_description?: string | null
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          store_id?: string | null
          tags?: Json | null
          updated_at?: string
          weight?: number | null
          woo_product_id?: number | null
          woo_updated_at?: string | null
        }
        Update: {
          attributes?: Json | null
          backorders?: string
          barcode?: string | null
          category?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          dimensions?: Json | null
          id?: string
          image_url?: string | null
          image_urls?: Json
          is_active?: boolean
          is_featured?: boolean
          manage_stock?: boolean
          name?: string
          price?: number
          regular_price?: number | null
          sale_price?: number | null
          sale_price_from?: string | null
          sale_price_to?: string | null
          sales_count?: number
          short_description?: string | null
          sku?: string | null
          stock_quantity?: number
          stock_status?: string
          store_id?: string | null
          tags?: Json | null
          updated_at?: string
          weight?: number | null
          woo_product_id?: number | null
          woo_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          expected_at: string | null
          id: string
          items: Json
          location_id: string | null
          notes: string | null
          po_number: string
          received_at: string | null
          status: string
          supplier_id: string
          total_cost: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          po_number: string
          received_at?: string | null
          status?: string
          supplier_id: string
          total_cost?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          po_number?: string
          received_at?: string | null
          status?: string
          supplier_id?: string
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      selling_points: {
        Row: {
          brand_id: string
          business_id: string
          config: Json
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          location_id: string | null
          name: string
          storefront_id: string | null
          type: string
          updated_at: string
          woo_store_id: string | null
        }
        Insert: {
          brand_id: string
          business_id: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          location_id?: string | null
          name: string
          storefront_id?: string | null
          type: string
          updated_at?: string
          woo_store_id?: string | null
        }
        Update: {
          brand_id?: string
          business_id?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          location_id?: string | null
          name?: string
          storefront_id?: string | null
          type?: string
          updated_at?: string
          woo_store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "selling_points_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selling_points_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selling_points_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selling_points_storefront_id_fkey"
            columns: ["storefront_id"]
            isOneToOne: false
            referencedRelation: "storefronts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selling_points_woo_store_id_fkey"
            columns: ["woo_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selling_points_woo_store_id_fkey"
            columns: ["woo_store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_collection_products: {
        Row: {
          collection_id: string
          id: string
          position: number
          product_id: string
        }
        Insert: {
          collection_id: string
          id?: string
          position?: number
          product_id: string
        }
        Update: {
          collection_id?: string
          id?: string
          position?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_collection_products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "storefront_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_collections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          position: number
          slug: string
          storefront_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          position?: number
          slug: string
          storefront_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          position?: number
          slug?: string
          storefront_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_collections_storefront_id_fkey"
            columns: ["storefront_id"]
            isOneToOne: false
            referencedRelation: "storefronts"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_pages: {
        Row: {
          body_md: string | null
          created_at: string
          id: string
          is_active: boolean
          slug: string
          storefront_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body_md?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          slug: string
          storefront_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          slug?: string
          storefront_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_pages_storefront_id_fkey"
            columns: ["storefront_id"]
            isOneToOne: false
            referencedRelation: "storefronts"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_products: {
        Row: {
          added_at: string
          badge: string | null
          id: string
          is_featured: boolean
          position: number
          product_id: string
          storefront_id: string
        }
        Insert: {
          added_at?: string
          badge?: string | null
          id?: string
          is_featured?: boolean
          position?: number
          product_id: string
          storefront_id: string
        }
        Update: {
          added_at?: string
          badge?: string | null
          id?: string
          is_featured?: boolean
          position?: number
          product_id?: string
          storefront_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_products_storefront_id_fkey"
            columns: ["storefront_id"]
            isOneToOne: false
            referencedRelation: "storefronts"
            referencedColumns: ["id"]
          },
        ]
      }
      storefronts: {
        Row: {
          about_md: string | null
          accent_hex: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          favicon_url: string | null
          hero_image_url: string | null
          hero_subtitle: string | null
          hero_title: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          policies: Json
          slug: string
          social: Json
          store_id: string | null
          theme: string
          updated_at: string
        }
        Insert: {
          about_md?: string | null
          accent_hex?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          favicon_url?: string | null
          hero_image_url?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          policies?: Json
          slug: string
          social?: Json
          store_id?: string | null
          theme?: string
          updated_at?: string
        }
        Update: {
          about_md?: string | null
          accent_hex?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          favicon_url?: string | null
          hero_image_url?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          policies?: Json
          slug?: string
          social?: Json
          store_id?: string | null
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          circuit_breaker_until: string | null
          consumer_key: string | null
          consumer_secret: string | null
          created_at: string
          customers_synced_at: string | null
          id: string
          last_synced_at: string | null
          manual_order_prefix: string
          manual_order_suffix: string
          name: string
          pos_order_prefix: string
          pos_order_suffix: string
          status: string
          sync_failures: number
          updated_at: string
          url: string
          woo_order_prefix: string
          woo_order_suffix: string
        }
        Insert: {
          circuit_breaker_until?: string | null
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          customers_synced_at?: string | null
          id?: string
          last_synced_at?: string | null
          manual_order_prefix?: string
          manual_order_suffix?: string
          name: string
          pos_order_prefix?: string
          pos_order_suffix?: string
          status?: string
          sync_failures?: number
          updated_at?: string
          url: string
          woo_order_prefix?: string
          woo_order_suffix?: string
        }
        Update: {
          circuit_breaker_until?: string | null
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          customers_synced_at?: string | null
          id?: string
          last_synced_at?: string | null
          manual_order_prefix?: string
          manual_order_suffix?: string
          name?: string
          pos_order_prefix?: string
          pos_order_suffix?: string
          status?: string
          sync_failures?: number
          updated_at?: string
          url?: string
          woo_order_prefix?: string
          woo_order_suffix?: string
        }
        Relationships: []
      }
      supplier_products: {
        Row: {
          cost_price: number | null
          created_at: string
          id: string
          is_preferred: boolean
          lead_time_days: number | null
          notes: string | null
          product_id: string | null
          sku: string | null
          supplier_id: string
          updated_at: string
        }
        Insert: {
          cost_price?: number | null
          created_at?: string
          id?: string
          is_preferred?: boolean
          lead_time_days?: number | null
          notes?: string | null
          product_id?: string | null
          sku?: string | null
          supplier_id: string
          updated_at?: string
        }
        Update: {
          cost_price?: number | null
          created_at?: string
          id?: string
          is_preferred?: boolean
          lead_time_days?: number | null
          notes?: string | null
          product_id?: string | null
          sku?: string | null
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          business_id: string
          city: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_factory: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_id: string
          city?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_factory?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_id?: string
          city?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_factory?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_queue: {
        Row: {
          action: string
          attempts: number
          created_at: string | null
          error_log: string | null
          id: string
          idempotency_key: string | null
          next_retry_at: string | null
          order_id: string | null
          payload: Json | null
          status: string
          store_id: string
          updated_at: string | null
        }
        Insert: {
          action: string
          attempts?: number
          created_at?: string | null
          error_log?: string | null
          id?: string
          idempotency_key?: string | null
          next_retry_at?: string | null
          order_id?: string | null
          payload?: Json | null
          status?: string
          store_id: string
          updated_at?: string | null
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string | null
          error_log?: string | null
          id?: string
          idempotency_key?: string | null
          next_retry_at?: string | null
          order_id?: string | null
          payload?: Json | null
          status?: string
          store_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_queue_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_queue_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_queue_cleanup_log: {
        Row: {
          action: string | null
          attempts: number | null
          created_at: string | null
          id: string
          order_id: string | null
          payload: Json | null
          purged_at: string
          status: string | null
        }
        Insert: {
          action?: string | null
          attempts?: number | null
          created_at?: string | null
          id: string
          order_id?: string | null
          payload?: Json | null
          purged_at?: string
          status?: string | null
        }
        Update: {
          action?: string | null
          attempts?: number | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          payload?: Json | null
          purged_at?: string
          status?: string | null
        }
        Relationships: []
      }
      user_business_access: {
        Row: {
          business_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_business_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_custom_roles: {
        Row: {
          assigned_at: string
          custom_role_id: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          custom_role_id: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          custom_role_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_custom_roles_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          permission: Database["public"]["Enums"]["app_permission"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted?: boolean
          id?: string
          permission: Database["public"]["Enums"]["app_permission"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_store_access: {
        Row: {
          created_at: string
          id: string
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_store_access_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_store_access_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string | null
          delivery_id: string | null
          entity_type: string | null
          error: string | null
          id: string
          payload_size: number | null
          status_code: number | null
          store_id: string | null
          topic: string | null
          woo_id: number | null
        }
        Insert: {
          created_at?: string | null
          delivery_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: string
          payload_size?: number | null
          status_code?: number | null
          store_id?: string | null
          topic?: string | null
          woo_id?: number | null
        }
        Update: {
          created_at?: string | null
          delivery_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: string
          payload_size?: number | null
          status_code?: number | null
          store_id?: string | null
          topic?: string | null
          woo_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_safe"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pathao_integrations_safe: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      stores_safe: {
        Row: {
          created_at: string | null
          id: string | null
          last_synced_at: string | null
          name: string | null
          status: string | null
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          last_synced_at?: string | null
          name?: string | null
          status?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          last_synced_at?: string | null
          name?: string | null
          status?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      sync_health: {
        Row: {
          breaker_detail: Json | null
          courier_tracking: Json | null
          oldest_pending_seconds: number | null
          pending_waiting_retry: number | null
          queue_dead_letter: number | null
          queue_failed: number | null
          queue_pending: number | null
          queue_processing: number | null
          stores_breaker_tripped: number | null
          stores_sync: Json | null
          webhooks_failed_last_hour: number | null
          webhooks_last_hour: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      bump_store_sync_failure: {
        Args: { p_store_id: string }
        Returns: undefined
      }
      claim_sync_queue_batch: {
        Args: { p_limit: number }
        Returns: {
          action: string
          attempts: number
          created_at: string | null
          error_log: string | null
          id: string
          idempotency_key: string | null
          next_retry_at: string | null
          order_id: string | null
          payload: Json | null
          status: string
          store_id: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sync_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_order_push: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      format_order_number: {
        Args: { p_base: string; p_source: string; p_store_id: string }
        Returns: string
      }
      generate_pos_order_number: {
        Args: { p_source?: string; p_store_id?: string }
        Returns: string
      }
      get_sync_alert_webhook_url: { Args: never; Returns: string }
      get_sync_worker_cron_token: { Args: never; Returns: string }
      get_user_permissions: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_permission"][]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_store_ids: { Args: { _user_id: string }; Returns: string[] }
      get_woo_sync_cron_token: { Args: never; Returns: string }
      has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["app_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_business_member: { Args: { p_business_id: string }; Returns: boolean }
      merge_duplicate_customers: {
        Args: never
        Returns: {
          deleted_count: number
          kept_id: string
          merged_phone: string
        }[]
      }
      normalize_bd_phone: { Args: { _phone: string }; Returns: string }
      purge_trashed_orders: { Args: never; Returns: undefined }
      recon_multi_business: { Args: never; Returns: Json }
      recover_orphaned_sync_rows: {
        Args: { p_stale_before: string }
        Returns: number
      }
      reset_store_circuit_breaker: {
        Args: { p_store_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_has_store_access: {
        Args: { _store_id: string; _user_id: string }
        Returns: boolean
      }
      verify_multi_business_foundation: { Args: never; Returns: Json }
    }
    Enums: {
      app_permission:
        | "dashboard.view"
        | "orders.view"
        | "orders.create"
        | "orders.edit"
        | "orders.delete"
        | "orders.change_status"
        | "orders.dispatch"
        | "orders.refund"
        | "orders.log_payment"
        | "orders.discount_large"
        | "preorders.view"
        | "preorders.manage"
        | "customers.view"
        | "customers.edit"
        | "customers.delete"
        | "products.view"
        | "products.create"
        | "products.edit"
        | "products.delete"
        | "products.view_cost"
        | "products.edit_cost"
        | "pos.use"
        | "pos.discount_large"
        | "pos.refund"
        | "pos.shift_close"
        | "analytics.view"
        | "analytics.view_revenue"
        | "integrations.view"
        | "integrations.manage"
        | "stores.view"
        | "stores.manage"
        | "settings.view"
        | "settings.manage"
        | "team.view"
        | "team.manage"
        | "audit.view"
        | "orders.attach_courier"
      app_role: "admin" | "staff" | "viewer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_permission: [
        "dashboard.view",
        "orders.view",
        "orders.create",
        "orders.edit",
        "orders.delete",
        "orders.change_status",
        "orders.dispatch",
        "orders.refund",
        "orders.log_payment",
        "orders.discount_large",
        "preorders.view",
        "preorders.manage",
        "customers.view",
        "customers.edit",
        "customers.delete",
        "products.view",
        "products.create",
        "products.edit",
        "products.delete",
        "products.view_cost",
        "products.edit_cost",
        "pos.use",
        "pos.discount_large",
        "pos.refund",
        "pos.shift_close",
        "analytics.view",
        "analytics.view_revenue",
        "integrations.view",
        "integrations.manage",
        "stores.view",
        "stores.manage",
        "settings.view",
        "settings.manage",
        "team.view",
        "team.manage",
        "audit.view",
        "orders.attach_courier",
      ],
      app_role: ["admin", "staff", "viewer"],
    },
  },
} as const
