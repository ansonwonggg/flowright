import { render, screen, within } from '@testing-library/react';
import { ApiError } from '../api.ts';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META } from '../lib/fixtures.test-utils.ts';
import { FlowBuilderPage } from './FlowBuilderPage.tsx';

let savedFlows: { file: string; label: string; summary: string; spec: unknown }[] = [];
let checkErrors: string[] = [];
const start = { mutateAsync: vi.fn(), isPending: false };
const save = { mutateAsync: vi.fn(), isPending: false };
vi.mock('../queries.ts', () => ({
  useMeta: () => ({ data: META }),
  usePresets: () => ({ data: { fields: {}, flows: savedFlows } }),
  useLive: () => ({ data: null }),
  useFlowCheck: () => ({ data: { errors: checkErrors, warnings: [] }, isPending: false, isPlaceholderData: false }),
  useStartFlow: () => start,
  useSaveFlow: () => save,
}));

const page = (url = '/flow-builder') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FlowBuilderPage />
    </MemoryRouter>,
  );
const mode = (name: string) => screen.getByRole('radio', { name });
const openSave = () => userEvent.click(screen.getByRole('button', { name: 'Save…' }));

beforeEach(() => {
  localStorage.clear();
  savedFlows = [];
  checkErrors = [];
  start.mutateAsync.mockReset();
  save.mutateAsync.mockReset();
});
afterEach(() => localStorage.clear());

