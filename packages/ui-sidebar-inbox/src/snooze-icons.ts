import { IconClockOutlineRegular, IconPlayOutlineRegular } from '@dungsil/dsh-ui/icons'

/** Install keyed native context-menu icons for the lifetime of the menu service. */
export function installSnoozeIcons(slots: {
  inject(name: 'contextMenu.icon', callback: () => Generator<() => void>): void
  register(options: { name: 'contextMenu.icon'; key: string }, icon: typeof IconClockOutlineRegular): () => void
}): void {
  slots.inject('contextMenu.icon', function* () {
    yield slots.register({ name: 'contextMenu.icon', key: 'sidebar-inbox.snooze' }, IconClockOutlineRegular)
    yield slots.register({ name: 'contextMenu.icon', key: 'sidebar-inbox.wake' }, IconPlayOutlineRegular)
  })
}
