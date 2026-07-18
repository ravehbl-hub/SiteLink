/**
 * Workers (Foreman) — a single drawer surface hosting an in-screen navigation state
 * machine: LIST → DETAIL(view) → EDIT, and LIST → ADD. Kept self-contained (no new
 * navigation dependency) — the drawer registers ONE additive "Workers" screen.
 *
 * SCOPE: everything is tied to the SitePicker/ActiveSite. The list is fetched for the
 * active site; the back end additionally auto-scopes the FOREMAN caller to their
 * assigned site(s). Manager-only actions (archive/delete/docs/salary edit/image) are
 * NOT surfaced here — the foreman token is 403'd for them server-side.
 *
 * Deck theme (dark-first tokens), compact controls, textAlign:'auto' RTL primitives.
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError, uploadToSignedUrl } from '../../lib/api';
import { endpoints } from '../../lib/endpoints';
import type { PickedFile } from '../../lib/camera';
import { money } from '../../lib/format';
import { useActiveSite } from '../../site/ActiveSiteProvider';
import { SitePicker } from '../../site/SitePicker';
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeading,
  StatusPill,
  Title,
} from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import {
  useCreateWorker,
  useUpdateWorker,
  useWorkerDetail,
  useWorkersList,
} from './hooks';
import { WorkerForm, type WorkerFormValues } from './WorkerForm';

type Nav =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'detail'; workerId: string }
  | { kind: 'edit'; workerId: string };

/** Map an ApiError to a friendly inline message (400 validation / 403 scope / 409 dup). */
function useApiErrorMessage() {
  const { t } = useTranslation();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.status === 409) return t('workers.errorDuplicate');
      if (e.status === 403) return t('workers.errorScope');
      if (e.status === 400) return t('workers.errorValidation');
      if (e.message) return e.message;
    }
    return t('common.error');
  };
}

function InlineError({ message }: { message: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.dangerSubtle,
        borderColor: theme.colors.danger,
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        borderRadius: Number(theme.tokens.radii.sm),
        padding: Number(theme.tokens.spacing['3']),
        marginBottom: Number(theme.tokens.spacing['3']),
      }}
    >
      <Body>{message}</Body>
    </View>
  );
}

export function WorkersScreen() {
  const { t } = useTranslation();
  const { activeSiteId, ready } = useActiveSite();
  const [view, setView] = useState<Nav>({ kind: 'list' });

  if (!ready) {
    return (
      <Screen>
        <Title>{t('workers.title')}</Title>
        <Loading label={t('site.loading')} />
      </Screen>
    );
  }

  if (!activeSiteId) {
    return (
      <Screen>
        <Title>{t('workers.title')}</Title>
        <Card>
          <EmptyState label={t('common.noSiteAssigned')} />
        </Card>
      </Screen>
    );
  }

  switch (view.kind) {
    case 'add':
      return <AddView onDone={() => setView({ kind: 'list' })} />;
    case 'detail':
      return (
        <DetailView
          workerId={view.workerId}
          onBack={() => setView({ kind: 'list' })}
          onEdit={() => setView({ kind: 'edit', workerId: view.workerId })}
        />
      );
    case 'edit':
      return (
        <EditView
          workerId={view.workerId}
          onDone={() => setView({ kind: 'detail', workerId: view.workerId })}
        />
      );
    case 'list':
    default:
      return (
        <ListView
          siteId={activeSiteId}
          onAdd={() => setView({ kind: 'add' })}
          onOpen={(id) => setView({ kind: 'detail', workerId: id })}
        />
      );
  }
}

