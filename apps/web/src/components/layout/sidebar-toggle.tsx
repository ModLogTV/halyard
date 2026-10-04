import { useTranslation } from 'react-i18next'
import { Kbd } from '@/components/ui/kbd'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** The sidebar collapse button with a tooltip that names the action and its shortcut. */
export function SidebarToggle({ className }: { className?: string }) {
  const { t } = useTranslation('layout')
  const { state, isMobile } = useSidebar()
  const label = state === 'collapsed' && !isMobile ? t('sidebar.expand') : t('sidebar.collapse')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger className={className} aria-label={label} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        {label}
        <Kbd>⌘B</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
