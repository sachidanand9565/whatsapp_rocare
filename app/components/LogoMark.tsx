import { MessageCircle } from 'lucide-react';

/**
 * Brand mark placeholder — used on the landing, login and signup pages.
 * When the final logo arrives, swap the contents of this ONE component
 * (e.g. render an <Image src="/logo.png" …/>) and every page updates.
 */
export default function LogoMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-whatsapp-green to-whatsapp-teal text-white shadow-md
      ${size === 'lg' ? 'w-12 h-12' : 'w-9 h-9'}`}>
      <MessageCircle size={size === 'lg' ? 26 : 20} strokeWidth={2.4} />
    </span>
  );
}
