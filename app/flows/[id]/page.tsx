'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Connection, type Edge, type Node,
  Handle, Position, type NodeProps,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { apiFetch } from '@/hooks/useApi';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  MessageSquare, Clock, GitBranch, ArrowRightLeft, XCircle,
  Save, ArrowLeft, Plus, Trash2, X, Loader2, HelpCircle,
  Zap, Globe, Database, UserCheck, Timer, LayoutTemplate,
} from 'lucide-react';

// ── Node type configs ─────────────────────────────────────────
const NODE_TYPES_META = {
  message:        { label: 'Message',        color: 'bg-green-500',   icon: MessageSquare,  border: 'border-green-400',   desc: 'Text message bhejo' },
  wait:           { label: 'Wait',           color: 'bg-yellow-500',  icon: Clock,          border: 'border-yellow-400',  desc: 'User reply ka wait karo' },
  condition:      { label: 'Condition',      color: 'bg-blue-500',    icon: GitBranch,      border: 'border-blue-400',    desc: 'Reply se branch karo' },
  set_variable:   { label: 'Save Reply',     color: 'bg-teal-500',    icon: Database,       border: 'border-teal-400',    desc: 'User reply variable mein save karo' },
  api_call:       { label: 'API Call',       color: 'bg-purple-500',  icon: Globe,          border: 'border-purple-400',  desc: 'External API call karo' },
  update_contact: { label: 'Update Contact', color: 'bg-indigo-500',  icon: UserCheck,      border: 'border-indigo-400',  desc: 'Contact ki info update karo' },
  delay:          { label: 'Delay',          color: 'bg-gray-500',    icon: Timer,          border: 'border-gray-400',    desc: 'Kuch seconds wait karo' },
  template:       { label: 'Template',       color: 'bg-pink-500',    icon: LayoutTemplate, border: 'border-pink-400',    desc: 'WhatsApp template bhejo' },
  transfer:       { label: 'Transfer',       color: 'bg-orange-500',  icon: ArrowRightLeft, border: 'border-orange-400',  desc: 'Agent ko transfer karo' },
  end:            { label: 'End',            color: 'bg-red-500',     icon: XCircle,        border: 'border-red-400',     desc: 'Flow khatam karo' },
};
type NodeType = keyof typeof NODE_TYPES_META;

// ── Example Flow ──────────────────────────────────────────────
const EXAMPLE_NODES: Node[] = [
  { id: 'ex-1', type: 'flowNode', position: { x: 260, y: 40 },
    data: { type: 'message', text: 'Namaste! 👋 Aapka naam kya hai?' } },
  { id: 'ex-2', type: 'flowNode', position: { x: 260, y: 180 },
    data: { type: 'wait' } },
  { id: 'ex-3', type: 'flowNode', position: { x: 260, y: 310 },
    data: { type: 'set_variable', variable_name: 'user_name' } },
  { id: 'ex-4', type: 'flowNode', position: { x: 260, y: 440 },
    data: { type: 'message', text: 'Namaste {{user_name}}! 🙏\n\nKya help chahiye?\n1️⃣ Order Status\n2️⃣ Support\n3️⃣ Agent se baat' } },
  { id: 'ex-5', type: 'flowNode', position: { x: 260, y: 590 },
    data: { type: 'wait' } },
  { id: 'ex-6', type: 'flowNode', position: { x: 260, y: 720 },
    data: { type: 'condition', conditions: [{ value: '1', label: 'Order' }, { value: '2', label: 'Support' }, { value: '3', label: 'Agent' }] } },
  { id: 'ex-7', type: 'flowNode', position: { x: 30,  y: 900 },
    data: { type: 'api_call', url: 'https://yourcrm.com/api/order', method: 'POST',
            body: '{"phone":"{{contact_phone}}","name":"{{user_name}}"}' } },
  { id: 'ex-8', type: 'flowNode', position: { x: 270, y: 900 },
    data: { type: 'message', text: '🛠️ Support team jald contact karega {{user_name}}!' } },
  { id: 'ex-9', type: 'flowNode', position: { x: 500, y: 900 },
    data: { type: 'transfer', transferNote: '{{user_name}} ko agent chahiye' } },
  { id: 'ex-10', type: 'flowNode', position: { x: 30,  y: 1060 },
    data: { type: 'update_contact', contact_field: 'name', field_value: '{{user_name}}' } },
  { id: 'ex-11', type: 'flowNode', position: { x: 30,  y: 1190 },
    data: { type: 'end' } },
  { id: 'ex-12', type: 'flowNode', position: { x: 270, y: 1060 },
    data: { type: 'end' } },
];
const EXAMPLE_EDGES: Edge[] = [
  { id:'ee1', source:'ex-1',  target:'ex-2',  markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee2', source:'ex-2',  target:'ex-3',  markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee3', source:'ex-3',  target:'ex-4',  markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee4', source:'ex-4',  target:'ex-5',  markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee5', source:'ex-5',  target:'ex-6',  markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee6', source:'ex-6',  target:'ex-7',  sourceHandle:'1', markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee7', source:'ex-6',  target:'ex-8',  sourceHandle:'2', markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee8', source:'ex-6',  target:'ex-9',  sourceHandle:'3', markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee9', source:'ex-7',  target:'ex-10', markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee10',source:'ex-10', target:'ex-11', markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
  { id:'ee11',source:'ex-8',  target:'ex-12', markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} },
];

