import { useEffect, useRef, useState } from 'react';
import {
  type ActionEntry,
  type ActionList,
  BUILTIN_LABELS,
  CUSTOM_MAX,
  type CustomEntry,
  defaultList,
  isCustom,
  type LibrarianActions,
  listProblem,
  moveEntry,
} from '../../lib/librarianActions';
import { ReaderIcon } from '../reader/ReaderIcon';
import { QuickActionForm } from './QuickActionForm';
import { rowDesc, rowLabel, settingsRow } from './rowStyles';

const LISTS: { list: ActionList; title: string; desc: string }[] = [
  { list: 'passage', title: 'Passage', desc: 'Chips under a selected passage in the reader.' },
  { list: 'article', title: 'Article', desc: 'Chips in an empty chat about an article.' },
];
const SET_HINT: Record<string, string> = {
  explain: 'Phrases',
  simplify: 'Phrases',
  counterpoint: 'Phrases',
  define: 'Single words',
  context: 'Single words',
  related: 'Single words',
};

type Pending = { id: string; index: number; dir: 'up' | 'down' };

function RowActions({
  name,
  custom,
  hidden,
  onHide,
  onEdit,
  onAskDelete,
}: {
  name: string;
  custom: boolean;
  hidden: boolean;
  onHide: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
}) {
  return custom ? (
    <>
      <button
        type="button"
        className="silo-settings-btn silo-qa-icon"
        data-edit
        aria-label={`Edit ${name}`}
        onClick={onEdit}
      >
        <ReaderIcon name="edit" size={16} />
      </button>
      <button
        type="button"
        className="silo-settings-btn silo-qa-icon"
        data-delete
        aria-label={`Delete ${name}`}
        onClick={onAskDelete}
      >
        <ReaderIcon name="trash" size={16} />
      </button>
    </>
  ) : (
    <button
      type="button"
      className="silo-settings-btn silo-qa-toggle"
      data-hide
      aria-label={`${hidden ? 'Show' : 'Hide'} ${name}`}
      onClick={onHide}
    >
      {hidden ? 'Show' : 'Hide'}
    </button>
  );
}

function Row({
  list,
  entry,
  index,
  count,
  editing,
  deleting,
  onMove,
  onHide,
  onEdit,
  onAskDelete,
  onDelete,
  onCancelDelete,
  form,
}: {
  list: ActionList;
  entry: ActionEntry;
  index: number;
  count: number;
  editing: boolean;
  deleting: boolean;
  onMove: (dir: 'up' | 'down') => void;
  onHide: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  form: React.ReactNode;
}) {
  const custom = isCustom(entry);
  const name = custom
    ? entry.label
    : (BUILTIN_LABELS[list].find(([id]) => id === entry.id)?.[1] ?? entry.id);
  if (editing) return <li data-row={entry.id}>{form}</li>;
  if (deleting)
    return (
      <li data-row={entry.id} style={settingsRow} className="silo-qa-row">
        <div className="silo-qa-copy">
          <div style={rowLabel}>Delete “{name}”?</div>
        </div>
        <div className="silo-qa-controls">
          <button type="button" className="silo-settings-btn silo-qa-danger" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="silo-settings-btn" data-cancel onClick={onCancelDelete}>
            Cancel
          </button>
        </div>
      </li>
    );
  const hidden = !custom && entry.hidden;
  return (
    <li data-row={entry.id} style={settingsRow} className="silo-qa-row">
      <div className="silo-qa-copy" data-hidden={hidden || undefined}>
        <div style={rowLabel}>{name}</div>
        <div style={{ ...rowDesc, textWrap: 'nowrap' }} className="silo-qa-sub">
          {custom
            ? entry.prompt
            : `${hidden ? 'Hidden · ' : ''}${list === 'passage' ? (SET_HINT[entry.id] ?? '') : 'Built in'}`}
        </div>
      </div>
      <div className="silo-qa-controls">
        <button
          type="button"
          className="silo-settings-btn silo-qa-icon"
          data-move="up"
          aria-label={`Move ${name} up`}
          disabled={index === 0}
          onClick={() => onMove('up')}
        >
          <ReaderIcon name="up" size={16} />
        </button>
        <button
          type="button"
          className="silo-settings-btn silo-qa-icon"
          data-move="down"
          aria-label={`Move ${name} down`}
          disabled={index === count - 1}
          onClick={() => onMove('down')}
        >
          <ReaderIcon name="down" size={16} />
        </button>
        <RowActions
          name={name}
          custom={custom}
          hidden={hidden}
          onHide={onHide}
          onEdit={onEdit}
          onAskDelete={onAskDelete}
        />
      </div>
    </li>
  );
}

