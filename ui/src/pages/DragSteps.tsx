import { Fragment, useState, type DragEvent } from 'react';
import type { FlowDef, Fn, Meta } from '../api.ts';
import { carried, flowGives, groupByRecord, splitTag, startLabel, stepErrors, toneOf } from '../lib/flowChart.ts';
import { dropGaps, insertAt, moveTo, newStep, type DraftStep, type Dragged } from '../lib/flowDraft.ts';
import { StepCard } from './StepCard.tsx';

export type DragStepsProps = { steps: DraftStep[]; flow: FlowDef; meta: Meta; errors: string[]; onSteps: (steps: DraftStep[]) => void };

const startDrag = (e: DragEvent, text: string) => {
  e.dataTransfer?.setData('text/plain', text);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
};

const toneClass = (title: string) => {
  const tone = toneOf(splitTag(title).tag);
  return tone === undefined ? '' : ` tone-${tone}`;
};

const Tag = ({ title }: { title: string }) => {
  const { tag, name } = splitTag(title);
  return (
    <>
      {tag && <span className="tag">{tag}</span>}
      <span className="name">{name}</span>
    </>
  );
};

const MAX_SHOWN_ERRORS = 2;
const MAX_SHOWN_VALUES = 2;

/**
 * The builder's flow-chart mode: a palette of functions grouped by record kind, and the flow drawn from
 * Start to End with an arrow between steps. An arrow shows the values handed down to the next step, and
 * is where a dragged function or step can drop; only the arrows where the flow stays in order open while
 * dragging. `errors` are the flow check's; each step shows its own.
 */
