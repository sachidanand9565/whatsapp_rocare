'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Connection, type Edge, type Node,
  Handle, Position, type NodeProps,
  MarkerType, BaseEdge, EdgeLabelRenderer, getBezierPath,
  type EdgeProps, useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { apiFetch } from '@/hooks/useApi';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import MediaLibrary, { type MediaItem, getWorkspaceId } from '@/app/components/MediaLibrary';
import { decryptId } from '@/lib/idCrypt';
import {
  MessageSquare, Clock, GitBranch, ArrowRightLeft, XCircle,
  Save, ArrowLeft, Plus, Trash2, X, Loader2, HelpCircle,
  Zap, Globe, Database, UserCheck, Timer, LayoutTemplate, Settings, Image,
  ChevronLeft, ChevronRight, ShoppingCart, Workflow, Paperclip, Download, Upload,
} from 'lucide-react';

// ── Node type configs ─────────────────────────────────────────
const NODE_TYPES_META = {
  message:        { label: 'Message',        color: 'bg-green-500',   icon: MessageSquare,  border: 'border-green-400',   desc: 'Send a text message' },
  button_message: { label: 'Text & Buttons',        color: 'bg-emerald-600', icon: LayoutTemplate, border: 'border-emerald-500', desc: 'Send WhatsApp interactive buttons (max 3)' },
  list_message:   { label: 'List Menu',      color: 'bg-cyan-600',    icon: MessageSquare,  border: 'border-cyan-400',    desc: 'Send WhatsApp scrollable list (max 10 items)' },
  dynamic_list:   { label: 'Dynamic List',   color: 'bg-violet-600',  icon: Globe,          border: 'border-violet-400',  desc: 'Fetch items from API and send as list' },
  media_message:  { label: 'Media + Buttons',color: 'bg-rose-500',    icon: Image,          border: 'border-rose-400',    desc: 'Send image/video/document with optional buttons' },
  multi_product:  { label: 'Multi Product',  color: 'bg-blue-600',    icon: ShoppingCart,   border: 'border-blue-500',    desc: 'Display multiple products with images & prices' },
  wait:           { label: 'Wait',           color: 'bg-yellow-500',  icon: Clock,          border: 'border-yellow-400',  desc: 'Wait for user reply' },
  condition:      { label: 'Condition',      color: 'bg-blue-500',    icon: GitBranch,      border: 'border-blue-400',    desc: 'Branch based on user reply' },
  set_variable:   { label: 'Save Reply',     color: 'bg-teal-500',    icon: Database,       border: 'border-teal-400',    desc: 'Save user reply into a variable' },
  api_call:       { label: 'API Call',       color: 'bg-purple-500',  icon: Globe,          border: 'border-purple-400',  desc: 'Make an external API request' },
  update_contact: { label: 'Update Contact', color: 'bg-indigo-500',  icon: UserCheck,      border: 'border-indigo-400',  desc: 'Update contact information' },
  delay:          { label: 'Delay',          color: 'bg-gray-500',    icon: Timer,          border: 'border-gray-400',    desc: 'Wait N seconds before continuing' },
  template:       { label: 'Template',       color: 'bg-pink-500',    icon: LayoutTemplate, border: 'border-pink-400',    desc: 'Send a WhatsApp approved template' },
  transfer:       { label: 'Transfer',       color: 'bg-orange-500',  icon: ArrowRightLeft, border: 'border-orange-400',  desc: 'Transfer chat to a human agent' },
  connect_flow:   { label: 'Connect Flow',   color: 'bg-fuchsia-600', icon: Workflow,       border: 'border-fuchsia-400', desc: 'Jump into another flow' },
  end:            { label: 'End',            color: 'bg-red-500',     icon: XCircle,        border: 'border-red-400',     desc: 'End the flow' },
};
type NodeType = keyof typeof NODE_TYPES_META;

// ── Example Flow ──────────────────────────────────────────────
const EXAMPLE_NODES: Node[] = [
  { id: 'ex-1', type: 'flowNode', position: { x: 260, y: 40 },
    data: { type: 'message', text: 'Hi! 👋 What is your name?' } },
  { id: 'ex-2', type: 'flowNode', position: { x: 260, y: 180 },
    data: { type: 'wait' } },
  { id: 'ex-3', type: 'flowNode', position: { x: 260, y: 310 },
    data: { type: 'set_variable', variable_name: 'user_name' } },
  { id: 'ex-4', type: 'flowNode', position: { x: 260, y: 440 },
    data: { type: 'message', text: 'Hello {{user_name}}! 🙏\n\nHow can we help you?\n1️⃣ Order Status\n2️⃣ Support\n3️⃣ Talk to Agent' } },
  { id: 'ex-5', type: 'flowNode', position: { x: 260, y: 590 },
    data: { type: 'wait' } },
  { id: 'ex-6', type: 'flowNode', position: { x: 260, y: 720 },
    data: { type: 'condition', conditions: [{ value: '1', label: 'Order' }, { value: '2', label: 'Support' }, { value: '3', label: 'Agent' }] } },
  { id: 'ex-7', type: 'flowNode', position: { x: 30,  y: 900 },
    data: { type: 'api_call', url: 'https://yourcrm.com/api/order', method: 'POST',
            body: '{"phone":"{{contact_phone}}","name":"{{user_name}}"}' } },
  { id: 'ex-8', type: 'flowNode', position: { x: 270, y: 900 },
    data: { type: 'message', text: '🛠️ Our support team will contact you shortly, {{user_name}}!' } },
  { id: 'ex-9', type: 'flowNode', position: { x: 500, y: 900 },
    data: { type: 'transfer', transferNote: '{{user_name}} needs agent assistance' } },
  { id: 'ex-10', type: 'flowNode', position: { x: 30,  y: 1060 },
    data: { type: 'update_contact', contact_field: 'name', field_value: '{{user_name}}' } },
  { id: 'ex-11', type: 'flowNode', position: { x: 30,  y: 1190 },
    data: { type: 'end' } },
  { id: 'ex-12', type: 'flowNode', position: { x: 270, y: 1060 },
    data: { type: 'end' } },
];
const EXAMPLE_EDGES: Edge[] = [
  { id:'ee1', source:'ex-1',  target:'ex-2',  type:'deleteEdge' },
  { id:'ee2', source:'ex-2',  target:'ex-3',  type:'deleteEdge' },
  { id:'ee3', source:'ex-3',  target:'ex-4',  type:'deleteEdge' },
  { id:'ee4', source:'ex-4',  target:'ex-5',  type:'deleteEdge' },
  { id:'ee5', source:'ex-5',  target:'ex-6',  type:'deleteEdge' },
  { id:'ee6', source:'ex-6',  target:'ex-7',  sourceHandle:'1', type:'deleteEdge' },
  { id:'ee7', source:'ex-6',  target:'ex-8',  sourceHandle:'2', type:'deleteEdge' },
  { id:'ee8', source:'ex-6',  target:'ex-9',  sourceHandle:'3', type:'deleteEdge' },
  { id:'ee9', source:'ex-7',  target:'ex-10', type:'deleteEdge' },
  { id:'ee10',source:'ex-10', target:'ex-11', type:'deleteEdge' },
  { id:'ee11',source:'ex-8',  target:'ex-12', type:'deleteEdge' },
];

