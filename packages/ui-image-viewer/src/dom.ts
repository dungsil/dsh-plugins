/**
 * Native DSH DOM contracts this plugin reads. Only data attributes, roles and element structure are
 * used: the CSS module class names that ship with DSH are hashed per build.
 */

/** One rendered conversation: `ConversationContent` in dsh-client-ui-conversation. */
export const CONVERSATION = '[data-conversation-content]'
/** The composer inside a conversation; its draft attachments are not part of the history. */
export const COMPOSER = '[data-composer-seat]'

/**
 * Thumbnail button that opens the native lightbox: Markdown images (`imageButton`) and message
 * attachment frames (`MessageImage`) both render the image as the button's direct child. A message
 * frame still waiting for its URL renders its own spinner instead of an image, so it never matches.
 */
export function isOpener(element: Element): element is HTMLButtonElement {
  return element.tagName === 'BUTTON' && element.querySelector(':scope > img') !== null
}

/** An opener that belongs to a conversation history, outside the composer. */
export function isHistoryOpener(element: Element): element is HTMLButtonElement {
  return isOpener(element) && element.closest(CONVERSATION) !== null && element.closest(COMPOSER) === null
}

/** History openers of the conversation that contains `opener`, in reading order. */
export function conversationOpeners(opener: Element): HTMLButtonElement[] {
  const conversation = opener.closest(CONVERSATION)
  if (conversation === null) return []
  return [...conversation.querySelectorAll('button')].filter(
    (button): button is HTMLButtonElement => isOpener(button) && button.closest(COMPOSER) === null
  )
}

/**
 * Native `ImageLightbox` portal: `body > [role=dialog][aria-modal] > stage > (mask, img, close)`.
 * Returns its stage, image and close control, or `undefined` for any other dialog.
 */
export function lightboxParts(element: Element) {
  if (element.parentElement !== element.ownerDocument.body) return undefined
  if (element.getAttribute('role') !== 'dialog' || element.getAttribute('aria-modal') !== 'true') return undefined
  const stage = element.firstElementChild
  const image = stage?.querySelector<HTMLImageElement>(':scope > img')
  const close = stage?.querySelector<HTMLButtonElement>(`:scope > button:not([${NAV}])`)
  if (!stage || !image || !close) return undefined
  return { stage: stage as HTMLElement, image, close }
}

/** Marks the previous and next controls this plugin adds to a native lightbox stage. */
export const NAV = 'data-dungsil-image-nav'
/** Marks an image host while its bytes are still downloading. */
export const LOADING = 'data-dungsil-image-loading'
