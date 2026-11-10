import { Fragment, useEffect, useRef } from 'react';
import { isIf, type Arm, type FlowRun, type FlowRunStep } from '../../../src/flow.ts';
import { segmentDone, segmentsOf, wireInto, nodeNote, type Segment, type WireState } from '../lib/canvas.ts';
import { splitTag, toneOf } from '../lib/flowChart.ts';

/** Props of {@link FlowCanvas}. */
export type FlowCanvasProps = {
  /** The run to draw; its steps as `flatten` lays them out, IF arms tagged with their branch. */
  run: FlowRun;
  /** Flat index of the step drawn as selected. */
  selected: number;
  /** Called with a step's flat index when its node is clicked. */
  onSelect: (index: number) => void;
};

const BADGE: Record<string, string> = { passed: '✓', failed: '✗', stopped: '■', skipped: '↷' };

const Wire = ({ state, label, tail = false }: { state: WireState; label?: string; tail?: boolean }) => (
  <span className={`cv-wire ${state}${tail ? ' tail' : ''}`} aria-hidden="true">
    {label && <span className="cv-label">{label}</span>}
  </span>
);

const statusClass = (step: FlowRunStep) => `st-${step.status === 'stopped' ? 'interrupted' : step.status}`;

const Node = ({ step, n, selected, onSelect }: { step: FlowRunStep; n: number; selected: boolean; onSelect: () => void }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const running = step.status === 'running';
  useEffect(() => {
    // Keeps the running node in view on a wide flow; a one-off scroll, so there is nothing to clean up.
    if (running) ref.current?.scrollIntoView?.({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [running]);
  const badge = running ? <span className="spin">◐</span> : BADGE[step.status];
  if (isIf(step))
    return (
      <button ref={ref} type="button" className={`cv-if ${statusClass(step)}`} aria-label={`Step ${n}: ${step.title}, ${nodeNote(step)}`} aria-pressed={selected} onClick={onSelect}>
        <span className="cv-diamond">
          <span>IF</span>
        </span>
        {badge && <span className="cv-badge">{badge}</span>}
        <span className="cv-cond">{step.title.replace(/^If /, '')}</span>
      </button>
    );
  const { tag, name } = splitTag(step.title);
  const tone = toneOf(tag);
  return (
    <button
      ref={ref}
      type="button"
      className={`cv-node ${statusClass(step)}${tone === undefined ? '' : ` tone-${tone}`}`}
      aria-label={`Step ${n}: ${step.title}, ${nodeNote(step)}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="cv-icon">{tag ?? 'ƒ'}</span>
      <span className="cv-text">
        <span className="cv-name">{name}</span>
        <span className="cv-meta">{nodeNote(step)}</span>
      </span>
      {badge && <span className="cv-badge">{badge}</span>}
    </button>
  );
};

/**
 * A flow run drawn left to right as nodes joined by wires, n8n style: a wire lights green once the flow
 * has passed through it, marches into the running node, and goes dashed into a skipped one. An IF is a
 * diamond that forks into a `true` lane (its then-arm) above and a `false` lane below, joining after.
 * Each node is a button; the running one scrolls into view.
 */
export const FlowCanvas = ({ run, selected, onSelect }: FlowCanvasProps) => {
  const steps = run.steps;
  const segments = segmentsOf(steps);
  const node = (i: number) => <Node key={i} step={steps[i]} n={i + 1} selected={selected === i} onSelect={() => onSelect(i)} />;
  const outLabel = (i: number) => {
    const n = Object.keys(steps[i]?.output ?? {}).length;
    return steps[i]?.status === 'passed' && n ? `${n} value${n === 1 ? '' : 's'}` : undefined;
  };

  const arm = (seg: Extract<Segment, { kind: 'fork' }>, which: Arm) => {
    const ifStep = steps[seg.index];
    const taken = ifStep?.taken === which;
    const decided = Boolean(ifStep?.taken);
    const list = seg[which];
    const label = which === 'then' ? 'true' : 'false';
    const entry: WireState = decided && !taken ? 'dead' : wireInto(taken, list.length ? steps[list[0]] : undefined);
    const tailState: WireState = decided && !taken ? 'dead' : list.length ? wireInto(steps[list[list.length - 1]]?.status === 'passed', undefined) : entry;
    return (
      <div className={`cv-arm ${which} ${decided ? (taken ? 'lit' : 'dead') : ''}`} aria-label={`${label} branch`}>
        <Wire state={entry} label={label} tail={!list.length} />
        {list.map((i, k) => (
          <Fragment key={i}>
            {k > 0 && <Wire state={wireInto(steps[list[k - 1]]?.status === 'passed', steps[i])} label={outLabel(list[k - 1])} />}
            {node(i)}
          </Fragment>
        ))}
        {list.length > 0 && <Wire state={tailState} label={outLabel(list[list.length - 1])} tail />}
      </div>
    );
  };

  const last = segments[segments.length - 1];
  const finished = Boolean(last && segmentDone(steps, last));

  return (
    <div className="canvas" role="group" aria-label="Flow canvas">
      <div className="cv-lane">
        <span className={`cv-term start${steps.length ? ' lit' : ''}`} title="Start">
          ▶
        </span>
        {segments.map((seg, k) => {
          const before = k === 0 ? true : segmentDone(steps, segments[k - 1]);
          const label = k > 0 && segments[k - 1].kind === 'step' ? outLabel(segments[k - 1].index) : undefined;
          return (
            <Fragment key={seg.index}>
              <Wire state={wireInto(before, steps[seg.index])} label={label} />
              {node(seg.index)}
              {seg.kind === 'fork' && <Wire state={steps[seg.index]?.taken ? 'lit' : 'idle'} tail />}
              {seg.kind === 'fork' && (
                <div className="cv-fork">
                  {arm(seg, 'then')}
                  {arm(seg, 'else')}
                </div>
              )}
            </Fragment>
          );
        })}
        <Wire state={finished ? 'lit' : 'idle'} label={last?.kind === 'step' ? outLabel(last.index) : undefined} />
        <span className={`cv-term end${run.status === 'passed' ? ' lit' : ''}`} title="End">
          ■
        </span>
      </div>
    </div>
  );
};
