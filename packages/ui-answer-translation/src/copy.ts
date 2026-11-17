/** UI copy; `{provider}` is the configured translation service. */
export interface Copy {
  translate: string
  show: string
  hide: string
  translating: string
  failed: string
  retry: string
  /** Disclosure shown before and beside every translation. */
  disclosure: string
  translatedBy: string
  /** Joins the action name and the disclosure in one accessible label. */
  separator: string
}

export const copy: Record<'en' | 'ko' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', Copy> = {
  en: {
    translate: 'Translate paragraph',
    show: 'Show translation',
    hide: 'Hide translation',
    translating: 'Translating…',
    failed: 'Translation failed.',
    retry: 'Retry',
    disclosure: 'Sends this paragraph’s text to {provider}.',
    translatedBy: 'Translated by {provider}',
    separator: '. ',
  },
  ko: {
    translate: '문단 번역',
    show: '번역 표시',
    hide: '번역 숨기기',
    translating: '번역 중…',
    failed: '번역하지 못했습니다.',
    retry: '다시 시도',
    disclosure: '이 문단의 텍스트를 {provider}(으)로 보냅니다.',
    translatedBy: '{provider} 번역',
    separator: '. ',
  },
  zh: {
    translate: '翻译段落',
    show: '显示译文',
    hide: '隐藏译文',
    translating: '正在翻译…',
    failed: '翻译失败。',
    retry: '重试',
    disclosure: '会将此段落的文本发送给 {provider}。',
    translatedBy: '由 {provider} 翻译',
    separator: '。',
  },
  ja: {
    translate: '段落を翻訳',
    show: '翻訳を表示',
    hide: '翻訳を隠す',
    translating: '翻訳中…',
    failed: '翻訳に失敗しました。',
    retry: '再試行',
    disclosure: 'この段落のテキストを {provider} に送信します。',
    translatedBy: '{provider} による翻訳',
    separator: '。',
  },
  es: {
    translate: 'Traducir párrafo',
    show: 'Mostrar traducción',
    hide: 'Ocultar traducción',
    translating: 'Traduciendo…',
    failed: 'No se pudo traducir.',
    retry: 'Reintentar',
    disclosure: 'Envía el texto de este párrafo a {provider}.',
    translatedBy: 'Traducido por {provider}',
    separator: '. ',
  },
  fr: {
    translate: 'Traduire le paragraphe',
    show: 'Afficher la traduction',
    hide: 'Masquer la traduction',
    translating: 'Traduction…',
    failed: 'La traduction a échoué.',
    retry: 'Réessayer',
    disclosure: 'Envoie le texte de ce paragraphe à {provider}.',
    translatedBy: 'Traduit par {provider}',
    separator: '. ',
  },
  de: {
    translate: 'Absatz übersetzen',
    show: 'Übersetzung anzeigen',
    hide: 'Übersetzung ausblenden',
    translating: 'Wird übersetzt…',
    failed: 'Übersetzung fehlgeschlagen.',
    retry: 'Erneut versuchen',
    disclosure: 'Sendet den Text dieses Absatzes an {provider}.',
    translatedBy: 'Übersetzt von {provider}',
    separator: '. ',
  },
  ru: {
    translate: 'Перевести абзац',
    show: 'Показать перевод',
    hide: 'Скрыть перевод',
    translating: 'Перевод…',
    failed: 'Не удалось перевести.',
    retry: 'Повторить',
    disclosure: 'Текст этого абзаца будет отправлен в {provider}.',
    translatedBy: 'Перевод: {provider}',
    separator: '. ',
  },
  pt: {
    translate: 'Traduzir parágrafo',
    show: 'Mostrar tradução',
    hide: 'Ocultar tradução',
    translating: 'Traduzindo…',
    failed: 'Não foi possível traduzir.',
    retry: 'Tentar novamente',
    disclosure: 'Envia o texto deste parágrafo para {provider}.',
    translatedBy: 'Traduzido por {provider}',
    separator: '. ',
  },
}

/** Provider names as the official translation settings show them. */
export const providerNames: Record<string, string> = {
  bing: 'Bing',
  google: 'Google',
  'deepseek-account': 'DeepSeek Flash',
  'deepseek-official': 'DeepSeek Flash',
}
