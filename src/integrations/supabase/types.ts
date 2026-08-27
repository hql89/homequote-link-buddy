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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          connection_type: string | null
          created_at: string
          event_name: string | null
          event_type: string
          gclid: string | null
          id: string
          ip_address: string | null
          is_touch_device: boolean | null
          language: string | null
          metadata: Json | null
          page_path: string | null
          page_title: string | null
          page_url: string | null
          referrer: string | null
          screen_height: number | null
          screen_width: number | null
          session_id: string | null
          timezone: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          visitor_id: string | null
        }
        Insert: {
          connection_type?: string | null
          created_at?: string
          event_name?: string | null
          event_type: string
          gclid?: string | null
          id?: string
          ip_address?: string | null
          is_touch_device?: boolean | null
          language?: string | null
          metadata?: Json | null
          page_path?: string | null
          page_title?: string | null
          page_url?: string | null
          referrer?: string | null
          screen_height?: number | null
          screen_width?: number | null
          session_id?: string | null
          timezone?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Update: {
          connection_type?: string | null
          created_at?: string
          event_name?: string | null
          event_type?: string
          gclid?: string | null
          id?: string
          ip_address?: string | null
          is_touch_device?: boolean | null
          language?: string | null
          metadata?: Json | null
          page_path?: string | null
          page_title?: string | null
          page_url?: string | null
          referrer?: string | null
          screen_height?: number | null
          screen_width?: number | null
          session_id?: string | null
          timezone?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      blocked_emails: {
        Row: {
          created_at: string
          email_normalized: string
          id: string
          source_lead_id: string | null
        }
        Insert: {
          created_at?: string
          email_normalized: string
          id?: string
          source_lead_id?: string | null
        }
        Update: {
          created_at?: string
          email_normalized?: string
          id?: string
          source_lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_emails_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_phones: {
        Row: {
          created_at: string
          id: string
          phone_normalized: string
          source_lead_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          phone_normalized: string
          source_lead_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          phone_normalized?: string
          source_lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_phones_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      business_photos: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          business_id: string
          caption: string | null
          created_at: string
          id: string
          sort_order: number
          status: string
          storage_path: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_id: string
          caption?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          status?: string
          storage_path: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          status?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_photos_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_photos_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "public_business_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          business_name: string
          city: string
          city_slug: string
          claim_token: string
          claimed_at: string | null
          classification: string | null
          created_at: string
          email: string | null
          email_confidence: string | null
          email_review_assessed_at: string | null
          email_review_notes: string | null
          email_review_verdict: string | null
          email_source_address: string | null
          email_source_phone: string | null
          email_source_url: string | null
          email_undeliverable_at: string | null
          enriched_at: string | null
          featured_until: string | null
          id: string
          is_claimed: boolean
          is_published: boolean
          license_expires_at: string | null
          license_number: string | null
          license_status: string | null
          listing_tier: string
          outreach_bounce_kind: string | null
          outreach_bounced_at: string | null
          outreach_email_1_sent_at: string | null
          outreach_email_2_sent_at: string | null
          outreach_paused: boolean
          outreach_suppressed_at: string | null
          owner_name: string | null
          phone: string | null
          scraped_context: string | null
          services: Json
          slug: string
          source: string
          updated_at: string
          vertical_slug: string | null
          website_url: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_name: string
          city: string
          city_slug: string
          claim_token?: string
          claimed_at?: string | null
          classification?: string | null
          created_at?: string
          email?: string | null
          email_confidence?: string | null
          email_review_assessed_at?: string | null
          email_review_notes?: string | null
          email_review_verdict?: string | null
          email_source_address?: string | null
          email_source_phone?: string | null
          email_source_url?: string | null
          email_undeliverable_at?: string | null
          enriched_at?: string | null
          featured_until?: string | null
          id?: string
          is_claimed?: boolean
          is_published?: boolean
          license_expires_at?: string | null
          license_number?: string | null
          license_status?: string | null
          listing_tier?: string
          outreach_bounce_kind?: string | null
          outreach_bounced_at?: string | null
          outreach_email_1_sent_at?: string | null
          outreach_email_2_sent_at?: string | null
          outreach_paused?: boolean
          outreach_suppressed_at?: string | null
          owner_name?: string | null
          phone?: string | null
          scraped_context?: string | null
          services?: Json
          slug: string
          source?: string
          updated_at?: string
          vertical_slug?: string | null
          website_url?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_name?: string
          city?: string
          city_slug?: string
          claim_token?: string
          claimed_at?: string | null
          classification?: string | null
          created_at?: string
          email?: string | null
          email_confidence?: string | null
          email_review_assessed_at?: string | null
          email_review_notes?: string | null
          email_review_verdict?: string | null
          email_source_address?: string | null
          email_source_phone?: string | null
          email_source_url?: string | null
          email_undeliverable_at?: string | null
          enriched_at?: string | null
          featured_until?: string | null
          id?: string
          is_claimed?: boolean
          is_published?: boolean
          license_expires_at?: string | null
          license_number?: string | null
          license_status?: string | null
          listing_tier?: string
          outreach_bounce_kind?: string | null
          outreach_bounced_at?: string | null
          outreach_email_1_sent_at?: string | null
          outreach_email_2_sent_at?: string | null
          outreach_paused?: boolean
          outreach_suppressed_at?: string | null
          owner_name?: string | null
          phone?: string | null
          scraped_context?: string | null
          services?: Json
          slug?: string
          source?: string
          updated_at?: string
          vertical_slug?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_vertical_slug_fkey"
            columns: ["vertical_slug"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["slug"]
          },
        ]
      }
      buyer_profiles: {
        Row: {
          ai_enriched_data: Json | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          buyer_id: string | null
          company_description: string | null
          created_at: string | null
          id: string
          license_number: string | null
          logo_url: string | null
          updated_at: string | null
          user_id: string
          website: string | null
          years_in_business: number | null
        }
        Insert: {
          ai_enriched_data?: Json | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          buyer_id?: string | null
          company_description?: string | null
          created_at?: string | null
          id?: string
          license_number?: string | null
          logo_url?: string | null
          updated_at?: string | null
          user_id: string
          website?: string | null
          years_in_business?: number | null
        }
        Update: {
          ai_enriched_data?: Json | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          buyer_id?: string | null
          company_description?: string | null
          created_at?: string | null
          id?: string
          license_number?: string | null
          logo_url?: string | null
          updated_at?: string | null
          user_id?: string
          website?: string | null
          years_in_business?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "buyer_profiles_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: true
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      buyers: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          business_name: string
          contact_name: string
          created_at: string
          daily_lead_cap: number | null
          email: string
          id: string
          is_active: boolean
          notes: string | null
          phone: string
          service_areas: string[] | null
          supported_service_types: string[] | null
          updated_at: string
          vertical: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_name: string
          contact_name: string
          created_at?: string
          daily_lead_cap?: number | null
          email: string
          id?: string
          is_active?: boolean
          notes?: string | null
          phone: string
          service_areas?: string[] | null
          supported_service_types?: string[] | null
          updated_at?: string
          vertical?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_name?: string
          contact_name?: string
          created_at?: string
          daily_lead_cap?: number | null
          email?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          phone?: string
          service_areas?: string[] | null
          supported_service_types?: string[] | null
          updated_at?: string
          vertical?: string
        }
        Relationships: []
      }
      data_audit_log: {
        Row: {
          action: string
          actor_context: string
          actor_user_id: string | null
          id: string
          occurred_at: string
          reason: string | null
          row_id: string
          row_snapshot: Json
          table_name: string
        }
        Insert: {
          action: string
          actor_context?: string
          actor_user_id?: string | null
          id?: string
          occurred_at?: string
          reason?: string | null
          row_id: string
          row_snapshot: Json
          table_name: string
        }
        Update: {
          action?: string
          actor_context?: string
          actor_user_id?: string | null
          id?: string
          occurred_at?: string
          reason?: string | null
          row_id?: string
          row_snapshot?: Json
          table_name?: string
        }
        Relationships: []
      }
      directory_leads: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          business_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          ip_address: string | null
          message: string | null
          notified_at: string | null
          notify_error: string | null
          notify_skipped_reason: string | null
          phone: string
          preferred_time: string | null
          source: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          ip_address?: string | null
          message?: string | null
          notified_at?: string | null
          notify_error?: string | null
          notify_skipped_reason?: string | null
          phone: string
          preferred_time?: string | null
          source?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          ip_address?: string | null
          message?: string | null
          notified_at?: string | null
          notify_error?: string | null
          notify_skipped_reason?: string | null
          phone?: string
          preferred_time?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "public_business_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      email_canary_probes: {
        Row: {
          alarm_raised_at: string | null
          confirmed_at: string | null
          id: string
          send_error: string | null
          send_status: string
          sent_at: string
        }
        Insert: {
          alarm_raised_at?: string | null
          confirmed_at?: string | null
          id?: string
          send_error?: string | null
          send_status: string
          sent_at?: string
        }
        Update: {
          alarm_raised_at?: string | null
          confirmed_at?: string | null
          id?: string
          send_error?: string | null
          send_status?: string
          sent_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          body: string | null
          bounce_kind: string | null
          bounced_at: string | null
          email_type: string
          error_message: string | null
          id: string
          job_name: string
          method: string | null
          recipient_email: string
          recipient_kind: string | null
          related_business_id: string | null
          related_lead_id: string | null
          sent_at: string
          status: string
          subject: string | null
        }
        Insert: {
          body?: string | null
          bounce_kind?: string | null
          bounced_at?: string | null
          email_type: string
          error_message?: string | null
          id?: string
          job_name: string
          method?: string | null
          recipient_email: string
          recipient_kind?: string | null
          related_business_id?: string | null
          related_lead_id?: string | null
          sent_at?: string
          status: string
          subject?: string | null
        }
        Update: {
          body?: string | null
          bounce_kind?: string | null
          bounced_at?: string | null
          email_type?: string
          error_message?: string | null
          id?: string
          job_name?: string
          method?: string | null
          recipient_email?: string
          recipient_kind?: string | null
          related_business_id?: string | null
          related_lead_id?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      homeowner_profiles: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          linked_lead_ids: string[] | null
          phone: string | null
          user_id: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id?: string
          linked_lead_ids?: string[] | null
          phone?: string | null
          user_id: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          linked_lead_ids?: string[] | null
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ignored_senders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          match_type: string
          note: string | null
          pattern: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          match_type: string
          note?: string | null
          pattern: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          match_type?: string
          note?: string | null
          pattern?: string
        }
        Relationships: []
      }
      inbound_emails: {
        Row: {
          body_text: string | null
          business_id: string | null
          classification: string
          extracted_url: string | null
          from_email: string
          from_name: string | null
          handled_at: string | null
          id: string
          is_priority: boolean
          message_id: string
          received_at: string
          subject: string | null
        }
        Insert: {
          body_text?: string | null
          business_id?: string | null
          classification?: string
          extracted_url?: string | null
          from_email: string
          from_name?: string | null
          handled_at?: string | null
          id?: string
          is_priority?: boolean
          message_id: string
          received_at?: string
          subject?: string | null
        }
        Update: {
          body_text?: string | null
          business_id?: string | null
          classification?: string
          extracted_url?: string | null
          from_email?: string
          from_name?: string | null
          handled_at?: string | null
          id?: string
          is_priority?: boolean
          message_id?: string
          received_at?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_emails_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_emails_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "public_business_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_queue: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          business_id: string | null
          business_name: string
          city: string | null
          classification: string | null
          created_at: string
          id: string
          license_number: string | null
          phone: string | null
          processed_at: string | null
          raw: Json
          skip_reason: string | null
          source: string
          status: string
          vertical_slug: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_id?: string | null
          business_name: string
          city?: string | null
          classification?: string | null
          created_at?: string
          id?: string
          license_number?: string | null
          phone?: string | null
          processed_at?: string | null
          raw?: Json
          skip_reason?: string | null
          source?: string
          status?: string
          vertical_slug?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          business_id?: string | null
          business_name?: string
          city?: string | null
          classification?: string | null
          created_at?: string
          id?: string
          license_number?: string | null
          phone?: string | null
          processed_at?: string | null
          raw?: Json
          skip_reason?: string | null
          source?: string
          status?: string
          vertical_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingest_queue_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_queue_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "public_business_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_run_logs: {
        Row: {
          attempts: number
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          job_name: string
          metadata: Json
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name: string
          metadata?: Json
          status: string
        }
        Update: {
          attempts?: number
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name?: string
          metadata?: Json
          status?: string
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          event_detail: string | null
          event_type: string
          id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          event_detail?: string | null
          event_type: string
          id?: string
          lead_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          event_detail?: string | null
          event_type?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_feedback: {
        Row: {
          created_at: string
          hired_plumber: boolean | null
          id: string
          lead_id: string
          rating: number | null
          review_text: string | null
          submitted_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          hired_plumber?: boolean | null
          id?: string
          lead_id: string
          rating?: number | null
          review_text?: string | null
          submitted_at?: string | null
          token: string
        }
        Update: {
          created_at?: string
          hired_plumber?: boolean | null
          id?: string
          lead_id?: string
          rating?: number | null
          review_text?: string | null
          submitted_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_feedback_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_nurture_emails: {
        Row: {
          created_at: string
          email_type: string
          id: string
          lead_id: string
          scheduled_at: string
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email_type: string
          id?: string
          lead_id: string
          scheduled_at: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email_type?: string
          id?: string
          lead_id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_nurture_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ai_authenticity_reason: string | null
          ai_authenticity_score: number | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          assigned_buyer_id: string | null
          city: string | null
          consent_to_contact: boolean
          created_at: string
          description: string | null
          duplicate_flag: boolean
          email: string | null
          email_normalized: string | null
          full_name: string | null
          gclid: string | null
          id: string
          is_test: boolean
          landing_page: string | null
          lead_score: number | null
          notes: string | null
          phone: string
          phone_normalized: string | null
          preferred_contact_method: string
          referrer: string | null
          review_reason: string | null
          service_type: string | null
          source: string | null
          spam_flag: boolean
          status: string
          updated_at: string
          urgency: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          vertical: string
          zip_code: string | null
        }
        Insert: {
          ai_authenticity_reason?: string | null
          ai_authenticity_score?: number | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_buyer_id?: string | null
          city?: string | null
          consent_to_contact?: boolean
          created_at?: string
          description?: string | null
          duplicate_flag?: boolean
          email?: string | null
          email_normalized?: string | null
          full_name?: string | null
          gclid?: string | null
          id?: string
          is_test?: boolean
          landing_page?: string | null
          lead_score?: number | null
          notes?: string | null
          phone: string
          phone_normalized?: string | null
          preferred_contact_method?: string
          referrer?: string | null
          review_reason?: string | null
          service_type?: string | null
          source?: string | null
          spam_flag?: boolean
          status?: string
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          vertical?: string
          zip_code?: string | null
        }
        Update: {
          ai_authenticity_reason?: string | null
          ai_authenticity_score?: number | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_buyer_id?: string | null
          city?: string | null
          consent_to_contact?: boolean
          created_at?: string
          description?: string | null
          duplicate_flag?: boolean
          email?: string | null
          email_normalized?: string | null
          full_name?: string | null
          gclid?: string | null
          id?: string
          is_test?: boolean
          landing_page?: string | null
          lead_score?: number | null
          notes?: string | null
          phone?: string
          phone_normalized?: string | null
          preferred_contact_method?: string
          referrer?: string | null
          review_reason?: string | null
          service_type?: string | null
          source?: string | null
          spam_flag?: boolean
          status?: string
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          vertical?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_buyer_id_fkey"
            columns: ["assigned_buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          thumbnail_url: string | null
          title: string | null
          type: string
          url: string
        }
        Insert: {
          alt_text?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          thumbnail_url?: string | null
          title?: string | null
          type?: string
          url: string
        }
        Update: {
          alt_text?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          thumbnail_url?: string | null
          title?: string | null
          type?: string
          url?: string
        }
        Relationships: []
      }
      outreach_sends: {
        Row: {
          business_id: string | null
          email_type: string
          id: string
          sent_at: string
          variant_key: string
        }
        Insert: {
          business_id?: string | null
          email_type: string
          id?: string
          sent_at?: string
          variant_key: string
        }
        Update: {
          business_id?: string | null
          email_type?: string
          id?: string
          sent_at?: string
          variant_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_sends_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_sends_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "public_business_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_template_variants: {
        Row: {
          body: string
          created_at: string
          email_type: string
          id: string
          is_active: boolean
          subject: string
          updated_at: string
          variant_key: string
          weight: number
        }
        Insert: {
          body: string
          created_at?: string
          email_type: string
          id?: string
          is_active?: boolean
          subject: string
          updated_at?: string
          variant_key: string
          weight?: number
        }
        Update: {
          body?: string
          created_at?: string
          email_type?: string
          id?: string
          is_active?: boolean
          subject?: string
          updated_at?: string
          variant_key?: string
          weight?: number
        }
        Relationships: []
      }
      post_metrics: {
        Row: {
          id: number
          ip_hash: string | null
          post_id: string | null
          referrer: string | null
          session_id: string | null
          user_agent: string | null
          viewed_at: string | null
        }
        Insert: {
          id?: never
          ip_hash?: string | null
          post_id?: string | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
          viewed_at?: string | null
        }
        Update: {
          id?: never
          ip_hash?: string | null
          post_id?: string | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_metrics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_versions: {
        Row: {
          category: string | null
          content: string
          created_at: string
          excerpt: string | null
          featured_image_url: string | null
          id: string
          post_id: string
          saved_by: string | null
          tags: string[] | null
          title: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          excerpt?: string | null
          featured_image_url?: string | null
          id?: string
          post_id: string
          saved_by?: string | null
          tags?: string[] | null
          title: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          excerpt?: string | null
          featured_image_url?: string | null
          id?: string
          post_id?: string
          saved_by?: string | null
          tags?: string[] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_versions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          canonical_url: string | null
          category: string | null
          content: string
          created_at: string | null
          excerpt: string | null
          external_id: string | null
          featured_image_url: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          og_image_height: number | null
          og_image_width: number | null
          published_at: string | null
          scheduled_at: string | null
          slug: string
          source: string
          status: string
          tags: string[] | null
          title: string
          twitter_card_type: string | null
          updated_at: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          canonical_url?: string | null
          category?: string | null
          content: string
          created_at?: string | null
          excerpt?: string | null
          external_id?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          og_image_height?: number | null
          og_image_width?: number | null
          published_at?: string | null
          scheduled_at?: string | null
          slug: string
          source?: string
          status?: string
          tags?: string[] | null
          title: string
          twitter_card_type?: string | null
          updated_at?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          canonical_url?: string | null
          category?: string | null
          content?: string
          created_at?: string | null
          excerpt?: string | null
          external_id?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          og_image_height?: number | null
          og_image_width?: number | null
          published_at?: string | null
          scheduled_at?: string | null
          slug?: string
          source?: string
          status?: string
          tags?: string[] | null
          title?: string
          twitter_card_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          buyer_id: string | null
          buyer_responded_at: string | null
          buyer_response: string | null
          created_at: string | null
          id: string
          is_verified: boolean | null
          lead_id: string | null
          rating: number
          review_text: string | null
          reviewer_user_id: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          buyer_id?: string | null
          buyer_responded_at?: string | null
          buyer_response?: string | null
          created_at?: string | null
          id?: string
          is_verified?: boolean | null
          lead_id?: string | null
          rating: number
          review_text?: string | null
          reviewer_user_id: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          buyer_id?: string | null
          buyer_responded_at?: string | null
          buyer_response?: string | null
          created_at?: string | null
          id?: string
          is_verified?: boolean | null
          lead_id?: string | null
          rating?: number
          review_text?: string | null
          reviewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_settings: {
        Row: {
          after_hours_behavior: string | null
          business_hours: Json | null
          buyer_id: string
          city: string
          created_at: string
          id: string
          is_active: boolean
          max_daily_leads: number | null
          service_type: string
          updated_at: string
          vertical: string
        }
        Insert: {
          after_hours_behavior?: string | null
          business_hours?: Json | null
          buyer_id: string
          city: string
          created_at?: string
          id?: string
          is_active?: boolean
          max_daily_leads?: number | null
          service_type: string
          updated_at?: string
          vertical?: string
        }
        Update: {
          after_hours_behavior?: string | null
          business_hours?: Json | null
          buyer_id?: string
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          max_daily_leads?: number | null
          service_type?: string
          updated_at?: string
          vertical?: string
        }
        Relationships: [
          {
            foreignKeyName: "routing_settings_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      spam_events: {
        Row: {
          created_at: string
          email: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          phone?: string | null
        }
        Relationships: []
      }
      verticals: {
        Row: {
          created_at: string
          hero_description: string | null
          hero_title: string | null
          icon_name: string | null
          id: string
          is_active: boolean
          label: string
          meta_description: string | null
          meta_title: string | null
          professional_label: string
          professional_label_plural: string
          service_types: string[]
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          hero_description?: string | null
          hero_title?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean
          label: string
          meta_description?: string | null
          meta_title?: string | null
          professional_label?: string
          professional_label_plural?: string
          service_types?: string[]
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          hero_description?: string | null
          hero_title?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean
          label?: string
          meta_description?: string | null
          meta_title?: string | null
          professional_label?: string
          professional_label_plural?: string
          service_types?: string[]
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_business_listings: {
        Row: {
          business_name: string | null
          city: string | null
          city_slug: string | null
          created_at: string | null
          id: string | null
          is_claimed: boolean | null
          listing_tier: string | null
          owner_name: string | null
          phone: string | null
          scraped_context: string | null
          services: Json | null
          slug: string | null
          tier_rank: number | null
          vertical_slug: string | null
          website_url: string | null
        }
        Insert: {
          business_name?: string | null
          city?: string | null
          city_slug?: string | null
          created_at?: string | null
          id?: string | null
          is_claimed?: boolean | null
          listing_tier?: never
          owner_name?: string | null
          phone?: string | null
          scraped_context?: string | null
          services?: Json | null
          slug?: string | null
          tier_rank?: never
          vertical_slug?: string | null
          website_url?: string | null
        }
        Update: {
          business_name?: string | null
          city?: string | null
          city_slug?: string | null
          created_at?: string | null
          id?: string | null
          is_claimed?: boolean | null
          listing_tier?: never
          owner_name?: string | null
          phone?: string | null
          scraped_context?: string | null
          services?: Json | null
          slug?: string | null
          tier_rank?: never
          vertical_slug?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_vertical_slug_fkey"
            columns: ["vertical_slug"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["slug"]
          },
        ]
      }
      public_directory_cities: {
        Row: {
          city: string | null
          city_slug: string | null
          listing_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_ignored_sender_internal: {
        Args: { p_match_type: string; p_note?: string; p_pattern: string }
        Returns: number
      }
      admin_add_ignored_sender: {
        Args: { p_match_type: string; p_note?: string; p_pattern: string }
        Returns: number
      }
      admin_archive_row: {
        Args: { p_id: string; p_reason?: string; p_table: string }
        Returns: Json
      }
      admin_archived_summary: {
        Args: never
        Returns: {
          archived_count: number
          table_name: string
        }[]
      }
      admin_database_diagnostics: { Args: never; Returns: Json }
      admin_list_archived: {
        Args: { p_limit?: number; p_offset?: number; p_table: string }
        Returns: {
          archive_reason: string
          archived_at: string
          archived_by: string
          id: string
          label: string
          row_data: Json
        }[]
      }
      admin_list_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          command: string
          jobid: number
          jobname: string
          schedule: string
        }[]
      }
      admin_outreach_variant_stats: {
        Args: never
        Returns: {
          claimed_count: number
          email_type: string
          last_sent_at: string
          replied_count: number
          sent_count: number
          variant_key: string
        }[]
      }
      admin_prune_internal_job_logs: { Args: never; Returns: Json }
      admin_purge_archived: {
        Args: { p_archived_before: string; p_limit?: number; p_table: string }
        Returns: Json
      }
      admin_purge_by_ids: {
        Args: { p_ids: string[]; p_table: string }
        Returns: Json
      }
      admin_purgeable_refs: {
        Args: { p_before: string; p_limit?: number; p_table: string }
        Returns: {
          id: string
          storage_refs: string[]
        }[]
      }
      admin_recent_alarms: {
        Args: { p_since?: string }
        Returns: {
          created_at: string
          error_message: string
          id: string
          metadata: Json
        }[]
      }
      admin_recent_job_runs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          duration_ms: number
          error_message: string
          id: string
          job_name: string
          metadata: Json
          status: string
        }[]
      }
      admin_remove_ignored_sender: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_restore_row: {
        Args: { p_id: string; p_table: string }
        Returns: Json
      }
      admin_toggle_cron_job: {
        Args: { p_enable: boolean; p_jobname: string }
        Returns: Json
      }
      archivable_tables: { Args: never; Returns: string[] }
      is_admin: { Args: never; Returns: boolean }
      purge_analytics_by_ip_or_visitor: {
        Args: { p_ip?: string; p_visitor_id?: string }
        Returns: number
      }
      run_enrich_business_email: { Args: never; Returns: number }
      sender_matches_pattern: {
        Args: { p_email: string; p_match_type: string; p_pattern: string }
        Returns: boolean
      }
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
