import { useState, type ReactNode } from 'react';

/** What a dialog asks. */
export type Ask = {
  /** First line, in bold; also the dialog's accessible name. */
  title: string;
  /** Anything under the title: text, a list of steps, a warning. */
  body?: ReactNode;
  /** The confirming button's text. Defaults to "OK". */
  ok?: string;
  /** The cancelling button's text, or `false` for a message with only the confirming button. Defaults to "Cancel". */
  cancel?: string | false;
  /** `danger` colours the confirming button red, for actions that can't be undone. */
  tone?: 'danger';
};

type Open = Ask & { resolve: (ok: boolean) => void };

const DialogBox = ({ ask, onClose }: { ask: Open; onClose: (ok: boolean) => void }) => {
  const dismiss = () => onClose(ask.cancel === false);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && dismiss()} onKeyDown={(e) => e.key === 'Escape' && dismiss()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title">{ask.title}</h3>
        {ask.body && <div className="dialog-body">{ask.body}</div>}
        <div className="dialog-actions">
          {ask.cancel !== false && (
            <button type="button" className="btn" onClick={() => onClose(false)}>
              {ask.cancel ?? 'Cancel'}
            </button>
          )}
          <button type="button" className={`btn primary${ask.tone === 'danger' ? ' danger' : ''}`} autoFocus onClick={() => onClose(true)}>
            {ask.ok ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * In-page replacements for `window.confirm` and `window.alert`. Render `dialog` once in the component;
 * it is `null` while nothing is asked. Escape and a click outside count as Cancel (as OK for `notify`).
 * Asking again while a dialog is open replaces it and resolves the first one as cancelled.
 *
 * @returns `confirm` resolves `true` on the confirming button; `notify` resolves when dismissed.
 */
export const useDialog = () => {
  const [open, setOpen] = useState<Open | null>(null);
  const confirm = (ask: Ask) =>
    new Promise<boolean>((resolve) =>
      setOpen((current) => {
        current?.resolve(false);
        return { ...ask, resolve };
      }),
    );
  const notify = async (title: string, body?: ReactNode) => {
    await confirm({ title, body, cancel: false });
  };
  const close = (ok: boolean) => {
    open?.resolve(ok);
    setOpen(null);
  };
  return { confirm, notify, dialog: open && <DialogBox ask={open} onClose={close} /> };
};
