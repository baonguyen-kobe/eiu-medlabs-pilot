export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      acquisition_record_lines: {
        Row: {
          acquisition_record_id: string
          catalog_item_id: string
          country_of_origin: string | null
          created_at: string
          currency_code: string | null
          expected_conversion_factor: number | null
          expected_purchase_quantity: number
          id: string
          line_key: string
          manufacturer: string | null
          model: string | null
          notes: string | null
          purchase_uom_code: string
          unit_cost: number | null
          updated_at: string
          warranty_end: string | null
          warranty_start: string | null
        }
        Insert: {
          acquisition_record_id: string
          catalog_item_id: string
          country_of_origin?: string | null
          created_at?: string
          currency_code?: string | null
          expected_conversion_factor?: number | null
          expected_purchase_quantity: number
          id?: string
          line_key: string
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          purchase_uom_code: string
          unit_cost?: number | null
          updated_at?: string
          warranty_end?: string | null
          warranty_start?: string | null
        }
        Update: {
          acquisition_record_id?: string
          catalog_item_id?: string
          country_of_origin?: string | null
          created_at?: string
          currency_code?: string | null
          expected_conversion_factor?: number | null
          expected_purchase_quantity?: number
          id?: string
          line_key?: string
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          purchase_uom_code?: string
          unit_cost?: number | null
          updated_at?: string
          warranty_end?: string | null
          warranty_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_record_lines_acquisition_record_id_fkey"
            columns: ["acquisition_record_id"]
            isOneToOne: false
            referencedRelation: "acquisition_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquisition_record_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquisition_record_lines_purchase_uom_code_fkey"
            columns: ["purchase_uom_code"]
            isOneToOne: false
            referencedRelation: "inventory_uoms"
            referencedColumns: ["code"]
          },
        ]
      }
      acquisition_records: {
        Row: {
          created_at: string
          external_reference: string | null
          funding_source: string | null
          id: string
          notes: string | null
          reference_date: string
          revision: number
          source_reference: string
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_reference?: string | null
          funding_source?: string | null
          id?: string
          notes?: string | null
          reference_date: string
          revision?: number
          source_reference: string
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_reference?: string | null
          funding_source?: string | null
          id?: string
          notes?: string | null
          reference_date?: string
          revision?: number
          source_reference?: string
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_records_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "inventory_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          new_data: Json | null
          old_data: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          new_data?: Json | null
          old_data?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          new_data?: Json | null
          old_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_medical_equipment_catalog: {
        Row: {
          commercial_name: string
          country_of_origin: string | null
          created_at: string
          id: string
          is_active: boolean
          item_name: string
          item_type: string | null
          manufacturer: string | null
          model: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          commercial_name: string
          country_of_origin?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          item_name: string
          item_type?: string | null
          manufacturer?: string | null
          model?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          commercial_name?: string
          country_of_origin?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          item_name?: string
          item_type?: string | null
          manufacturer?: string | null
          model?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      basic_medical_equipment_condition_logs: {
        Row: {
          actor_id: string
          catalog_item_id_snapshot: string | null
          commercial_name_snapshot: string | null
          confirmation_id: string | null
          created_at: string
          damaged_after: number
          damaged_before: number
          event_type: string
          good_after: number
          good_before: number
          id: string
          inventory_id: string
          item_name_snapshot: string | null
          note: string | null
          quantity_delta: number
          total_after: number
          total_before: number
          unit_snapshot: string | null
        }
        Insert: {
          actor_id: string
          catalog_item_id_snapshot?: string | null
          commercial_name_snapshot?: string | null
          confirmation_id?: string | null
          created_at?: string
          damaged_after: number
          damaged_before: number
          event_type: string
          good_after: number
          good_before: number
          id?: string
          inventory_id: string
          item_name_snapshot?: string | null
          note?: string | null
          quantity_delta?: number
          total_after: number
          total_before: number
          unit_snapshot?: string | null
        }
        Update: {
          actor_id?: string
          catalog_item_id_snapshot?: string | null
          commercial_name_snapshot?: string | null
          confirmation_id?: string | null
          created_at?: string
          damaged_after?: number
          damaged_before?: number
          event_type?: string
          good_after?: number
          good_before?: number
          id?: string
          inventory_id?: string
          item_name_snapshot?: string | null
          note?: string | null
          quantity_delta?: number
          total_after?: number
          total_before?: number
          unit_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_equipment_condition_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_equipment_condition_logs_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_session_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_equipment_condition_logs_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_room_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_medical_registration_sessions: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_schedule_id: string
          id: string
          lesson_title: string
          registration_id: string
          session_number: number
          teaching_lecturer_id: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_schedule_id: string
          id?: string
          lesson_title: string
          registration_id: string
          session_number: number
          teaching_lecturer_id: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_schedule_id?: string
          id?: string
          lesson_title?: string
          registration_id?: string
          session_number?: number
          teaching_lecturer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_registration_sessions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registration_sessions_class_schedule_id_fkey"
            columns: ["class_schedule_id"]
            isOneToOne: true
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registration_sessions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registration_completion"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "basic_medical_registration_sessions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registration_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registration_sessions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registration_sessions_teaching_lecturer_id_fkey"
            columns: ["teaching_lecturer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_medical_registrations: {
        Row: {
          academic_year: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          course_id: string
          created_at: string
          created_by: string
          end_date: string
          id: string
          note: string | null
          registrant_id: string
          registration_code: string
          responsible_lecturer_id: string
          room_id: string
          semester: string
          start_date: string
          student_count: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          course_id: string
          created_at?: string
          created_by: string
          end_date: string
          id?: string
          note?: string | null
          registrant_id: string
          registration_code?: string
          responsible_lecturer_id: string
          room_id: string
          semester: string
          start_date: string
          student_count: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          course_id?: string
          created_at?: string
          created_by?: string
          end_date?: string
          id?: string
          note?: string | null
          registrant_id?: string
          registration_code?: string
          responsible_lecturer_id?: string
          room_id?: string
          semester?: string
          start_date?: string
          student_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_registrations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registrations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registrations_registrant_id_fkey"
            columns: ["registrant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registrations_responsible_lecturer_id_fkey"
            columns: ["responsible_lecturer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_registrations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_medical_room_inventory: {
        Row: {
          catalog_item_id: string
          created_at: string
          damaged_quantity: number
          good_quantity: number
          id: string
          is_active: boolean
          last_damage_reported_at: string | null
          last_damage_reporter_id: string | null
          room_id: string
          total_quantity: number
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          damaged_quantity?: number
          good_quantity?: number
          id?: string
          is_active?: boolean
          last_damage_reported_at?: string | null
          last_damage_reporter_id?: string | null
          room_id: string
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          damaged_quantity?: number
          good_quantity?: number
          id?: string
          is_active?: boolean
          last_damage_reported_at?: string | null
          last_damage_reporter_id?: string | null
          room_id?: string
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_room_inventory_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_equipment_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_room_inventory_last_damage_reporter_id_fkey"
            columns: ["last_damage_reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_room_inventory_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_medical_session_confirmations: {
        Row: {
          building_code_snapshot: string | null
          class_schedule_id_snapshot: string
          course_code_snapshot: string | null
          course_name_snapshot: string | null
          created_at: string
          end_time_snapshot: string
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidated_by_name_snapshot: string | null
          invalidated_reason: string | null
          registration_id_snapshot: string
          room_code_snapshot: string | null
          room_id_snapshot: string
          room_name_snapshot: string | null
          schedule_date_snapshot: string
          session_id: string | null
          signature_data: string
          signed_at: string
          signer_id: string
          signer_name_snapshot: string | null
          start_time_snapshot: string
          teaching_lecturer_id_snapshot: string
          teaching_lecturer_name_snapshot: string | null
        }
        Insert: {
          building_code_snapshot?: string | null
          class_schedule_id_snapshot: string
          course_code_snapshot?: string | null
          course_name_snapshot?: string | null
          created_at?: string
          end_time_snapshot: string
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidated_by_name_snapshot?: string | null
          invalidated_reason?: string | null
          registration_id_snapshot: string
          room_code_snapshot?: string | null
          room_id_snapshot: string
          room_name_snapshot?: string | null
          schedule_date_snapshot: string
          session_id?: string | null
          signature_data: string
          signed_at?: string
          signer_id: string
          signer_name_snapshot?: string | null
          start_time_snapshot: string
          teaching_lecturer_id_snapshot: string
          teaching_lecturer_name_snapshot?: string | null
        }
        Update: {
          building_code_snapshot?: string | null
          class_schedule_id_snapshot?: string
          course_code_snapshot?: string | null
          course_name_snapshot?: string | null
          created_at?: string
          end_time_snapshot?: string
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidated_by_name_snapshot?: string | null
          invalidated_reason?: string | null
          registration_id_snapshot?: string
          room_code_snapshot?: string | null
          room_id_snapshot?: string
          room_name_snapshot?: string | null
          schedule_date_snapshot?: string
          session_id?: string | null
          signature_data?: string
          signed_at?: string
          signer_id?: string
          signer_name_snapshot?: string | null
          start_time_snapshot?: string
          teaching_lecturer_id_snapshot?: string
          teaching_lecturer_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_session_confirm_teaching_lecturer_id_snapsho_fkey"
            columns: ["teaching_lecturer_id_snapshot"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_session_confirmations_invalidated_by_fkey"
            columns: ["invalidated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_session_confirmations_room_id_snapshot_fkey"
            columns: ["room_id_snapshot"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_session_confirmations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registration_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_session_confirmations_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_medical_session_equipment_checks: {
        Row: {
          commercial_name_snapshot: string | null
          confirmation_id: string
          created_at: string
          damaged_after: number
          damaged_before: number
          good_after: number
          good_before: number
          id: string
          inventory_id: string
          item_name_snapshot: string
          newly_damaged_quantity: number
          total_before: number
          unit_snapshot: string
        }
        Insert: {
          commercial_name_snapshot?: string | null
          confirmation_id: string
          created_at?: string
          damaged_after: number
          damaged_before: number
          good_after: number
          good_before: number
          id?: string
          inventory_id: string
          item_name_snapshot: string
          newly_damaged_quantity?: number
          total_before: number
          unit_snapshot: string
        }
        Update: {
          commercial_name_snapshot?: string | null
          confirmation_id?: string
          created_at?: string
          damaged_after?: number
          damaged_before?: number
          good_after?: number
          good_before?: number
          id?: string
          inventory_id?: string
          item_name_snapshot?: string
          newly_damaged_quantity?: number
          total_before?: number
          unit_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_session_equipment_checks_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_session_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_medical_session_equipment_checks_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_room_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      class_schedules: {
        Row: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        Insert: {
          basic_medical_registration_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_code?: string | null
          course_code_snapshot: string
          course_id?: string | null
          course_name_snapshot: string
          created_at?: string
          created_by: string
          end_time: string
          id?: string
          import_batch_id?: string | null
          lecturer_2_id?: string | null
          lecturer_id?: string | null
          note?: string | null
          published_at?: string | null
          published_by?: string | null
          room_id: string
          schedule_date: string
          schedule_status?: Database["public"]["Enums"]["schedule_status"]
          semester?: string | null
          source?: Database["public"]["Enums"]["schedule_source"]
          source_row_id?: string | null
          start_time: string
          student_count?: number
          time_range?: unknown
          updated_at?: string
        }
        Update: {
          basic_medical_registration_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          class_code?: string | null
          course_code_snapshot?: string
          course_id?: string | null
          course_name_snapshot?: string
          created_at?: string
          created_by?: string
          end_time?: string
          id?: string
          import_batch_id?: string | null
          lecturer_2_id?: string | null
          lecturer_id?: string | null
          note?: string | null
          published_at?: string | null
          published_by?: string | null
          room_id?: string
          schedule_date?: string
          schedule_status?: Database["public"]["Enums"]["schedule_status"]
          semester?: string | null
          source?: Database["public"]["Enums"]["schedule_source"]
          source_row_id?: string | null
          start_time?: string
          student_count?: number
          time_range?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_schedules_basic_medical_registration_id_fkey"
            columns: ["basic_medical_registration_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registration_completion"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "class_schedules_basic_medical_registration_id_fkey"
            columns: ["basic_medical_registration_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registration_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_basic_medical_registration_id_fkey"
            columns: ["basic_medical_registration_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_lecturer_2_id_fkey"
            columns: ["lecturer_2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_lecturer_id_fkey"
            columns: ["lecturer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          course_code: string
          course_name: string
          created_at: string
          id: string
          is_active: boolean
          room_type_id: string
          updated_at: string
        }
        Insert: {
          course_code: string
          course_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          room_type_id?: string
          updated_at?: string
        }
        Update: {
          course_code?: string
          course_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          room_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_settings: {
        Row: {
          delivery_mode: string
          setting_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          delivery_mode?: string
          setting_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          delivery_mode?: string
          setting_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notifications: {
        Row: {
          acknowledgement_error: string | null
          attempts: number
          created_at: string
          dedupe_key: string
          delivery_mode_at_enqueue: string
          id: string
          last_error: string | null
          notification_type: string
          payload: Json
          processing_started_at: string | null
          provider_message_id: string | null
          provider_succeeded_at: string | null
          recipient_email: string
          recipient_id: string
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          acknowledgement_error?: string | null
          attempts?: number
          created_at?: string
          dedupe_key: string
          delivery_mode_at_enqueue?: string
          id?: string
          last_error?: string | null
          notification_type: string
          payload?: Json
          processing_started_at?: string | null
          provider_message_id?: string | null
          provider_succeeded_at?: string | null
          recipient_email: string
          recipient_id: string
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          acknowledgement_error?: string | null
          attempts?: number
          created_at?: string
          dedupe_key?: string
          delivery_mode_at_enqueue?: string
          id?: string
          last_error?: string | null
          notification_type?: string
          payload?: Json
          processing_started_at?: string | null
          provider_message_id?: string | null
          provider_succeeded_at?: string | null
          recipient_email?: string
          recipient_id?: string
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox_events: {
        Row: {
          actor_id: string | null
          aggregate_id: string | null
          attempts: number
          created_at: string
          delivery_mode_at_event: string
          domain: string
          event_key: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          processing_started_at: string | null
          recipients: Json
          status: string
        }
        Insert: {
          actor_id?: string | null
          aggregate_id?: string | null
          attempts?: number
          created_at?: string
          delivery_mode_at_event: string
          domain: string
          event_key: string
          event_type: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          processing_started_at?: string | null
          recipients: Json
          status?: string
        }
        Update: {
          actor_id?: string | null
          aggregate_id?: string | null
          attempts?: number
          created_at?: string
          delivery_mode_at_event?: string
          domain?: string
          event_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          recipients?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_catalog: {
        Row: {
          commercial_name: string
          country_of_origin: string | null
          created_at: string
          id: string
          is_active: boolean
          item_name: string
          item_type: string | null
          manufacturer: string | null
          model: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          commercial_name: string
          country_of_origin?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          item_name: string
          item_type?: string | null
          manufacturer?: string | null
          model?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          commercial_name?: string
          country_of_origin?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          item_name?: string
          item_type?: string | null
          manufacturer?: string | null
          model?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      equipment_request_items: {
        Row: {
          basic_medical_catalog_item_id: string | null
          catalog_item_id: string | null
          created_at: string
          id: string
          note: string | null
          quantity: number
          request_id: string
          skill_name: string
        }
        Insert: {
          basic_medical_catalog_item_id?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          quantity: number
          request_id: string
          skill_name: string
        }
        Update: {
          basic_medical_catalog_item_id?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          quantity?: number
          request_id?: string
          skill_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_request_items_basic_medical_catalog_item_id_fkey"
            columns: ["basic_medical_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "basic_medical_equipment_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_request_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "equipment_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_requests: {
        Row: {
          class_schedule_id: string | null
          created_at: string
          created_by: string
          email_snapshot: string
          handover_effective_at: string | null
          handover_file_url: string | null
          handover_recipient_signed_at: string | null
          handover_signature_path: string | null
          handover_staff_confirmed_at: string | null
          handover_staff_confirmed_by: string | null
          id: string
          late_approval_status: string
          late_registration_reason: string | null
          late_requested_at: string | null
          late_review_note: string | null
          late_reviewed_at: string | null
          late_reviewed_by: string | null
          note: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at: string | null
          return_recipient_signed_at: string | null
          return_signature_path: string | null
          return_staff_confirmed_at: string | null
          return_staff_confirmed_by: string | null
          semester: string
          source_identity_id: string
          status: string
          updated_at: string
        }
        Insert: {
          class_schedule_id?: string | null
          created_at?: string
          created_by: string
          email_snapshot: string
          handover_effective_at?: string | null
          handover_file_url?: string | null
          handover_recipient_signed_at?: string | null
          handover_signature_path?: string | null
          handover_staff_confirmed_at?: string | null
          handover_staff_confirmed_by?: string | null
          id?: string
          late_approval_status?: string
          late_registration_reason?: string | null
          late_requested_at?: string | null
          late_review_note?: string | null
          late_reviewed_at?: string | null
          late_reviewed_by?: string | null
          note?: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at?: string | null
          return_recipient_signed_at?: string | null
          return_signature_path?: string | null
          return_staff_confirmed_at?: string | null
          return_staff_confirmed_by?: string | null
          semester: string
          source_identity_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          class_schedule_id?: string | null
          created_at?: string
          created_by?: string
          email_snapshot?: string
          handover_effective_at?: string | null
          handover_file_url?: string | null
          handover_recipient_signed_at?: string | null
          handover_signature_path?: string | null
          handover_staff_confirmed_at?: string | null
          handover_staff_confirmed_by?: string | null
          id?: string
          late_approval_status?: string
          late_registration_reason?: string | null
          late_requested_at?: string | null
          late_review_note?: string | null
          late_reviewed_at?: string | null
          late_reviewed_by?: string | null
          note?: string | null
          phone_snapshot?: string
          receive_at?: string
          registrant_id?: string
          request_domain?: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id?: string
          return_at?: string
          return_effective_at?: string | null
          return_recipient_signed_at?: string | null
          return_signature_path?: string | null
          return_staff_confirmed_at?: string | null
          return_staff_confirmed_by?: string | null
          semester?: string
          source_identity_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_requests_class_schedule_id_fkey"
            columns: ["class_schedule_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_requests_handover_staff_confirmed_by_fkey"
            columns: ["handover_staff_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_requests_late_reviewed_by_fkey"
            columns: ["late_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_requests_registrant_id_fkey"
            columns: ["registrant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_requests_responsible_lecturer_id_fkey"
            columns: ["responsible_lecturer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_requests_return_staff_confirmed_by_fkey"
            columns: ["return_staff_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          completed_at: string | null
          conflict_rows: number
          created_at: string
          created_by: string
          duplicate_rows: number
          error_rows: number
          file_hash: string
          id: string
          imported_rows: number
          original_file_name: string
          room_type_id: string
          source_type: Database["public"]["Enums"]["schedule_source"]
          status: Database["public"]["Enums"]["import_status"]
          total_rows: number
          valid_rows: number
          warning_rows: number
        }
        Insert: {
          completed_at?: string | null
          conflict_rows?: number
          created_at?: string
          created_by: string
          duplicate_rows?: number
          error_rows?: number
          file_hash: string
          id?: string
          imported_rows?: number
          original_file_name: string
          room_type_id?: string
          source_type?: Database["public"]["Enums"]["schedule_source"]
          status?: Database["public"]["Enums"]["import_status"]
          total_rows?: number
          valid_rows?: number
          warning_rows?: number
        }
        Update: {
          completed_at?: string | null
          conflict_rows?: number
          created_at?: string
          created_by?: string
          duplicate_rows?: number
          error_rows?: number
          file_hash?: string
          id?: string
          imported_rows?: number
          original_file_name?: string
          room_type_id?: string
          source_type?: Database["public"]["Enums"]["schedule_source"]
          status?: Database["public"]["Enums"]["import_status"]
          total_rows?: number
          valid_rows?: number
          warning_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          class_schedule_id: string | null
          created_at: string
          errors: Json
          id: string
          import_batch_id: string
          normalized_data: Json
          normalized_row_hash: string
          raw_data: Json
          row_number: number
          source_row_id: string | null
          validation_status: Database["public"]["Enums"]["import_row_status"]
          warnings: Json
        }
        Insert: {
          class_schedule_id?: string | null
          created_at?: string
          errors?: Json
          id?: string
          import_batch_id: string
          normalized_data?: Json
          normalized_row_hash: string
          raw_data?: Json
          row_number: number
          source_row_id?: string | null
          validation_status: Database["public"]["Enums"]["import_row_status"]
          warnings?: Json
        }
        Update: {
          class_schedule_id?: string | null
          created_at?: string
          errors?: Json
          id?: string
          import_batch_id?: string
          normalized_data?: Json
          normalized_row_hash?: string
          raw_data?: Json
          row_number?: number
          source_row_id?: string | null
          validation_status?: Database["public"]["Enums"]["import_row_status"]
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_class_schedule_id_fkey"
            columns: ["class_schedule_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_catalog_items: {
        Row: {
          active: boolean
          base_uom_code: string
          category_id: string
          code: string
          created_at: string
          expiry_required: boolean
          id: string
          material_kind: string
          name: string
          return_semantics: string
          revision: number
          tracking_strategy: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_uom_code: string
          category_id: string
          code: string
          created_at?: string
          expiry_required: boolean
          id?: string
          material_kind: string
          name: string
          return_semantics: string
          revision?: number
          tracking_strategy: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_uom_code?: string
          category_id?: string
          code?: string
          created_at?: string
          expiry_required?: boolean
          id?: string
          material_kind?: string
          name?: string
          return_semantics?: string
          revision?: number
          tracking_strategy?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_catalog_items_base_uom_code_fkey"
            columns: ["base_uom_code"]
            isOneToOne: false
            referencedRelation: "inventory_uoms"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_catalog_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "inventory_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_categories: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          revision: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          revision?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      inventory_opening_batches: {
        Row: {
          count_cutoff: string
          created_at: string
          cutover_key: string
          id: string
          provenance_note: string
          scope_description: string
          synthetic: boolean
          transaction_id: string
        }
        Insert: {
          count_cutoff: string
          created_at?: string
          cutover_key: string
          id?: string
          provenance_note: string
          scope_description: string
          synthetic: boolean
          transaction_id: string
        }
        Update: {
          count_cutoff?: string
          created_at?: string
          cutover_key?: string
          id?: string
          provenance_note?: string
          scope_description?: string
          synthetic?: boolean
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_opening_batches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_opening_scope: {
        Row: {
          catalog_item_id: string
          location_id: string
          opening_batch_id: string
        }
        Insert: {
          catalog_item_id: string
          location_id: string
          opening_batch_id: string
        }
        Update: {
          catalog_item_id?: string
          location_id?: string
          opening_batch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_opening_scope_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_opening_scope_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_opening_scope_opening_batch_id_fkey"
            columns: ["opening_batch_id"]
            isOneToOne: false
            referencedRelation: "inventory_opening_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_operation_replays: {
        Row: {
          actor_id: string
          committed_at: string
          operation: string
          payload_hash: string
          result_ids: Json
          retry_key: string
        }
        Insert: {
          actor_id: string
          committed_at?: string
          operation: string
          payload_hash: string
          result_ids: Json
          retry_key: string
        }
        Update: {
          actor_id?: string
          committed_at?: string
          operation?: string
          payload_hash?: string
          result_ids?: Json
          retry_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_operation_replays_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_receipt_cohorts: {
        Row: {
          created_at: string
          current_fact_id: string
          origin_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_fact_id: string
          origin_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_fact_id?: string
          origin_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_receipt_cohorts_origin_fact_fk"
            columns: ["origin_id", "current_fact_id"]
            isOneToOne: false
            referencedRelation: "inventory_stock_facts"
            referencedColumns: ["origin_id", "id"]
          },
          {
            foreignKeyName: "inventory_receipt_cohorts_origin_id_fkey"
            columns: ["origin_id"]
            isOneToOne: true
            referencedRelation: "inventory_stock_origins"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_receipts: {
        Row: {
          created_at: string
          id: string
          receipt_reference: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          receipt_reference: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          id?: string
          receipt_reference?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_receipts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_balances: {
        Row: {
          cohort_id: string
          condition: string
          location_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          cohort_id: string
          condition: string
          location_id: string
          quantity: number
          updated_at?: string
        }
        Update: {
          cohort_id?: string
          condition?: string
          location_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_balances_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "inventory_receipt_cohorts"
            referencedColumns: ["origin_id"]
          },
          {
            foreignKeyName: "inventory_stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_storage_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_evidence: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          metadata: Json
          note: string
          origin_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          metadata?: Json
          note: string
          origin_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          note?: string
          origin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_evidence_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_evidence_origin_id_fkey"
            columns: ["origin_id"]
            isOneToOne: false
            referencedRelation: "inventory_stock_origins"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_facts: {
        Row: {
          base_quantity: number
          base_uom_code: string
          conversion_factor: number | null
          created_at: string
          damaged_quantity: number
          evidence_note: string | null
          expiry_date: string | null
          expiry_input: string | null
          expiry_precision: string
          good_quantity: number
          id: string
          location_id: string
          origin_id: string
          previous_fact_id: string | null
          purchase_quantity: number | null
          purchase_uom_code: string | null
          source_snapshot: Json
          transaction_id: string
          version: number
        }
        Insert: {
          base_quantity: number
          base_uom_code: string
          conversion_factor?: number | null
          created_at?: string
          damaged_quantity: number
          evidence_note?: string | null
          expiry_date?: string | null
          expiry_input?: string | null
          expiry_precision: string
          good_quantity: number
          id?: string
          location_id: string
          origin_id: string
          previous_fact_id?: string | null
          purchase_quantity?: number | null
          purchase_uom_code?: string | null
          source_snapshot?: Json
          transaction_id: string
          version: number
        }
        Update: {
          base_quantity?: number
          base_uom_code?: string
          conversion_factor?: number | null
          created_at?: string
          damaged_quantity?: number
          evidence_note?: string | null
          expiry_date?: string | null
          expiry_input?: string | null
          expiry_precision?: string
          good_quantity?: number
          id?: string
          location_id?: string
          origin_id?: string
          previous_fact_id?: string | null
          purchase_quantity?: number | null
          purchase_uom_code?: string | null
          source_snapshot?: Json
          transaction_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_facts_base_uom_code_fkey"
            columns: ["base_uom_code"]
            isOneToOne: false
            referencedRelation: "inventory_uoms"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_stock_facts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_facts_origin_id_fkey"
            columns: ["origin_id"]
            isOneToOne: false
            referencedRelation: "inventory_stock_origins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_facts_previous_fact_id_fkey"
            columns: ["previous_fact_id"]
            isOneToOne: true
            referencedRelation: "inventory_stock_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_facts_purchase_uom_code_fkey"
            columns: ["purchase_uom_code"]
            isOneToOne: false
            referencedRelation: "inventory_uoms"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_stock_facts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_holds: {
        Row: {
          created_at: string
          hold_reason: string
          origin_id: string
          placed_at: string
          placed_by_id: string
          release_reason: string | null
          released_at: string | null
          released_by_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hold_reason: string
          origin_id: string
          placed_at?: string
          placed_by_id: string
          release_reason?: string | null
          released_at?: string | null
          released_by_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hold_reason?: string
          origin_id?: string
          placed_at?: string
          placed_by_id?: string
          release_reason?: string | null
          released_at?: string | null
          released_by_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_holds_origin_id_fkey"
            columns: ["origin_id"]
            isOneToOne: true
            referencedRelation: "inventory_stock_origins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_holds_placed_by_id_fkey"
            columns: ["placed_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_holds_released_by_id_fkey"
            columns: ["released_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_origins: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          line_key: string
          opening_batch_id: string | null
          provenance_group: string
          receipt_id: string | null
          source_line_id: string | null
          surplus_id: string | null
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          line_key: string
          opening_batch_id?: string | null
          provenance_group: string
          receipt_id?: string | null
          source_line_id?: string | null
          surplus_id?: string | null
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          line_key?: string
          opening_batch_id?: string | null
          provenance_group?: string
          receipt_id?: string | null
          source_line_id?: string | null
          surplus_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_origins_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_origins_opening_batch_id_fkey"
            columns: ["opening_batch_id"]
            isOneToOne: false
            referencedRelation: "inventory_opening_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_origins_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "inventory_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_origins_source_line_id_fkey"
            columns: ["source_line_id"]
            isOneToOne: false
            referencedRelation: "acquisition_record_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_origins_surplus_id_fkey"
            columns: ["surplus_id"]
            isOneToOne: false
            referencedRelation: "inventory_stocktake_surplus_records"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stocktake_surplus_records: {
        Row: {
          catalog_item_id: string
          counted_at: string
          counted_by_id: string
          created_at: string
          evidence_note: string
          id: string
          initial_condition: string
          initial_location_id: string
          initial_quantity: number
          reason: string
          status: string
          surplus_reference: string
          transaction_id: string
          updated_at: string
          verification_evidence_note: string | null
          verification_reason: string | null
          verified_at: string | null
          verified_by_id: string | null
        }
        Insert: {
          catalog_item_id: string
          counted_at: string
          counted_by_id: string
          created_at?: string
          evidence_note: string
          id?: string
          initial_condition: string
          initial_location_id: string
          initial_quantity: number
          reason: string
          status?: string
          surplus_reference: string
          transaction_id: string
          updated_at?: string
          verification_evidence_note?: string | null
          verification_reason?: string | null
          verified_at?: string | null
          verified_by_id?: string | null
        }
        Update: {
          catalog_item_id?: string
          counted_at?: string
          counted_by_id?: string
          created_at?: string
          evidence_note?: string
          id?: string
          initial_condition?: string
          initial_location_id?: string
          initial_quantity?: number
          reason?: string
          status?: string
          surplus_reference?: string
          transaction_id?: string
          updated_at?: string
          verification_evidence_note?: string | null
          verification_reason?: string | null
          verified_at?: string | null
          verified_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stocktake_surplus_records_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stocktake_surplus_records_counted_by_id_fkey"
            columns: ["counted_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stocktake_surplus_records_initial_location_id_fkey"
            columns: ["initial_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stocktake_surplus_records_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stocktake_surplus_records_verified_by_id_fkey"
            columns: ["verified_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_storage_locations: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          parent_location_id: string | null
          revision: number
          room_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          parent_location_id?: string | null
          revision?: number
          room_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          parent_location_id?: string | null
          revision?: number
          room_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_storage_locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_storage_locations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_suppliers: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          revision: number
          tax_code: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          revision?: number
          tax_code?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          revision?: number
          tax_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_transaction_lines: {
        Row: {
          catalog_item_id: string
          cohort_id: string
          condition: string
          created_at: string
          line_no: number
          location_id: string
          quantity_delta: number
          transaction_id: string
        }
        Insert: {
          catalog_item_id: string
          cohort_id: string
          condition: string
          created_at?: string
          line_no: number
          location_id: string
          quantity_delta: number
          transaction_id: string
        }
        Update: {
          catalog_item_id?: string
          cohort_id?: string
          condition?: string
          created_at?: string
          line_no?: number
          location_id?: string
          quantity_delta?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transaction_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transaction_lines_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "inventory_receipt_cohorts"
            referencedColumns: ["origin_id"]
          },
          {
            foreignKeyName: "inventory_transaction_lines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transaction_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          actor_id: string
          business_key: string
          corrects_transaction_id: string | null
          id: string
          occurred_at: string
          operation: string
          posted_at: string
          reason: string | null
        }
        Insert: {
          actor_id: string
          business_key: string
          corrects_transaction_id?: string | null
          id?: string
          occurred_at: string
          operation: string
          posted_at?: string
          reason?: string | null
        }
        Update: {
          actor_id?: string
          business_key?: string
          corrects_transaction_id?: string | null
          id?: string
          occurred_at?: string
          operation?: string
          posted_at?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_corrects_transaction_id_fkey"
            columns: ["corrects_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_uoms: {
        Row: {
          active: boolean
          allowed_scale: number
          code: string
          created_at: string
          dimension: string
          name: string
          revision: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_scale?: number
          code: string
          created_at?: string
          dimension: string
          name: string
          revision?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_scale?: number
          code?: string
          created_at?: string
          dimension?: string
          name?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      personnel_auth_reconciliation_logs: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          failure_stage: string
          id: string
          previous_email: string
          profile_id: string | null
          requested_email: string
          resolved_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          failure_stage: string
          id?: string
          previous_email: string
          profile_id?: string | null
          requested_email: string
          resolved_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          failure_stage?: string
          id?: string
          previous_email?: string
          profile_id?: string | null
          requested_email?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personnel_auth_reconciliation_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_auth_reconciliation_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personnel_password_operations: {
        Row: {
          action: string
          actor_id: string
          auth_updated_at: string | null
          committed_at: string | null
          correlation_id: string
          created_at: string
          id: string
          last_error: string | null
          resolved_at: string | null
          status: string
          target_user_id: string
        }
        Insert: {
          action: string
          actor_id: string
          auth_updated_at?: string | null
          committed_at?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          resolved_at?: string | null
          status: string
          target_user_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          auth_updated_at?: string | null
          committed_at?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          resolved_at?: string | null
          status?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personnel_password_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_password_operations_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personnel_update_operations: {
        Row: {
          actor_id: string
          auth_updated_at: string | null
          committed_at: string | null
          created_at: string
          expected_version: number
          expires_at: string
          id: string
          last_error: string | null
          payload: Json
          previous_email: string
          profile_id: string
          reconcile_lease_expires_at: string | null
          reconcile_started_at: string | null
          reconcile_worker_id: string | null
          requested_email: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          actor_id: string
          auth_updated_at?: string | null
          committed_at?: string | null
          created_at?: string
          expected_version: number
          expires_at?: string
          id?: string
          last_error?: string | null
          payload: Json
          previous_email: string
          profile_id: string
          reconcile_lease_expires_at?: string | null
          reconcile_started_at?: string | null
          reconcile_worker_id?: string | null
          requested_email: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          actor_id?: string
          auth_updated_at?: string | null
          committed_at?: string | null
          created_at?: string
          expected_version?: number
          expires_at?: string
          id?: string
          last_error?: string | null
          payload?: Json
          previous_email?: string
          profile_id?: string
          reconcile_lease_expires_at?: string | null
          reconcile_started_at?: string | null
          reconcile_worker_id?: string | null
          requested_email?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "personnel_update_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_update_operations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_room_types: {
        Row: {
          created_at: string
          created_by: string | null
          profile_id: string
          receive_schedule_emails: boolean
          room_type_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          profile_id: string
          receive_schedule_emails?: boolean
          room_type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          profile_id?: string
          receive_schedule_emails?: boolean
          room_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_room_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_room_types_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_room_types_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_version: number
          allow_basic_medical_access: boolean
          allow_early_equipment_handover: boolean
          can_import_schedules: boolean
          can_manage_email_notifications: boolean
          can_manage_shift_history: boolean
          created_at: string
          email: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          must_change_password: boolean
          must_change_password_hash: string | null
          phone: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          access_version?: number
          allow_basic_medical_access?: boolean
          allow_early_equipment_handover?: boolean
          can_import_schedules?: boolean
          can_manage_email_notifications?: boolean
          can_manage_shift_history?: boolean
          created_at?: string
          email: string
          employee_code?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          must_change_password?: boolean
          must_change_password_hash?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          access_version?: number
          allow_basic_medical_access?: boolean
          allow_early_equipment_handover?: boolean
          can_import_schedules?: boolean
          can_manage_email_notifications?: boolean
          can_manage_shift_history?: boolean
          created_at?: string
          email?: string
          employee_code?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          must_change_password_hash?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      room_types: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          building_code: string
          capacity: number | null
          created_at: string
          id: string
          is_active: boolean
          room_code: string
          room_name: string | null
          room_type: string | null
          room_type_id: string
          updated_at: string
        }
        Insert: {
          building_code: string
          capacity?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          room_code: string
          room_name?: string | null
          room_type?: string | null
          room_type_id?: string
          updated_at?: string
        }
        Update: {
          building_code?: string
          capacity?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          room_code?: string
          room_name?: string | null
          room_type?: string | null
          room_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          creation_group_id: string | null
          end_time: string
          id: string
          note: string | null
          registration_source: Database["public"]["Enums"]["shift_registration_source"]
          shift_date: string
          shift_slot: string
          staff_id: string
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by: string
          creation_group_id?: string | null
          end_time: string
          id?: string
          note?: string | null
          registration_source: Database["public"]["Enums"]["shift_registration_source"]
          shift_date: string
          shift_slot: string
          staff_id: string
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string
          creation_group_id?: string | null
          end_time?: string
          id?: string
          note?: string | null
          registration_source?: Database["public"]["Enums"]["shift_registration_source"]
          shift_date?: string
          shift_slot?: string
          staff_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_security_principals: {
        Row: {
          configured_at: string
          configured_by: string | null
          personnel_manager_id: string
          root_admin_id: string
          singleton: boolean
        }
        Insert: {
          configured_at?: string
          configured_by?: string | null
          personnel_manager_id: string
          root_admin_id: string
          singleton?: boolean
        }
        Update: {
          configured_at?: string
          configured_by?: string | null
          personnel_manager_id?: string
          root_admin_id?: string
          singleton?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "system_security_principals_configured_by_fkey"
            columns: ["configured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_security_principals_personnel_manager_id_fkey"
            columns: ["personnel_manager_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_security_principals_root_admin_id_fkey"
            columns: ["root_admin_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          actor_id: string | null
          body: string
          created_at: string
          dedupe_key: string
          domain: string
          entity_id: string | null
          entity_type: string
          href: string | null
          id: string
          metadata: Json
          notification_type: string
          read_at: string | null
          recipient_id: string
          title: string
        }
        Insert: {
          actor_id?: string | null
          body: string
          created_at?: string
          dedupe_key: string
          domain: string
          entity_id?: string | null
          entity_type: string
          href?: string | null
          id?: string
          metadata?: Json
          notification_type: string
          read_at?: string | null
          recipient_id: string
          title: string
        }
        Update: {
          actor_id?: string | null
          body?: string
          created_at?: string
          dedupe_key?: string
          domain?: string
          entity_id?: string | null
          entity_type?: string
          href?: string | null
          id?: string
          metadata?: Json
          notification_type?: string
          read_at?: string | null
          recipient_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      basic_medical_registration_completion: {
        Row: {
          confirmed_session_count: number | null
          is_completed: boolean | null
          registration_id: string | null
          session_count: number | null
        }
        Relationships: []
      }
      basic_medical_registration_list: {
        Row: {
          academic_year: string | null
          building_code: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_session_count: number | null
          course_code: string | null
          course_name: string | null
          created_at: string | null
          end_date: string | null
          id: string | null
          is_completed: boolean | null
          registrant_name: string | null
          registration_code: string | null
          responsible_name: string | null
          room_code: string | null
          room_name: string | null
          search_text: string | null
          semester: string | null
          session_count: number | null
          start_date: string | null
          student_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "basic_medical_registrations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_equipment_request_item: {
        Args: {
          target_catalog_item_id: string
          target_note?: string
          target_quantity: number
          target_request_id: string
          target_skill_name: string
        }
        Returns: string
      }
      adjust_basic_medical_inventory_condition: {
        Args: {
          target_damaged_quantity: number
          target_good_quantity: number
          target_inventory_id: string
          target_note?: string
        }
        Returns: {
          catalog_item_id: string
          created_at: string
          damaged_quantity: number
          good_quantity: number
          id: string
          is_active: boolean
          last_damage_reported_at: string | null
          last_damage_reporter_id: string | null
          room_id: string
          total_quantity: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "basic_medical_room_inventory"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_apply_personnel_import: {
        Args: {
          target_file_name?: string
          target_mode: string
          target_rows: Json
        }
        Returns: Json
      }
      admin_delete_email_notifications: {
        Args: { target_ids: string[] }
        Returns: number
      }
      admin_list_personnel: {
        Args: {
          target_import_permission?: string
          target_page?: number
          target_page_size?: number
          target_query?: string
          target_role?: string
          target_status?: string
        }
        Returns: {
          access_version: number
          allow_basic_medical_access: boolean
          can_edit_security: boolean
          can_import_schedules: boolean
          email: string
          email_room_type_ids: string[]
          full_name: string
          id: string
          is_active: boolean
          is_current_admin: boolean
          is_root_administrator: boolean
          is_security_principal: boolean
          phone: string
          roles: Database["public"]["Enums"]["app_role"][]
          room_type_ids: string[]
          title: string
          total_count: number
        }[]
      }
      admin_update_personnel: {
        Args: {
          target_allow_basic_medical_access: boolean
          target_can_import_schedules: boolean
          target_email: string
          target_email_room_type_ids: string[]
          target_expected_version: number
          target_full_name: string
          target_is_active: boolean
          target_phone: string
          target_profile_id: string
          target_roles: Database["public"]["Enums"]["app_role"][]
          target_room_type_ids: string[]
          target_title: string
        }
        Returns: Json
      }
      apply_basic_medical_catalog_import: {
        Args: { target_mode: string; target_rows: Json }
        Returns: Json
      }
      apply_catalog_course_import: {
        Args: { target_rows: Json }
        Returns: number
      }
      apply_catalog_reconciliation: {
        Args: {
          target_domain: string
          target_fingerprint: string
          target_rows: Json
        }
        Returns: Json
      }
      apply_catalog_room_import: {
        Args: { target_rows: Json }
        Returns: number
      }
      assign_class_lecturers: {
        Args: { target_lecturer_ids: string[]; target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_class_lecturers_authorized_impl: {
        Args: { target_lecturer_ids: string[]; target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      audit_basic_medical_equipment_export: {
        Args: { target_row_count: number }
        Returns: boolean
      }
      begin_personnel_password_auth_update: {
        Args: { target_operation_id: string }
        Returns: undefined
      }
      begin_personnel_password_reset: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      begin_personnel_update: {
        Args: {
          target_allow_basic_medical_access: boolean
          target_can_import_schedules: boolean
          target_email: string
          target_email_room_type_ids: string[]
          target_expected_version: number
          target_full_name: string
          target_is_active: boolean
          target_phone: string
          target_profile_id: string
          target_roles: Database["public"]["Enums"]["app_role"][]
          target_room_type_ids: string[]
          target_title: string
        }
        Returns: Json
      }
      cancel_basic_medical_registration: {
        Args: { target_reason?: string; target_registration_id: string }
        Returns: Json
      }
      cancel_basic_medical_session: {
        Args: { target_reason?: string; target_session_id: string }
        Returns: Json
      }
      cancel_class_schedule: {
        Args: { target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_personnel_update: {
        Args: { target_operation_id: string }
        Returns: boolean
      }
      cancel_staff_shift: {
        Args: { reason?: string; target_shift_id: string }
        Returns: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          creation_group_id: string | null
          end_time: string
          id: string
          note: string | null
          registration_source: Database["public"]["Enums"]["shift_registration_source"]
          shift_date: string
          shift_slot: string
          staff_id: string
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "staff_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_class: {
        Args: { target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_email_notifications: {
        Args: { batch_size?: number }
        Returns: {
          acknowledgement_error: string | null
          attempts: number
          created_at: string
          dedupe_key: string
          delivery_mode_at_enqueue: string
          id: string
          last_error: string | null
          notification_type: string
          payload: Json
          processing_started_at: string | null
          provider_message_id: string | null
          provider_succeeded_at: string | null
          recipient_email: string
          recipient_id: string
          sent_at: string | null
          status: string
          subject: string
        }[]
        SetofOptions: {
          from: "*"
          to: "email_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_personnel_reconciliation_batch: {
        Args: {
          target_lease_seconds?: number
          target_limit?: number
          target_worker_id?: string
        }
        Returns: {
          actor_id: string
          expected_version: number
          expires_at: string
          id: string
          previous_email: string
          prior_status: string
          profile_id: string
          requested_email: string
        }[]
      }
      clear_own_must_change_password: {
        Args: { target_reason: string }
        Returns: undefined
      }
      commit_personnel_password_operation: {
        Args: { target_operation_id: string }
        Returns: undefined
      }
      commit_personnel_update: {
        Args: { target_operation_id: string }
        Returns: Json
      }
      confirm_basic_medical_session: {
        Args: {
          target_checks: Json
          target_session_id: string
          target_signature_data: string
        }
        Returns: Json
      }
      create_equipment_request_with_items: {
        Args: {
          target_class_schedule_id: string
          target_items: Json
          target_late_registration_reason: string
          target_note: string
          target_receive_at: string
          target_responsible_lecturer_id: string
          target_return_at: string
          target_semester: string
        }
        Returns: string
      }
      create_import_schedule_row: {
        Args: {
          target_batch_id: string
          target_course_code: string
          target_course_id: string
          target_course_name: string
          target_date: string
          target_end: string
          target_errors: Json
          target_hash: string
          target_lecturer_id: string
          target_normalized: Json
          target_note: string
          target_raw: Json
          target_room_id: string
          target_row_number: number
          target_semester?: string
          target_start: string
          target_status: Database["public"]["Enums"]["import_row_status"]
          target_student_count: number
          target_warnings: Json
        }
        Returns: string
      }
      create_manual_class_schedule: {
        Args: {
          target_course_id: string
          target_end_time: string
          target_lecturer_2_id: string
          target_lecturer_id: string
          target_note: string
          target_room_id: string
          target_schedule_date: string
          target_semester: string
          target_start_time: string
          target_student_count: number
        }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_catalog_course: {
        Args: { target_course_id: string }
        Returns: undefined
      }
      delete_catalog_room: {
        Args: { target_room_id: string }
        Returns: undefined
      }
      delete_skills_lab_class_schedule: {
        Args: { target_schedule_id: string }
        Returns: boolean
      }
      finalize_import_batch: {
        Args: { target_batch_id: string }
        Returns: Json
      }
      find_existing_import_hashes: {
        Args: { target_hashes: string[]; target_room_type_id: string }
        Returns: {
          normalized_row_hash: string
        }[]
      }
      get_basic_medical_authority_context: { Args: never; Returns: Json }
      get_basic_medical_confirmation_evidence: {
        Args: { target_confirmation_id: string }
        Returns: Json
      }
      get_class_schedules_equipment_lock_status: {
        Args: { target_schedule_ids: string[] }
        Returns: {
          has_equipment_request: boolean
          schedule_id: string
        }[]
      }
      get_personnel_authority_context: { Args: never; Returns: Json }
      hard_delete_class_schedule: {
        Args: { target_schedule_id: string }
        Returns: boolean
      }
      hard_delete_equipment_request: {
        Args: { target_request_id: string }
        Returns: boolean
      }
      hook_only_precreated_personnel: { Args: { event: Json }; Returns: Json }
      import_equipment_requests: {
        Args: { target_requests: Json }
        Returns: Json
      }
      import_hash_exists: { Args: { target_hash: string }; Returns: boolean }
      invalidate_basic_medical_session_confirmation: {
        Args: { target_confirmation_id: string; target_reason: string }
        Returns: Json
      }
      inventory_command: {
        Args: { p_operation: string; p_payload: Json; p_retry_key: string }
        Returns: Json
      }
      inventory_read: {
        Args: { p_filters?: Json; p_resource: string }
        Returns: Json
      }
      list_active_people: {
        Args: never
        Returns: {
          full_name: string
          id: string
          title: string
        }[]
      }
      list_basic_medical_instructors: {
        Args: never
        Returns: {
          full_name: string
          id: string
          title: string
        }[]
      }
      list_basic_medical_schedule_confirmation_states: {
        Args: { target_schedule_ids: string[] }
        Returns: {
          class_schedule_id: string
          confirmation_id: string
          invalidated_at: string
          session_id: string
          signed_at: string
          signer_name_snapshot: string
        }[]
      }
      list_equipment_request_lifecycle_audit: {
        Args: { target_request_id: string }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          created_at: string
          metadata: Json
          new_status: string
          old_status: string
        }[]
      }
      list_import_lecturers: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      list_operational_people: {
        Args: never
        Returns: {
          full_name: string
          id: string
          title: string
        }[]
      }
      list_operational_shift_assignees: {
        Args: never
        Returns: {
          full_name: string
          id: string
          title: string
        }[]
      }
      list_recoverable_personnel_password_operations: {
        Args: never
        Returns: {
          action: string
          correlation_id: string
          created_at: string
          id: string
          status: string
          target_email: string
          target_full_name: string
        }[]
      }
      list_scoped_import_lecturers: {
        Args: { target_room_type_id: string }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      list_scoped_lecturers: {
        Args: { target_room_type_id: string }
        Returns: {
          full_name: string
          id: string
          title: string
        }[]
      }
      manager_confirm_equipment_status: {
        Args: { target_request_id: string; target_status: string }
        Returns: {
          class_schedule_id: string | null
          created_at: string
          created_by: string
          email_snapshot: string
          handover_effective_at: string | null
          handover_file_url: string | null
          handover_recipient_signed_at: string | null
          handover_signature_path: string | null
          handover_staff_confirmed_at: string | null
          handover_staff_confirmed_by: string | null
          id: string
          late_approval_status: string
          late_registration_reason: string | null
          late_requested_at: string | null
          late_review_note: string | null
          late_reviewed_at: string | null
          late_reviewed_by: string | null
          note: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at: string | null
          return_recipient_signed_at: string | null
          return_signature_path: string | null
          return_staff_confirmed_at: string | null
          return_staff_confirmed_by: string | null
          semester: string
          source_identity_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "equipment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      manager_confirm_equipment_status_scoped_impl: {
        Args: { target_request_id: string; target_status: string }
        Returns: {
          class_schedule_id: string | null
          created_at: string
          created_by: string
          email_snapshot: string
          handover_effective_at: string | null
          handover_file_url: string | null
          handover_recipient_signed_at: string | null
          handover_signature_path: string | null
          handover_staff_confirmed_at: string | null
          handover_staff_confirmed_by: string | null
          id: string
          late_approval_status: string
          late_registration_reason: string | null
          late_requested_at: string | null
          late_review_note: string | null
          late_reviewed_at: string | null
          late_reviewed_by: string | null
          note: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at: string | null
          return_recipient_signed_at: string | null
          return_signature_path: string | null
          return_staff_confirmed_at: string | null
          return_staff_confirmed_by: string | null
          semester: string
          source_identity_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "equipment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      manager_review_late_equipment_request: {
        Args: {
          target_decision: string
          target_note?: string
          target_request_id: string
        }
        Returns: {
          class_schedule_id: string | null
          created_at: string
          created_by: string
          email_snapshot: string
          handover_effective_at: string | null
          handover_file_url: string | null
          handover_recipient_signed_at: string | null
          handover_signature_path: string | null
          handover_staff_confirmed_at: string | null
          handover_staff_confirmed_by: string | null
          id: string
          late_approval_status: string
          late_registration_reason: string | null
          late_requested_at: string | null
          late_review_note: string | null
          late_reviewed_at: string | null
          late_reviewed_by: string | null
          note: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at: string | null
          return_recipient_signed_at: string | null
          return_signature_path: string | null
          return_staff_confirmed_at: string | null
          return_staff_confirmed_by: string | null
          semester: string
          source_identity_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "equipment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      manager_review_late_equipment_request_scoped_impl: {
        Args: {
          target_decision: string
          target_note?: string
          target_request_id: string
        }
        Returns: {
          class_schedule_id: string | null
          created_at: string
          created_by: string
          email_snapshot: string
          handover_effective_at: string | null
          handover_file_url: string | null
          handover_recipient_signed_at: string | null
          handover_signature_path: string | null
          handover_staff_confirmed_at: string | null
          handover_staff_confirmed_by: string | null
          id: string
          late_approval_status: string
          late_registration_reason: string | null
          late_requested_at: string | null
          late_review_note: string | null
          late_reviewed_at: string | null
          late_reviewed_by: string | null
          note: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at: string | null
          return_recipient_signed_at: string | null
          return_signature_path: string | null
          return_staff_confirmed_at: string | null
          return_staff_confirmed_by: string | null
          semester: string
          source_identity_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "equipment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_personnel_auth_updated: {
        Args: { target_operation_id: string }
        Returns: boolean
      }
      mark_personnel_password_reconciliation_required: {
        Args: { target_error?: string; target_operation_id: string }
        Returns: undefined
      }
      preview_catalog_reconciliation: {
        Args: { target_domain: string; target_rows: Json }
        Returns: Json
      }
      process_email_outbox_events: {
        Args: { batch_size?: number }
        Returns: number
      }
      reconcile_personnel_password_operation: {
        Args: { target_operation_id: string }
        Returns: Json
      }
      record_import_validation_row: {
        Args: {
          target_batch_id: string
          target_errors: Json
          target_hash: string
          target_normalized: Json
          target_raw: Json
          target_row_number: number
          target_status: Database["public"]["Enums"]["import_row_status"]
          target_warnings: Json
        }
        Returns: string
      }
      record_personnel_password_auth_result: {
        Args: {
          target_auth_succeeded: boolean
          target_error?: string
          target_operation_id: string
        }
        Returns: undefined
      }
      record_personnel_password_operation: {
        Args: {
          target_action: string
          target_result: string
          target_user_id: string
        }
        Returns: undefined
      }
      register_staff_shifts: {
        Args: { adjustment_reason?: string; shifts_payload: Json }
        Returns: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          creation_group_id: string | null
          end_time: string
          id: string
          note: string | null
          registration_source: Database["public"]["Enums"]["shift_registration_source"]
          shift_date: string
          shift_slot: string
          staff_id: string
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "staff_shifts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      registrant_confirm_equipment_handoff: {
        Args: {
          target_phase: string
          target_request_id: string
          target_signature: string
        }
        Returns: {
          class_schedule_id: string | null
          created_at: string
          created_by: string
          email_snapshot: string
          handover_effective_at: string | null
          handover_file_url: string | null
          handover_recipient_signed_at: string | null
          handover_signature_path: string | null
          handover_staff_confirmed_at: string | null
          handover_staff_confirmed_by: string | null
          id: string
          late_approval_status: string
          late_registration_reason: string | null
          late_requested_at: string | null
          late_review_note: string | null
          late_reviewed_at: string | null
          late_reviewed_by: string | null
          note: string | null
          phone_snapshot: string
          receive_at: string
          registrant_id: string
          request_domain: Database["public"]["Enums"]["equipment_request_domain"]
          responsible_lecturer_id: string
          return_at: string
          return_effective_at: string | null
          return_recipient_signed_at: string | null
          return_signature_path: string | null
          return_staff_confirmed_at: string | null
          return_staff_confirmed_by: string | null
          semester: string
          source_identity_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "equipment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_equipment_request_item: {
        Args: { target_item_id: string }
        Returns: boolean
      }
      reschedule_class: {
        Args: { target_schedule_date: string; target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_class_authorized_impl: {
        Args: { target_schedule_date: string; target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_personnel_password_change: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      reserve_personnel_password_operation: {
        Args: { target_action: string; target_user_id: string }
        Returns: string
      }
      resolve_personnel_update_operation: {
        Args: {
          target_error?: string
          target_operation_id: string
          target_status: string
        }
        Returns: boolean
      }
      save_basic_medical_registration: {
        Args: {
          target_academic_year?: string
          target_course_id?: string
          target_end_date?: string
          target_note?: string
          target_registration_id?: string
          target_responsible_lecturer_id?: string
          target_room_id?: string
          target_semester?: string
          target_sessions?: Json
          target_start_date?: string
          target_student_count?: number
        }
        Returns: string
      }
      search_basic_medical_catalog_candidates: {
        Args: { target_limit?: number; target_query?: string }
        Returns: {
          commercial_name: string
          country_of_origin: string
          id: string
          is_active: boolean
          item_name: string
          item_type: string
          manufacturer: string
          model: string
          unit: string
        }[]
      }
      search_basic_medical_equipment: {
        Args: {
          target_actor_id?: string
          target_catalog_item_id?: string
          target_event_type?: string
          target_from_date?: string
          target_page?: number
          target_page_size?: number
          target_query?: string
          target_room_id?: string
          target_status?: string
          target_tab: string
          target_to_date?: string
        }
        Returns: {
          row_data: Json
          total_count: number
        }[]
      }
      set_basic_medical_room_inventory: {
        Args: {
          target_catalog_item_id: string
          target_damaged_quantity: number
          target_inventory_id: string
          target_is_active: boolean
          target_note?: string
          target_room_id: string
          target_total_quantity: number
        }
        Returns: {
          catalog_item_id: string
          created_at: string
          damaged_quantity: number
          good_quantity: number
          id: string
          is_active: boolean
          last_damage_reported_at: string | null
          last_damage_reporter_id: string | null
          room_id: string
          total_quantity: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "basic_medical_room_inventory"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_catalog_courses_active: {
        Args: { target_ids: string[]; target_is_active: boolean }
        Returns: number
      }
      set_catalog_rooms_active: {
        Args: { target_ids: string[]; target_is_active: boolean }
        Returns: number
      }
      set_email_delivery_mode: {
        Args: { target_mode: string }
        Returns: {
          delivery_mode: string
          setting_key: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "email_delivery_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_personnel_email_notification_capability: {
        Args: { target_enabled: boolean; target_user_id: string }
        Returns: number
      }
      soft_cancel_equipment_request: {
        Args: { target_request_id: string }
        Returns: boolean
      }
      update_basic_medical_equipment_request_content: {
        Args: {
          target_items: Json
          target_late_registration_reason: string
          target_note: string
          target_receive_at: string
          target_request_id: string
          target_return_at: string
        }
        Returns: string
      }
      update_basic_medical_session_teaching_lecturer: {
        Args: { target_session_id: string; target_teaching_lecturer_id: string }
        Returns: boolean
      }
      update_catalog_course: {
        Args: {
          target_course_code: string
          target_course_name: string
          target_id: string
          target_room_type_id: string
        }
        Returns: undefined
      }
      update_catalog_courses_batch: {
        Args: { target_rows: Json }
        Returns: number
      }
      update_catalog_room: {
        Args: {
          target_building_code: string
          target_capacity: number
          target_id: string
          target_room_code: string
          target_room_name: string
          target_room_type_id: string
        }
        Returns: undefined
      }
      update_catalog_rooms_batch: {
        Args: { target_rows: Json }
        Returns: number
      }
      update_class_schedule_details: {
        Args: {
          target_end_time: string
          target_lecturer_ids?: string[]
          target_room_id: string
          target_schedule_date: string
          target_schedule_id: string
          target_start_time: string
          target_student_count: number
        }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_class_schedule_details_core: {
        Args: {
          target_end_time: string
          target_lecturer_ids?: string[]
          target_room_id: string
          target_schedule_date: string
          target_schedule_id: string
          target_start_time: string
          target_student_count: number
        }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_equipment_request_content:
        | {
            Args: {
              target_class_schedule_id: string
              target_items: Json
              target_note: string
              target_receive_at: string
              target_request_id: string
              target_responsible_lecturer_id: string
              target_return_at: string
              target_semester: string
            }
            Returns: string
          }
        | {
            Args: {
              target_class_schedule_id: string
              target_items: Json
              target_late_registration_reason: string
              target_note: string
              target_receive_at: string
              target_request_id: string
              target_responsible_lecturer_id: string
              target_return_at: string
              target_semester: string
            }
            Returns: string
          }
      update_skills_lab_class_schedule: {
        Args: {
          target_course_id: string
          target_end_time: string
          target_lecturer_ids?: string[]
          target_room_id: string
          target_schedule_date: string
          target_schedule_id: string
          target_start_time: string
          target_student_count: number
        }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_staff_shift_time: {
        Args: {
          reason?: string
          target_end_time: string
          target_note?: string
          target_shift_id: string
          target_start_time: string
        }
        Returns: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          creation_group_id: string | null
          end_time: string
          id: string
          note: string | null
          registration_source: Database["public"]["Enums"]["shift_registration_source"]
          shift_date: string
          shift_slot: string
          staff_id: string
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "staff_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdraw_class: {
        Args: { target_schedule_id: string }
        Returns: {
          basic_medical_registration_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          class_code: string | null
          course_code_snapshot: string
          course_id: string | null
          course_name_snapshot: string
          created_at: string
          created_by: string
          end_time: string
          id: string
          import_batch_id: string | null
          lecturer_2_id: string | null
          lecturer_id: string | null
          note: string | null
          published_at: string | null
          published_by: string | null
          room_id: string
          schedule_date: string
          schedule_status: Database["public"]["Enums"]["schedule_status"]
          semester: string | null
          source: Database["public"]["Enums"]["schedule_source"]
          source_row_id: string | null
          start_time: string
          student_count: number
          time_range: unknown
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "class_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "lecturer"
        | "staff"
        | "teaching_assistant"
        | "importer"
        | "viewer"
      equipment_request_domain: "nursing_skills" | "basic_medical"
      import_row_status:
        | "valid"
        | "warning"
        | "error"
        | "duplicate"
        | "imported"
        | "skipped"
        | "conflict"
        | "system_error"
      import_status:
        | "uploaded"
        | "validating"
        | "ready"
        | "importing"
        | "completed"
        | "failed"
        | "completed_with_errors"
      schedule_source: "manual" | "import" | "google_sheet"
      schedule_status: "draft" | "published" | "cancelled" | "completed"
      shift_registration_source:
        | "self_registered"
        | "admin_assigned"
        | "generated"
      shift_status: "scheduled" | "cancelled" | "completed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "lecturer",
        "staff",
        "teaching_assistant",
        "importer",
        "viewer",
      ],
      equipment_request_domain: ["nursing_skills", "basic_medical"],
      import_row_status: [
        "valid",
        "warning",
        "error",
        "duplicate",
        "imported",
        "skipped",
        "conflict",
        "system_error",
      ],
      import_status: [
        "uploaded",
        "validating",
        "ready",
        "importing",
        "completed",
        "failed",
        "completed_with_errors",
      ],
      schedule_source: ["manual", "import", "google_sheet"],
      schedule_status: ["draft", "published", "cancelled", "completed"],
      shift_registration_source: [
        "self_registered",
        "admin_assigned",
        "generated",
      ],
      shift_status: ["scheduled", "cancelled", "completed"],
    },
  },
} as const