// ── Custom Node Component ─────────────────────────────────────
function FlowNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPES_META[data.type as NodeType] || NODE_TYPES_META.message;
  const Icon = meta.icon;
  return (
    <div className={`bg-white rounded-xl shadow-md border-2 min-w-[200px] max-w-[250px]
      ${selected ? 'border-whatsapp-green ring-2 ring-whatsapp-green/30' : meta.border}`}>
      <div className={`${meta.color} text-white text-xs font-semibold px-3 py-2 rounded-t-xl flex items-center gap-1.5`}>
        <Icon size={12}/>{meta.label}
      </div>
      <div className="px-3 py-2 text-xs text-gray-600 min-h-[32px]">
        {data.type === 'message'   && <p className="line-clamp-3 whitespace-pre-wrap">{data.text || <span className="text-gray-300 italic">Click to add message…</span>}</p>}
        {data.type === 'wait'      && <p className="text-gray-400 italic">⏳ User reply ka wait…</p>}
        {data.type === 'set_variable' && <p className="text-teal-600 font-mono">save → <strong>{data.variable_name || '?'}</strong></p>}
        {data.type === 'api_call'  && <p className="text-purple-600 truncate font-mono text-[10px]">{data.method||'POST'} {data.url||'...'}</p>}
        {data.type === 'update_contact' && <p className="text-indigo-600">{data.contact_field||'?'} = <span className="font-mono">{data.field_value||'...'}</span></p>}
        {data.type === 'delay'     && <p className="text-gray-500">⏱️ {data.seconds||1}s wait</p>}
        {data.type === 'template'  && <p className="text-pink-600 font-mono text-[10px]">{data.template_name||'...'}</p>}
        {data.type === 'transfer'  && <p className="text-orange-600 italic">{data.transferNote||'Agent ko transfer'}</p>}
        {data.type === 'end'       && <p className="text-red-500 italic">✅ Flow khatam</p>}
        {data.type === 'condition' && (
          <div className="space-y-0.5">
            {(data.conditions||[]).slice(0,3).map((c:{value:string;label:string},i:number)=>(
              <div key={i} className="flex items-center gap-1">
                <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold flex items-center justify-center flex-shrink-0">{c.value}</span>
                <span className="truncate text-[10px]">{c.label}</span>
              </div>
            ))}
            {!data.conditions?.length && <p className="text-gray-300 italic">Click to add conditions…</p>}
          </div>
        )}
      </div>
      {/* Handles */}
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"/>
      {data.type !== 'end' && data.type !== 'transfer' && (
        data.type === 'condition'
          ? <>
              {(data.conditions||[]).map((c:{value:string},i:number)=>(
                <Handle key={i} type="source" position={Position.Bottom} id={c.value}
                  style={{left:`${((i+1)/((data.conditions?.length||1)+1))*100}%`}}
                  className="!w-3 !h-3 !bg-blue-400 !border-2 !border-white"/>
              ))}
              <Handle type="source" position={Position.Bottom} id="default"
                style={{left:'92%'}} className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white"/>
            </>
          : <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"/>
      )}
    </div>
  );
}
const nodeTypes = { flowNode: FlowNode };

