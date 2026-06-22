/**
 * types/index.ts
 * Shared TypeScript interfaces used across the application
 */

export interface User {
  id:          number;
  name:        string;
  email:       string;
  phone?:      string;
  role:        'admin' | 'manager' | 'agent';
  is_active:   number;
  created_at:  string;
}

export interface Workspace {
  id:              number;
  owner_id:        number;
  name:            string;
  phone_number_id: string;
  waba_id:         string;
  access_token:    string;
  verify_token:    string;
  plan:            'free' | 'pro' | 'enterprise';
  is_active:       number;
}

export interface Contact {
  id:          number;
  workspace_id: number;
  name:        string;
  phone:       string;
  email:       string;
  city:        string;
  source:      string;
  status:      'new' | 'contacted' | 'converted' | 'lost';
  tags:        string[];
  notes:       string;
  opted_in:        number;
  chat_status?:       'open' | 'intervened' | 'resolved';
  intervened_by?:     string;
  assigned_agent_id?:   number | null;
  assigned_agent_name?: string | null;
  created_at:      string;
  updated_at?:     string;
  last_message_at?: string;
  unread_count?:   number;
  inbound_count?:  number;
}

export interface Template {
  id:               number;
  workspace_id:     number;
  name:             string;
  language:         string;
  category:         'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  status:           'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED';
  header_type:      'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  header_content:   string;
  body_text:        string;
  footer_text:      string;
  buttons:          TemplateButton[];
  variables:        string[];
  meta_template_id: string;
  created_at:       string;
}

export interface TemplateButton {
  type:    'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text:    string;
  url?:    string;
  phone?:  string;
}

export interface Message {
  id:               number;
  workspace_id:     number;
  contact_id:       number;
  wamid:            string;
  replied_to_wamid?: string;
  direction:        'inbound' | 'outbound';
  type:        string;
  content:     string;
  template_id: number;
  campaign_id: number;
  status:      'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  error_message: string;
  sent_at:     string;
  delivered_at: string;
  read_at:     string;
  created_at:  string;
  // joined fields
  contact_name?: string;
  contact_phone?: string;
}

export interface Campaign {
  id:              number;
  workspace_id:    number;
  name:            string;
  template_id:     number;
  campaign_type:   'broadcast' | 'api' | 'drip' | 'transactional';
  status:          'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
  scheduled_at:    string;
  total_contacts:  number;
  sent_count:      number;
  delivered_count: number;
  read_count:      number;
  failed_count:    number;
  template_vars:   Record<string, string>;
  created_at:      string;
  // joined fields
  template_name?: string;
}

export interface ChatbotRule {
  id:                   number;
  workspace_id:         number;
  trigger_type:         'keyword' | 'contains' | 'starts_with' | 'exact' | 'any';
  trigger_value:        string;
  response_type:        'text' | 'template' | 'flow';
  response_text:        string;
  response_template_id: number;
  flow_data:            FlowNode[];
  priority:             number;
  is_active:            number;
}

export interface FlowNode {
  id:       string;
  type:     'message' | 'input' | 'condition';
  content:  string;
  next?:    string;
}

export interface AnalyticsSummary {
  total_messages_sent:     number;
  total_messages_received: number;
  delivery_rate:           number;
  read_rate:               number;
  total_contacts:          number;
  new_contacts_today:      number;
  active_campaigns:        number;
  converted_leads:         number;
}

export interface PaginatedResponse<T> {
  data:       T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
