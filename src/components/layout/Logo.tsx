export function Logo({ size = 36, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/logo.png" alt="Mutu Akademi logosu" width={size} height={size} className="shrink-0" />
      {withText && (
        <span className="leading-none">
          <span className="block text-[15px] font-extrabold tracking-[0.14em] text-slate-900 dark:text-white">MUTU</span>
          <span className="block text-[10px] font-semibold tracking-[0.32em] text-brand-600 dark:text-brand-400">AKADEMİ</span>
        </span>
      )}
    </span>
  )
}
