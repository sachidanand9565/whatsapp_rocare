/**
 * Brand mark — the Limbu.ai badge.
 * Source asset lives at public/logo.png (256px, trimmed square).
 * Used on the landing, login and signup pages and in the dashboard sidebar,
 * so changing the file or this component updates every surface at once.
 *
 * Plain <img> on purpose: next/image's optimizer needs `sharp` as a production
 * dependency, which this project doesn't ship, and the asset is already
 * served at the right size.
 */
export default function LogoMark({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Limbu.ai"
      width={48}
      height={48}
      className={`${box} object-contain flex-shrink-0 ${className}`}
    />
  );
}
