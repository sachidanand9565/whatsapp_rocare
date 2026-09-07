import Link from 'next/link';
import LogoMark from './components/LogoMark';
import {
  Send, Users, PhoneCall, Bot, Database, BarChart3, Code2,
  BellRing, CheckCheck, ShieldCheck, Zap, ArrowRight, Check, Webhook, Mic,
} from 'lucide-react';

/**
 * Public landing page — Limbu AI provides the WhatsApp Business API platform
 * (campaigns, shared inbox, calling, chatbot, CRM, developer API).
 * Logo placeholder lives in app/components/LogoMark.tsx — swap it there
 * when the final logo arrives (landing/login/signup all update).
 */

const FEATURES = [
  {
    icon: <Send size={22} />,
    title: 'Bulk Campaigns',
    desc: 'Send approved template messages to thousands of contacts — CSV upload, per-contact variables, scheduling and retry handling built in.',
  },
  {
    icon: <Users size={22} />,
    title: 'Shared Team Inbox',
    desc: 'Every reply lands in one inbox. Assign chats to agents, transfer conversations, filter by campaign or button reply, resolve in bulk.',
  },
  {
    icon: <PhoneCall size={22} />,
    title: 'WhatsApp Calling',
    desc: 'Customers call your WhatsApp number; agents answer right in the browser. Business hours, call history and optional call recording.',
  },
  {
    icon: <Bot size={22} />,
    title: 'Chatbot & Flows',
    desc: 'Answer instantly with keyword rules and multi-step flows — collect details, qualify leads and hand off to a human when needed.',
  },
  {
    icon: <Database size={22} />,
    title: 'CRM & Lead Capture',
    desc: 'Contacts, tags and lead pipelines in one place. Push button replies and chat data straight into your own CRM via webhooks.',
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Analytics',
    desc: 'Delivery, read and reply rates per campaign. Agent performance and call reports — know exactly what works.',
  },
  {
    icon: <Code2 size={22} />,
    title: 'Developer API',
    desc: 'Trigger messages from your website, store or backend with a simple REST API — single sends or 5,000-message bulk queues.',
  },
  {
    icon: <BellRing size={22} />,
    title: 'Mobile Alerts',
    desc: 'Agents get push notifications for incoming calls and chats on their phone — even when the panel tab is closed.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Connect your number',
    desc: 'Sign up and link your WhatsApp Business number in minutes with Meta’s official Embedded Signup — no technical setup needed.',
  },
  {
    n: '2',
    title: 'Import contacts & templates',
    desc: 'Upload your contact list, create message templates and get them approved — we guide you through Meta’s rules.',
  },
  {
    n: '3',
    title: 'Launch & manage replies',
    desc: 'Send your first campaign, watch replies flow into the team inbox, and let agents chat, call and close — all from one panel.',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-gray-900">

      {/* ── Navbar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
            <LogoMark />
            <span className="font-bold text-lg tracking-tight">Limbu <span className="text-whatsapp-teal">AI</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-600 ml-4">
            <a href="#features" className="hover:text-whatsapp-teal transition-colors">Features</a>
            <a href="#how" className="hover:text-whatsapp-teal transition-colors">How it works</a>
            <a href="#developers" className="hover:text-whatsapp-teal transition-colors">Developers</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/login" className="text-sm font-semibold text-gray-700 hover:text-whatsapp-teal transition-colors px-2 py-2">
              Sign In
            </Link>
            <Link href="/signup"
              className="text-sm font-semibold bg-whatsapp-green hover:bg-whatsapp-teal text-white px-4 py-2 rounded-lg transition-colors shadow-sm">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-green-50/70 via-white to-white">
        <div className="max-w-6xl mx-auto px-4 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-whatsapp-dark bg-green-100 border border-green-200 rounded-full px-3 py-1 mb-5">
              <ShieldCheck size={13} /> Built on the official WhatsApp Business API
            </p>
            <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight">
              Grow your business on{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-whatsapp-teal to-whatsapp-green">WhatsApp</span>
              — campaigns, inbox &amp; calls in one panel
            </h1>
            <p className="mt-5 text-lg text-gray-600 leading-relaxed">
              Limbu AI gives you the WhatsApp Business API without the complexity: send bulk campaigns,
              reply from a shared team inbox, answer WhatsApp calls in the browser and automate
              conversations — all from a single dashboard.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup"
                className="inline-flex items-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal text-white font-bold px-7 py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200">
                Get Started Free <ArrowRight size={17} />
              </Link>
              <a href="#features"
                className="inline-flex items-center gap-2 border-2 border-gray-200 hover:border-whatsapp-green text-gray-800 font-bold px-7 py-3.5 rounded-xl transition-colors">
                See what&apos;s inside
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
              {['Official Meta Cloud API', 'Multi-agent team inbox', 'No code needed'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check size={15} className="text-whatsapp-green" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Chat mockup — pure CSS, no assets */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute -top-8 -left-8 w-40 h-40 bg-whatsapp-green/15 rounded-full blur-2xl" aria-hidden />
            <div className="absolute -bottom-10 -right-6 w-48 h-48 bg-whatsapp-teal/15 rounded-full blur-2xl" aria-hidden />
            <div className="relative rounded-3xl border border-gray-200 shadow-2xl overflow-hidden bg-[#e5ddd5]">
              {/* chat header */}
              <div className="bg-whatsapp-dark text-white px-4 py-3 flex items-center gap-3">
                <LogoMark />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight">Your Business</p>
                  <p className="text-[11px] text-green-200">online</p>
                </div>
                <PhoneCall size={17} className="text-green-200" />
              </div>
              {/* messages */}
              <div className="p-4 space-y-3 text-[13px]">
                <div className="bg-white rounded-xl rounded-tl-sm shadow px-3 py-2 max-w-[85%]">
                  <p className="font-semibold text-whatsapp-dark mb-0.5">🎉 Festive Sale is live!</p>
                  <p className="text-gray-700">Hi Rahul, get flat 20% off this week. Interested in the offer?</p>
                  <div className="grid grid-cols-2 gap-1.5 mt-2 text-center text-whatsapp-teal font-semibold">
                    <span className="bg-gray-50 border border-gray-200 rounded-lg py-1.5">✅ Interested</span>
                    <span className="bg-gray-50 border border-gray-200 rounded-lg py-1.5">❌ Not now</span>
                  </div>
                  <p className="text-right text-[10px] text-gray-400 mt-1">10:02 AM</p>
                </div>
                <div className="bg-whatsapp-light rounded-xl rounded-tr-sm shadow px-3 py-2 max-w-[70%] ml-auto">
                  <p className="text-gray-800">✅ Interested</p>
                  <p className="text-right text-[10px] text-gray-500 mt-1 flex items-center justify-end gap-1">
                    10:04 AM <CheckCheck size={13} className="text-sky-500" />
                  </p>
                </div>
                <div className="bg-white rounded-xl rounded-tl-sm shadow px-3 py-2 max-w-[85%]">
                  <p className="text-gray-700">Great choice! An agent will call you shortly to confirm your order 📞</p>
                  <p className="text-right text-[10px] text-gray-400 mt-1">10:04 AM</p>
                </div>
                <div className="flex items-center gap-2 bg-white/80 border border-gray-200 rounded-full px-3 py-1.5 w-max mx-auto text-[11px] text-gray-600">
                  <Mic size={12} className="text-red-500" /> Incoming WhatsApp call · answered in browser
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature strip ──────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-gray-50/60">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm font-medium text-gray-500">
          <span className="flex items-center gap-2"><Zap size={15} className="text-whatsapp-green" /> Instant setup with Embedded Signup</span>
          <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-whatsapp-green" /> Official Meta Cloud API</span>
          <span className="flex items-center gap-2"><Users size={15} className="text-whatsapp-green" /> Unlimited team agents</span>
          <span className="flex items-center gap-2"><Webhook size={15} className="text-whatsapp-green" /> Webhooks & CRM ready</span>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight">
            Everything your team needs on <span className="text-whatsapp-teal">WhatsApp</span>
          </h2>
          <p className="mt-4 text-gray-600">
            From the first broadcast to the follow-up call — one platform covers the whole customer conversation.
          </p>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title}
              className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-lg hover:border-green-200 transition-all">
              <div className="w-11 h-11 rounded-xl bg-green-50 text-whatsapp-teal flex items-center justify-center group-hover:bg-whatsapp-green group-hover:text-white transition-colors">
                {f.icon}
              </div>
              <h3 className="mt-4 font-bold">{f.title}</h3>
              <p className="mt-2 text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────── */}
      <section id="how" className="bg-gradient-to-b from-white to-green-50/50 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-20">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight">Live in three steps</h2>
            <p className="mt-4 text-gray-600">No technical team required — most businesses send their first campaign the same day.</p>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-2xl bg-white border border-gray-100 shadow-sm p-7">
                <span className="absolute -top-4 left-7 w-9 h-9 rounded-full bg-whatsapp-green text-white font-extrabold flex items-center justify-center shadow-md">
                  {s.n}
                </span>
                <h3 className="mt-3 font-bold text-lg">{s.title}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Developers ─────────────────────────────────────── */}
      <section id="developers" className="bg-whatsapp-dark text-white">
        <div className="max-w-6xl mx-auto px-4 py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-200 bg-white/10 rounded-full px-3 py-1 mb-4">
              <Code2 size={13} /> For developers
            </p>
            <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight">
              One API call to reach<br />any customer
            </h2>
            <p className="mt-4 text-green-100/90 leading-relaxed">
              Plug WhatsApp into your website, store or backend. Campaign sends, bulk queues,
              contact lookups, call recordings — everything in the panel is available over a
              simple REST API with webhooks for replies and delivery status.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-green-100/90">
              {[
                'Single sends & 5,000-message bulk queues per request',
                'Webhooks for replies, button clicks and message status',
                'CRM triggers on template button replies',
                'Workspace API key — no OAuth dance',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check size={16} className="text-whatsapp-green mt-0.5 flex-shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-black/40 border border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10">
              <span className="w-3 h-3 rounded-full bg-red-400/80" />
              <span className="w-3 h-3 rounded-full bg-amber-300/80" />
              <span className="w-3 h-3 rounded-full bg-green-400/80" />
              <span className="ml-3 text-[11px] text-green-200/60 font-mono">send-campaign.sh</span>
            </div>
            <pre className="p-5 text-[12.5px] leading-relaxed font-mono text-green-200 overflow-x-auto">{`curl -X POST https://whatsapp.limbu.ai/api/campaigns/send \\
  -H "Content-Type: application/json" \\
  -d '{
    "apiKey": "ws_your_api_key",
    "campaignName": "festive_sale",
    "destination": "919876543210",
    "templateParams": ["Rahul", "20% OFF"]
  }'`}</pre>
          </div>
        </div>
      </section>

      {/* ── CTA band ───────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-whatsapp-teal to-whatsapp-green text-white">
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight">Ready to put your business on WhatsApp?</h2>
          <p className="mt-3 text-white/85 max-w-xl mx-auto">
            Create your workspace, connect your number and send your first campaign today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup"
              className="inline-flex items-center gap-2 bg-white text-whatsapp-dark font-bold px-8 py-3.5 rounded-xl hover:bg-green-50 transition-colors shadow-lg">
              Get Started Free <ArrowRight size={17} />
            </Link>
            <Link href="/login"
              className="inline-flex items-center gap-2 border-2 border-white/70 hover:bg-white/10 text-white font-bold px-8 py-3.5 rounded-xl transition-colors">
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="bg-gray-950 text-gray-400">
        <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col md:flex-row items-center gap-6 md:gap-10">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-bold text-white">Limbu <span className="text-whatsapp-green">AI</span></span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how" className="hover:text-white transition-colors">How it works</a>
            <a href="#developers" className="hover:text-white transition-colors">Developers</a>
            <Link href="/login" className="hover:text-white transition-colors">Sign In</Link>
            <Link href="/signup" className="hover:text-white transition-colors">Get Started</Link>
          </nav>
          <p className="md:ml-auto text-xs text-gray-500">
            © {new Date().getFullYear()} Limbu AI · WhatsApp Business Platform
          </p>
        </div>
      </footer>
    </main>
  );
}