function QuickActionList({
  list,
  title,
  desc,
  actions,
  save,
}: {
  list: ActionList;
  title: string;
  desc: string;
  actions: LibrarianActions;
  save: (next: LibrarianActions) => void;
}) {
  const entries = actions[list];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const customCount = entries.filter(isCustom).length;

  const focus = (selector: string) =>
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());
  const write = (next: ActionEntry[]) => {
    const refusal = listProblem(list, next);
    setProblem(refusal);
    if (refusal) return false;
    save({ ...actions, [list]: next });
    return true;
  };

  // A moved row keeps focus on the button that moved it, or on its twin at the end of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each change of the list.
  useEffect(() => {
    const moved = pending.current;
    if (!moved || entries[moved.index]?.id !== moved.id) return;
    pending.current = null;
    const row = root.current?.querySelector(`[data-row="${CSS.escape(moved.id)}"]`);
    const same = row?.querySelector<HTMLButtonElement>(`[data-move="${moved.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `[data-move="${moved.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (same && !same.disabled ? same : other)?.focus();
  }, [entries]);

  const move = (id: string, dir: 'up' | 'down') => {
    const from = entries.findIndex((entry) => entry.id === id);
    const index = from + (dir === 'up' ? -1 : 1);
    pending.current = { id, index, dir };
    write(moveEntry(entries, id, dir === 'up' ? -1 : 1));
  };
  const addCustom = (label: string, prompt: string) => {
    const entry: CustomEntry = { id: `custom:${crypto.randomUUID()}`, label, prompt };
    if (write([...entries, entry])) {
      setAdding(false);
      focus('[data-add]');
    }
  };
  const editCustom = (id: string, label: string, prompt: string) => {
    const next = entries.map((entry) => (entry.id === id ? { id, label, prompt } : entry));
    if (write(next)) {
      setEditing(null);
      focus(`[data-row="${CSS.escape(id)}"] [data-edit]`);
    }
  };
  const closeEdit = (id: string) => {
    setEditing(null);
    setProblem(null);
    focus(`[data-row="${CSS.escape(id)}"] [data-edit]`);
  };

  return (
    <div ref={root} className="silo-qa-list" data-list={list}>
      <div style={settingsRow} className="silo-qa-head">
        <div className="silo-qa-copy">
          <h4 style={rowLabel}>{title}</h4>
          <div style={rowDesc}>{desc}</div>
        </div>
        <div className="silo-qa-controls">
          {resetting ? (
            <>
              <span className="silo-qa-ask" role="status">
                Reset {title.toLowerCase()} list?
              </span>
              <button
                type="button"
                className="silo-settings-btn silo-qa-danger"
                onClick={() => {
                  setResetting(false);
                  setAdding(false);
                  setEditing(null);
                  setProblem(null);
                  save({ ...actions, [list]: defaultList(list) });
                  focus('[data-reset]');
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="silo-settings-btn"
                data-cancel
                onClick={() => {
                  setResetting(false);
                  focus('[data-reset]');
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="silo-settings-btn"
              data-reset
              aria-label={`Reset ${title.toLowerCase()} list to defaults`}
              onClick={() => {
                setResetting(true);
                focus('[data-cancel]');
              }}
            >
              Reset to defaults
            </button>
          )}
        </div>
      </div>
      <ul className="silo-qa-rows">
        {entries.map((entry, index) => (
          <Row
            key={entry.id}
            list={list}
            entry={entry}
            index={index}
            count={entries.length}
            editing={editing === entry.id}
            deleting={deleting === entry.id}
            onMove={(dir) => move(entry.id, dir)}
            onHide={() =>
              write(
                entries.map((item) =>
                  item.id === entry.id && !isCustom(item)
                    ? { ...item, hidden: !item.hidden }
                    : item,
                ),
              )
            }
            onEdit={() => {
              setAdding(false);
              setProblem(null);
              setEditing(entry.id);
            }}
            onAskDelete={() => {
              setDeleting(entry.id);
              focus(`[data-row="${CSS.escape(entry.id)}"] [data-cancel]`);
            }}
            onDelete={() => {
              setDeleting(null);
              write(entries.filter((item) => item.id !== entry.id));
              focus('[data-add]');
            }}
            onCancelDelete={() => {
              setDeleting(null);
              focus(`[data-row="${CSS.escape(entry.id)}"] [data-delete]`);
            }}
            form={
              isCustom(entry) && (
                <QuickActionForm
                  initial={entry}
                  problem={problem}
                  onSave={(label, prompt) => editCustom(entry.id, label, prompt)}
                  onCancel={() => closeEdit(entry.id)}
                />
              )
            }
          />
        ))}
      </ul>
      {adding ? (
        <QuickActionForm
          problem={problem}
          onSave={addCustom}
          onCancel={() => {
            setAdding(false);
            setProblem(null);
            focus('[data-add]');
          }}
        />
      ) : (
        <div className="silo-qa-add">
          <button
            type="button"
            className="silo-settings-btn"
            data-add
            aria-label={`Add ${title.toLowerCase()} action`}
            disabled={customCount >= CUSTOM_MAX}
            onClick={() => {
              setEditing(null);
              setProblem(null);
              setAdding(true);
            }}
          >
            <ReaderIcon name="plus" size={16} />
            Add action
          </button>
          {customCount >= CUSTOM_MAX && (
            <span className="silo-qa-note">
              {CUSTOM_MAX} custom actions is the most a list holds.
            </span>
          )}
        </div>
      )}
      {problem && !adding && editing === null && (
        <div role="alert" className="silo-qa-error silo-qa-problem">
          {problem}
        </div>
      )}
    </div>
  );
}

/** Settings → AI → Librarian → Quick actions: the owner's two chip lists. */
export function QuickActionsEditor({
  actions,
  save,
}: {
  actions: LibrarianActions;
  save: (next: LibrarianActions) => void;
}) {
  return (
    <section aria-label="Quick actions">
      <h3 className="silo-plugin-section-label">Quick actions</h3>
      {LISTS.map((item) => (
        <QuickActionList key={item.list} {...item} actions={actions} save={save} />
      ))}
    </section>
  );
}
