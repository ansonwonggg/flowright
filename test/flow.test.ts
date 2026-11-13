import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { field } from '../src/fields.ts';
import {
  conditionHolds,
  conditionText,
  flatten,
  flowProblems,
  flowSummary,
  functionsIn,
  newFlowRun,
  nextStepIndex,
  producedBefore,
  resolveInput,
  retriedFlowRun,
  retryProblem,
  secretProblems,
  stepEnded,
  stepStarted,
  type Condition,
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
const WEB: FlowDef = { steps: [{ function: 'create', values: { company: 'Acme' } }, { function: 'vet' }, { function: 'activate' }] };
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
  it('keeps the saved flow file it came from; none or blank keeps no file', () => {
    assert.equal(newFlowRun(FNS, WEB, { id: 'r', name: 'web', now: 1, file: 'config/flows/web.flow.json' }).file, 'config/flows/web.flow.json');
    assert.equal('file' in fresh(), false);
    assert.equal('file' in newFlowRun(FNS, WEB, { id: 'r', name: 'web', now: 1, file: '' }), false);
  });
  it('keeps the environment it ran in; none or blank keeps none', () => {
    assert.equal(newFlowRun(FNS, WEB, { id: 'r', name: 'web', now: 1, env: 'uat' }).env, 'uat');
    assert.equal('env' in fresh(), false);
    assert.equal('env' in newFlowRun(FNS, WEB, { id: 'r', name: 'web', now: 1, env: '' }), false);
  });
  it('runs in turn, passing outputs on, then passes', () => {
    let run = fresh();
    assert.equal(nextStepIndex(run), 0);
    run = stepStarted(run, 0, { company: 'Acme' });
    assert.equal(nextStepIndex(run), -1);
    run = stepEnded(run, { status: 'passed', output: { ref: 'DMD1', mobile: '9' } }, 2);
    run = stepEnded(stepStarted(run, 1, {}), { status: 'passed', output: { ref: 'DMD1', status: 'SUCCEED' } }, 3);
    assert.equal(run.status, 'running');
    run = stepEnded(stepStarted(run, 2, {}), { status: 'passed', output: { status: 'ACTIVATED' } }, 4);
    assert.deepEqual({ status: run.status, endedAt: run.endedAt, values: run.values }, { status: 'passed', endedAt: 4, values: { ref: 'DMD1', mobile: '9', status: 'ACTIVATED' } });
    assert.equal(nextStepIndex(run), -1);
  });
  it('a started step keeps the id of the run it started as, through to its end', () => {
    let run = stepStarted(fresh(), 0, { company: 'Acme' }, '20261109-112000-abcd');
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

describe('retry', () => {
  const fresh = () => newFlowRun(FNS, WEB, { id: 'r', name: 'web', now: 1 });
  const failedAtVet = (end: { status: 'failed' | 'stopped'; error?: string; output?: Record<string, string> } = { status: 'failed', error: 'Timeout 900000ms exceeded' }) => {
    const run = stepEnded(stepStarted(fresh(), 0, { company: 'Acme' }, 'run-1'), { status: 'passed', output: { ref: 'DMD1', mobile: '9' } }, 2);
    return stepEnded(stepStarted(run, 1, { ref: 'DMD1' }, 'run-2'), end, 3);
  };
  const ALL = ['create', 'vet', 'activate'];

  describe('retriedFlowRun', () => {
    it('puts the failed step back to waiting and the run back to running, keeping the values passed along', () => {
      const run = retriedFlowRun(failedAtVet());
      assert.equal(run.status, 'running');
      assert.equal('endedAt' in run, false);
      assert.deepEqual(run.values, { ref: 'DMD1', mobile: '9' });
      assert.deepEqual(run.steps.map((s) => s.status), ['passed', 'waiting', 'waiting']);
      assert.equal(nextStepIndex(run), 1);
    });
    it('keeps passed steps as they were, so nothing before the failure runs again', () => {
      const before = failedAtVet();
      assert.deepEqual(retriedFlowRun(before).steps[0], before.steps[0]);
    });
    it('keeps the failed try on the step, with its error and History run, and clears them from the step', () => {
      const step = retriedFlowRun(failedAtVet()).steps[1];
      assert.deepEqual(step.tries, [{ status: 'failed', error: 'Timeout 900000ms exceeded', runId: 'run-2' }]);
      for (const gone of ['error', 'runId', 'input', 'output']) assert.equal(gone in step, false, `${gone} is cleared`);
    });
    it('keeps what a failed try gave out on that try, never in the values passed along', () => {
      const run = retriedFlowRun(failedAtVet({ status: 'failed', output: { status: 'X' } }));
      assert.deepEqual(run.steps[1].tries, [{ status: 'failed', runId: 'run-2', output: { status: 'X' } }]);
      assert.deepEqual(run.values, { ref: 'DMD1', mobile: '9' });
    });
    it('a stopped run is retried the same way, the try marked stopped', () => {
      const run = retriedFlowRun(failedAtVet({ status: 'stopped' }));
      assert.equal(run.status, 'running');
      assert.deepEqual(run.steps[1].tries, [{ status: 'stopped', runId: 'run-2' }]);
    });
    it('a second retry adds to the tries, oldest first', () => {
      let run = retriedFlowRun(failedAtVet());
      run = stepEnded(stepStarted(run, 1, { ref: 'DMD1' }, 'run-3'), { status: 'failed', error: 'again' }, 4);
      run = retriedFlowRun(run);
      assert.deepEqual(run.steps[1].tries?.map((t) => [t.runId, t.error]), [['run-2', 'Timeout 900000ms exceeded'], ['run-3', 'again']]);
    });
    it('a retried step that passes keeps its tries and the run goes on to pass', () => {
      let run = retriedFlowRun(failedAtVet());
      run = stepEnded(stepStarted(run, 1, { ref: 'DMD1' }, 'run-3'), { status: 'passed', output: { status: 'SUCCEED' } }, 4);
      run = stepEnded(stepStarted(run, 2, {}, 'run-4'), { status: 'passed' }, 5);
      assert.deepEqual({ status: run.status, endedAt: run.endedAt }, { status: 'passed', endedAt: 5 });
      assert.equal(run.steps[1].tries?.length, 1);
      assert.equal(run.steps[1].runId, 'run-3');
    });
    it('a step that could not start (no History run) is retried too', () => {
      const run = retriedFlowRun(stepEnded(stepStarted(fresh(), 0, {}), { status: 'failed', error: "can't start: x" }, 2));
      assert.deepEqual(run.steps[0].tries, [{ status: 'failed', error: "can't start: x" }]);
      assert.equal(nextStepIndex(run), 0);
    });
    it('a run with nothing to retry comes back unchanged', () => {
      const running = fresh();
      assert.equal(retriedFlowRun(running), running);
      let passed = stepEnded(stepStarted(fresh(), 0, {}), { status: 'passed' }, 2);
      passed = stepEnded(stepStarted(passed, 1, {}), { status: 'passed' }, 3);
      passed = stepEnded(stepStarted(passed, 2, {}), { status: 'passed' }, 4);
      assert.equal(retriedFlowRun(passed), passed);
    });
  });

  describe('retryProblem', () => {
    it('none for a failed or stopped run in the same environment, its functions all known', () => {
      assert.equal(retryProblem(failedAtVet(), { functions: ALL }), undefined);
      assert.equal(retryProblem(failedAtVet({ status: 'stopped' }), { functions: ALL }), undefined);
      assert.equal(retryProblem({ ...failedAtVet(), env: 'uat' }, { env: 'uat', functions: ALL }), undefined);
    });
    it('a running or passed run cannot be retried', () => {
      assert.match(retryProblem(fresh(), { functions: ALL }) ?? '', /only a failed or stopped/i);
      assert.match(retryProblem({ ...failedAtVet(), status: 'passed' }, { functions: ALL }) ?? '', /only a failed or stopped/i);
    });
    it('a failed run with no failed or stopped step has nothing to retry', () =>
      assert.match(retryProblem({ ...fresh(), status: 'failed' }, { functions: ALL }) ?? '', /no step failed/i));
    it('names both environments when the app is on another one', () => {
      assert.equal(
        retryProblem({ ...failedAtVet(), env: 'uat' }, { env: 'dev', functions: ALL }),
        'This run used uat and the app is on dev now. Switch the app to uat, then retry.',
      );
      assert.equal(
        retryProblem(failedAtVet(), { env: 'dev', functions: ALL }),
        'This run used .env.local and the app is on dev now. Switch the app to .env.local, then retry.',
      );
      assert.match(retryProblem({ ...failedAtVet(), env: 'uat' }, { functions: ALL }) ?? '', /used uat and the app is on \.env\.local/);
    });
    it('names a step whose function is gone, from the failed one on', () => {
      assert.equal(retryProblem(failedAtVet(), { functions: ['create', 'vet'] }), 'Step 3: function "activate" is no longer in this repo.');
      assert.equal(retryProblem(failedAtVet(), { functions: ['vet', 'activate'] }), undefined);
    });
  });
});

describe('IF steps', () => {
  const BR = [
    meta({ id: 'enrol', record: 'member', starts: true, outputs: ['reg', 'status', 'enr'] }),
    meta({ id: 'vet', record: 'member', inputs: { enr: 'required' }, outputs: ['status', 'acct'] }),
    meta({ id: 'note', inputs: { status: 'required' }, outputs: ['acct', 'memo'] }),
    meta({ id: 'after', inputs: { acct: 'required' } }),
    meta({ id: 'needsMemo', inputs: { memo: 'required' } }),
  ];
  const IF = { value: 'status', equals: 'NEEDS_DDE' };
  const FLOW: FlowDef = { steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'vet' }], else: [{ function: 'note' }] }, { function: 'after' }] };

  describe('flatten', () => {
    it('an IF, then its then-arm, then its else-arm, each arm step tagged with the IF\'s index', () =>
      assert.deepEqual(flatten(FLOW), [
        { function: 'enrol' },
        { if: IF },
        { function: 'vet', branch: { at: 1, arm: 'then' } },
        { function: 'note', branch: { at: 1, arm: 'else' } },
        { function: 'after' },
      ]));
    it('a missing else and junk arms add nothing', () => {
      assert.deepEqual(flatten({ steps: [{ if: IF, then: [{ function: 'vet' }] }] }), [{ if: IF }, { function: 'vet', branch: { at: 0, arm: 'then' } }]);
      assert.deepEqual(flatten({ steps: [{ if: IF, then: 'x', else: null }] }), [{ if: IF }]);
    });
    for (const bad of [undefined, null, {}, { steps: 'x' }]) it(`no steps: ${JSON.stringify(bad)}`, () => assert.deepEqual(flatten(bad), []));
    it('a linear flow stays as it is', () => assert.deepEqual(flatten(WEB), WEB.steps));
  });

  describe('conditionHolds and conditionText', () => {
    const cases: [Condition, Record<string, string>, boolean, string][] = [
      [{ value: 'status', equals: 'NEEDS_DDE' }, { status: 'NEEDS_DDE' }, true, 'status is NEEDS_DDE'],
      [{ value: 'status', equals: 'NEEDS_DDE' }, { status: 'ACCOUNT_OPENED' }, false, 'status is NEEDS_DDE'],
      [{ value: 'status', equals: 'NEEDS_DDE' }, {}, false, 'status is NEEDS_DDE'],
      [{ value: 'status', equals: ' NEEDS_DDE ' }, { status: 'NEEDS_DDE' }, true, 'status is NEEDS_DDE'],
      [{ value: 'status', equals: 'needs_dde' }, { status: 'NEEDS_DDE' }, false, 'status is needs_dde'],
      [{ value: 'status', equals: '' }, {}, true, 'status is empty'],
      [{ value: 'status', notEquals: 'ACCOUNT_OPENED' }, { status: 'PENDING' }, true, 'status is not ACCOUNT_OPENED'],
      [{ value: 'status', notEquals: 'ACCOUNT_OPENED' }, { status: 'ACCOUNT_OPENED' }, false, 'status is not ACCOUNT_OPENED'],
      [{ value: 'status', notEquals: 'X' }, {}, true, 'status is not X'],
      [{ value: 'status' }, { status: 'A' }, true, 'status is set'],
      [{ value: 'status' }, {}, false, 'status is set'],
    ];
    for (const [cond, values, holds, text] of cases)
      it(`${JSON.stringify(cond)} on ${JSON.stringify(values)}`, () => {
        assert.equal(conditionHolds(cond, values), holds);
        assert.equal(conditionText(cond), text);
      });
  });

  describe('flowProblems', () => {
    it('a good IF flow', () => assert.deepEqual(flowProblems(BR, FIELDS, FLOW), []));
    it('the IF needs its value from an earlier step', () =>
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ if: IF, then: [{ function: 'enrol' }] }] }), ['Step 1: the IF needs Status from an earlier step']));
    it('a value given in only one arm of an earlier IF is not certain', () =>
      assert.deepEqual(
        flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'note' }] }, { if: { value: 'memo' }, then: [{ function: 'vet' }] }] }),
        ['Step 4: the IF needs memo from an earlier step'],
      ));
    it('no value to test, both equals and notEquals, and no steps in either arm', () =>
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: { value: ' ' }, then: [] }, { if: { value: 'status', equals: 'A', notEquals: 'B' }, then: [{ function: 'vet' }] }] }), [
        'Step 2: the IF needs a value to test',
        'Step 2: the IF has no steps in either branch',
        'Step 3: the IF takes equals or notEquals, not both',
      ]));
    it('an IF inside an arm', () =>
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: IF, then: [{ if: IF, then: [{ function: 'vet' }] } as never] }] }), ["Step 3: an IF can't hold another IF"]));
    it('an arm step gets values from before the IF and from earlier in its own arm', () => {
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'note' }, { function: 'needsMemo' }] }] }), []);
    });
    it('an else-arm step does not get what the then-arm gives', () =>
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'note' }], else: [{ function: 'needsMemo' }] }] }), [
        'Step 4: needsMemo needs memo',
      ]));
    it('after the IF, a value counts only when both arms give it', () => {
      assert.deepEqual(flowProblems(BR, FIELDS, FLOW), []);
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'vet' }] }, { function: 'after' }] }), ['Step 4: after needs acct']);
      assert.deepEqual(flowProblems(BR, FIELDS, { steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'vet' }], else: [{ function: 'note' }] }, { function: 'needsMemo' }] }), [
        'Step 5: needsMemo needs memo',
      ]);
    });
    it('a secret typed in an arm is caught', () =>
      assert.deepEqual(secretProblems(FIELDS, { steps: [{ if: IF, then: [{ function: 'activate', values: { password: 'p' } }] }] }), ["Step 2: don't save Password in a flow file; leave it blank"]));
  });

  describe('producedBefore', () => {
    it('numbers steps as laid out flat; after an IF, from the then-arm when both arms give it', () => {
      const flat = flatten(FLOW);
      assert.deepEqual([...producedBefore(BR, flat, 4)], [['reg', 1], ['status', 1], ['enr', 1], ['acct', 3]]);
      assert.deepEqual([...producedBefore(BR, flat, 3)], [['reg', 1], ['status', 1], ['enr', 1]]);
    });
  });

  describe('run', () => {
    const fresh = (flow = FLOW) => newFlowRun(BR, flow, { id: 'r', name: 'n', now: 1 });
    const statuses = (run: ReturnType<typeof fresh>) => run.steps.map((s) => s.status);
    it('the IF is titled by its condition, and waits with the rest', () => {
      const run = fresh();
      assert.deepEqual(run.steps.map((s) => s.title), ['enrol', 'If status is NEEDS_DDE', 'vet', 'note', 'after']);
      assert.deepEqual(statuses(run), ['waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
    });
    it('condition holds: the IF passes taking then, the else-arm is skipped, then-arm runs next', () => {
      let run = stepEnded(stepStarted(fresh(), 0, {}), { status: 'passed', output: { status: 'NEEDS_DDE', enr: 'E1' } }, 2);
      assert.deepEqual(statuses(run), ['passed', 'passed', 'waiting', 'skipped', 'waiting']);
      assert.equal(run.steps[1].taken, 'then');
      assert.deepEqual(run.steps[1].input, { status: 'NEEDS_DDE' });
      assert.equal(nextStepIndex(run), 2);
      run = stepEnded(stepStarted(run, 2, {}), { status: 'passed', output: { acct: '1' } }, 3);
      assert.equal(nextStepIndex(run), 4);
      run = stepEnded(stepStarted(run, 4, {}), { status: 'passed' }, 4);
      assert.deepEqual({ status: run.status, endedAt: run.endedAt }, { status: 'passed', endedAt: 4 });
    });
    it('condition fails: the then-arm is skipped and the else-arm runs', () => {
      const run = stepEnded(stepStarted(fresh(), 0, {}), { status: 'passed', output: { status: 'ACCOUNT_OPENED' } }, 2);
      assert.deepEqual(statuses(run), ['passed', 'passed', 'skipped', 'waiting', 'waiting']);
      assert.equal(run.steps[1].taken, 'else');
      assert.equal(nextStepIndex(run), 3);
    });
    it('an IF last in the flow with an empty arm taken: the run passes at once', () => {
      const run = stepEnded(stepStarted(fresh({ steps: [{ function: 'enrol' }, { if: IF, then: [{ function: 'vet' }] }] }), 0, {}), { status: 'passed', output: { reg: 'R' } }, 2);
      assert.deepEqual(run.steps[1].input, { status: '' });
      assert.deepEqual(statuses(run), ['passed', 'passed', 'skipped']);
      assert.deepEqual({ status: run.status, endedAt: run.endedAt }, { status: 'passed', endedAt: 2 });
    });
    it('the IF reads the latest value of its name', () => {
      let run = fresh({ steps: [{ function: 'enrol' }, { function: 'note' }, { if: IF, then: [{ function: 'vet' }] }] });
      run = stepEnded(stepStarted(run, 0, {}), { status: 'passed', output: { status: 'NEEDS_DDE' } }, 2);
      run = stepEnded(stepStarted(run, 1, {}), { status: 'passed', output: { status: 'DONE' } }, 3);
      assert.equal(run.steps[2].taken, 'else');
    });
    it('a failure before the IF leaves it waiting', () => {
      const run = stepEnded(stepStarted(fresh(), 0, {}), { status: 'failed' }, 2);
      assert.deepEqual(statuses(run), ['failed', 'waiting', 'waiting', 'waiting', 'waiting']);
    });
      it('a failure in an IF arm resumes there; the IF stays decided and the other arm skipped', () => {
        let run = fresh();
        run = stepEnded(stepStarted(run, 0, {}), { status: 'passed', output: { status: 'NEEDS_DDE' } }, 2);
        run = retriedFlowRun(stepEnded(stepStarted(run, 2, {}), { status: 'failed', error: 'boom' }, 3));
        assert.deepEqual(run.steps.map((s) => s.status), ['passed', 'passed', 'waiting', 'skipped', 'waiting']);
        assert.equal(run.steps[1].taken, 'then');
        assert.equal(nextStepIndex(run), 2);
      });
  });

  describe('flowSummary and functionsIn', () => {
    it('one line, arms after the IF; titles by id when unknown', () =>
      assert.equal(flowSummary([{ id: 'enrol', title: 'Enrol' }], FLOW), 'Enrol → If status is NEEDS_DDE: vet | else: note → after'));
    it('no else: left out; an empty then reads —', () => {
      assert.equal(flowSummary([], { steps: [{ function: 'a' }, { if: IF, then: [{ function: 'b' }, { function: 'c' }] }] }), 'a → If status is NEEDS_DDE: b → c');
      assert.equal(flowSummary([], { steps: [{ if: IF, then: [], else: [{ function: 'b' }] }] }), 'If status is NEEDS_DDE: — | else: b');
    });
    it('a linear flow and no flow', () => {
      assert.equal(flowSummary([], WEB), 'create → vet → activate');
      assert.equal(flowSummary([], null), '');
    });
    it('functionsIn lists arm functions too', () => {
      assert.deepEqual(functionsIn(FLOW), ['enrol', 'vet', 'note', 'after']);
      assert.deepEqual(functionsIn(undefined), []);
    });
  });
});