// ── Config Panel ──────────────────────────────────────────────
function ConfigPanel({ node, onUpdate, onDelete, onClose }: {
  node: Node; onUpdate:(id:string,data:Record<string,unknown>)=>void;
  onDelete:(id:string)=>void; onClose:()=>void;
}) {
  const type = node.data.type as NodeType;
  const meta = NODE_TYPES_META[type];
  const Icon = meta.icon;

  const [text,           setText]          = useState(node.data.text||'');
  const [transferNote,   setTransferNote]  = useState(node.data.transferNote||'');
  const [conditions,     setConditions]    = useState<{value:string;label:string}[]>(node.data.conditions||[]);
  const [varName,        setVarName]       = useState(node.data.variable_name||'');
  const [apiUrl,         setApiUrl]        = useState(node.data.url||'');
  const [apiMethod,      setApiMethod]     = useState(node.data.method||'POST');
  const [apiHeaders,     setApiHeaders]    = useState(node.data.headers||'');
  const [apiBody,        setApiBody]       = useState(node.data.body||'');
  const [apiSaveAs,      setApiSaveAs]     = useState(node.data.save_response_as||'');
  const [contactField,   setContactField]  = useState(node.data.contact_field||'name');
  const [fieldValue,     setFieldValue]    = useState(node.data.field_value||'');
  const [delaySecs,      setDelaySecs]     = useState(node.data.seconds||2);
  const [tplName,        setTplName]       = useState(node.data.template_name||'');
  const [tplLang,        setTplLang]       = useState(node.data.language||'en');

  function save() {
    const base = { type: node.data.type };
    const updates: Record<string,unknown> = { ...base };
    if (type==='message')        { updates.text = text; }
    if (type==='transfer')       { updates.transferNote = transferNote; }
    if (type==='condition')      { updates.conditions = conditions; }
    if (type==='set_variable')   { updates.variable_name = varName; }
    if (type==='api_call')       { updates.url=apiUrl; updates.method=apiMethod; updates.headers=apiHeaders; updates.body=apiBody; updates.save_response_as=apiSaveAs; }
    if (type==='update_contact') { updates.contact_field=contactField; updates.field_value=fieldValue; }
    if (type==='delay')          { updates.seconds=Number(delaySecs); }
    if (type==='template')       { updates.template_name=tplName; updates.language=tplLang; }
    onUpdate(node.id, updates);
    onClose();
  }

  const readOnly = type==='wait'||type==='end';

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
              placeholder="User ko bhejne wala message…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-whatsapp-green resize-none text-sm"/>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 space-y-1">
            <p className="font-semibold text-green-800">Variables use kar sakte ho:</p>
            {['{{user_message}}','{{contact_phone}}','{{contact_name}}','{{koi_bhi_variable}}'].map(v=>(
              <p key={v} className="font-mono text-green-700">{v}</p>
            ))}
          </div>
        </>}

        {/* WAIT */}
        {type==='wait' && <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="font-semibold text-yellow-800 mb-1">⏳ Wait Node</p>
          <p className="text-yellow-700">Flow yahan rukta hai aur user ke reply ka wait karta hai. Agle node se connect karo.</p>
        </div>}

        {/* CONDITION */}
        {type==='condition' && <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="font-semibold text-blue-800 mb-1">🔀 Condition Node</p>
            <p className="text-blue-700">User ne jo reply kiya us value se match karke alag branch pe jayega.</p>
          </div>
          <div className="space-y-2">
            {conditions.map((c,i)=>(
              <div key={i} className="bg-gray-50 rounded-lg p-2 flex gap-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-14 flex-shrink-0">User reply:</span>
                    <input value={c.value} onChange={e=>{const n=[...conditions];n[i]={...n[i],value:e.target.value};setConditions(n);}}
                      placeholder="1" className="flex-1 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 w-14 flex-shrink-0">Label:</span>
                    <input value={c.label} onChange={e=>{const n=[...conditions];n[i]={...n[i],label:e.target.value};setConditions(n);}}
                      placeholder="Order Status" className="flex-1 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                  </div>
                </div>
                <button onClick={()=>setConditions(conditions.filter((_,j)=>j!==i))} className="text-gray-300 hover:text-red-500"><Trash2 size={12}/></button>
              </div>
            ))}
            <button onClick={()=>setConditions([...conditions,{value:'',label:''}])}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium">
              <Plus size={11}/> Condition Add Karo
            </button>
          </div>
          <p className="text-gray-400">💡 <strong>default</strong> = koi match na ho</p>
        </>}

        {/* SET VARIABLE */}
        {type==='set_variable' && <>
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
            <p className="font-semibold text-teal-800 mb-1">💾 Save Reply Node</p>
            <p className="text-teal-700">User ne jo reply kiya wo ek variable mein save ho jayega. Baad mein <code className="bg-teal-100 px-1 rounded">{'{{variable_name}}'}</code> se use kar sakte ho.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Variable ka naam</label>
            <input value={varName} onChange={e=>setVarName(e.target.value)}
              placeholder="e.g. user_name, order_id, phone"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400 text-sm font-mono"/>
            <p className="text-gray-400 mt-1">Baad mein: <code className="bg-gray-100 px-1">{`{{${varName||'variable_name'}}}`}</code></p>
          </div>
        </>}

        {/* API CALL */}
        {type==='api_call' && <>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="font-semibold text-purple-800 mb-1">🌐 API Call Node</p>
            <p className="text-purple-700">External URL pe request bhejta hai. Variables use kar sakte ho.</p>
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
            <label className="block font-semibold text-gray-600 mb-1">Body (JSON, variables use kar sakte ho)</label>
            <textarea value={apiBody} onChange={e=>setApiBody(e.target.value)} rows={4}
              placeholder={'{\n  "phone": "{{contact_phone}}",\n  "name": "{{user_name}}",\n  "message": "{{user_message}}"\n}'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 text-sm font-mono resize-none"/>
          </div>}
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Response save karo (optional)</label>
            <input value={apiSaveAs} onChange={e=>setApiSaveAs(e.target.value)}
              placeholder="e.g. api_response (variable name)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-400 text-sm font-mono"/>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-gray-500">
            Available vars: <code className="bg-gray-200 px-1">{'{{contact_phone}}'}</code> <code className="bg-gray-200 px-1">{'{{contact_name}}'}</code> <code className="bg-gray-200 px-1">{'{{user_message}}'}</code> aur koi bhi saved variable
          </div>
        </>}

        {/* UPDATE CONTACT */}
        {type==='update_contact' && <>
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
            <p className="font-semibold text-indigo-800 mb-1">👤 Update Contact Node</p>
            <p className="text-indigo-700">Contact ki information DB mein update karta hai.</p>
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
            <label className="block font-semibold text-gray-600 mb-1">Value (variables use kar sakte ho)</label>
            <input value={fieldValue} onChange={e=>setFieldValue(e.target.value)}
              placeholder="e.g. {{user_name}} ya {{user_message}}"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-sm font-mono"/>
          </div>
        </>}

        {/* DELAY */}
        {type==='delay' && <>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="font-semibold text-gray-700 mb-1">⏱️ Delay Node</p>
            <p className="text-gray-500">Flow N seconds ke liye ruk jayega. Max 30 seconds.</p>
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
            <p className="text-pink-700">Approved WhatsApp template message bhejta hai.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Template Name *</label>
            <input value={tplName} onChange={e=>setTplName(e.target.value)}
              placeholder="e.g. welcome_message"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-pink-400 text-sm font-mono"/>
          </div>
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
            <p className="text-orange-700">Chat agent ke paas chali jayegi, flow band ho jayega.</p>
          </div>
          <div>
            <label className="block font-semibold text-gray-600 mb-1">Note (optional)</label>
            <input value={transferNote} onChange={e=>setTransferNote(e.target.value)}
              placeholder="e.g. {{user_name}} ko billing help chahiye"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-400 text-sm"/>
          </div>
        </>}

        {/* END */}
        {type==='end' && <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="font-semibold text-red-800 mb-1">🔚 End Node</p>
          <p className="text-red-700">Flow yahan khatam ho jayega. Session complete mark hoga.</p>
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
            { i:'1️⃣', t:'Node add karo',     d:'Upar toolbar se koi bhi node button click karo.' },
            { i:'2️⃣', t:'Connect karo',       d:'Node ke neeche wale circle ko pakdo aur doosre node ke upar waale circle tak khicho.' },
            { i:'3️⃣', t:'Configure karo',     d:'Node pe click karo → right panel mein settings set karo → Apply karo.' },
            { i:'4️⃣', t:'Save karo',          d:'"Save Flow" button dabao. Turant live ho jayega.' },
          ].map(s=>(
            <div key={s.i} className="flex gap-2.5">
              <span className="text-lg flex-shrink-0">{s.i}</span>
              <div><p className="font-semibold text-gray-800">{s.t}</p><p className="text-gray-500 mt-0.5">{s.d}</p></div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="font-semibold text-gray-700">Sab Node Types:</p>
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
              <p className="font-semibold">User ka naam lena:</p>
              <p className="font-mono text-[10px]">Message → Wait → Save Reply → Message</p>
            </div>
            <div>
              <p className="font-semibold">Menu banana:</p>
              <p className="font-mono text-[10px]">Message → Wait → Condition → branches</p>
            </div>
            <div>
              <p className="font-semibold">CRM mein save karna:</p>
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
  const flowId  = params.id as string;

  const [flowName, setFlowName]          = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode]  = useState<Node | null>(null);
  const [saving, setSaving]              = useState(false);
  const [loading, setLoading]            = useState(true);
  const [showHelp, setShowHelp]          = useState(false);
  const wrapper                          = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`/api/flows/${flowId}`).then((r) => {
      const f = r.data;
      setFlowName(f.name || '');
      setNodes((f.nodes||[]).map((n:Node) => ({ ...n, type:'flowNode' })));
      setEdges(f.edges||[]);
      if (!(f.nodes||[]).length) setShowHelp(true);
    }).catch(()=>toast.error('Flow not found')).finally(()=>setLoading(false));
  }, [flowId, setNodes, setEdges]);

  const onConnect = useCallback((p:Connection) => {
    setEdges(eds => addEdge({ ...p, markerEnd:{type:MarkerType.ArrowClosed}, style:{strokeWidth:2} }, eds));
  }, [setEdges]);

  function addNode(type: NodeType) {
    setNodes(nds => [...nds, {
      id: uid(), type:'flowNode',
      position: { x: 220 + Math.random()*80, y: 80 + nds.length*140 },
      data: { type, text:'', conditions:[], transferNote:'', variable_name:'', url:'', method:'POST', headers:'', body:'', seconds:2, template_name:'', language:'en', contact_field:'name', field_value:'' },
    }]);
  }

  function loadExample() {
    if (nodes.length > 0 && !confirm('Canvas clear ho jayega. Example load karo?')) return;
    setNodes(EXAMPLE_NODES);
    setEdges(EXAMPLE_EDGES);
    setShowHelp(false);
    toast.success('Example flow load hua! Nodes pe click karke configure karo.');
  }

  function updateNodeData(id:string, data:Record<string,unknown>) {
    setNodes(nds => nds.map(n => n.id===id ? {...n, data} : n));
    if (selectedNode?.id===id) setSelectedNode(p => p ? {...p, data} : p);
  }

  function deleteNode(id:string) {
    setNodes(nds => nds.filter(n => n.id!==id));
    setEdges(eds => eds.filter(e => e.source!==id && e.target!==id));
    setSelectedNode(null);
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

  if (loading) return (
    <div className="h-[calc(100vh-5rem)] flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-whatsapp-teal"/>
    </div>
  );

  const rightPanel = showHelp ? 'help' : selectedNode ? 'config' : null;

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

        {/* Node add buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          {(Object.entries(NODE_TYPES_META) as [NodeType, typeof NODE_TYPES_META[NodeType]][]).map(([type,meta])=>{
            const Icon=meta.icon;
            return (
              <button key={type} onClick={()=>addNode(type)} title={meta.desc}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-white ${meta.color} hover:opacity-90 flex-shrink-0`}>
                <Icon size={10}/> {meta.label}
              </button>
            );
          })}
        </div>

        <button onClick={()=>{setShowHelp(v=>!v);setSelectedNode(null);}}
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
        <div className="flex-1" ref={wrapper}>
          <ReactFlow nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes}
            onNodeClick={(_,n)=>{setSelectedNode(n);setShowHelp(false);}}
            onPaneClick={()=>setSelectedNode(null)}
            fitView
            defaultEdgeOptions={{markerEnd:{type:MarkerType.ArrowClosed},style:{strokeWidth:2}}}>
            <Background color="#e5e7eb" gap={20}/>
            <Controls/>
            <MiniMap nodeColor={n=>{
              const c:Record<string,string>={message:'#22c55e',wait:'#eab308',condition:'#3b82f6',
                set_variable:'#14b8a6',api_call:'#a855f7',update_contact:'#6366f1',
                delay:'#6b7280',template:'#ec4899',transfer:'#f97316',end:'#ef4444'};
              return c[n.data?.type]||'#9ca3af';
            }}/>

            {nodes.length===0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center space-y-3 pointer-events-auto">
                  <div className="text-5xl">🤖</div>
                  <p className="text-gray-500 font-semibold">Flow abhi khali hai</p>
                  <p className="text-gray-400 text-sm">Upar se node add karo ya example dekho</p>
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
          <ConfigPanel node={selectedNode} onUpdate={updateNodeData} onDelete={deleteNode} onClose={()=>setSelectedNode(null)}/>
        )}
        {rightPanel==='help' && <HelpPanel onClose={()=>setShowHelp(false)}/>}
      </div>
    </div>
  );
}
