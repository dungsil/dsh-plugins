import { DisclosureRow } from '@dungsil/dsh-ui'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { abbreviateHomePath } from './path.js'

import { directoryTitle } from './copy.js'
import type { CopyKey } from './copy.js'
import { directoryInput, directoryModel } from './model.js'
export type DirectoryViewProps = ToolCallOwnerProps & { readonly t: (key: CopyKey) => string }

const FolderIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
)

/** 공식 접힘 훅을 써야 턴 전체를 접을 때 상세 내용도 함께 닫힌다. 홈 아래 경로는 `~`로 줄여 보이고 원문은 펼침에 남긴다. */
export const DirectoryView = (props: DirectoryViewProps) => {
  const { t, home } = props
  const model = directoryModel(props)
  const path = model.path === null ? null : abbreviateHomePath(model.path, home)
  const input = model.input === null ? null : abbreviateHomePath(directoryInput(model.input) ?? t('current'), home)
  // oxlint-disable-next-line react/hooks -- 공식 도구 슬롯이 수명 동안 동일한 접힘 훅을 제공한다.
  const { expanded, toggle } = props.useDisclosure()
  const handleInspect = props.inspect
  const busy = model.state === 'preparing' || model.state === 'running'
  return (
    <div className="dsh-working-directory" data-state={model.state}>
      <DisclosureRow
        icon={<FolderIcon />}
        title={directoryTitle(path, t)}
        open={expanded}
        expandable={model.input !== null || model.output !== null || props.inspect !== undefined}
        onToggle={toggle}
        running={busy}
        expandOnRowClick
        previewChevron
        collapsedContent={
          model.state === 'error' || model.state === 'stopped' ? (
            <span className="dsh-working-directory-state dsh-working-directory-inline-state">{t(model.state)}</span>
          ) : null
        }
      >
        <div className="dsh-working-directory-details">
          <span className="dsh-working-directory-state">{t(model.state)}</span>
          {model.input !== null && (
            <section aria-label={t('input')}>
              <div className="dsh-working-directory-label">{t('input')}</div>
              <pre>{input}</pre>
              {!props.inspect && model.input !== input && (
                <details>
                  <summary>{t('rawInput')}</summary>
                  <pre>{model.input}</pre>
                </details>
              )}
            </section>
          )}
          {model.output !== null && (
            <section aria-label={t('output')}>
              <div className="dsh-working-directory-label">{t('output')}</div>
              <pre>{model.output}</pre>
            </section>
          )}
          {props.inspect && (
            <button type="button" onClick={handleInspect}>
              {t('inspect')}
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