export const DragSteps = ({ steps, flow, meta, errors, onSteps }: DragStepsProps) => {
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const fns = meta.functions;
  const ids = steps.map((s) => s.fn);
  const gaps = dragged ? dropGaps(fns, ids, dragged) : [];
  const fnOf = (id: string) => fns.find((f) => f.id === id);
  const gives = flowGives(fns, ids);

  const end = () => {
    setDragged(null);
    setOver(null);
  };
  const add = (id: string, gap: number) => onSteps(insertAt(steps, newStep(fns, meta.fields, id, meta.options), gap));
  const move = (from: number, gap: number) => onSteps(moveTo(steps, from, gap));
  const remove = (key: string) => onSteps(steps.filter((s) => s.key !== key));
  const drop = (gap: number) => {
    if (dragged && gaps[gap]) {
      if ('fn' in dragged) add(dragged.fn, gap);
      else move(dragged.from, gap);
    }
    end();
  };

  const edgeAt = (gap: number, empty = false) => {
    const ok = Boolean(gaps[gap]);
    const cls = ['edge', 'drop', empty && 'empty-lane', ok && 'ok', over === gap && 'over'].filter(Boolean).join(' ');
    const values = gap > 0 && gap < steps.length ? carried(fns, flow, gap) : [];
    return (
      <div
        className={cls}
        data-testid={`gap-${gap}`}
        onDragOver={(e) => {
          if (!ok) return;
          e.preventDefault();
          setOver(gap);
        }}
        onDragLeave={() => setOver((g) => (g === gap ? null : g))}
        onDrop={(e) => {
          e.preventDefault();
          drop(gap);
        }}
      >
        <span className="line" />
        <div className="slot">{empty ? 'Drag a function here to start' : 'Drop here'}</div>
        <span className="line" />
        <span className="arrow" />
        {values.length > 0 && (
          <div className="carry" title={`Handed down from earlier steps: ${values.join(', ')}`}>
            {values.slice(0, MAX_SHOWN_VALUES).map((v) => (
              <code key={v}>{v}</code>
            ))}
            {values.length > MAX_SHOWN_VALUES && <code className="more">+{values.length - MAX_SHOWN_VALUES}</code>}
          </div>
        )}
      </div>
    );
  };

  const chip = (f: Fn) => {
    const fits = dropGaps(fns, ids, { fn: f.id });
    const fitsAny = fits.some(Boolean);
    return (
      <div
        key={f.id}
        className={`fn-chip${toneClass(f.title)}${fitsAny ? '' : ' off'}`}
        draggable={fitsAny}
        title={fitsAny ? f.detail : "Can't go anywhere in this flow"}
        onDragStart={(e) => {
          startDrag(e, f.id);
          setDragged({ fn: f.id });
        }}
        onDragEnd={end}
      >
        <span className="chip-title">
          <Tag title={f.title} />
        </span>
        <button type="button" className="btn small" aria-label={`Add ${f.title}`} disabled={!fits[ids.length]} onClick={() => add(f.id, ids.length)}>
          +
        </button>
      </div>
    );
  };

  const node = (step: DraftStep, i: number) => {
    const fn = fnOf(step.fn);
    const title = fn?.title ?? `Unknown function "${step.fn}"`;
    const moves = dropGaps(fns, ids, { from: i });
    const problems = stepErrors(errors, i);
    const isOpen = open === step.key;
    const moving = dragged && 'from' in dragged && dragged.from === i;
    return (
      <div className={`node-wrap${isOpen ? ' open' : ''}`}>
        <div
          className={`node${toneClass(title)}${moving ? ' moving' : ''}${problems.length ? ' has-errors' : ''}`}
          aria-label={`Step ${i + 1} tile`}
          draggable
          onDragStart={(e) => {
            startDrag(e, step.fn);
            setDragged({ from: i });
          }}
          onDragEnd={end}
        >
          <div className="node-head">
            <span className="step-no">{i + 1}</span>
            <b className="node-title">
              <Tag title={title} />
            </b>
            <div className="node-actions">
              <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.key)}>
                {isOpen ? 'Hide' : 'Inputs'}
              </button>
              <button type="button" className="btn small" aria-label={`Move step ${i + 1} up`} disabled={!moves[i - 1]} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="btn small" aria-label={`Move step ${i + 1} down`} disabled={!moves[i + 2]} onClick={() => move(i, i + 2)}>
                ↓
              </button>
              <button type="button" className="btn small" aria-label={`Remove step ${i + 1}`} onClick={() => remove(step.key)}>
                ✕
              </button>
            </div>
          </div>
          {problems.length > 0 && (
            <ul className="node-errors">
              {problems.slice(0, MAX_SHOWN_ERRORS).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {problems.length > MAX_SHOWN_ERRORS && <li>+{problems.length - MAX_SHOWN_ERRORS} more</li>}
            </ul>
          )}
          {fn && <div className="hint">Gives: {fn.outputs.join(', ') || 'nothing'}</div>}
        </div>
        {isOpen && (
          <div className="node-inputs">
            <StepCard
              bare
              index={i}
              step={step}
              fn={fn}
              flow={flow}
              meta={meta}
              onChange={(next) => onSteps(steps.map((s) => (s.key === step.key ? next : s)))}
              onRemove={() => remove(step.key)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`dnd${dragged ? ' dragging' : ''}`}>
      <section className="panel palette" aria-label="Functions">
        <div className="muted small">Drag onto an arrow in the flow, or + to add at the end.</div>
        {groupByRecord(fns, meta.settings.records).map((group) => (
          <div key={group.label} className="palette-group">
            <div className="palette-head">{group.label}</div>
            {group.fns.map(chip)}
          </div>
        ))}
      </section>
      <div className="chart" aria-label="Flow">
        <div className="terminal start">▶ {startLabel(fns, ids, meta.settings.records)}</div>
        {steps.length === 0
          ? edgeAt(0, true)
          : steps.map((step, i) => (
              <Fragment key={step.key}>
                {edgeAt(i)}
                {node(step, i)}
              </Fragment>
            ))}
        {steps.length > 0 && edgeAt(steps.length)}
        <div className="terminal end">
          ■ End
          {gives.length > 0 && <div className="terminal-sub">Gives {gives.join(', ')}</div>}
        </div>
      </div>
    </div>
  );
};