function ListView({
  siteId,
  onAdd,
  onOpen,
}: {
  siteId: string;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const q = useWorkersList(siteId);

  return (
    <Screen>
      <Title>{t('workers.title')}</Title>
      <SitePicker />
      <Button title={t('workers.add')} onPress={onAdd} />

      {q.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : q.isError ? (
        <ErrorState label={t('common.error')} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <Card>
          <EmptyState label={t('workers.empty')} />
        </Card>
      ) : (
        q.data.items.map((w) => (
          <Pressable key={w.id} onPress={() => onOpen(w.id)}>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flexShrink: 1 }}>
                  <Body>
                    {w.firstName} {w.lastName}
                  </Body>
                  <Body muted>{t(`professions.${w.profession}`)}</Body>
                </View>
                <StatusPill label={t(`levels.${w.level}`)} tone="info" />
              </Row>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

/** Read-only detail (VIEW). Salary shown ONLY if the back end returns it; no edit of
 * salary/docs/archive here (manager-only). The single write action is Edit. */
function DetailView({
  workerId,
  onBack,
  onEdit,
}: {
  workerId: string;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { sites } = useActiveSite();
  const q = useWorkerDetail(workerId);
  const errMsg = useApiErrorMessage();

  if (q.isLoading) {
    return (
      <Screen>
        <Title>{t('workers.details')}</Title>
        <Loading label={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Screen>
        <Title>{t('workers.details')}</Title>
        <InlineError message={errMsg(q.error)} />
        <Button title={t('workers.back')} variant="secondary" onPress={onBack} />
      </Screen>
    );
  }

  const w = q.data;
  const siteNames = (w.siteIds ?? [])
    .map((id) => sites.find((s) => s.siteId === id)?.name ?? id)
    .join(', ');

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>
          {w.firstName} {w.lastName}
        </Title>
      </Row>

      <Card>
        <DetailRow label={t('workers.profession')} value={t(`professions.${w.profession}`)} />
        <DetailRow label={t('workers.level')} value={t(`levels.${w.level}`)} />
        <DetailRow label={t('workers.phone')} value={w.phone ?? '—'} />
        <DetailRow label={t('workers.email')} value={w.email ?? '—'} />
        {w.personnelCompany ? (
          <DetailRow label={t('workers.personnelCompany')} value={w.personnelCompany} />
        ) : null}
        {w.residence ? <DetailRow label={t('workers.residence')} value={w.residence} /> : null}
        <DetailRow label={t('workers.site')} value={siteNames || '—'} />
      </Card>

      {w.salaryData ? (
        <Card>
          <SectionHeading>{t('workers.salaryData')}</SectionHeading>
          <DetailRow
            label={t('workers.hourlyWage')}
            value={money(w.salaryData.hourlyWage, w.salaryData.currency)}
          />
          {w.salaryData.workingConditions ? (
            <DetailRow
              label={t('workers.workingConditions')}
              value={w.salaryData.workingConditions}
            />
          ) : null}
        </Card>
      ) : null}

      <Button title={t('workers.edit')} onPress={onEdit} />
      <Button title={t('workers.back')} variant="secondary" onPress={onBack} />
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
      <Body muted>{label}</Body>
      <Body>{value}</Body>
    </Row>
  );
}

function AddView({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const create = useCreateWorker();
  const errMsg = useApiErrorMessage();
  const [error, setError] = useState<string | null>(null);

  function submit(values: WorkerFormValues, image: PickedFile | null) {
    setError(null);
    create.mutate(values, {
      onSuccess: async (worker) => {
        // BEST-EFFORT profile-image upload via the signed-URL flow (mirrors the
        // Manager wizard). A failure here must NOT fail the create — the worker is
        // already saved; we surface a non-fatal inline notice and still close.
        if (image) {
          try {
            const signed = await endpoints.requestImageUpload(worker.id, {
              fileName: image.fileName,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
            });
            await uploadToSignedUrl(signed.uploadUrl, image.uri, image.mimeType);
            await endpoints.confirmImage(worker.id, {
              storageKey: signed.storageKey,
              fileName: image.fileName,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
            });
          } catch {
            setError(t('workers.imageUploadFailed'));
            return; // keep the screen open so the non-fatal notice is visible
          }
        }
        onDone();
      },
      onError: (e) => setError(errMsg(e)),
    });
  }

  return (
    <Screen>
      <Title>{t('workers.add')}</Title>
      {error ? <InlineError message={error} /> : null}
      <Card>
        <WorkerForm mode="add" submitting={create.isPending} onSubmit={submit} />
      </Card>
      <Button title={t('common.cancel')} variant="secondary" onPress={onDone} />
    </Screen>
  );
}

function EditView({ workerId, onDone }: { workerId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const detail = useWorkerDetail(workerId);
  const update = useUpdateWorker(workerId);
  const errMsg = useApiErrorMessage();
  const [error, setError] = useState<string | null>(null);

  // EDIT does not change the image (parity with the Manager wizard, which only
  // captures the profile image on ADD); the image arg is always null here.
  function submit(values: WorkerFormValues, _image: PickedFile | null) {
    setError(null);
    // password is already omitted by the form on edit; strip defensively.
    const { password: _password, ...patch } = values;
    update.mutate(patch, {
      onSuccess: () => onDone(),
      onError: (e) => setError(errMsg(e)),
    });
  }

  if (detail.isLoading) {
    return (
      <Screen>
        <Title>{t('workers.edit')}</Title>
        <Loading label={t('common.loading')} />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <Title>{t('workers.edit')}</Title>
        <InlineError message={errMsg(detail.error)} />
        <Button title={t('workers.back')} variant="secondary" onPress={onDone} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t('workers.edit')}</Title>
      {error ? <InlineError message={error} /> : null}
      <Card>
        <WorkerForm
          mode="edit"
          initial={detail.data}
          submitting={update.isPending}
          onSubmit={submit}
        />
      </Card>
      <Button title={t('common.cancel')} variant="secondary" onPress={onDone} />
    </Screen>
  );
}
