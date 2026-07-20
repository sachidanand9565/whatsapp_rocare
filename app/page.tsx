import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-whatsapp-dark via-whatsapp-teal to-whatsapp-green flex items-center justify-center p-4">
      <div className="text-center text-white max-w-2xl">
        <div className="text-6xl mb-6">💬</div>
        <h1 className="text-5xl font-bold mb-4">Whatsapp Automation With Limbu Ai</h1>
        <p className="text-xl mb-2 opacity-90">WhatsApp Business Platform</p>
        <p className="text-md mb-10 opacity-75">
          Send campaigns · Manage leads · Automate replies · View analytics
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/signup" className="bg-white text-whatsapp-dark font-bold px-8 py-3 rounded-xl hover:bg-gray-100 transition">
            Get Started Free
          </Link>
          <Link href="/login" className="border-2 border-white text-white font-bold px-8 py-3 rounded-xl hover:bg-white/10 transition">
            Sign In
          </Link>
        </div>
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
          {[
            ['📤', 'Bulk Campaigns'],
            ['🤖', 'Chatbot'],
            ['👥', 'CRM Leads'],
            ['📊', 'Analytics'],
          ].map(([icon, label]) => (
            <div key={label} className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-2xl mb-1">{icon}</div>
              <div className="font-medium">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
