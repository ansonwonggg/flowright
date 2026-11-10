import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { field } from '../src/fields.ts';
import {
  flowProblems,
  newFlowRun,
  nextStepIndex,
  producedBefore,
  resolveInput,
  secretProblems,
  stepEnded,
  stepStarted,
  type FlowDef,
} from '../src/flow.ts';
import type { FunctionMeta } from '../src/fn.ts';

const meta = (over: Partial<FunctionMeta> & { id: string }): FunctionMeta => ({ title: over.id, detail: '', starts: false, inputs: {}, outputs: [], env: [], setup: [], ...over });
const FNS = [
  meta({ id: 'create', record: 'user', starts: true, inputs: { company: 'required' }, outputs: ['ref', 'mobile'] }),
  meta({ id: 'vet', record: 'user', recordKey: 'ref', inputs: { ref: 'required' }, outputs: ['ref', 'status'] }),
  meta({ id: 'activate', record: 'user', recordKey: 'ref', inputs: { ref: 'required', mobile: 'required', password: 'optional' }, outputs: ['status', 'username'] }),
  meta({ id: 'register', record: 'member', starts: true, outputs: ['reg'] }),
  meta({ id: 'enrol', record: 'member', inputs: { reg: 'required' } }),
];
const FIELDS = {
  company: field.text({ label: 'Company' }),
  ref: field.text({ label: 'Ref', pattern: /^DMD\d+$/ }),
  mobile: field.text({ label: 'Mobile' }),
  password: field.secret({ label: 'Password' }),
  status: field.text({ label: 'Status' }),
  username: field.text({ label: 'Username' }),
  reg: field.text({ label: 'Reg' }),
  spec: field.json({ label: 'Spec', validate: (v) => (v && typeof v === 'object' && 'company' in v ? [] : ['company is required']) }),
};
const WEB: FlowDef = { steps: [{ function: 'create', values: { company: 'PCCW' } }, { function: 'vet' }, { function: 'activate' }] };
const ids = (list: FunctionMeta[]) => list.map((f) => f.id);

describe('producedBefore', () => {
  it('first step to give each name, 1-based', () => {
    const p = producedBefore(FNS, WEB.steps, 2);
    assert.deepEqual([...p], [['ref', 1], ['mobile', 1], ['status', 2]]);
  });
  it('index 0 and unknown functions give nothing', () => {
    assert.equal(producedBefore(FNS, WEB.steps, 0).size, 0);
    assert.equal(producedBefore(FNS, [{ function: 'x' }], 1).size, 0);
  });
});

describe('flowProblems', () => {
  it('a good flow', () => assert.deepEqual(flowProblems(FNS, FIELDS, WEB), []));
  it('one record function with its input typed', () => assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'vet', values: { ref: 'DMD1' } }] }), []));
  for (const bad of [undefined, null, {}, { steps: [] }, { steps: 'x' }])
    it(`no steps: ${JSON.stringify(bad)}`, () => assert.deepEqual(flowProblems(FNS, FIELDS, bad), ['A flow needs at least one step.']));
  it('unknown function', () => assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'x' }] }), ['Step 1: unknown function "x"']));
  it('a starting function later on is fine: order is the author\'s call', () =>
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [...WEB.steps, { function: 'create', values: { company: 'C' } }] }), []));
  it('mixing records is fine', () =>
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'create', values: { company: 'C' } }, { function: 'enrol', values: { reg: 'R' } }] }), []));
  it('a required input neither typed nor given earlier; blank counts as missing', () =>
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'activate', values: { ref: ' ' } }] }), ['Step 1: activate needs Ref', 'Step 1: activate needs Mobile']));
  it('an input the function lacks, and a typed value breaking its rule', () =>
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'vet', values: { ref: 'X', colour: 'red' } }] }), [
      'Step 1: ref "X" doesn\'t match /^DMD\\d+$/',
      'Step 1: vet has no input "colour"',
    ]));
  it('a required input the record can hold counts once the key is known', () => {
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'activate', values: { ref: 'DMD1' } }] }), []);
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'vet', values: { ref: 'DMD1' } }, { function: 'activate' }] }), []);
  });
  it('without the key, the record can\'t help', () =>
    assert.deepEqual(flowProblems(FNS, FIELDS, { steps: [{ function: 'activate' }] }), ['Step 1: activate needs Ref', 'Step 1: activate needs Mobile']));
  it('a name no function on that record gives is still needed', () => {
    const fns = [...FNS.slice(0, 2), meta({ id: 'x', record: 'user', recordKey: 'ref', inputs: { ref: 'required', username: 'required' } })];
    assert.deepEqual(flowProblems(fns, FIELDS, { steps: [{ function: 'x', values: { ref: 'DMD1' } }] }), ['Step 1: x needs Username']);
  });
  it('a JSON value may be written inline, and is validated', () => {
    const fns = [meta({ id: 'make', starts: true, inputs: { spec: 'required' } })];
    assert.deepEqual(flowProblems(fns, FIELDS, { steps: [{ function: 'make', values: { spec: { company: 'P' } } }] }), []);
    assert.deepEqual(flowProblems(fns, FIELDS, { steps: [{ function: 'make', values: { spec: { x: 1 } } }] }), ['Step 1: spec: company is required']);
    assert.deepEqual(flowProblems(fns, FIELDS, { steps: [{ function: 'make', values: { spec: {} } }] }), ['Step 1: make needs Spec']);
  });
  it('functions with and without a record can share a flow', () => {
    const plain = [meta({ id: 'a' }), meta({ id: 'b' })];
    assert.deepEqual(flowProblems(plain, FIELDS, { steps: [{ function: 'a' }, { function: 'b' }] }), []);
    assert.deepEqual(flowProblems([...plain, meta({ id: 'c', record: 'user' })], FIELDS, { steps: [{ function: 'a' }, { function: 'c' }] }), []);
  });
});

