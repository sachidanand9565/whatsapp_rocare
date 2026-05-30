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
  MessageSquare, Clock, GitBranch, ArrowRightLeft,
  XCircle, Save, ArrowLeft, Plus, Trash2, X, Loader2,
  HelpCircle, Zap,
} from 'lucide-react';

// ── Node type configs ─────────────────────────────────────────
const NODE_TYPES_META = {
  message:   { label: 'Message',   color: 'bg-green-500',  icon: MessageSquare,  border: 'border-green-400',  desc: 'Bot message bhejta hai' },
  wait:      { label: 'Wait',      color: 'bg-yellow-500', icon: Clock,          border: 'border-yellow-400', desc: 'User ke reply ka wait' },
  condition: { label: 'Condition', color: 'bg-blue-500',   icon: GitBranch,      border: 'border-blue-400',   desc: 'Reply se branch karo' },
  transfer:  { label: 'Transfer',  color: 'bg-orange-500', icon: ArrowRightLeft, border: 'border-orange-400', desc: 'Agent ko transfer' },
  end:       { label: 'End',       color: 'bg-red-500',    icon: XCircle,        border: 'border-red-400',    desc: 'Flow khatam' },
};
type NodeType = keyof typeof NODE_TYPES_META;

// ── Sample / Example Flow ─────────────────────────────────────
const EXAMPLE_NODES: Node[] = [
  { id: 'ex-1', type: 'flowNode', position: { x: 250, y: 50 },
    data: { type: 'message', text: 'Namaste! 👋\nKya help chahiye?\n\n1️⃣ Order Status\n2️⃣ Support\n3️⃣ Agent se baat karo' } },
  { id: 'ex-2', type: 'flowNode', position: { x: 250, y: 220 },
    data: { type: 'wait', text: '' } },
  { id: 'ex-3', type: 'flowNode', position: { x: 250, y: 380 },
    data: { type: 'condition', conditions: [
      { value: '1', label: 'Order Status' },
      { value: '2', label: 'Support' },
      { value: '3', label: 'Agent' },
    ]} },
  { id: 'ex-4', type: 'flowNode', position: { x: 50, y: 560 },
    data: { type: 'message', text: '📦 Aapka order process ho raha hai. 24 ghante mein update milega.' } },
  { id: 'ex-5', type: 'flowNode', position: { x: 280, y: 560 },
    data: { type: 'message', text: '🛠️ Support ke liye humara team jald contact karega.' } },
  { id: 'ex-6', type: 'flowNode', position: { x: 510, y: 560 },
    data: { type: 'transfer', transferNote: 'Agent se baat karna chahte hain' } },
  { id: 'ex-7', type: 'flowNode', position: { x: 50, y: 720 },
    data: { type: 'end' } },
  { id: 'ex-8', type: 'flowNode', position: { x: 280, y: 720 },
    data: { type: 'end' } },
];
const EXAMPLE_EDGES: Edge[] = [
  { id: 'ee-1', source: 'ex-1', target: 'ex-2', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
  { id: 'ee-2', source: 'ex-2', target: 'ex-3', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
  { id: 'ee-3', source: 'ex-3', target: 'ex-4', sourceHandle: '1', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
  { id: 'ee-4', source: 'ex-3', target: 'ex-5', sourceHandle: '2', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
  { id: 'ee-5', source: 'ex-3', target: 'ex-6', sourceHandle: '3', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
  { id: 'ee-6', source: 'ex-4', target: 'ex-7', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
  { id: 'ee-7', source: 'ex-5', target: 'ex-8', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } },
];

// ── Custom Node Component ─────────────────────────────────────
function FlowNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPES_META[data.type as NodeType] || NODE_TYPES_META.message;
  const Icon = meta.icon;
  return (
    <div className={`bg-white rounded-xl shadow-md border-2 min-w-[190px] max-w-[240px]
      ${selected ? 'border-whatsapp-green ring-2 ring-whatsapp-green/30' : meta.border}`}>
      <div className={`${meta.color} text-white text-xs font-semibold px-3 py-2 rounded-t-xl flex items-center gap-1.5`}>
        <Icon size={12} />{meta.label}
      </div>
      <div className="px-3 py-2 text-xs text-gray-600">
        {data.type === 'message' && (
          <p className="line-clamp-3 whitespace-pre-wrap">{data.text || <span className="text-gray-300 italic">Click to add message…</span>}</p>
        )}
        {data.type === 'wait' && <p className="text-gray-400 italic">⏳ User reply ka wait kar raha hai…</p>}
        {data.type === 'condition' && (
          <div className="space-y-1">
            {(data.conditions || []).map((c: { value: string; label: string }, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{c.value}</span>
                <span className="truncate">{c.label}</span>
              </div>
            ))}
            {(!data.conditions || data.conditions.length === 0) && <p className="text-gray-300 italic">Click to add conditions…</p>}
          </div>
        )}
        {data.type === 'transfer' && <p className="text-gray-500 italic">{data.transferNote || 'Agent ko transfer karega'}</p>}
        {data.type === 'end' && <p className="text-gray-400 italic">✅ Flow khatam</p>}
      </div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
      {data.type !== 'end' && data.type !== 'transfer' && (
        data.type === 'condition'
          ? <>
              {(data.conditions || []).map((c: { value: string }, i: number) => (
                <Handle key={i} type="source" position={Position.Bottom} id={c.value}
                  style={{ left: `${((i + 1) / ((data.conditions?.length || 1) + 1)) * 100}%` }}
                  className="!w-3 !h-3 !bg-blue-400 !border-2 !border-white" />
              ))}
              <Handle type="source" position={Position.Bottom} id="default"
                style={{ left: '92%' }}
                className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white" />
            </>
          : <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
      )}
    </div>
  );
}
const nodeTypes = { flowNode: FlowNode };

// ── Config Panel ──────────────────────────────────────────────
function ConfigPanel({ node, onUpdate, onDelete, onClose }: {
  node: Node;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const type = node.data.type as NodeType;
  const meta = NODE_TYPES_META[type];
  const Icon = meta.icon;
  const [text, setText]             = useState<string>(node.data.text || '');
  const [transferNote, setTransferNote] = useState<string>(node.data.transferNote || '');
  const [conditions, setConditions] = useState<{ value: string; label: string }[]>(node.data.conditions || []);

  function save() {
    if (type === 'message')   onUpdate(node.id, { ...node.data, text });
    if (type === 'transfer')  onUpdate(node.id, { ...node.data, transferNote });
    if (type === 'condition') onUpdate(node.id, { ...node.data, conditions });
    onClose();
  }

  return (
    <div className="w-72 bg-white border-l border-gray-200 flex flex-col h-full shadow-xl">
      <div className={`${meta.color} text-white px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2"><Icon size={15} /><span className="font-semibold text-sm">{meta.label} Node</span></div>
        <button onClick={onClose} className="opacity-80 hover:opacity-100"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {type === 'message' && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Message Text</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
              placeholder="Yahan message likho jo user ko jaega…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-whatsapp-green resize-none" />
            <p className="text-xs text-gray-400 mt-1">*bold*, _italic_ supported</p>
          </div>
        )}
        {type === 'wait' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-yellow-800">⏳ Wait Node</p>
            <p className="text-xs text-yellow-700">Flow yahan ruk jayega aur user ke reply ka wait karega. Iske aage <strong>Condition</strong> ya <strong>Message</strong> node connect karo.</p>
          </div>
        )}
        {type === 'condition' && (
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-800 mb-1">🔀 Condition Node</p>
              <p className="text-xs text-blue-700">User ne jo reply kiya, us value se match karke alag branch pe jayega. Har condition ka ek alag arrow hoga.</p>
            </div>
            <label className="block text-xs font-semibold text-gray-600">Conditions banao:</label>
            {conditions.map((c, i) => (
              <div key={i} className="flex gap-2 items-start bg-gray-50 rounded-lg p-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400 w-16 flex-shrink-0">User reply:</span>
                    <input value={c.value} onChange={(e) => { const n=[...conditions]; n[i]={...n[i],value:e.target.value}; setConditions(n); }}
                      placeholder="1" className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400 w-16 flex-shrink-0">Label:</span>
                    <input value={c.label} onChange={(e) => { const n=[...conditions]; n[i]={...n[i],label:e.target.value}; setConditions(n); }}
                      placeholder="Order Status" className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </div>
                <button onClick={() => setConditions(conditions.filter((_,j)=>j!==i))} className="text-gray-300 hover:text-red-500 mt-1"><Trash2 size={13} /></button>
              </div>
            ))}
            <button onClick={() => setConditions([...conditions,{value:'',label:''}])}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
              <Plus size={12}/> Condition Add Karo
            </button>
            <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-400">
              💡 <strong>Default</strong> handle (sabse right wala) = koi match na ho tab
            </div>
          </div>
        )}
        {type === 'transfer' && (
          <div className="space-y-3">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-800 mb-1">👤 Transfer Node</p>
              <p className="text-xs text-orange-700">Chat human agent ke paas chali jayegi aur flow band ho jayega.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Note (optional)</label>
              <input value={transferNote} onChange={(e) => setTransferNote(e.target.value)}
                placeholder="e.g. Billing issue ke liye transfer" className="input text-sm" />
            </div>
          </div>
        )}
        {type === 'end' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-red-800 mb-1">🔚 End Node</p>
            <p className="text-xs text-red-700">Flow yahan khatam ho jayega. Session complete mark ho jayega.</p>
          </div>
        )}
      </div>
      <div className="p-4 border-t border-gray-100 space-y-2">
        {type !== 'wait' && type !== 'end' && (
          <button onClick={save} className="w-full btn-primary text-sm flex items-center justify-center gap-2">
            <Save size={14}/> Apply Changes
          </button>
        )}
        <button onClick={() => onDelete(node.id)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors">
          <Trash2 size={14}/> Delete Node
        </button>
      </div>
    </div>
  );
}

// ── Help Panel ────────────────────────────────────────────────
function HelpPanel({ onClose }: { onClose: () => void }) {
  const steps = [
    { icon: '1️⃣', title: 'Message Node add karo', desc: 'Upar "Message" button click karo. Ye bot ka pehla message hoga.' },
    { icon: '2️⃣', title: 'Node click karke configure karo', desc: 'Kisi bhi node pe click karo — right panel mein message ya conditions set karo.' },
    { icon: '3️⃣', title: 'Nodes ko connect karo', desc: 'Node ke neeche wale dot ko pakdo aur doosre node ke upar waale dot se connect karo.' },
    { icon: '4️⃣', title: 'Wait + Condition pattern', desc: 'User se reply lena ho to: Message → Wait → Condition nodes use karo.' },
    { icon: '5️⃣', title: 'Save karo', desc: '"Save Flow" button dabao. Flow turant active ho jayega.' },
  ];
  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full shadow-xl">
      <div className="bg-whatsapp-teal text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><HelpCircle size={15}/><span className="font-semibold text-sm">Flow Builder Guide</span></div>
        <button onClick={onClose} className="opacity-80 hover:opacity-100"><X size={16}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {steps.map((s) => (
          <div key={s.icon} className="flex gap-3">
            <span className="text-xl flex-shrink-0">{s.icon}</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">{s.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Node Types:</p>
          {(Object.entries(NODE_TYPES_META) as [NodeType, typeof NODE_TYPES_META[NodeType]][]).map(([type, meta]) => {
            const Icon = meta.icon;
            return (
              <div key={type} className="flex items-center gap-2 py-1.5">
                <div className={`w-6 h-6 rounded ${meta.color} flex items-center justify-center flex-shrink-0`}>
                  <Icon size={11} className="text-white"/>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-700">{meta.label}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{meta.desc}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-800 mb-1">💡 Basic Pattern</p>
          <div className="text-xs text-blue-700 space-y-1">
            <p>Message → Wait → Condition</p>
            <p>Condition ke outputs → alag alag Message/Transfer/End</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Flow Builder ─────────────────────────────────────────
let nodeCounter = 0;
function uid() { return `node-${++nodeCounter}-${Date.now()}`; }

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
  const reactFlowWrapper                 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`/api/flows/${flowId}`).then((r) => {
      const f = r.data;
      setFlowName(f.name || '');
      const loadedNodes = (f.nodes || []).map((n: Node) => ({ ...n, type: 'flowNode' }));
      setNodes(loadedNodes);
      setEdges(f.edges || []);
      // Show help if canvas is empty
      if (!loadedNodes.length) setShowHelp(true);
    }).catch(() => toast.error('Flow not found')).finally(() => setLoading(false));
  }, [flowId, setNodes, setEdges]);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }, eds));
  }, [setEdges]);

  function addNode(type: NodeType) {
    const id = uid();
    setNodes((nds) => [...nds, {
      id, type: 'flowNode',
      position: { x: 220 + Math.random() * 60, y: 80 + nds.length * 130 },
      data: { type, text: '', conditions: [], transferNote: '' },
    }]);
  }

  function loadExample() {
    if (nodes.length > 0 && !confirm('Current canvas clear ho jayega. Example load karo?')) return;
    setNodes(EXAMPLE_NODES);
    setEdges(EXAMPLE_EDGES);
    setShowHelp(false);
    toast.success('Example flow load hua! Nodes pe click karke dekho.');
  }

  function updateNodeData(id: string, data: Record<string, unknown>) {
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data } : n));
    if (selectedNode?.id === id) setSelectedNode((prev) => prev ? { ...prev, data } : prev);
  }

  function deleteNode(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }

  async function save() {
    setSaving(true);
    try {
      const saveNodes = nodes.map(({ id, type: _, data, position }) => ({ id, type: data.type, data, position }));
      await apiFetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        body: JSON.stringify({ nodes: saveNodes, edges }),
      });
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
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 flex-shrink-0 flex-wrap">
        <button onClick={() => router.push('/flows')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0">
          <ArrowLeft size={16}/> Back
        </button>
        <div className="w-px h-5 bg-gray-200"/>
        <span className="font-semibold text-gray-800 text-sm flex-shrink-0">{flowName}</span>
        <div className="flex-1"/>

        {/* Example button */}
        <button onClick={loadExample}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg text-xs font-medium transition-colors flex-shrink-0">
          <Zap size={12}/> Example Load Karo
        </button>

        {/* Add node buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          {(Object.entries(NODE_TYPES_META) as [NodeType, typeof NODE_TYPES_META[NodeType]][]).map(([type, meta]) => {
            const Icon = meta.icon;
            return (
              <button key={type} onClick={() => addNode(type)}
                title={meta.desc}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white ${meta.color} hover:opacity-90 transition-opacity flex-shrink-0`}>
                <Icon size={11}/> {meta.label}
              </button>
            );
          })}
        </div>

        <div className="w-px h-5 bg-gray-200"/>
        <button onClick={() => { setShowHelp((v) => !v); setSelectedNode(null); }}
          className={`p-2 rounded-lg transition-colors flex-shrink-0 ${showHelp ? 'bg-teal-50 text-whatsapp-teal' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          title="Help">
          <HelpCircle size={16}/>
        </button>
        <button onClick={save} disabled={saving}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 flex-shrink-0">
          {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save Flow
        </button>
      </div>

      {/* Canvas + Panel */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes}
            onNodeClick={(_, node) => { setSelectedNode(node); setShowHelp(false); }}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }}>
            <Background color="#e5e7eb" gap={20}/>
            <Controls/>
            <MiniMap nodeColor={(n) => {
              const colors: Record<string, string> = { message:'#22c55e', wait:'#eab308', condition:'#3b82f6', transfer:'#f97316', end:'#ef4444' };
              return colors[n.data?.type] || '#9ca3af';
            }}/>

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center space-y-3 pointer-events-auto">
                  <div className="text-5xl">🤖</div>
                  <p className="text-gray-500 font-semibold">Flow abhi khali hai</p>
                  <p className="text-gray-400 text-sm">Upar se node add karo ya example dekho</p>
                  <button onClick={loadExample}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 mx-auto">
                    <Zap size={14}/> Example Flow Load Karo
                  </button>
                </div>
              </div>
            )}
          </ReactFlow>
        </div>

        {/* Right Panel */}
        {rightPanel === 'config' && selectedNode && (
          <ConfigPanel
            node={selectedNode}
            onUpdate={updateNodeData}
            onDelete={deleteNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
        {rightPanel === 'help' && (
          <HelpPanel onClose={() => setShowHelp(false)}/>
        )}
      </div>
    </div>
  );
}
