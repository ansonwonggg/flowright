import { Fragment, useState, type DragEvent } from 'react';
import { functionsIn, type Arm } from '../../../src/flow.ts';
import type { FlowDef, Fn, Meta } from '../api.ts';
import { carried, flowGives, groupByRecord, splitTag, startLabel, stepErrors, toneOf } from '../lib/flowChart.ts';
import {
  dropGaps,
  flatIndexes,
  insertAt,
  isDraftIf,
  moveTo,
  newIf,
  newStep,
  removeKey,
  replaceStep,
  testableBefore,
  updateIf,
  type DraftIf,
  type DraftItem,
  type DraftStep,
  type Dragged,
} from '../lib/flowDraft.ts';
import { AddFunction, ConditionEditor } from './IfBlock.tsx';
import { StepCard } from './StepCard.tsx';

export type DragStepsProps = { steps: DraftItem[]; flow: FlowDef; meta: Meta; errors: string[]; onSteps: (steps: DraftItem[]) => void };

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
  const ids = steps.map((s) => (isDraftIf(s) ? '' : s.fn));
  const gaps = dragged ? dropGaps(ids, dragged) : [];
  const fnOf = (id: string) => fns.find((f) => f.id === id);
  const gives = flowGives(fns, functionsIn(flow));
  const at = flatIndexes(steps);
  const flatAt = (key: string) => at.get(key) ?? 0;

  const end = () => {
    setDragged(null);
    setOver(null);
  };
  const add = (id: string, gap: number) => onSteps(insertAt(steps, newStep(fns, meta.fields, id, meta.options), gap));
  const addIf = (gap: number) => onSteps(insertAt<DraftItem>(steps, newIf(), gap));
  const move = (from: number, gap: number) => onSteps(moveTo(steps, from, gap));
  const remove = (key: string) => onSteps(removeKey(steps, key));
  const drop = (gap: number) => {
    if (dragged && gaps[gap]) {
      if ('fn' in dragged) add(dragged.fn, gap);
      else if ('if' in dragged) addIf(gap);
      else move(dragged.from, gap);
    }
    end();
  };

  const edgeAt = (gap: number, empty = false) => {
    const ok = Boolean(gaps[gap]);
    const cls = ['edge', 'drop', empty && 'empty-lane', ok && 'ok', over === gap && 'over'].filter(Boolean).join(' ');
    const values = gap > 0 && gap < steps.length ? carried(fns, flow, flatAt(steps[gap].key)) : [];
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

  const chip = (f: Fn) => (
    <div
      key={f.id}
      className={`fn-chip${toneClass(f.title)}`}
      draggable
      title={f.detail}
      onDragStart={(e) => {
        startDrag(e, f.id);
        setDragged({ fn: f.id });
      }}
      onDragEnd={end}
    >
      <span className="chip-title">
        <Tag title={f.title} />
      </span>
      <button type="button" className="btn small" aria-label={`Add ${f.title}`} onClick={() => add(f.id, ids.length)}>
        +
      </button>
    </div>
  );

  const errorList = (problems: string[]) =>
    problems.length > 0 && (
      <ul className="node-errors">
        {problems.slice(0, MAX_SHOWN_ERRORS).map((p) => (
          <li key={p}>{p}</li>
        ))}
        {problems.length > MAX_SHOWN_ERRORS && <li>+{problems.length - MAX_SHOWN_ERRORS} more</li>}
      </ul>
    );

  const inputsOf = (step: DraftStep, fn: Fn | undefined) => (
    <div className="node-inputs">
      <StepCard bare index={flatAt(step.key)} step={step} fn={fn} flow={flow} meta={meta} onChange={(next) => onSteps(replaceStep(steps, step.key, next))} onRemove={() => remove(step.key)} />
    </div>
  );

  const armNode = (step: DraftStep) => {
    const fn = fnOf(step.fn);
    const title = fn?.title ?? `Unknown function "${step.fn}"`;
    const n = flatAt(step.key) + 1;
    const isOpen = open === step.key;
    const problems = stepErrors(errors, n - 1);
    return (
      <div key={step.key} className={`node-wrap${isOpen ? ' open' : ''}`}>
        <div className={`node small${toneClass(title)}${problems.length ? ' has-errors' : ''}`} aria-label={`Step ${n} tile`}>
          <div className="node-head">
            <span className="step-no">{n}</span>
            <b className="node-title">
              <Tag title={title} />
            </b>
            <div className="node-actions">
              <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.key)}>
                {isOpen ? 'Hide' : 'Inputs'}
              </button>
              <button type="button" className="btn small" aria-label={`Remove step ${n}`} onClick={() => remove(step.key)}>
                ✕
              </button>
            </div>
          </div>
          {errorList(problems)}
        </div>
        {isOpen && inputsOf(step, fn)}
      </div>
    );
  };

  const ifNode = (item: DraftIf, i: number) => {
    const n = flatAt(item.key) + 1;
    const moves = dropGaps(ids, { from: i });
    const moving = dragged && 'from' in dragged && dragged.from === i;
    const problems = stepErrors(errors, n - 1);
    const setArm = (arm: Arm, list: DraftStep[]) => onSteps(updateIf(steps, item.key, (it) => ({ ...it, [arm]: list })));
    return (
      <div className="node-wrap if-wrap">
        <div
          className={`node if-node${moving ? ' moving' : ''}${problems.length ? ' has-errors' : ''}`}
          aria-label={`Step ${n} tile`}
          draggable
          onDragStart={(e) => {
            startDrag(e, 'if');
            setDragged({ from: i });
          }}
          onDragEnd={end}
        >
          <div className="node-head">
            <span className="step-no if">{n}</span>
            <b className="node-title">If</b>
            <div className="node-actions">
              <button type="button" className="btn small" aria-label={`Move step ${n} up`} disabled={!moves[i - 1]} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="btn small" aria-label={`Move step ${n} down`} disabled={!moves[i + 2]} onClick={() => move(i, i + 2)}>
                ↓
              </button>
              <button type="button" className="btn small" aria-label={`Remove step ${n}`} onClick={() => remove(item.key)}>
                ✕
              </button>
            </div>
          </div>
          <div onDragStart={(e) => e.stopPropagation()}>
            <ConditionEditor id={`chart-if${n}`} cond={item.cond} names={testableBefore(fns, flow, n - 1)} onChange={(cond) => onSteps(updateIf(steps, item.key, (it) => ({ ...it, cond })))} />
          </div>
          {errorList(problems)}
        </div>
        <div className="if-lanes">
          {(['then', 'else'] as const).map((arm) => (
            <div key={arm} className={`if-lane ${arm}`} aria-label={`Step ${n} ${arm === 'then' ? 'true' : 'false'} branch`}>
              <span className="lane-tag">{arm === 'then' ? 'true' : 'false'}</span>
              {item[arm].map(armNode)}
              <AddFunction id={`chart-if${n}-${arm}-add`} label="Add a step" fns={fns} onAdd={(id) => setArm(arm, [...item[arm], newStep(fns, meta.fields, id, meta.options)])} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const node = (step: DraftItem, i: number) => {
    if (isDraftIf(step)) return ifNode(step, i);
    const fn = fnOf(step.fn);
    const title = fn?.title ?? `Unknown function "${step.fn}"`;
    const moves = dropGaps(ids, { from: i });
    const n = flatAt(step.key) + 1;
    const problems = stepErrors(errors, n - 1);
    const isOpen = open === step.key;
    const moving = dragged && 'from' in dragged && dragged.from === i;
    return (
      <div className={`node-wrap${isOpen ? ' open' : ''}`}>
        <div
          className={`node${toneClass(title)}${moving ? ' moving' : ''}${problems.length ? ' has-errors' : ''}`}
          aria-label={`Step ${n} tile`}
          draggable
          onDragStart={(e) => {
            startDrag(e, step.fn);
            setDragged({ from: i });
          }}
          onDragEnd={end}
        >
          <div className="node-head">
            <span className="step-no">{n}</span>
            <b className="node-title">
              <Tag title={title} />
            </b>
            <div className="node-actions">
              <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.key)}>
                {isOpen ? 'Hide' : 'Inputs'}
              </button>
              <button type="button" className="btn small" aria-label={`Move step ${n} up`} disabled={!moves[i - 1]} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="btn small" aria-label={`Move step ${n} down`} disabled={!moves[i + 2]} onClick={() => move(i, i + 2)}>
                ↓
              </button>
              <button type="button" className="btn small" aria-label={`Remove step ${n}`} onClick={() => remove(step.key)}>
                ✕
              </button>
            </div>
          </div>
          {errorList(problems)}
          {fn && <div className="hint">Gives: {fn.outputs.join(', ') || 'nothing'}</div>}
        </div>
        {isOpen && inputsOf(step, fn)}
      </div>
    );
  };

  return (
    <div className={`dnd${dragged ? ' dragging' : ''}`}>
      <section className="panel palette" aria-label="Functions">
        <div className="muted small">Drag onto an arrow in the flow, or + to add at the end.</div>
        <div className="palette-group">
          <div className="palette-head">Logic</div>
          <div
            className="fn-chip if-chip"
            draggable
            title="Run one branch or the other, on a value an earlier step gave"
            onDragStart={(e) => {
              startDrag(e, 'if');
              setDragged({ if: true });
            }}
            onDragEnd={end}
          >
            <span className="chip-title">
              <span className="tag">IF</span>
              <span className="name">True / false branch</span>
            </span>
            <button type="button" className="btn small" aria-label="Add an IF" onClick={() => addIf(ids.length)}>
              +
            </button>
          </div>
        </div>
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