describe('FlowBuilderPage modes', () => {
  it('starts in Form mode', () => {
    page();
    expect(mode('Form')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('First step')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Functions' })).toBeNull();
  });

  it('Flow chart swaps in the palette and keeps the steps; the choice is remembered', async () => {
    page();
    await userEvent.selectOptions(screen.getByLabelText('First step'), 'create-user');
    await userEvent.click(mode('Flow chart'));
    expect(mode('Flow chart')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('region', { name: 'Functions' })).toBeInTheDocument();
    expect(screen.getByLabelText('Step 1 tile')).toHaveTextContent('WebCreate ER User');
    expect(localStorage.getItem('builderMode')).toBe('drag');
  });

  it('opens in the remembered mode; an unknown value falls back to Form', () => {
    localStorage.setItem('builderMode', 'drag');
    const { unmount } = page();
    expect(mode('Flow chart')).toHaveAttribute('aria-checked', 'true');
    unmount();
    localStorage.setItem('builderMode', 'weird');
    page();
    expect(mode('Form')).toHaveAttribute('aria-checked', 'true');
  });
});

const withSteps = async () => {
  page();
  await userEvent.selectOptions(screen.getByLabelText('First step'), 'create-user');
  await userEvent.selectOptions(screen.getByLabelText('Add a step'), 'vet-datamod');
};

describe('FlowBuilderPage dialogs', () => {
  it('Run asks in the page, listing the steps; Cancel starts nothing', async () => {
    await withSteps();
    await userEvent.click(screen.getByRole('button', { name: 'Run the flow' }));
    const dialog = screen.getByRole('dialog', { name: 'Start this flow?' });
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['[Web] Create ER User', '[Admin] Vet']);
    expect(dialog).toHaveTextContent('This makes permanent records on DEV.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(start.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Start starts the flow under its name', async () => {
    start.mutateAsync.mockResolvedValue({ id: 'r1' });
    await withSteps();
    await openSave();
    await userEvent.type(screen.getByLabelText('Title'), 'mine');
    await userEvent.click(screen.getByRole('button', { name: 'Run the flow' }));
    expect(screen.getByRole('dialog', { name: 'Start mine?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(start.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'mine' }));
  });

  it('a failed start is shown in the page', async () => {
    start.mutateAsync.mockRejectedValue(new Error('busy'));
    await withSteps();
    await userEvent.click(screen.getByRole('button', { name: 'Run the flow' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('dialog', { name: 'Could not start the flow' })).toHaveTextContent('busy');
  });

  it('saving over an existing file asks first; Replace saves with overwrite, Cancel does not', async () => {
    save.mutateAsync.mockRejectedValueOnce(new ApiError('exists', 409, { file: 'config/flows/mine.flow.json' })).mockResolvedValueOnce({ file: 'config/flows/mine.flow.json' });
    await withSteps();
    await openSave();
    await userEvent.type(screen.getByLabelText('Title'), 'mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset' }));
    expect(await screen.findByRole('dialog', { name: 'Replace the saved flow?' })).toHaveTextContent('config/flows/mine.flow.json already exists.');
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(save.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ overwrite: true }));
    expect(await screen.findByText('Saved config/flows/mine.flow.json')).toBeInTheDocument();
  });

  it('a failed save is shown in the page', async () => {
    save.mutateAsync.mockRejectedValue(new Error('disk full'));
    await withSteps();
    await openSave();
    await userEvent.type(screen.getByLabelText('Title'), 'mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset' }));
    expect(await screen.findByRole('dialog', { name: 'Could not save the flow' })).toHaveTextContent('disk full');
  });
});

describe('FlowBuilderPage title and file name', () => {
  it('Title, File name and Save sit behind Save…, which opens and closes them', async () => {
    page();
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save…' })).toHaveAttribute('aria-expanded', 'false');
    await openSave();
    expect(screen.getByRole('button', { name: 'Save…' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Save the flow' })).toBeInTheDocument();
    await openSave();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('a new flow: "New flow", and the intro names the kinds of record', () => {
    page();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New flow');
    expect(screen.getByText(/one after another on one ER user or one member\./)).toBeInTheDocument();
  });

  it("a saved flow opens with its title as the heading and in Title, and its file name", async () => {
    savedFlows = [{ file: 'config/flows/new-er-user.flow.json', label: 'New ER user', summary: '', spec: { title: 'New ER user', steps: [{ function: 'create-user' }] } }];
    page('/flow-builder?preset=config%2Fflows%2Fnew-er-user.flow.json');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New ER user');
    await openSave();
    expect(screen.getByLabelText('Title')).toHaveValue('New ER user');
    expect(screen.getByLabelText('File name')).toHaveValue('new-er-user');
  });

  it('a saved flow without a title: the file name is the heading; Title stays blank', async () => {
    savedFlows = [{ file: 'config/flows/x/old.flow.json', label: 'x/old', summary: '', spec: { steps: [] } }];
    page('/flow-builder?preset=config%2Fflows%2Fx%2Fold.flow.json');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('x/old');
    await openSave();
    expect(screen.getByLabelText('Title')).toHaveValue('');
  });

  it('typing a title renames the heading and suggests a file name; Save uses it and keeps the title in the flow', async () => {
    save.mutateAsync.mockResolvedValue({ file: 'config/flows/new-er-user-kiosk.flow.json' });
    await withSteps();
    await openSave();
    expect(screen.getByRole('button', { name: 'Save as preset' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Title'), 'New ER user (kiosk)');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New ER user (kiosk)');
    expect(screen.getByLabelText('File name')).toHaveAttribute('placeholder', 'new-er-user-kiosk');
    expect(screen.getByText('Saves to config/flows/new-er-user-kiosk.flow.json')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset' }));
    expect(save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'new-er-user-kiosk', flow: expect.objectContaining({ title: 'New ER user (kiosk)' }) }));
  });

  it('a typed file name wins over the suggestion', async () => {
    save.mutateAsync.mockResolvedValue({ file: 'config/flows/mine.flow.json' });
    await withSteps();
    await openSave();
    await userEvent.type(screen.getByLabelText('Title'), 'New ER user');
    await userEvent.type(screen.getByLabelText('File name'), 'mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset' }));
    expect(save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'mine' }));
  });

  it('the start dialog and run use the file name when there is no title', async () => {
    start.mutateAsync.mockResolvedValue({ id: 'r1' });
    await withSteps();
    await openSave();
    await userEvent.type(screen.getByLabelText('File name'), 'quick');
    await userEvent.click(screen.getByRole('button', { name: 'Run the flow' }));
    expect(screen.getByRole('dialog', { name: 'Start quick?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(start.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'quick' }));
  });
});

describe('FlowBuilderPage flow chart', () => {
  it("shows the flow check's errors on the step they belong to", async () => {
    checkErrors = ['Step 2: needs DataMod ref'];
    await withSteps();
    await userEvent.click(mode('Flow chart'));
    expect(screen.getByLabelText('Step 2 tile')).toHaveTextContent('needs DataMod ref');
    expect(screen.getByLabelText('Step 1 tile')).not.toHaveTextContent('needs DataMod ref');
  });
});