describe('secretProblems', () => {
  it('a typed secret', () => assert.deepEqual(secretProblems(FIELDS, { steps: [{ function: 'activate', values: { password: 'p' } }] }), ["Step 1: don't save Password in a flow file; leave it blank"]));
  it('blank secrets and non-secrets are fine', () => assert.deepEqual(secretProblems(FIELDS, { steps: [{ function: 'activate', values: { password: ' ', ref: 'DMD1' } }, { function: 'vet' }] }), []));
});

describe('resolveInput', () => {
  const values = { ref: 'DMD1', mobile: '9', status: 'S' };
  it('earlier outputs by name, only declared inputs', () => assert.deepEqual(resolveInput(FNS[2], { function: 'activate' }, values), { ref: 'DMD1', mobile: '9' }));
  it('an inline JSON value becomes JSON text', () =>
    assert.deepEqual(resolveInput(meta({ id: 'm', inputs: { spec: 'required' } }), { function: 'm', values: { spec: { company: 'P' } } }, {}), { spec: '{"company":"P"}' }));
  it('typed wins, trimmed; blank falls back', () => assert.deepEqual(resolveInput(FNS[2], { function: 'activate', values: { mobile: ' 8 ', ref: ' ' } }, values), { ref: 'DMD1', mobile: '8' }));
});

describe('flow run', () => {
  const fresh = () => newFlowRun(FNS, WEB, { id: 'r', name: 'web', now: 1 });
  it('starts waiting, titled', () => {
    const run = fresh();
    assert.deepEqual(run.steps.map((s) => [s.title, s.status]), [['create', 'waiting'], ['vet', 'waiting'], ['activate', 'waiting']]);
    assert.equal(newFlowRun(FNS, { steps: [{ function: 'x' }] }, { id: 'r', name: 'n', now: 1 }).steps[0].title, 'x');
  });
  it('runs in turn, passing outputs on, then passes', () => {
    let run = fresh();
    assert.equal(nextStepIndex(run), 0);
    run = stepStarted(run, 0, { company: 'PCCW' });
    assert.equal(nextStepIndex(run), -1);
    run = stepEnded(run, { status: 'passed', output: { ref: 'DMD1', mobile: '9' } }, 2);
    run = stepEnded(stepStarted(run, 1, {}), { status: 'passed', output: { ref: 'DMD1', status: 'SUCCEED' } }, 3);
    assert.equal(run.status, 'running');
    run = stepEnded(stepStarted(run, 2, {}), { status: 'passed', output: { status: 'ACTIVATED' } }, 4);
    assert.deepEqual({ status: run.status, endedAt: run.endedAt, values: run.values }, { status: 'passed', endedAt: 4, values: { ref: 'DMD1', mobile: '9', status: 'ACTIVATED' } });
    assert.equal(nextStepIndex(run), -1);
  });
  it('a started step keeps the id of the run it started as, through to its end', () => {
    let run = stepStarted(fresh(), 0, { company: 'PCCW' }, '20261109-112000-abcd');
    assert.equal(run.steps[0].runId, '20261109-112000-abcd');
    run = stepEnded(run, { status: 'passed', output: {} }, 2);
    assert.equal(run.steps[0].runId, '20261109-112000-abcd');
    assert.equal(run.steps[1].runId, undefined);
  });
  it('a step that never got a run (it could not start) has no run id', () =>
    assert.equal(Object.hasOwn(stepStarted(fresh(), 0, {}).steps[0], 'runId'), false));
  it('a failure fails the run, keeps earlier values and the error; later steps wait', () => {
    let run = stepEnded(stepStarted(fresh(), 0, {}), { status: 'passed', output: { ref: 'DMD1' } }, 2);
    run = stepEnded(stepStarted(run, 1, {}), { status: 'failed', output: { status: 'X' }, error: 'boom' }, 3);
    assert.equal(run.status, 'failed');
    assert.deepEqual(run.values, { ref: 'DMD1' });
    assert.deepEqual(run.steps.map((s) => s.status), ['passed', 'failed', 'waiting']);
    assert.equal(run.steps[1].error, 'boom');
  });
  it('a stop stops the run', () => assert.equal(stepEnded(stepStarted(fresh(), 0, {}), { status: 'stopped' }, 2).status, 'stopped'));
  it('a pass without output keeps the values', () => assert.deepEqual(stepEnded(stepStarted(fresh(), 0, {}), { status: 'passed' }, 2).values, {}));
  it('ending with nothing running changes nothing', () => {
    const run = fresh();
    assert.equal(stepEnded(run, { status: 'passed' }, 2), run);
  });
});