// ── Custom Node Component ─────────────────────────────────────
function FlowNode({ data, selected }: NodeProps) {
  // ── TRIGGER: special entry-point node, marks where the flow starts ──
  if (data.type === 'trigger') {
    const ttype = data.trigger_type || 'keyword';
    const tval  = (data.trigger_value || '') as string;
    const keywords = tval ? tval.split(',').map((k: string) => k.trim()).filter(Boolean) : [];
    const label = ttype === 'any' ? 'Any message' : ttype === 'starts_with' ? 'Message starts with' : 'Message contains';
    return (
      <div className={`bg-white rounded-xl shadow-md border-2 min-w-[220px] max-w-[270px]
        ${selected ? 'border-whatsapp-green ring-2 ring-whatsapp-green/30' : 'border-teal-400'}`}>
        <div className="bg-teal-600 text-white text-xs font-semibold px-3 py-2 rounded-t-xl flex items-center gap-1.5">
          <Zap size={12}/> Trigger — Flow Start
        </div>
        <div className="px-3 py-2 text-xs text-gray-600 min-h-[32px] space-y-1.5">
          <p className="text-teal-700 font-semibold text-[11px]">{label}</p>
          {keywords.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {keywords.map((kw: string) => (
                <span key={kw} className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full font-mono">{kw}</span>
              ))}
            </div>
          ) : ttype === 'any' ? (
            <p className="text-gray-400 text-[10px] italic">Triggers on any incoming message</p>
          ) : (
            <p className="text-gray-300 text-[10px] italic">No keywords set</p>
          )}
          <p className="text-gray-300 text-[9px] pt-1">Click to edit in Flow Settings ⚙️</p>
        </div>
        <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white"/>
      </div>
    );
  }

  const meta = NODE_TYPES_META[data.type as NodeType] || NODE_TYPES_META.message;
  const Icon = meta.icon;
  return (
    <div className={`bg-white rounded-xl shadow-md border-2 min-w-[220px] max-w-[270px]
      ${selected ? 'border-whatsapp-green ring-2 ring-whatsapp-green/30' : meta.border}`}>
      <div className={`${meta.color} text-white text-xs font-semibold px-3 py-2 rounded-t-xl flex items-center gap-1.5`}>
        <Icon size={12}/>{meta.label}
      </div>
      <div className="px-3 py-2 text-xs text-gray-600 min-h-[32px]">

        {/* MESSAGE */}
        {data.type === 'message' && (
          <div>
            <p className="line-clamp-3 whitespace-pre-wrap text-gray-700">{data.text || <span className="text-gray-300 italic">Click to add message…</span>}</p>
            {data.text && <p className="text-gray-300 text-[9px] text-right mt-1">{(data.text||'').length}/1024</p>}
          </div>
        )}

        {/* BUTTON MESSAGE */}
        {data.type === 'button_message' && (
          <div className="space-y-1">
            <p className="line-clamp-2 text-gray-700 text-[11px]">{data.body_text || <span className="text-gray-300 italic">Click to add message…</span>}</p>
            {data.body_text && <p className="text-gray-300 text-[9px] text-right">{(data.body_text||'').length}/1024</p>}
            <div className="border-t border-gray-100 pt-1 space-y-1">
              {(data.buttons || []).map((b: { id: string; title: string }, i: number) => (
                <div key={i} className="relative flex items-center justify-between bg-white border border-emerald-200 rounded-lg px-2 py-1.5 pr-5">
                  <span className="text-[10px] text-emerald-700 font-medium truncate flex-1">{b.title || '...'}</span>
                  <span className="text-[9px] text-gray-300 mr-2 flex-shrink-0">{(b.title||'').length}/20</span>
                  <Handle type="source" position={Position.Right} id={b.id}
                    style={{ right: -10, top: '50%', transform: 'translateY(-50%)' }}
                    className="!w-3.5 !h-3.5 !bg-emerald-500 !border-2 !border-white !rounded-full"/>
                </div>
              ))}
              {!(data.buttons?.length) && (
                <div className="border border-dashed border-gray-200 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 text-center">+ Add Button</div>
              )}
            </div>
          </div>
        )}

        {/* LIST MESSAGE */}
        {data.type === 'list_message' && (
          <div className="space-y-1">
            <p className="line-clamp-2 text-gray-700 text-[11px]">{data.body_text || <span className="text-gray-300 italic">Click to add message…</span>}</p>
            <div className="border-t border-gray-100 pt-1 space-y-1">
              {(data.list_sections?.[0]?.rows || []).map((r: { id: string; title: string }, i: number) => (
                <div key={i} className="relative flex items-center justify-between bg-white border border-cyan-200 rounded-lg px-2 py-1.5 pr-5">
                  <span className="text-[10px] text-cyan-700 font-medium truncate flex-1">{r.title || '...'}</span>
                  <span className="text-[9px] text-gray-300 mr-2 flex-shrink-0">{(r.title||'').length}/24</span>
                  <Handle type="source" position={Position.Right} id={r.id}
                    style={{ right: -10, top: '50%', transform: 'translateY(-50%)' }}
                    className="!w-3.5 !h-3.5 !bg-cyan-500 !border-2 !border-white !rounded-full"/>
                </div>
              ))}
              {!(data.list_sections?.[0]?.rows?.length) && (
                <div className="border border-dashed border-gray-200 rounded-lg px-2 py-1.5 text-[10px] text-gray-300 text-center">+ Add Items</div>
              )}
            </div>
          </div>
        )}

        {/* DYNAMIC LIST */}
        {data.type === 'dynamic_list' && (
          <div className="space-y-1">
            <p className="text-violet-600 font-mono text-[10px] truncate">{data.method||'GET'} {data.url||'...'}</p>
            <p className="line-clamp-1 text-gray-700 text-[11px]">{data.body_text || <span className="text-gray-300 italic">Body text…</span>}</p>
            <p className="text-[9px] text-violet-400 text-center pt-1">⚡ Items fetched from API at runtime</p>
          </div>
        )}

        {data.type === 'wait'      && <p className="text-gray-400 italic text-[11px]">⏳ Waiting for user reply…</p>}
        {data.type === 'set_variable' && <p className="text-teal-600 font-mono text-[11px]">save → <strong>{data.variable_name || '?'}</strong></p>}
        {data.type === 'api_call'  && <p className="text-purple-600 truncate font-mono text-[10px]">{data.method||'POST'} {data.url||'...'}</p>}
        {data.type === 'update_contact' && <p className="text-indigo-600 text-[11px]">{data.contact_field||'?'} = <span className="font-mono">{data.field_value||'...'}</span></p>}
        {data.type === 'delay'     && <p className="text-gray-500 text-[11px]">⏱️ {data.seconds||1}s wait</p>}
        {data.type === 'template'  && <p className="text-pink-600 font-mono text-[10px]">{data.template_name||'...'}</p>}
        {data.type === 'media_message' && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded">{data.media_type||'IMAGE'}</span>
              {data.media_id && <span className="text-[9px] text-gray-400 truncate">📁 from library</span>}
              {!data.media_id && data.media_url && <span className="text-[9px] text-gray-400 truncate">{data.media_url}</span>}
            </div>
            {data.caption && <p className="text-[11px] text-gray-600 line-clamp-2">{data.caption}</p>}
            {(data.buttons||[]).length > 0 && (
              <div className="space-y-1 pt-0.5">
                {(data.buttons as {id:string;title:string}[]).map((b,i)=>(
                  <div key={i} className="relative flex items-center justify-between bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 pr-5">
                    <span className="text-[10px] text-rose-700 font-medium truncate flex-1">{b.title || '...'}</span>
                    <Handle type="source" position={Position.Right} id={b.id}
                      style={{ right: -10, top: '50%', transform: 'translateY(-50%)' }}
                      className="!w-3.5 !h-3.5 !bg-rose-500 !border-2 !border-white !rounded-full"/>
                  </div>
                ))}
              </div>
            )}
            {!data.media_id && !data.media_url && <p className="text-gray-300 italic text-[11px]">Click to add media…</p>}
          </div>
        )}
        {data.type === 'multi_product' && (
          <div className="space-y-1">
            {data.header_text && <p className="text-blue-600 font-semibold text-[10px]">{data.header_text}</p>}
            {data.body_text && <p className="text-gray-600 text-[10px] line-clamp-2">{data.body_text}</p>}
            <div className="text-[9px] text-blue-400 font-mono">Catalog: {data.catalog_id || <span className="italic text-gray-300">not set</span>}</div>
            {(data.multi_sections||[]).slice(0,2).map((s:{title:string;product_items:{product_retailer_id:string}[]},i:number)=>(
              <div key={i} className="bg-blue-50 border border-blue-100 rounded px-2 py-1">
                {s.title && <p className="text-[9px] font-semibold text-blue-700">{s.title}</p>}
                {(s.product_items||[]).slice(0,2).map((p,j)=>(
                  <p key={j} className="text-[9px] text-blue-500 font-mono truncate">• {p.product_retailer_id||'...'}</p>
                ))}
              </div>
            ))}
            {!(data.multi_sections||[]).length && <div className="border border-dashed border-gray-200 rounded px-2 py-1 text-[10px] text-gray-300 text-center">+ Add Section</div>}
          </div>
        )}
        {data.type === 'transfer'  && <p className="text-orange-600 italic text-[11px]">{data.transferNote||'Transfer to agent'}</p>}
        {data.type === 'connect_flow' && (
          <div className="flex items-center gap-1.5 bg-fuchsia-50 border border-fuchsia-100 rounded-lg px-2 py-1.5">
            <Workflow size={12} className="text-fuchsia-500 flex-shrink-0"/>
            {data.target_flow_name
              ? <span className="text-[11px] font-semibold text-fuchsia-700 truncate">{data.target_flow_name as string}</span>
              : <span className="text-[11px] italic text-gray-300">Select flow…</span>}
          </div>
        )}
        {data.type === 'end'       && <p className="text-red-500 italic text-[11px]">✅ Flow ended</p>}
        {data.type === 'condition' && (
          <div className="space-y-1.5">
            <div className="text-[10px] text-gray-500 font-mono bg-gray-50 rounded-lg px-2 py-1.5 leading-tight">
              <span className="text-blue-600 font-semibold">{`{{${data.condition_variable||'user_message'}}}`}</span>
              <span className="text-gray-400 mx-1">{
                data.condition_operator==='equal'        ? '='   :
                data.condition_operator==='not_equal'    ? '≠'   :
                data.condition_operator==='contains'     ? 'contains' :
                data.condition_operator==='starts_with'  ? 'starts with' :
                data.condition_operator==='is_empty'     ? 'is empty' :
                data.condition_operator==='is_not_empty' ? 'is not empty' :
                data.condition_operator==='any'          ? '(any)' : '='
              }</span>
              {data.condition_operator!=='is_empty' && data.condition_operator!=='is_not_empty' && data.condition_operator!=='any' && (
                <span className="text-gray-700">{data.condition_value||<span className="italic text-gray-300">value</span>}</span>
              )}
            </div>
            <div className="relative flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 pr-5">
              <span className="text-[10px] text-green-700 font-semibold">✓ True</span>
              <Handle type="source" position={Position.Right} id="true"
                style={{ right: -10, top: '50%', transform: 'translateY(-50%)' }}
                className="!w-3.5 !h-3.5 !bg-green-500 !border-2 !border-white !rounded-full"/>
            </div>
            <div className="relative flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 pr-5">
              <span className="text-[10px] text-red-700 font-semibold">✗ False</span>
              <Handle type="source" position={Position.Right} id="false"
                style={{ right: -10, top: '50%', transform: 'translateY(-50%)' }}
                className="!w-3.5 !h-3.5 !bg-red-400 !border-2 !border-white !rounded-full"/>
            </div>
          </div>
        )}
      </div>
      {/* Handles */}
      <Handle type="target" position={Position.Left} className="!w-3.5 !h-3.5 !bg-gray-400 !border-2 !border-white"/>
      {data.type !== 'end' && data.type !== 'transfer' && data.type !== 'condition' &&
        data.type !== 'button_message' && data.type !== 'list_message' && data.type !== 'connect_flow' &&
        !(data.type === 'media_message' && (data.buttons||[]).length > 0) && (
          <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"/>
      )}
    </div>
  );
}
// ── Custom Edge with Delete Button + Label ───────────────────
function DeleteEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#teal-arrow)"
        style={{ stroke: '#0d9488', strokeWidth: 2, strokeDasharray: '6 3', animation: 'flowdash 0.7s linear infinite' }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ position:'absolute', transform:`translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents:'all' }}
          className="nodrag nopan group">
          <button
            onClick={() => setEdges((eds) => eds.filter((e) => e.id !== id))}
            className="w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow hover:bg-red-700">
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { flowNode: FlowNode };
const edgeTypes = { deleteEdge: DeleteEdge };

// ── Count positional vars ({{1}},{{2}}…) in a template body ───
function templateVarCount(body?: string): number {
  const m = body?.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  return new Set(m.map((x) => x.replace(/\D/g, ''))).size;
}

// ── Extract flow variables from all nodes ─────────────────────
function extractFlowVars(allNodes: Node[]): string[] {
  const vars = new Set<string>([
    'user_message','contact_phone','contact_name','selected_id','selected_title',
    'current_date','current_time','current_day','current_hour',
  ]);
  for (const n of allNodes) {
    const d = n.data as Record<string,string>;
    if (d.variable_name?.trim())   vars.add(d.variable_name.trim());
    if (d.save_id_as?.trim())      vars.add(d.save_id_as.trim());
    if (d.save_title_as?.trim())   vars.add(d.save_title_as.trim());
    if (d.save_response_as?.trim())vars.add(d.save_response_as.trim());
    // API Call node — "Extract fields" me banaye gaye variables bhi include karo
    const ef = (n.data as Record<string, unknown>).extract_fields as { path?: string; variable?: string }[] | undefined;
    if (Array.isArray(ef)) ef.forEach((f) => { if (f?.variable?.trim()) vars.add(f.variable.trim()); });
  }
  return Array.from(vars);
}

// Navigate a JSON value using a dot/bracket path, e.g. "[0].products_title" or "data.items.0.name"
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// Auto-detect first array anywhere in a JSON response (any key / nested)
function findFirstArray(obj: unknown): unknown[] | null {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const found = findFirstArray(v);
      if (found) return found;
    }
  }
  return null;
}

// ── Trigger node helpers ───────────────────────────────────────
// Real (non-trigger) nodes — used to decide if the canvas is "empty"
function realNodes(allNodes: Node[]): Node[] {
  return allNodes.filter(n => n.data?.type !== 'trigger');
}

// Ensure there's always exactly one 'trigger' node, positioned to the left
// of everything else, reflecting the flow's current trigger settings.
function ensureTriggerNode(allNodes: Node[], triggerType: string, triggerValue: string | null): Node[] {
  const existing = allNodes.find(n => n.data?.type === 'trigger');
  const others   = realNodes(allNodes);

  let position = existing?.position;
  if (!position) {
    if (others.length) {
      const minX = Math.min(...others.map(n => n.position.x));
      const avgY = others.reduce((sum, n) => sum + n.position.y, 0) / others.length;
      position = { x: minX - 280, y: avgY };
    } else {
      position = { x: 40, y: 40 };
    }
  }

  const trigger: Node = {
    id: existing?.id || 'trigger-node',
    type: 'flowNode',
    position,
    deletable: false,
    data: { type: 'trigger', trigger_type: triggerType, trigger_value: triggerValue || '' },
  };

  return [trigger, ...others];
}

// ── Config Panel ──────────────────────────────────────────────
function ConfigPanel({ node, allNodes, onUpdate, onDelete, onClose, onAddConnected, currentFlowId }: {
  node: Node; allNodes: Node[];
  onUpdate:(id:string,data:Record<string,unknown>)=>void;
  onDelete:(id:string)=>void; onClose:()=>void;
  onAddConnected:(sourceId:string, sourceHandle:string|null, type:NodeType)=>void;
  currentFlowId: string;
}) {
  const type = node.data.type as NodeType;
  const meta = NODE_TYPES_META[type];
  const Icon = meta.icon;

  const [text,           setText]          = useState(node.data.text||'');
  const [btnBodyText,    setBtnBodyText]   = useState(node.data.body_text||'');
  const [btnHeaderText,  setBtnHeaderText] = useState(node.data.header_text||'');
  const [btnFooterText,  setBtnFooterText] = useState(node.data.footer_text||'');
  const [buttons,        setButtons]       = useState<{ id: string; title: string }[]>(node.data.buttons||[]);
  const [transferNote,   setTransferNote]  = useState(node.data.transferNote||'');
  const [transferAgentId, setTransferAgentId] = useState(node.data.transfer_agent_id||'');
  const [agentsList,     setAgentsList]    = useState<{id:number;name:string;workspace_role?:string}[]>([]);
  const [loadingAgents,  setLoadingAgents] = useState(false);
  const [condVar,        setCondVar]       = useState(node.data.condition_variable||'user_message');
  const [condOp,         setCondOp]        = useState(node.data.condition_operator||'equal');
  const [condVal,        setCondVal]       = useState(node.data.condition_value||'');
  const flowVars = extractFlowVars(allNodes);
  const [mediaType,    setMediaType]    = useState<'IMAGE'|'VIDEO'|'DOCUMENT'|'AUDIO'>((node.data.media_type as 'IMAGE'|'VIDEO'|'DOCUMENT'|'AUDIO')||'IMAGE');
  const [mediaUrl,     setMediaUrl]     = useState(node.data.media_url||'');
  const [mediaId,      setMediaId]      = useState(node.data.media_id||'');
  const [mediaFilename,setMediaFilename]= useState('');
  const [mediaMime,    setMediaMime]    = useState('');
  const [showMediaLib, setShowMediaLib] = useState(false);
  const [showAddContent, setShowAddContent] = useState(false);
  const [mediaCaption, setMediaCaption] = useState(node.data.caption||'');
  const [mediaButtons, setMediaButtons] = useState<{id:string;title:string}[]>(node.data.buttons&&node.data.media_type?node.data.buttons:[]);
  const [varName,        setVarName]       = useState(node.data.variable_name||'');
  const [waitValType,    setWaitValType]   = useState((node.data.validation_type as string)||'none');
  const [waitValError,   setWaitValError]  = useState(node.data.validation_error||'');
  const [waitValPattern, setWaitValPattern]= useState(node.data.validation_pattern||'');
  const [apiUrl,         setApiUrl]        = useState(node.data.url||'');
  const [apiMethod,      setApiMethod]     = useState(node.data.method||'POST');
  const [apiHeaders,     setApiHeaders]    = useState(node.data.headers||'');
  const [apiBody,        setApiBody]       = useState(node.data.body||'');
  const [apiSaveAs,      setApiSaveAs]     = useState(node.data.save_response_as||'');
  const [apiExtractFields, setApiExtractFields] = useState<{path:string;variable:string}[]>(node.data.extract_fields||[]);
  const [apiTestLoading, setApiTestLoading]= useState(false);
  const [apiTestResult,  setApiTestResult] = useState<{ ok: boolean; status?: number; error?: string; raw?: string; extracted?: {path:string;variable:string;value:string}[] } | null>(null);
  const [contactField,   setContactField]  = useState(node.data.contact_field||'name');
  const [fieldValue,     setFieldValue]    = useState(node.data.field_value||'');
  const [delaySecs,      setDelaySecs]     = useState(node.data.seconds||2);
  const [tplName,        setTplName]       = useState(node.data.template_name||'');
  const [tplLang,        setTplLang]       = useState(node.data.language||'en');
  const [dynUrl,         setDynUrl]        = useState(node.data.url||'');
  const [dynMethod,      setDynMethod]     = useState(node.data.method||'GET');
  const [dynTestLoading, setDynTestLoading]= useState(false);
  const [dynTestResult,  setDynTestResult] = useState<{ ok: boolean; items?: {id:string;title:string;description?:string}[]; error?: string; raw?: string; _tab?: string } | null>(null);
  const [dynHeaders,     setDynHeaders]    = useState(node.data.headers||'');
  const [dynReqBody,     setDynReqBody]    = useState(node.data.body||'');
  const [dynItemsPath,   setDynItemsPath]  = useState(node.data.items_path||'');
  const [dynFields,      setDynFields]     = useState<string[]>([]);   // detected keys from Test API
  const [dynIdField,     setDynIdField]    = useState(node.data.id_field||'id');
  const [dynTitleField,  setDynTitleField] = useState(node.data.title_field||'name');
  const [dynDescField,   setDynDescField]  = useState(node.data.description_field||'');
  const [dynBodyText,    setDynBodyText]   = useState(node.data.body_text||'');
  const [dynHeaderText,  setDynHeaderText] = useState(node.data.header_text||'');
  const [dynFooterText,  setDynFooterText] = useState(node.data.footer_text||'');
  const [dynBtnText,     setDynBtnText]    = useState(node.data.list_button_text||'Select');
  const [dynSaveAs,      setDynSaveAs]     = useState(node.data.save_response_as||'');
  const [dynSaveIdAs,    setDynSaveIdAs]   = useState(node.data.save_id_as||'');
  const [dynSaveTitleAs, setDynSaveTitleAs]= useState(node.data.save_title_as||'');
  const [dynCache,       setDynCache]      = useState(!!node.data.cache_enabled);
  const [listBodyText,   setListBodyText]  = useState(node.data.body_text||'');
  const [listHeaderText, setListHeaderText]= useState(node.data.header_text||'');
  const [listFooterText, setListFooterText]= useState(node.data.footer_text||'');
  const [listButtonText, setListButtonText]= useState(node.data.list_button_text||'View Options');
  const [listSaveIdAs,   setListSaveIdAs]  = useState(node.data.save_id_as||'');
  const [listSaveTitleAs,setListSaveTitleAs]=useState(node.data.save_title_as||'');
  const [btnSaveIdAs,    setBtnSaveIdAs]   = useState(node.data.save_id_as||'');
  const [btnSaveTitleAs, setBtnSaveTitleAs]= useState(node.data.save_title_as||'');
  const [listSections,   setListSections]  = useState<{ title: string; rows: { id: string; title: string; description?: string }[] }[]>(
    node.data.list_sections || [{ title: '', rows: [] }]
  );
  
  // Multi Product state
  const [prodHeaderText, setProdHeaderText] = useState(node.data.header_text || '');
  const [prodBodyText,   setProdBodyText]   = useState(node.data.body_text || '');
  const [prodFooterText, setProdFooterText] = useState(node.data.footer_text || '');
  const [catalogId,      setCatalogId]      = useState(node.data.catalog_id || '');
  const [multiSections,  setMultiSections]  = useState<{title:string;product_items:{product_retailer_id:string}[]}[]>(
    node.data.multi_sections || [{ title: '', product_items: [{ product_retailer_id: '' }] }]
  );
  const [catalogProducts, setCatalogProducts] = useState<{retailer_id:string;name:string;price?:string;image_url?:string}[]>([]);
  const [loadingCatalogProducts, setLoadingCatalogProducts] = useState(false);

  // Connect Flow state
  const [targetFlowId,   setTargetFlowId]   = useState(node.data.target_flow_id || '');
  const [allFlows,       setAllFlows]       = useState<{id:number;name:string}[]>([]);
  const [loadingFlows,   setLoadingFlows]   = useState(false);

  // Template Node — approved templates dropdown
  const [tplList,        setTplList]        = useState<{name:string;language:string;status:string;body_text?:string;header_type?:string;header_content?:string}[]>([]);
  const [loadingTpls,    setLoadingTpls]    = useState(false);
  const [tplVars,        setTplVars]        = useState<string[]>(node.data.template_vars||[]);
  const [tplHeaderType,  setTplHeaderType]  = useState((node.data.template_header_type||'') as string); // fallback when template not in list
  const [tplHeaderMedia, setTplHeaderMedia] = useState(node.data.template_header_media||'');             // media id OR url
  const [tplHeaderFileName, setTplHeaderFileName] = useState('');
  const [tplHeaderUploading, setTplHeaderUploading] = useState(false);

  // Derived from the currently selected approved template (falls back to saved node.data)
  const selectedTpl     = tplList.find(t=>t.name===tplName);
  const tplVarCountNum  = selectedTpl ? templateVarCount(selectedTpl.body_text) : tplVars.length;
  const tplHeaderTypeEff = (() => {
    const ht = (selectedTpl?.header_type ?? tplHeaderType ?? '').toUpperCase();
    return ['IMAGE','VIDEO','DOCUMENT'].includes(ht) ? ht : '';
  })();
  const isTplMedia = !!tplHeaderTypeEff;

  async function uploadTplNodeHeaderFile(file: File) {
    const ALLOWED: Record<string, number> = { 'application/pdf':10, 'image/jpeg':5, 'image/png':5, 'video/mp4':16 };
    const maxMB = ALLOWED[file.type];
    if (!maxMB) { toast.error(`Unsupported file type: ${file.type || 'unknown'}. Allowed: PDF, JPG, PNG, MP4`); return; }
    if (file.size > maxMB*1024*1024) { toast.error(`File is ${(file.size/(1024*1024)).toFixed(1)} MB — must be under ${maxMB} MB`); return; }
    setTplHeaderUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/media', { method:'POST', headers:{ Authorization:`Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setTplHeaderMedia(data.data.mediaId);
      setTplHeaderFileName(file.name);
      toast.success('Header media uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally { setTplHeaderUploading(false); }
  }

  // Load list of flows once when connect_flow panel opens
  useEffect(() => {
    if (type !== 'connect_flow') return;
    setLoadingFlows(true);
    apiFetch('/api/flows')
      .then(r => setAllFlows((r.data || []).filter((f: {id:number}) => String(f.id) !== String(currentFlowId))))
      .catch(() => setAllFlows([]))
      .finally(() => setLoadingFlows(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Load agents once when transfer panel opens
  useEffect(() => {
    if (type !== 'transfer') return;
    setLoadingAgents(true);
    apiFetch('/api/agents')
      .then(r => setAgentsList((r.data || []).map((a: {id:number;name:string;workspace_role?:string}) => ({ id:a.id, name:a.name, workspace_role:a.workspace_role }))))
      .catch(() => setAgentsList([]))
      .finally(() => setLoadingAgents(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Load approved templates once when template panel opens
  useEffect(() => {
    if (type !== 'template') return;
    setLoadingTpls(true);
    apiFetch('/api/templates')
      .then(r => setTplList((r.data || []).filter((t: {status?:string}) => (t.status || '').toUpperCase() === 'APPROVED')))
      .catch(() => setTplList([]))
      .finally(() => setLoadingTpls(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Load catalog products once when multi_product panel opens
  useEffect(() => {
    if (type !== 'multi_product') return;
    async function fetchCatalogProducts() {
      setLoadingCatalogProducts(true);
      try {
        // First get the connected catalog_id
        const r1 = await apiFetch('/api/catalog?action=catalogs');
        const cid = r1.data.selected_catalog_id || catalogId;
        if (!cid) return;
        if (!catalogId) setCatalogId(cid);
        const r2 = await apiFetch(`/api/catalog?action=products&id=${cid}`);
        setCatalogProducts(r2.data.products || []);
      } catch { /* ignore */ }
      finally { setLoadingCatalogProducts(false); }
    }
    fetchCatalogProducts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  function save() {
    const base = { type: node.data.type };
    const updates: Record<string,unknown> = { ...base };
    if (type==='message')        { updates.text = text; }
    if (type==='button_message') { updates.body_text=btnBodyText; updates.header_text=btnHeaderText; updates.footer_text=btnFooterText; updates.buttons=buttons; updates.save_id_as=btnSaveIdAs; updates.save_title_as=btnSaveTitleAs; }
    if (type==='transfer')       { updates.transferNote = transferNote; updates.transfer_agent_id = transferAgentId; updates.transfer_agent_name = agentsList.find(a=>String(a.id)===String(transferAgentId))?.name || node.data.transfer_agent_name || ''; }
    if (type==='condition')      { updates.condition_variable = condVar; updates.condition_operator = condOp; updates.condition_value = condVal; }
    if (type==='set_variable')   { updates.variable_name = varName; }
    if (type==='wait')           { updates.validation_type = waitValType; updates.validation_error = waitValError; updates.validation_pattern = waitValPattern; }
    if (type==='api_call')       { updates.url=apiUrl; updates.method=apiMethod; updates.headers=apiHeaders; updates.body=apiBody; updates.save_response_as=apiSaveAs; updates.extract_fields=apiExtractFields.filter(f=>f.path&&f.variable); }
    if (type==='update_contact') { updates.contact_field=contactField; updates.field_value=fieldValue; }
    if (type==='delay')          { updates.seconds=Number(delaySecs); }
    if (type==='template')       {
      updates.template_name=tplName;
      updates.language=tplLang;
      updates.template_vars=tplVars.slice(0, tplVarCountNum);
      updates.template_header_type=tplHeaderTypeEff;
      updates.template_header_media=isTplMedia ? tplHeaderMedia : '';
    }
    if (type==='list_message')   { updates.body_text=listBodyText; updates.header_text=listHeaderText; updates.footer_text=listFooterText; updates.list_button_text=listButtonText; updates.list_sections=listSections; updates.save_id_as=listSaveIdAs; updates.save_title_as=listSaveTitleAs; }
    if (type==='dynamic_list')   { updates.url=dynUrl; updates.method=dynMethod; updates.headers=dynHeaders; updates.body=dynReqBody; updates.items_path=dynItemsPath; updates.id_field=dynIdField; updates.title_field=dynTitleField; updates.description_field=dynDescField; updates.body_text=dynBodyText; updates.header_text=dynHeaderText; updates.footer_text=dynFooterText; updates.list_button_text=dynBtnText; updates.save_response_as=dynSaveAs; updates.save_id_as=dynSaveIdAs; updates.save_title_as=dynSaveTitleAs; updates.cache_enabled=dynCache; }
    if (type==='media_message') { updates.media_type=mediaType; updates.media_url=mediaUrl; updates.media_id=mediaId; updates.caption=mediaCaption; updates.buttons=mediaButtons; }
    if (type==='multi_product') { updates.header_text=prodHeaderText; updates.body_text=prodBodyText; updates.footer_text=prodFooterText; updates.catalog_id=catalogId; updates.multi_sections=multiSections; }
    if (type==='connect_flow')   { updates.target_flow_id=targetFlowId; updates.target_flow_name=allFlows.find(f=>String(f.id)===String(targetFlowId))?.name || node.data.target_flow_name || ''; }
    onUpdate(node.id, updates);
    onClose();
  }

  const readOnly = type==='end';

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full shadow-xl">
      <div className={`${meta.color} text-white px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2"><Icon size={15}/><span className="font-semibold text-sm">{meta.label} Node</span></div>
        <button onClick={onClose} className="opacity-80 hover:opacity-100"><X size={16}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">

        {/* MESSAGE */}
        {type==='message' && <>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Message Text</label>
            <textarea value={text} onChange={e=>setText(e.target.value)} rows={5}
              placeholder="Type the message to send…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-whatsapp-green resize-none text-sm"/>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 space-y-1">
            <p className="font-semibold text-green-800">Available variables:</p>
            {['{{user_message}}','{{contact_phone}}','{{contact_name}}','{{any_variable}}'].map(v=>(
              <p key={v} className="font-mono text-green-700">{v}</p>
            ))}
          </div>
        </>}

        {/* BUTTON MESSAGE */}
        {type==='button_message' && <>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="font-semibold text-emerald-800 mb-1">🔘 Button Message Node</p>
            <p className="text-emerald-700">Sends WhatsApp interactive buttons (max 3). Each button has its own output handle — connect each to a different next node.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Header (optional)</label>
            <input value={btnHeaderText} onChange={e=>setBtnHeaderText(e.target.value)}
              placeholder="e.g. RO Care India" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Message Body *</label>
            <textarea value={btnBodyText} onChange={e=>setBtnBodyText(e.target.value)} rows={3}
              placeholder="How can we help you? Please select an option:"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-none"/>
          </div>
          <div className="space-y-2">
            <label className="block font-semibold text-gray-600">Buttons (max 3)</label>
            {buttons.map((b, i) => (
              <div key={i} className="flex gap-2 items-center bg-gray-50 rounded-lg p-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-8 flex-shrink-0 text-[11px]">ID:</span>
                    <input value={b.id} onChange={e=>{const n=[...buttons];n[i]={...n[i],id:e.target.value};setButtons(n);}}
                      placeholder="btn_1" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400"/>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-8 flex-shrink-0 text-[11px]">Text:</span>
                    <input value={b.title} onChange={e=>{const n=[...buttons];n[i]={...n[i],title:e.target.value.slice(0,20)};setButtons(n);}}
                      placeholder="Book Service (max 20)" maxLength={20}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-400"/>
                  </div>
                </div>
                <button onClick={()=>setButtons(buttons.filter((_,j)=>j!==i))} className="text-gray-300 hover:text-red-500"><Trash2 size={12}/></button>
              </div>
            ))}
            {buttons.length < 3 && (
              <button onClick={()=>setButtons([...buttons,{id:`btn_${buttons.length+1}`,title:''}])}
                className="flex items-center gap-1 text-emerald-600 hover:text-emerald-800 font-medium text-xs">
                <Plus size={11}/> Add Button
              </button>
            )}
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Footer (optional)</label>
            <input value={btnFooterText} onChange={e=>setBtnFooterText(e.target.value)}
              placeholder="e.g. Powered by Limbu.ai" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"/>
          </div>
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-2">
            <p className="font-semibold text-teal-800 text-[11px]">💾 Save Selection as Variable (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-gray-500 text-[10px] mb-1">Save button ID as</label>
                <input value={btnSaveIdAs} onChange={e=>setBtnSaveIdAs(e.target.value)}
                  placeholder="e.g. selected_btn"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"/>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] mb-1">Save button text as</label>
                <input value={btnSaveTitleAs} onChange={e=>setBtnSaveTitleAs(e.target.value)}
                  placeholder="e.g. selected_service"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"/>
              </div>
            </div>
            {(btnSaveIdAs||btnSaveTitleAs) && (
              <p className="text-teal-600 text-[10px]">
                {btnSaveIdAs && <span>Use <code className="bg-teal-100 px-1 rounded">{`{{${btnSaveIdAs}}}`}</code>. </span>}
                {btnSaveTitleAs && <span>Use <code className="bg-teal-100 px-1 rounded">{`{{${btnSaveTitleAs}}}`}</code>.</span>}
              </p>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 space-y-1">
            <p className="font-semibold text-blue-800 text-[11px]">💡 Separate flow per button:</p>
            <p className="text-blue-700 text-[11px]">Connect each button handle directly to its next node. The button ID is used to route the flow.</p>
          </div>
        </>}

        {/* DYNAMIC LIST */}
        {type==='dynamic_list' && <>
          <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
            <p className="font-semibold text-violet-800 mb-1">🌐 Dynamic List Node</p>
            <p className="text-violet-700">Fetches items from an API and sends them as a WhatsApp list. When the user selects an item, the flow branches by item ID.</p>
          </div>

          {/* API Config */}
          <p className="font-semibold text-gray-700 text-[11px] uppercase tracking-wide">API Settings</p>
          <div className="flex gap-2">
            <select value={dynMethod} onChange={e=>setDynMethod(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none w-20 flex-shrink-0">
              <option>GET</option><option>POST</option><option>PUT</option>
            </select>
            <input value={dynUrl} onChange={e=>setDynUrl(e.target.value)}
              placeholder="https://api.example.com/products"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 font-mono"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Headers (JSON, optional)</label>
            <textarea value={dynHeaders} onChange={e=>setDynHeaders(e.target.value)} rows={2}
              placeholder={'{"Authorization": "Bearer {{token}}"}'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"/>
          </div>
          {dynMethod !== 'GET' && <div>
            <label className="block font-semibold text-gray-600 mb-1">Request Body (JSON, optional)</label>
            <textarea value={dynReqBody} onChange={e=>setDynReqBody(e.target.value)} rows={2}
              placeholder={'{"category": "{{user_message}}"}'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"/>
          </div>}

          {/* Response Mapping */}
          <p className="font-semibold text-gray-700 text-[11px] uppercase tracking-wide">Response → List Items</p>
          <p className="text-[10px] text-gray-400">WhatsApp list = max 10 rows. 10+ items hone par flow apne aap <span className="font-medium">"➡️ Show more"</span> row daal deta hai jo agli page dikhata hai.</p>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Items path (optional)</label>
            <input value={dynItemsPath} onChange={e=>setDynItemsPath(e.target.value)}
              placeholder="e.g. data.products  (leave empty if response is a root array)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"/>
            <p className="text-gray-400 mt-1 text-[10px]">API returns: <code className="bg-gray-100 px-1">{`{ "data": { "products": [...] } }`}</code> → path: <code className="bg-gray-100 px-1">data.products</code></p>
          </div>
          {/* Keys detected from Test API — dropdown me aa jaate hain */}
          <datalist id="dynDetectedFields">
            {dynFields.map((k) => <option key={k} value={k} />)}
          </datalist>
          {dynFields.length > 0 && (
            <p className="text-[10px] text-gray-500">
              Detected fields:{' '}
              {dynFields.map((k) => (
                <code key={k} className="bg-violet-50 text-violet-700 px-1 rounded mr-1">{k}</code>
              ))}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold text-gray-600 mb-1">ID field *</label>
              <input list="dynDetectedFields" value={dynIdField} onChange={e=>setDynIdField(e.target.value)}
                placeholder="id" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"/>
            </div>
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Title field *</label>
              <input list="dynDetectedFields" value={dynTitleField} onChange={e=>setDynTitleField(e.target.value)}
                placeholder="name" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"/>
            </div>
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Desc field</label>
              <input list="dynDetectedFields" value={dynDescField} onChange={e=>setDynDescField(e.target.value)}
                placeholder="desc" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"/>
            </div>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Save response as (optional)</label>
            <input value={dynSaveAs} onChange={e=>setDynSaveAs(e.target.value)}
              placeholder="e.g. products_data"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"/>
          </div>

          {/* Cache toggle */}
          <div className={`rounded-lg border p-2.5 ${dynCache ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200'}`}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={dynCache} onChange={e=>setDynCache(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="font-semibold text-gray-700 text-xs">Cache list (faster)</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  Calls the API once and stores the data — it won't call on every message. Auto-refreshes every <strong>24 hours</strong> (new data is picked up too). Makes the flow faster.
                </span>
              </span>
            </label>
          </div>

          {/* Test API */}
          <div className="space-y-2">
            <button
              onClick={async () => {
                if (!dynUrl) return;
                setDynTestLoading(true);
                setDynTestResult(null);
                try {
                  let headersObj: Record<string,string> = {};
                  if (dynHeaders) {
                    try { headersObj = JSON.parse(dynHeaders); } catch { /**/ }
                  }
                  // Use server-side proxy to avoid CORS issues
                  const token = localStorage.getItem('token');
                  const proxyRes = await fetch('/api/proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      url:     dynUrl,
                      method:  dynMethod,
                      headers: headersObj,
                      body:    dynMethod !== 'GET' && dynReqBody ? dynReqBody : undefined,
                    }),
                  });
                  const proxyData = await proxyRes.json();
                  const data: unknown = proxyData.data;

                  // Navigate to items path
                  let arr: unknown = data;
                  if (dynItemsPath) {
                    for (const key of dynItemsPath.split('.')) {
                      if (arr && typeof arr === 'object') arr = (arr as Record<string,unknown>)[key];
                    }
                  }
                  // Fallback: path se array na mile (ya khaali ho) to response me se pehli array khud dhoondo
                  if (!Array.isArray(arr)) arr = findFirstArray(data);

                  if (Array.isArray(arr)) {
                    // Detect available keys from the first item → dropdown me dikhao + smart auto-fill
                    const first = arr[0];
                    if (first && typeof first === 'object') {
                      const keys = Object.keys(first as Record<string, unknown>);
                      setDynFields(keys);
                      const guess = (cands: string[]) => keys.find(k => cands.includes(k.toLowerCase()));
                      const idGuess    = guess(['id','_id','value','key','type_id','product_id','item_id']);
                      const titleGuess = guess(['title','name','label','type','text','product_name']);
                      const descGuess  = guess(['description','desc','subtitle','detail','details']);
                      if ((!dynIdField    || dynIdField === 'id')   && idGuess)    setDynIdField(idGuess);
                      if ((!dynTitleField || dynTitleField === 'name') && titleGuess) setDynTitleField(titleGuess);
                      if (!dynDescField && descGuess) setDynDescField(descGuess);
                    }
                    const items = (arr as Record<string,unknown>[]).slice(0, 5).map((item, idx) => ({
                      id:          String(item[dynIdField||'id']    ?? idx + 1),
                      title:       String(item[dynTitleField||'title'] ?? `Item ${idx+1}`),
                      description: dynDescField && item[dynDescField] ? String(item[dynDescField]) : undefined,
                    }));
                    setDynTestResult({ ok: true, items, raw: JSON.stringify(data, null, 2) });
                  } else {
                    setDynTestResult({ ok: false, error: 'Could not find array at specified path. Check Items Path field.', raw: JSON.stringify(data, null, 2) });
                  }
                } catch (e) {
                  setDynTestResult({ ok: false, error: e instanceof Error ? e.message : 'Request failed. Check URL and network.' });
                } finally {
                  setDynTestLoading(false);
                }
              }}
              disabled={!dynUrl || dynTestLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
              {dynTestLoading
                ? <><Loader2 size={13} className="animate-spin"/> Testing…</>
                : <><Zap size={13}/> Test API</>}
            </button>

            {dynTestResult && (
              <div className="rounded-lg border overflow-hidden">
                {/* Status bar */}
                <div className={`px-3 py-2 flex items-center gap-2 ${dynTestResult.ok ? 'bg-green-600' : 'bg-red-600'}`}>
                  <span className="text-white text-[11px] font-semibold">
                    {dynTestResult.ok ? `✓ Success — ${dynTestResult.items?.length} item(s) extracted` : `✗ ${dynTestResult.error}`}
                  </span>
                </div>

                {/* Tabs */}
                {(() => {
                  const [tab, setTab] = [dynTestResult._tab||'response', (t: string) => setDynTestResult(p => p ? {...p, _tab: t} : p)];
                  return (
                    <>
                      <div className="flex border-b border-gray-200 bg-gray-50">
                        {['response', 'items'].map(t => (
                          <button key={t} onClick={() => setTab(t)}
                            className={`px-3 py-1.5 text-[10px] font-semibold capitalize border-b-2 transition-colors
                              ${tab === t ? 'border-violet-500 text-violet-700 bg-white' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                            {t === 'response' ? 'Raw Response' : `Extracted Items (${dynTestResult.items?.length||0})`}
                          </button>
                        ))}
                      </div>

                      {tab === 'response' && (
                        <div className="bg-gray-900 max-h-52 overflow-y-auto">
                          <pre className="text-[10px] text-green-400 font-mono p-3 whitespace-pre-wrap leading-relaxed">
                            {dynTestResult.raw || 'No response body'}
                          </pre>
                        </div>
                      )}

                      {tab === 'items' && (
                        <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                          {dynTestResult.items?.length ? dynTestResult.items.map((item, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                              <span className="text-[9px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{item.id}</span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-gray-800 truncate">{item.title}</p>
                                {item.description && <p className="text-[9px] text-gray-400 truncate">{item.description}</p>}
                              </div>
                            </div>
                          )) : (
                            <p className="text-[11px] text-gray-400 text-center py-4">No items extracted — check Items Path and field names</p>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Message Config */}
          <p className="font-semibold text-gray-700 text-[11px] uppercase tracking-wide">Message Config</p>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Header (optional)</label>
            <input value={dynHeaderText} onChange={e=>setDynHeaderText(e.target.value)}
              placeholder="e.g. Available Products"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Body Text *</label>
            <textarea value={dynBodyText} onChange={e=>setDynBodyText(e.target.value)} rows={3}
              placeholder="Please select an option:"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Button Text</label>
              <input value={dynBtnText} onChange={e=>setDynBtnText(e.target.value.slice(0,20))} maxLength={20}
                placeholder="Select" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"/>
            </div>
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Footer (optional)</label>
              <input value={dynFooterText} onChange={e=>setDynFooterText(e.target.value)}
                placeholder="Powered by..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"/>
            </div>
          </div>
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-2">
            <p className="font-semibold text-teal-800 text-[11px]">💾 Save Selection as Variable (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-gray-500 text-[10px] mb-1">Save item ID as</label>
                <input value={dynSaveIdAs} onChange={e=>setDynSaveIdAs(e.target.value)}
                  placeholder="e.g. service_id"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"/>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] mb-1">Save item title as</label>
                <input value={dynSaveTitleAs} onChange={e=>setDynSaveTitleAs(e.target.value)}
                  placeholder="e.g. service_name"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"/>
              </div>
            </div>
            {(dynSaveIdAs||dynSaveTitleAs) && (
              <p className="text-teal-600 text-[10px]">
                {dynSaveIdAs && <span>Use <code className="bg-teal-100 px-1 rounded">{`{{${dynSaveIdAs}}}`}</code>. </span>}
                {dynSaveTitleAs && <span>Use <code className="bg-teal-100 px-1 rounded">{`{{${dynSaveTitleAs}}}`}</code>.</span>}
              </p>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 space-y-1">
            <p className="font-semibold text-blue-800 text-[11px]">💡 Flow Pattern:</p>
            <p className="text-blue-700 text-[11px] font-mono">Dynamic List → next node (branches by item ID)</p>
            <p className="text-blue-700 text-[11px]">Connect each item's ID to a separate branch. The item ID routes the flow.</p>
          </div>
        </>}

        {/* LIST MESSAGE */}
        {type==='list_message' && <>
          <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3">
            <p className="font-semibold text-cyan-800 mb-1">📋 List Menu Node</p>
            <p className="text-cyan-700">Sends a WhatsApp scrollable list. When user selects an item, flow branches by row ID.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Header (optional)</label>
            <input value={listHeaderText} onChange={e=>setListHeaderText(e.target.value)}
              placeholder="e.g. Help Menu" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Message Body *</label>
            <textarea value={listBodyText} onChange={e=>setListBodyText(e.target.value)} rows={3}
              placeholder="Please select an option below:"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400 resize-none"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Button Text (max 20 chars)</label>
            <input value={listButtonText} onChange={e=>setListButtonText(e.target.value.slice(0,20))}
              placeholder="View Options" maxLength={20}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"/>
          </div>
          <div className="space-y-2">
            <label className="block font-semibold text-gray-600">List Items (max 10)</label>
            {(listSections[0]?.rows || []).map((r, i) => (
              <div key={i} className="flex gap-2 items-start bg-gray-50 rounded-lg p-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-8 flex-shrink-0 text-[11px]">ID:</span>
                    <input value={r.id} onChange={e=>{const s=[...listSections];s[0].rows[i]={...s[0].rows[i],id:e.target.value};setListSections(s);}}
                      placeholder="order_status" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-cyan-400"/>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-8 flex-shrink-0 text-[11px]">Title:</span>
                    <input value={r.title} onChange={e=>{const s=[...listSections];s[0].rows[i]={...s[0].rows[i],title:e.target.value.slice(0,24)};setListSections(s);}}
                      placeholder="Order Status (max 24)" maxLength={24}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-400"/>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-8 flex-shrink-0 text-[11px]">Desc:</span>
                    <input value={r.description||''} onChange={e=>{const s=[...listSections];s[0].rows[i]={...s[0].rows[i],description:e.target.value.slice(0,72)};setListSections(s);}}
                      placeholder="optional (max 72)" maxLength={72}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-400"/>
                  </div>
                </div>
                <button onClick={()=>{const s=[...listSections];s[0].rows=s[0].rows.filter((_,j)=>j!==i);setListSections(s);}} className="text-gray-300 hover:text-red-500 mt-1"><Trash2 size={12}/></button>
              </div>
            ))}
            {(listSections[0]?.rows?.length||0) < 10 && (
              <button onClick={()=>{const s=[...listSections];if(!s[0])s[0]={title:'',rows:[]};s[0].rows=[...s[0].rows,{id:`item_${(s[0].rows.length||0)+1}`,title:'',description:''}];setListSections(s);}}
                className="flex items-center gap-1 text-cyan-600 hover:text-cyan-800 font-medium text-xs">
                <Plus size={11}/> Add Item
              </button>
            )}
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Footer (optional)</label>
            <input value={listFooterText} onChange={e=>setListFooterText(e.target.value)}
              placeholder="e.g. Powered by Limbu.ai" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"/>
          </div>
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-2">
            <p className="font-semibold text-teal-800 text-[11px]">💾 Save Selection as Variable (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-gray-500 text-[10px] mb-1">Save ID as</label>
                <input value={listSaveIdAs} onChange={e=>setListSaveIdAs(e.target.value)}
                  placeholder="e.g. lead_type"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"/>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] mb-1">Save Title as</label>
                <input value={listSaveTitleAs} onChange={e=>setListSaveTitleAs(e.target.value)}
                  placeholder="e.g. category_name"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"/>
              </div>
            </div>
            {(listSaveIdAs||listSaveTitleAs) && (
              <p className="text-teal-600 text-[10px]">
                {listSaveIdAs && <span>Use <code className="bg-teal-100 px-1 rounded">{`{{${listSaveIdAs}}}`}</code> for ID. </span>}
                {listSaveTitleAs && <span>Use <code className="bg-teal-100 px-1 rounded">{`{{${listSaveTitleAs}}}`}</code> for title.</span>}
              </p>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
            <p className="font-semibold text-blue-800 mb-1 text-[11px]">💡 Connect to separate branches</p>
            <p className="text-blue-700 text-[11px]">Each row handle connects directly to its own next node. The row ID routes the flow.</p>
          </div>
        </>}

        {/* WAIT */}
        {type==='wait' && <>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="font-semibold text-yellow-800 mb-1">⏳ Wait Node</p>
            <p className="text-yellow-700">Flow pauses here and waits for the user to reply. Connect to the next node to continue.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Validate reply (optional)</label>
            <select value={waitValType} onChange={e=>setWaitValType(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
              <option value="none">No validation (accept anything)</option>
              <option value="number">Number only (digits)</option>
              <option value="pincode">Pincode (6 digits)</option>
              <option value="phone">Phone (10–15 digits)</option>
              <option value="email">Email</option>
              <option value="regex">Custom pattern (regex)</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">Reply is format se match na ho to error message jaayega aur flow yahi wait karega (user dobara bhejega).</p>
          </div>
          {waitValType==='regex' && (
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Regex pattern</label>
              <input value={waitValPattern} onChange={e=>setWaitValPattern(e.target.value)}
                placeholder="e.g. ^[A-Z]{2}\\d{4}$"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-yellow-400"/>
            </div>
          )}
          {waitValType!=='none' && (
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Error message (on invalid input)</label>
              <textarea value={waitValError} onChange={e=>setWaitValError(e.target.value)}
                placeholder="e.g. Please enter a valid 6-digit pincode (numbers only)."
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-yellow-400"/>
              <p className="text-[10px] text-gray-400 mt-1">Khaali chhoda to default message jaayega. {'{{vars}}'} bhi use kar sakte ho.</p>
            </div>
          )}
        </>}

        {/* CONDITION */}
        {type==='condition' && <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
            <p className="font-semibold text-blue-800 text-[11px]">🔀 Condition node — the True branch runs if the condition matches, otherwise False.</p>
          </div>
          {/* Variable */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Select Condition</label>
            <select value={condOp} onChange={e=>setCondOp(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
              <option value="equal">Equal</option>
              <option value="not_equal">Not Equal</option>
              <option value="contains">Contains</option>
              <option value="starts_with">Starts With</option>
              <option value="is_empty">Is Empty / Not Set</option>
              <option value="is_not_empty">Is Not Empty</option>
              <option value="any">Any value (always True)</option>
            </select>
          </div>
          {/* Variable / Attribute */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Select Attribute</label>
            <select value={condVar} onChange={e=>setCondVar(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
              {flowVars.map(v=>{
                const labels: Record<string,string> = {
                  current_date:'current_date (YYYY-MM-DD)',
                  current_time:'current_time (HH:mm)',
                  current_day: 'current_day (monday…)',
                  current_hour:'current_hour (0–23)',
                  user_message:'user_message',
                  contact_phone:'contact_phone',
                  contact_name:'contact_name',
                };
                return <option key={v} value={v}>{labels[v] ?? `${v}`}</option>;
              })}
            </select>
          </div>
          {/* Value */}
          {condOp !== 'any' && condOp !== 'is_empty' && condOp !== 'is_not_empty' && (
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 mb-1">Value</label>
              <input value={condVal} onChange={e=>setCondVal(e.target.value)}
                placeholder="e.g. yes, 1, Water Purifier"
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
            </div>
          )}
          {/* True / False preview */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0"/>
              <span className="text-xs font-semibold text-green-700">True</span>
              <span className="text-[10px] text-green-500 ml-auto">→ connect this to next node</span>
            </div>
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <div className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0"/>
              <span className="text-xs font-semibold text-red-700">False</span>
              <span className="text-[10px] text-red-400 ml-auto">→ connect this to next node</span>
            </div>
          </div>
        </>}

        {/* SET VARIABLE */}
        {type==='set_variable' && <>
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
            <p className="font-semibold text-teal-800 mb-1">💾 Save Reply Node</p>
            <p className="text-teal-700">The user's reply is saved into a variable. Use it later with <code className="bg-teal-100 px-1 rounded">{'{{variable_name}}'}</code>.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Variable name</label>
            <input value={varName} onChange={e=>setVarName(e.target.value)}
              placeholder="e.g. user_name, order_id, phone"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400 text-sm font-mono"/>
            <p className="text-gray-400 mt-1">Use later as: <code className="bg-gray-100 px-1">{`{{${varName||'variable_name'}}}`}</code></p>
          </div>
        </>}

        {/* API CALL */}
        {type==='api_call' && <>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="font-semibold text-purple-800 mb-1">🌐 API Call Node</p>
            <p className="text-purple-700">Makes an HTTP request to an external URL. Variables are supported.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">URL *</label>
            <input value={apiUrl} onChange={e=>setApiUrl(e.target.value)}
              placeholder="https://yourcrm.com/api/lead"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 text-sm font-mono"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Method</label>
            <select value={apiMethod} onChange={e=>setApiMethod(e.target.value as 'GET'|'POST'|'PUT'|'PATCH')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none text-sm">
              <option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Headers (JSON, optional)</label>
            <textarea value={apiHeaders} onChange={e=>setApiHeaders(e.target.value)} rows={2}
              placeholder={'{"Authorization": "Bearer TOKEN"}'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 text-sm font-mono resize-none"/>
          </div>
          {apiMethod !== 'GET' && <div>
            <label className="block font-semibold text-gray-600 mb-1">Body (JSON, variables supported)</label>
            <textarea value={apiBody} onChange={e=>setApiBody(e.target.value)} rows={4}
              placeholder={'{\n  "phone": "{{contact_phone}}",\n  "name": "{{user_name}}",\n  "message": "{{user_message}}"\n}'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 text-sm font-mono resize-none"/>
          </div>}
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Save full response as (optional)</label>
            <input value={apiSaveAs} onChange={e=>setApiSaveAs(e.target.value)}
              placeholder="e.g. api_response (variable name)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 text-sm font-mono"/>
          </div>

          {/* Extract fields from response */}
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Extract fields from response (optional)</label>
            <div className="space-y-2">
              {apiExtractFields.map((f, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <input value={f.path}
                    onChange={e=>setApiExtractFields(prev=>prev.map((p,i)=>i===idx?{...p, path:e.target.value}:p))}
                    placeholder="e.g. [0].products_title or data.items[0].price"
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-purple-400"/>
                  <span className="text-gray-400 text-xs pt-2">→</span>
                  <input value={f.variable}
                    onChange={e=>setApiExtractFields(prev=>prev.map((p,i)=>i===idx?{...p, variable:e.target.value}:p))}
                    placeholder="variable name"
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-purple-400"/>
                  <button onClick={()=>setApiExtractFields(prev=>prev.filter((_,i)=>i!==idx))}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                    <Trash2 size={14}/>
                  </button>
                </div>
              ))}
              <button onClick={()=>setApiExtractFields(prev=>[...prev, {path:'', variable:''}])}
                className="flex items-center gap-1.5 text-purple-600 hover:text-purple-700 text-xs font-semibold">
                <Plus size={13}/> Add field
              </button>
            </div>
            <p className="text-gray-400 text-[10px] mt-1">
              Response JSON se ek value nikal kar variable mein save karo. Array ho to index use karo, e.g.{' '}
              <code className="bg-gray-100 px-1">{'[0].products_title'}</code> pehle item ka title{' '}
              <code className="bg-gray-100 px-1">{'product_title'}</code> variable mein save karega — aage{' '}
              <code className="bg-gray-100 px-1">{'{{product_title}}'}</code> se use karo.
            </p>
          </div>

          <div className="bg-gray-50 rounded-lg p-2 text-gray-500">
            Available vars: <code className="bg-gray-200 px-1">{'{{contact_phone}}'}</code> <code className="bg-gray-200 px-1">{'{{contact_name}}'}</code> <code className="bg-gray-200 px-1">{'{{user_message}}'}</code> and any saved variable
          </div>

          {/* Test API */}
          <div className="space-y-2">
            <button
              onClick={async () => {
                if (!apiUrl) return;
                setApiTestLoading(true);
                setApiTestResult(null);
                try {
                  let headersObj: Record<string,string> = {};
                  if (apiHeaders) {
                    try { headersObj = JSON.parse(apiHeaders); } catch { /**/ }
                  }
                  // Use server-side proxy to avoid CORS issues
                  const token = localStorage.getItem('token');
                  const proxyRes = await fetch('/api/proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      url:     apiUrl,
                      method:  apiMethod,
                      headers: headersObj,
                      body:    apiMethod !== 'GET' && apiBody ? apiBody : undefined,
                    }),
                  });
                  const proxyData = await proxyRes.json();
                  if (proxyData.error && proxyData.ok === undefined) {
                    setApiTestResult({ ok: false, error: proxyData.error });
                  } else {
                    const validFields = apiExtractFields.filter(f=>f.path && f.variable);
                    const extracted = validFields.map(f => {
                      const val = getByPath(proxyData.data, f.path);
                      return {
                        path:     f.path,
                        variable: f.variable,
                        value:    val !== undefined && val !== null ? (typeof val==='object' ? JSON.stringify(val) : String(val)) : '(not found)',
                      };
                    });
                    setApiTestResult({
                      ok:     !!proxyData.ok,
                      status: proxyData.status,
                      raw:    JSON.stringify(proxyData.data, null, 2),
                      extracted: extracted.length ? extracted : undefined,
                    });
                  }
                } catch (e) {
                  setApiTestResult({ ok: false, error: e instanceof Error ? e.message : 'Request failed. Check URL and network.' });
                } finally {
                  setApiTestLoading(false);
                }
              }}
              disabled={!apiUrl || apiTestLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
              {apiTestLoading
                ? <><Loader2 size={13} className="animate-spin"/> Testing…</>
                : <><Zap size={13}/> Test API</>}
            </button>

            {apiTestResult && (
              <div className="rounded-lg border overflow-hidden">
                <div className={`px-3 py-2 flex items-center gap-2 ${apiTestResult.ok ? 'bg-green-600' : 'bg-red-600'}`}>
                  <span className="text-white text-[11px] font-semibold">
                    {apiTestResult.ok ? `✓ Success — Status ${apiTestResult.status}` : `✗ ${apiTestResult.error || `Failed — Status ${apiTestResult.status}`}`}
                  </span>
                </div>
                <div className="bg-gray-900 max-h-52 overflow-y-auto">
                  <pre className="text-[10px] text-green-400 font-mono p-3 whitespace-pre-wrap leading-relaxed">
                    {apiTestResult.raw || 'No response body'}
                  </pre>
                </div>

                {apiTestResult.extracted && (
                  <div className="border-t border-gray-200 bg-purple-50">
                    <p className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide px-3 pt-2">Extracted Fields Preview</p>
                    <div className="divide-y divide-purple-100">
                      {apiTestResult.extracted.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                          <code className="bg-white border border-purple-200 px-1.5 py-0.5 rounded text-purple-700 flex-shrink-0">{f.path}</code>
                          <span className="text-gray-400">→</span>
                          <code className="bg-white border border-purple-200 px-1.5 py-0.5 rounded text-purple-700 flex-shrink-0">{`{{${f.variable}}}`}</code>
                          <span className="text-gray-400">=</span>
                          <span className="text-gray-700 truncate font-mono">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-gray-400 text-[10px]">Note: <code className="bg-gray-100 px-1">{'{{variables}}'}</code> are sent as literal text in this test — they are only substituted when the flow actually runs.</p>
          </div>
        </>}

        {/* UPDATE CONTACT */}
        {type==='update_contact' && <>
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
            <p className="font-semibold text-indigo-800 mb-1">👤 Update Contact Node</p>
            <p className="text-indigo-700">Updates the contact's information in the database.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Field</label>
            <select value={contactField} onChange={e=>setContactField(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none text-sm">
              <option value="name">Name</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="notes">Notes</option>
              <option value="tags">Tags</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Value (variables supported)</label>
            <input value={fieldValue} onChange={e=>setFieldValue(e.target.value)}
              placeholder="e.g. {{user_name}} or {{user_message}}"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-sm font-mono"/>
          </div>
        </>}

        {/* DELAY */}
        {type==='delay' && <>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="font-semibold text-gray-700 mb-1">⏱️ Delay Node</p>
            <p className="text-gray-500">Flow will pause for N seconds before continuing. Max 30 seconds.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Seconds</label>
            <input type="number" min={1} max={30} value={delaySecs} onChange={e=>setDelaySecs(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 text-sm"/>
          </div>
        </>}

        {/* TEMPLATE */}
        {type==='template' && <>
          <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
            <p className="font-semibold text-pink-800 mb-1">📄 Template Node</p>
            <p className="text-pink-700">Sends an approved WhatsApp template message.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Template Name *</label>
            <select
              value={tplName}
              onChange={e=>{
                const name = e.target.value;
                setTplName(name);
                const match = tplList.find(t=>t.name===name);
                if (match?.language) setTplLang(match.language);
              }}
              disabled={loadingTpls}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-pink-400 text-sm bg-white disabled:opacity-60">
              <option value="">{loadingTpls ? 'Loading templates…' : '— Select an approved template —'}</option>
              {/* Saved value jo list me nahi hai (deleted/abhi load nahi) — preserve karo */}
              {tplName && !tplList.some(t=>t.name===tplName) && (
                <option value={tplName}>{tplName} (not in approved list)</option>
              )}
              {tplList.map((t,i)=>(
                <option key={`${t.name}-${t.language}-${i}`} value={t.name}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {!loadingTpls && tplList.length===0 && (
              <p className="text-[11px] text-gray-400 mt-1">No approved templates found. Create &amp; get a template approved first.</p>
            )}
          </div>

          {/* Header media — jab template ka header IMAGE/VIDEO/DOCUMENT ho */}
          {isTplMedia && (
            <div>
              <label className="block font-semibold text-gray-600 mb-1">{tplHeaderTypeEff} header *</label>
              <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 cursor-pointer">
                {tplHeaderUploading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Paperclip size={14} />}
                <span className="truncate">
                  {tplHeaderFileName
                    || (tplHeaderMedia && !tplHeaderMedia.startsWith('http') ? 'Uploaded media' : `Upload ${tplHeaderTypeEff.toLowerCase()}`)}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept={tplHeaderTypeEff==='IMAGE' ? 'image/*' : tplHeaderTypeEff==='VIDEO' ? 'video/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'}
                  disabled={tplHeaderUploading}
                  onChange={e=>{ const f=e.target.files?.[0]; if (f) uploadTplNodeHeaderFile(f); e.target.value=''; }}
                />
              </label>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-gray-400">or</span>
                <input
                  value={tplHeaderMedia.startsWith('http') ? tplHeaderMedia : ''}
                  onChange={e=>{ setTplHeaderMedia(e.target.value); setTplHeaderFileName(''); }}
                  placeholder="paste a direct media URL (supports {{vars}})"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-pink-400 text-xs font-mono"/>
              </div>
            </div>
          )}

          {/* Body variables — {{1}}, {{2}}… (supports {{flow_vars}}) */}
          {tplVarCountNum > 0 && (
            <div>
              <label className="block font-semibold text-gray-600 mb-1">Template Variables</label>
              <div className="space-y-1.5">
                {Array.from({length: tplVarCountNum}).map((_, i)=>(
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-gray-400 w-8 shrink-0 text-right">{`{{${i+1}}}`}</span>
                    <input
                      value={tplVars[i] || ''}
                      onChange={e=>setTplVars(prev=>{ const next=[...prev]; while(next.length<tplVarCountNum) next.push(''); next[i]=e.target.value; return next; })}
                      placeholder={`Value for {{${i+1}}}`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-pink-400 text-xs"/>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Flow variables bhi use kar sakte ho, e.g. <span className="font-mono">{'{{contact_name}}'}</span></p>
            </div>
          )}

          <div>
            <label className="block font-semibold text-gray-600 mb-1">Language Code</label>
            <input value={tplLang} onChange={e=>setTplLang(e.target.value)}
              placeholder="en / hi / en_US"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-pink-400 text-sm font-mono"/>
          </div>
        </>}

        {/* TRANSFER */}
        {type==='transfer' && <>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
            <p className="font-semibold text-orange-800 mb-1">👤 Transfer Node</p>
            <p className="text-orange-700">Transfers the chat to a human agent and ends the flow.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Note (optional)</label>
            <input value={transferNote} onChange={e=>setTransferNote(e.target.value)}
              placeholder="e.g. {{user_name}} needs billing help"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-400 text-sm"/>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Assign to agent (optional)</label>
            {loadingAgents ? (
              <div className="flex items-center gap-1.5 text-gray-400 text-[11px] py-2"><Loader2 size={12} className="animate-spin"/> Loading agents…</div>
            ) : (
              <select value={transferAgentId} onChange={e=>setTransferAgentId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white">
                <option value="">Anyone (open to all agents)</option>
                {/* Saved agent jo list me nahi (deleted/abhi load nahi) — preserve karo */}
                {transferAgentId && !agentsList.some(a=>String(a.id)===String(transferAgentId)) && (
                  <option value={transferAgentId}>{node.data.transfer_agent_name || `Agent #${transferAgentId}`}</option>
                )}
                {agentsList.map(a=>(
                  <option key={a.id} value={a.id}>{a.name}{a.workspace_role ? ` (${a.workspace_role})` : ''}</option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-gray-400 mt-1">Agent chuno to chat seedhe usi ko assign hogi; warna sabhi agents ko dikhegi.</p>
          </div>
        </>}

        {/* CONNECT FLOW */}
        {type==='connect_flow' && <>
          <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-lg p-3">
            <p className="font-semibold text-fuchsia-800 mb-1 flex items-center gap-1.5"><Workflow size={13}/> Connect Flow</p>
            <p className="text-fuchsia-700">The user will jump from this flow into the selected flow. This is a final step — it cannot have any outgoing connections.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Select Flow</label>
            {loadingFlows ? (
              <div className="flex items-center gap-1.5 text-gray-400 text-[11px] py-2"><Loader2 size={12} className="animate-spin"/> Loading flows…</div>
            ) : allFlows.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic py-1">No other flows found. Create another flow first.</p>
            ) : (
              <select value={targetFlowId} onChange={e=>setTargetFlowId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-fuchsia-400 bg-white">
                <option value="">-- Select flow --</option>
                {allFlows.map(f=>(
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
          </div>
        </>}

        {/* MEDIA + BUTTONS */}
        {type==='media_message' && <>
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-2.5">
            <p className="font-semibold text-rose-800 text-[11px]">🖼️ Send image/video/document with optional reply buttons.</p>
          </div>
          {/* Media type */}
          <div>
            <label className="block font-semibold text-gray-600 mb-1 text-xs">Media Type</label>
            <select value={mediaType} onChange={e=>setMediaType(e.target.value as 'IMAGE'|'VIDEO'|'DOCUMENT'|'AUDIO')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rose-400 bg-white">
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
              <option value="DOCUMENT">Document</option>
              <option value="AUDIO">Audio</option>
            </select>
          </div>
          {/* Media URL or Library */}
          <div>
            <label className="block font-semibold text-gray-600 mb-1 text-xs">Media URL *</label>
            {mediaId ? (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <Image size={14} className="text-rose-500 flex-shrink-0"/>
                <span className="text-xs text-rose-700 font-medium truncate flex-1">{mediaFilename || 'Selected from library'}</span>
                <button onClick={()=>{setMediaId('');setMediaFilename('');setMediaMime('');}} className="text-gray-400 hover:text-red-500 flex-shrink-0"><X size={13}/></button>
              </div>
            ) : (
              <input value={mediaUrl} onChange={e=>setMediaUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-rose-400"/>
            )}
            {!mediaId && (
              <button onClick={()=>setShowMediaLib(true)}
                className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-rose-600 hover:text-rose-800 font-medium text-xs py-1.5 border border-dashed border-rose-300 rounded-lg">
                <Image size={11}/> Select from Media Library
              </button>
            )}
            {/* Preview — manual URL */}
            {mediaType==='IMAGE' && mediaUrl && !mediaId && (
              <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 max-h-32">
                <img src={mediaUrl} alt="preview" className="w-full object-cover max-h-32"
                  onError={e=>{(e.target as HTMLImageElement).style.display='none';}}/>
              </div>
            )}
            {/* Preview — selected from library */}
            {mediaId && mediaMime.startsWith('image/') && (
              <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 max-h-32">
                <img src={`/api/media/${mediaId}?workspaceId=${getWorkspaceId()}`} alt={mediaFilename}
                  className="w-full object-cover max-h-32"
                  onError={e=>{(e.target as HTMLImageElement).style.display='none';}}/>
              </div>
            )}
          </div>
          {showMediaLib && (
            <MediaLibrary
              onSelect={(item: MediaItem)=>{ setMediaId(item.media_id); setMediaFilename(item.filename); setMediaMime(item.mime_type||''); setMediaUrl(''); setShowMediaLib(false); }}
              onClose={()=>setShowMediaLib(false)}
            />
          )}
          {/* Caption — not supported for audio */}
          {mediaType !== 'AUDIO' && (
          <div>
            <label className="block font-semibold text-gray-600 mb-1 text-xs">Caption / Body text</label>
            <textarea value={mediaCaption} onChange={e=>setMediaCaption(e.target.value.slice(0,1024))} rows={3}
              placeholder="Description below the media…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rose-400 resize-none"/>
            <p className="text-[10px] text-gray-400 text-right">{mediaCaption.length}/1024</p>
          </div>
          )}
          {mediaType === 'AUDIO' && (
            <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">⚠️ Audio messages do not support captions or buttons in WhatsApp.</p>
          )}
          {/* Buttons — not supported for audio */}
          {mediaType !== 'AUDIO' && <div>
            <label className="block font-semibold text-gray-600 mb-1 text-xs">Reply Buttons (optional, max 3)</label>
            <div className="space-y-2">
              {mediaButtons.map((b,i)=>(
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                  <div className="flex-1 space-y-1">
                    <input value={b.id} onChange={e=>{const n=[...mediaButtons];n[i]={...n[i],id:e.target.value};setMediaButtons(n);}}
                      placeholder="ID e.g. book_call" className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-rose-400"/>
                    <input value={b.title} onChange={e=>{const n=[...mediaButtons];n[i]={...n[i],title:e.target.value.slice(0,20)};setMediaButtons(n);}}
                      placeholder="Label (max 20)" maxLength={20}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-rose-400"/>
                  </div>
                  <button onClick={()=>setMediaButtons(mediaButtons.filter((_,j)=>j!==i))} className="text-gray-300 hover:text-red-500"><Trash2 size={12}/></button>
                </div>
              ))}
              {mediaButtons.length < 3 && (
                <button onClick={()=>setMediaButtons([...mediaButtons,{id:`mbtn_${mediaButtons.length+1}`,title:''}])}
                  className="flex items-center gap-1 text-rose-600 hover:text-rose-800 font-medium text-xs w-full justify-center py-1.5 border border-dashed border-rose-300 rounded-lg">
                  <Plus size={11}/> Add Button
                </button>
              )}
            </div>
            {mediaButtons.length > 0 && (
              <div className="mt-1.5 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">
                <p className="text-[10px] text-rose-700 leading-snug">
                  💡 On the canvas, each button has a <strong>round handle on its right side</strong> — drag it to connect to any node (Message, Condition, End…). Each button can lead to its own separate path.
                </p>
              </div>
            )}
          </div>}

          {/* Add Content — quick-add the next node when no buttons are used */}
          {mediaButtons.length === 0 && (
            <div className="relative pt-1">
              <button onClick={()=>setShowAddContent(v=>!v)}
                className="w-full flex items-center justify-center gap-1.5 text-teal-600 hover:text-teal-800 font-medium text-xs py-2 border border-dashed border-teal-300 rounded-lg bg-teal-50/50">
                <Plus size={12}/> Add Content
              </button>
              <p className="text-[10px] text-gray-400 mt-1 text-center">Don&apos;t need a button? Pick the next node here and it&apos;ll connect automatically.</p>
              {showAddContent && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 max-h-72 overflow-y-auto">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Content Block</span>
                    <button onClick={()=>setShowAddContent(false)} className="text-gray-300 hover:text-gray-600"><X size={13}/></button>
                  </div>
                  {(Object.entries(NODE_TYPES_META) as [NodeType, typeof NODE_TYPES_META[NodeType]][]).map(([t,m])=>{
                    const Icon = m.icon;
                    return (
                      <button key={t} onClick={()=>{ onAddConnected(node.id, null, t); setShowAddContent(false); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-left">
                        <div className={`w-6 h-6 rounded-md ${m.color} flex items-center justify-center flex-shrink-0`}>
                          <Icon size={12} className="text-white"/>
                        </div>
                        <span className="text-xs text-gray-700 font-medium">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>}

        {/* MULTI PRODUCT */}
        {type==='multi_product' && <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
            <p className="font-semibold text-blue-800 text-[11px]">🛍️ WhatsApp Catalog — Multi Product Message</p>
            <p className="text-blue-700 text-[10px] mt-0.5">Apne WhatsApp Catalog ke products sections me dikhao. Catalog ID Meta Business Suite se milega.</p>
          </div>

          {/* Catalog ID */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Catalog ID *</label>
            <input value={catalogId} onChange={e=>setCatalogId(e.target.value)}
              placeholder="e.g. 1234567890123456"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"/>
            <p className="text-[10px] text-gray-400 mt-0.5">Meta Business Suite → Commerce → Catalog → Settings → Catalog ID</p>
          </div>

          {/* Header */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Header (optional)</label>
            <input value={prodHeaderText} onChange={e=>setProdHeaderText(e.target.value)}
              placeholder="e.g. Our Products"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"/>
          </div>

          {/* Body */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Body Text *</label>
            <textarea value={prodBodyText} onChange={e=>setProdBodyText(e.target.value.slice(0,1024))} rows={2}
              placeholder="e.g. Check out our products and select one"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"/>
            <p className="text-[10px] text-gray-400 text-right">{prodBodyText.length}/1024</p>
          </div>

          {/* Footer */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Footer (optional)</label>
            <input value={prodFooterText} onChange={e=>setProdFooterText(e.target.value.slice(0,60))}
              placeholder="e.g. Powered by our store"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"/>
          </div>

          {/* Sections */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Sections & Products</label>
            <div className="space-y-3">
              {multiSections.map((sec, si) => (
                <div key={si} className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={sec.title} onChange={e=>{const n=[...multiSections];n[si]={...n[si],title:e.target.value};setMultiSections(n);}}
                      placeholder="Section Title (max 24)" maxLength={24}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                    {multiSections.length > 1 && (
                      <button onClick={()=>setMultiSections(multiSections.filter((_,j)=>j!==si))} className="text-gray-300 hover:text-red-500"><Trash2 size={12}/></button>
                    )}
                  </div>
                  <div className="space-y-1.5 pl-1">
                    {loadingCatalogProducts && (
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 py-1">
                        <Loader2 size={11} className="animate-spin"/> Loading products from catalog…
                      </div>
                    )}
                    {sec.product_items.map((p, pi) => (
                      <div key={pi} className="flex items-center gap-1.5">
                        {catalogProducts.length > 0 ? (
                          <select value={p.product_retailer_id}
                            onChange={e=>{const n=[...multiSections];n[si]={...n[si],product_items:n[si].product_items.map((x,j)=>j===pi?{product_retailer_id:e.target.value}:x)};setMultiSections(n);}}
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                            <option value="">-- Select product --</option>
                            {catalogProducts.map(cp=>(
                              <option key={cp.retailer_id} value={cp.retailer_id}>
                                {cp.name} ({cp.retailer_id})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input value={p.product_retailer_id} onChange={e=>{const n=[...multiSections];n[si]={...n[si],product_items:n[si].product_items.map((x,j)=>j===pi?{product_retailer_id:e.target.value}:x)};setMultiSections(n);}}
                            placeholder="Product Retailer ID" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                        )}
                        {sec.product_items.length > 1 && (
                          <button onClick={()=>{const n=[...multiSections];n[si]={...n[si],product_items:n[si].product_items.filter((_,j)=>j!==pi)};setMultiSections(n);}} className="text-gray-300 hover:text-red-500 flex-shrink-0"><X size={11}/></button>
                        )}
                      </div>
                    ))}
                    <button onClick={()=>{const n=[...multiSections];n[si]={...n[si],product_items:[...n[si].product_items,{product_retailer_id:''}]};setMultiSections(n);}}
                      className="flex items-center gap-1 text-blue-500 hover:text-blue-700 text-[10px] font-medium">
                      <Plus size={10}/> Add Product
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>setMultiSections([...multiSections,{title:'',product_items:[{product_retailer_id:''}]}])}
              className="mt-2 w-full flex items-center justify-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium text-xs py-1.5 border border-dashed border-blue-300 rounded-lg">
              <Plus size={11}/> Add Section
            </button>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
            {catalogProducts.length > 0
              ? <p className="text-[10px] text-blue-700">💡 Loaded <strong>{catalogProducts.length} products</strong> from your catalog. Pick one from the dropdown, or manage them on the <a href="/catalog" target="_blank" className="underline">Catalogue page</a>.</p>
              : <p className="text-[10px] text-blue-700">💡 <strong>Product Retailer ID</strong> is the same ID you assigned when creating the product in Meta Catalog. Connect your <a href="/catalog" target="_blank" className="underline">Catalogue</a> first so products appear in the dropdown.</p>
            }
          </div>
        </>}

        {/* END */}
        {type==='end' && <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="font-semibold text-red-800 mb-1">🔚 End Node</p>
          <p className="text-red-700">The flow ends here. The session is marked as completed.</p>
        </div>}
      </div>

      <div className="p-4 border-t border-gray-100 space-y-2">
        {!readOnly && (
          <button onClick={save} className="w-full btn-primary text-sm flex items-center justify-center gap-2">
            <Save size={14}/> Apply Changes
          </button>
        )}
        <button onClick={()=>onDelete(node.id)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors">
          <Trash2 size={14}/> Delete Node
        </button>
      </div>
    </div>
  );
}

// ── Help Panel ────────────────────────────────────────────────
function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full shadow-xl">
      <div className="bg-whatsapp-teal text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><HelpCircle size={15}/><span className="font-semibold text-sm">Guide</span></div>
        <button onClick={onClose} className="opacity-80 hover:opacity-100"><X size={16}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        <div className="space-y-3">
          {[
            { i:'1️⃣', t:'Add a node',       d:'Click any node button in the top toolbar.' },
            { i:'2️⃣', t:'Connect nodes',    d:'Drag from the bottom circle of one node to the top circle of another.' },
            { i:'3️⃣', t:'Configure',        d:'Click a node → set options in the right panel → click Apply.' },
            { i:'4️⃣', t:'Save',             d:'Click "Save Flow". Changes go live immediately.' },
          ].map(s=>(
            <div key={s.i} className="flex gap-2.5">
              <span className="text-lg flex-shrink-0">{s.i}</span>
              <div><p className="font-semibold text-gray-800">{s.t}</p><p className="text-gray-500 mt-0.5">{s.d}</p></div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="font-semibold text-gray-700">All Node Types:</p>
          {(Object.entries(NODE_TYPES_META) as [NodeType, typeof NODE_TYPES_META[NodeType]][]).map(([t,m])=>{
            const Icon=m.icon;
            return (
              <div key={t} className="flex items-start gap-2 py-1">
                <div className={`w-6 h-6 rounded ${m.color} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <Icon size={11} className="text-white"/>
                </div>
                <div>
                  <span className="font-semibold text-gray-700">{m.label}</span>
                  <span className="text-gray-400 ml-1.5">{m.desc}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="font-semibold text-blue-800 mb-2">💡 Common Patterns:</p>
          <div className="space-y-2 text-blue-700">
            <div>
              <p className="font-semibold">Collect user name:</p>
              <p className="font-mono text-[10px]">Message → Wait → Save Reply → Message</p>
            </div>
            <div>
              <p className="font-semibold">Build a menu:</p>
              <p className="font-mono text-[10px]">Buttons / List → branches</p>
            </div>
            <div>
              <p className="font-semibold">Save to CRM:</p>
              <p className="font-mono text-[10px]">Save Reply → API Call / Update Contact</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Flow Builder ─────────────────────────────────────────
let nodeCounter = 100;
function uid() { return `n-${++nodeCounter}-${Date.now()}`; }

export default function FlowBuilderPage() {
  const params  = useParams();
  const router  = useRouter();
  const flowId  = decryptId(params.id as string) || (params.id as string);

  const [flowName, setFlowName]          = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode]  = useState<Node | null>(null);
  const [saving, setSaving]              = useState(false);
  const [loading, setLoading]            = useState(true);
  const [showHelp, setShowHelp]          = useState(false);
  const wrapper                          = useRef<HTMLDivElement>(null);
  const importRef                        = useRef<HTMLInputElement>(null);
  const [viewport, setViewport]          = useState({ x: 0, y: 0, zoom: 1 });

  // Flow settings (trigger edit)
  const [showNodeSidebar, setShowNodeSidebar] = useState(true);
  const [showSettings, setShowSettings]     = useState(false);
  const [settingsTriggerType, setSettingsTriggerType] = useState('keyword');
  const [settingsKeywords, setSettingsKeywords]       = useState<string[]>([]);
  const [settingsKwInput, setSettingsKwInput]         = useState('');
  const [settingsName, setSettingsName]               = useState('');
  const [savingSettings, setSavingSettings]           = useState(false);
  const settingsKwRef                                 = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch(`/api/flows/${flowId}`).then((r) => {
      const f = r.data;
      setFlowName(f.name || '');
      setSettingsName(f.name || '');
      setSettingsTriggerType(f.trigger_type || 'keyword');
      const kws = (f.trigger_value || '').split(',').map((k: string) => k.trim()).filter(Boolean);
      setSettingsKeywords(kws);
      const loadedNodes = (f.nodes||[]).map((n:Node) => ({ ...n, type:'flowNode' }));
      setNodes(ensureTriggerNode(loadedNodes, f.trigger_type || 'keyword', f.trigger_value || null));
      setEdges((f.edges||[]).map((e:Edge) => ({ ...e, type:'deleteEdge' })));
      if (!realNodes(loadedNodes).length) setShowHelp(true);
    }).catch(()=>toast.error('Flow not found')).finally(()=>setLoading(false));
  }, [flowId, setNodes, setEdges]);

  const onConnect = useCallback((p: Connection) => {
    setEdges(eds => addEdge({ ...p, type: 'deleteEdge' }, eds));
  }, [setEdges]);

  function addNode(type: NodeType) {
    const rect  = wrapper.current?.getBoundingClientRect();
    const canvasW = rect?.width  ?? window.innerWidth;
    const canvasH = rect?.height ?? window.innerHeight;
    const cx = (canvasW / 2 - viewport.x) / viewport.zoom;
    const cy = (canvasH / 2 - viewport.y) / viewport.zoom;
    setNodes(nds => [...nds, {
      id: uid(), type:'flowNode',
      position: { x: cx - 110 + (Math.random()*60 - 30), y: cy - 60 + (Math.random()*60 - 30) },
      data: { type, text:'', conditions:[], transferNote:'', variable_name:'', url:'', method:'POST', headers:'', body:'', seconds:2, template_name:'', language:'en', contact_field:'name', field_value:'', body_text:'', header_text:'', footer_text:'', buttons:[], media_type:'IMAGE', media_url:'', media_id:'', caption:'', products:[], list_sections:[] },
    }]);
  }

  function loadExample() {
    if (nodes.length > 0 && !confirm('Canvas will be cleared. Load example flow?')) return;
    setNodes(ensureTriggerNode(EXAMPLE_NODES, settingsTriggerType, settingsKeywords.join(', ') || null));
    setEdges(EXAMPLE_EDGES);
    setShowHelp(false);
    toast.success('Example flow loaded! Click any node to configure it.');
  }

  // Create a new node positioned to the right of `sourceId` and auto-connect an edge from it
  function addConnectedNode(sourceId: string, sourceHandle: string | null, type: NodeType) {
    const source = nodes.find(n => n.id === sourceId);
    const newId  = uid();
    const pos    = source
      ? { x: source.position.x + 320, y: source.position.y + (Math.random()*60 - 30) }
      : { x: 200, y: 200 };
    setNodes(nds => [...nds, {
      id: newId, type:'flowNode', position: pos,
      data: { type, text:'', conditions:[], transferNote:'', variable_name:'', url:'', method:'POST', headers:'', body:'', seconds:2, template_name:'', language:'en', contact_field:'name', field_value:'', body_text:'', header_text:'', footer_text:'', buttons:[], media_type:'IMAGE', media_url:'', media_id:'', caption:'', products:[], list_sections:[] },
    }]);
    setEdges(eds => addEdge({
      id: `e-${sourceId}-${newId}-${Date.now()}`,
      source: sourceId, target: newId,
      sourceHandle: sourceHandle || undefined,
      type: 'deleteEdge',
    }, eds));
    toast.success('Node added & connected!');
  }

  function updateNodeData(id:string, data:Record<string,unknown>) {
    setNodes(nds => nds.map(n => n.id===id ? {...n, data} : n));
    if (selectedNode?.id===id) setSelectedNode(p => p ? {...p, data} : p);
  }

  function deleteNode(id:string) {
    setNodes(nds => nds.filter(n => n.id!==id || n.data?.type === 'trigger'));
    setEdges(eds => eds.filter(e => e.source!==id && e.target!==id));
    setSelectedNode(null);
  }

  function addSettingsKeyword(val: string) {
    const kw = val.trim().toLowerCase();
    if (kw && !settingsKeywords.includes(kw)) setSettingsKeywords(p => [...p, kw]);
    setSettingsKwInput('');
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const triggerVal = settingsTriggerType === 'any'
        ? null
        : settingsKeywords.join(', ') || null;
      await apiFetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: settingsName,
          trigger_type: settingsTriggerType,
          trigger_value: triggerVal,
        }),
      });
      setFlowName(settingsName);
      setNodes(nds => ensureTriggerNode(nds, settingsTriggerType, triggerVal));
      setShowSettings(false);
      toast.success('Settings saved!');
    } catch { toast.error('Failed to save settings'); }
    finally { setSavingSettings(false); }
  }

  async function save() {
    setSaving(true);
    try {
      const saveNodes = nodes.map(({id, data, position}) => ({ id, type:data.type, data, position }));
      await apiFetch(`/api/flows/${flowId}`, { method:'PUT', body: JSON.stringify({ nodes:saveNodes, edges }) });
      toast.success('Flow saved!');
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  }

  // ── Export current flow to a JSON file ──────────────────────
  function exportFlow() {
    const realN = nodes
      .filter(n => n.data?.type !== 'trigger')
      .map(({ id, data, position }) => ({ id, type: data.type, data, position }));
    const payload = {
      _type:        'whatsapp-flow-export',
      version:       1,
      exported_at:   new Date().toISOString(),
      name:          flowName,
      trigger_type:  settingsTriggerType,
      trigger_value: settingsKeywords.join(','),
      nodes:         realN,
      edges:         edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${(flowName || 'flow').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Flow exported');
  }

  // ── Import a flow JSON into the current canvas ──────────────
  function importFlow(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.nodes)) throw new Error('Invalid flow file');
        if (!confirm('Importing will replace all nodes on this canvas. Continue?')) return;
        const loadedNodes = (data.nodes as Node[]).map(n => ({ ...n, type: 'flowNode' }));
        const tType = data.trigger_type || settingsTriggerType || 'keyword';
        const tVal  = (data.trigger_value ?? settingsKeywords.join(',')) as string;
        setNodes(ensureTriggerNode(loadedNodes, tType, tVal || null));
        setEdges((data.edges || []).map((e: Edge) => ({ ...e, type: 'deleteEdge' })));
        setSettingsTriggerType(tType);
        setSettingsKeywords((tVal || '').split(',').map((k: string) => k.trim()).filter(Boolean));
        setSelectedNode(null); setShowHelp(false);
        toast.success('Flow imported — review and click "Save"');
      } catch {
        toast.error('Invalid flow file');
      }
    };
    reader.readAsText(file);
  }

  if (loading) return (
    <div className="h-[calc(100vh-5rem)] flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-whatsapp-teal"/>
    </div>
  );

  const rightPanel = showSettings ? 'settings' : showHelp ? 'help' : selectedNode ? 'config' : null;

  return (
    <div className="h-[calc(100vh-5rem)] flex flex-col -mx-4 lg:-mx-6 -mt-4 lg:-mt-6">

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-gray-200 flex-shrink-0 flex-wrap gap-y-1.5">
        <button onClick={()=>router.push('/flows')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 flex-shrink-0">
          <ArrowLeft size={15}/> Back
        </button>
        <div className="w-px h-4 bg-gray-200"/>
        <span className="font-semibold text-gray-800 text-sm flex-shrink-0">{flowName}</span>
        <div className="flex-1"/>

        <button onClick={loadExample}
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg text-xs font-medium flex-shrink-0">
          <Zap size={11}/> Example
        </button>

        {/* Import / Export */}
        <input ref={importRef} type="file" accept=".json,application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFlow(f); e.target.value = ''; }} />
        <button onClick={() => importRef.current?.click()} title="Import a flow from a .json file"
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-xs font-medium flex-shrink-0">
          <Upload size={11}/> Import
        </button>
        <button onClick={exportFlow} title="Export this flow to a .json file"
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-xs font-medium flex-shrink-0">
          <Download size={11}/> Export
        </button>

        <button onClick={()=>{setShowSettings(v=>!v);setSelectedNode(null);setShowHelp(false);}}
          title="Flow Settings — edit name and trigger keywords"
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${showSettings?'bg-orange-50 text-orange-600':'text-gray-400 hover:bg-gray-100'}`}>
          <Settings size={16}/>
        </button>
        <button onClick={()=>{setShowHelp(v=>!v);setSelectedNode(null);setShowSettings(false);}}
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${showHelp?'bg-teal-50 text-whatsapp-teal':'text-gray-400 hover:bg-gray-100'}`}>
          <HelpCircle size={16}/>
        </button>
        <button onClick={save} disabled={saving}
          className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50 flex-shrink-0">
          {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>} Save
        </button>
      </div>

      {/* Canvas + Panel */}
      <div className="flex flex-1 min-h-0">

        {/* Left Node Sidebar */}
        <div className={`relative flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 ${showNodeSidebar ? 'w-48' : 'w-8'}`}>
          {/* Toggle button */}
          <button onClick={()=>setShowNodeSidebar(v=>!v)}
            className="absolute -right-3 top-4 z-10 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 shadow-sm">
            {showNodeSidebar ? <ChevronLeft size={12}/> : <ChevronRight size={12}/>}
          </button>
          {showNodeSidebar && (
            <div className="flex-1 overflow-y-auto p-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-2">Node Types</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.entries(NODE_TYPES_META) as [NodeType, typeof NODE_TYPES_META[NodeType]][]).map(([type, meta])=>{
                  const Icon = meta.icon;
                  return (
                    <button key={type} onClick={()=>addNode(type)} title={meta.desc}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 text-center transition-colors group">
                      <div className={`w-8 h-8 rounded-lg ${meta.color} flex items-center justify-center`}>
                        <Icon size={14} className="text-white"/>
                      </div>
                      <span className="text-[10px] font-medium text-gray-600 leading-tight">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1" ref={wrapper}>
          <ReactFlow nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodeClick={(_,n)=>{
              if (n.data?.type === 'trigger') { setSelectedNode(null); setShowHelp(false); setShowSettings(true); return; }
              setSelectedNode(n);setShowHelp(false);setShowSettings(false);
            }}
            onPaneClick={()=>setSelectedNode(null)}
            onMove={(_,vp)=>setViewport(vp)}
            deleteKeyCode={['Backspace','Delete']}
            fitView
            connectionLineStyle={{ stroke: '#0d9488', strokeWidth: 2, strokeDasharray: '6 3' }}
            defaultEdgeOptions={{ type: 'deleteEdge' }}>
            {/* Custom teal arrowhead */}
            <svg style={{ position:'absolute', width:0, height:0 }}>
              <defs>
                <marker id="teal-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#0d9488"/>
                </marker>
              </defs>
            </svg>
            <Background color="#e5e7eb" gap={20}/>
            <Controls/>
            <MiniMap nodeColor={n=>{
              const c:Record<string,string>={message:'#22c55e',wait:'#eab308',condition:'#3b82f6',
                set_variable:'#14b8a6',api_call:'#a855f7',update_contact:'#6366f1',
                delay:'#6b7280',template:'#ec4899',transfer:'#f97316',multi_product:'#2563eb',end:'#ef4444'};
              return c[n.data?.type]||'#9ca3af';
            }}/>

            {nodes.length===0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center space-y-3 pointer-events-auto">
                  <div className="text-5xl">🤖</div>
                  <p className="text-gray-500 font-semibold">This flow is empty</p>
                  <p className="text-gray-400 text-sm">Add a node from the left panel or load an example</p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={loadExample}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
                      <Zap size={14}/> Example Load Karo
                    </button>
                    <button onClick={()=>setShowHelp(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                      <HelpCircle size={14}/> Guide Dekho
                    </button>
                  </div>
                </div>
              </div>
            )}
          </ReactFlow>
        </div>

        {rightPanel==='config' && selectedNode && (
          <ConfigPanel node={selectedNode} allNodes={nodes} onUpdate={updateNodeData} onDelete={deleteNode} onClose={()=>setSelectedNode(null)} onAddConnected={addConnectedNode} currentFlowId={flowId}/>
        )}
        {rightPanel==='help' && <HelpPanel onClose={()=>setShowHelp(false)}/>}

        {/* Settings Panel */}
        {rightPanel==='settings' && (
          <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full shadow-xl">
            <div className="bg-orange-500 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><Settings size={15}/><span className="font-semibold text-sm">Flow Settings</span></div>
              <button onClick={()=>setShowSettings(false)} className="opacity-80 hover:opacity-100"><X size={16}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-600 mb-1">Flow Name</label>
                <input value={settingsName} onChange={e=>setSettingsName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"/>
              </div>
              <div>
                <label className="block font-semibold text-gray-600 mb-1">Trigger Type</label>
                <select value={settingsTriggerType} onChange={e=>{ setSettingsTriggerType(e.target.value); setSettingsKeywords([]); }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                  <option value="keyword">Contains keyword</option>
                  <option value="starts_with">Starts with</option>
                  <option value="any">Any message</option>
                </select>
              </div>
              {settingsTriggerType !== 'any' && (
                <div>
                  <label className="block font-semibold text-gray-600 mb-1">
                    Keywords
                    <span className="text-gray-400 font-normal ml-1">(Enter ya comma)</span>
                  </label>
                  <div
                    onClick={()=>settingsKwRef.current?.focus()}
                    className="min-h-[42px] flex flex-wrap gap-1.5 p-2 border border-gray-200 rounded-lg cursor-text focus-within:ring-1 focus-within:ring-orange-400">
                    {settingsKeywords.map((kw) => (
                      <span key={kw} className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 text-xs font-medium px-2 py-1 rounded-full">
                        {kw}
                        <button type="button" onClick={()=>setSettingsKeywords(p=>p.filter(k=>k!==kw))}
                          className="hover:text-red-600"><X size={10}/></button>
                      </span>
                    ))}
                    <input
                      ref={settingsKwRef}
                      value={settingsKwInput}
                      onChange={e=>{
                        const val = e.target.value;
                        if (val.endsWith(',')) { addSettingsKeyword(val.slice(0,-1)); }
                        else { setSettingsKwInput(val); }
                      }}
                      onKeyDown={e=>{
                        if (e.key==='Enter') { e.preventDefault(); addSettingsKeyword(settingsKwInput); }
                        if (e.key==='Backspace' && !settingsKwInput && settingsKeywords.length) {
                          setSettingsKeywords(p=>p.slice(0,-1));
                        }
                      }}
                      onBlur={()=>{ if(settingsKwInput.trim()) addSettingsKeyword(settingsKwInput); }}
                      placeholder={settingsKeywords.length ? '' : 'hi, hii, hello…'}
                      className="flex-1 min-w-[100px] outline-none text-sm bg-transparent"
                    />
                  </div>
                  <p className="text-gray-400 mt-1">Flow triggers when any of these keywords are received</p>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={saveSettings} disabled={savingSettings}
                className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
                {savingSettings ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                Save Settings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
