/**
 * Worker Wizard create + EDIT (FR-MGR-EMP-2/4/7). Captures Details + optional Salary
 * data, plus a CAMERA-captured profile image (FR-MGR-PARITY-2).
 *
 * ADD field order (item 12 / Phase 05 Stage C): email (REQUIRED) → FIRST PASSWORD
 * (REQUIRED, min 8, show/hide) → names → profession/level → phone/country →
 * personnel-company PICKER. Every new worker is provisioned a WORKER login from the
 * email + initial password (the backend create schema requires both).
 *
 * EDIT (route param `workerId` present): the form is prefilled from the worker and the
 * first-password field is OMITTED — the backend PATCH is `.partial()` and NEVER resets
 * the Supabase auth password, so we never send `password` on edit. Email stays required;
 * the personnel company can be changed.
 *
 * personnelCompany uses the reusable Select<T> populated from usePersonnelCompanies
 * (active). Selection is tracked by company id; the committed backend contract persists
 * the free-text `personnelCompany`, so on submit we send the selected company's NAME.
 * Image upload uses the signed-URL flow after create (the worker id is needed for the
 * server-chosen storage key).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Profession,
  RateType,
  WorkerLevel,
  type CreateWorkerInput,
  type UpdateWorkerInput,
} from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { captureFromCamera, pickFromLibrary, type PickedFile } from '../../lib/camera';
import { professionOptions, levelOptions } from '../../lib/enumOptions';
import { ApiError, uploadToSignedUrl } from '../../lib/api';
import { usePersonnelCompanies } from '../personnel-companies/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import type { WorkersStackParamList } from '../../navigation/types';
import {
  Body,
  Button,
  Card,
  Field,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Select,
  Title,
} from '../../components/ui';

type Props = NativeStackScreenProps<WorkersStackParamList, 'WorkerWizard'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PW = 8;

export function WorkerWizardScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { theme } = useTheme();

  const workerId = route.params?.workerId ?? null;
  const isEdit = workerId != null;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [profession, setProfession] = useState<Profession>(Profession.GENERAL_LABORER);
  const [level, setLevel] = useState<WorkerLevel>(WorkerLevel.MEDIUM);
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  // Personnel-company selection is tracked by company id (picker state). On submit we
  // send the matching company NAME into the free-text `personnelCompany` wire field.
  const [personnelCompanyId, setPersonnelCompanyId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [hourlyWage, setHourlyWage] = useState('');
  const [image, setImage] = useState<PickedFile | null>(null);

  // Active personnel companies for the picker (reuses the committed hook).
  const companiesQ = usePersonnelCompanies(false);
  const companies = companiesQ.data?.items ?? [];
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );

  // EDIT: load the worker and prefill. The company is matched by NAME (the stored
  // free-text) back to a company id so the picker shows the current selection.
  const workerQ = useQuery({
    queryKey: qk.worker(workerId ?? '__none__'),
    queryFn: () => endpoints.getWorker(workerId as string),
    enabled: isEdit,
  });

  useEffect(() => {
    const w = workerQ.data;
    if (!w) return;
    setFirstName(w.firstName ?? '');
    setLastName(w.lastName ?? '');
    setProfession(w.profession);
    setLevel(w.level);
    setPhone(w.phone ?? '');
    setCountry(w.country ?? '');
    setEmail(w.email ?? '');
    if (w.salaryData?.hourlyWage != null) setHourlyWage(String(w.salaryData.hourlyWage));
  }, [workerQ.data]);

  // Prefill the picker from the stored FK id (edit). The backend now returns
  // personnelCompanyId directly — no name-matching needed.
  useEffect(() => {
    const id = workerQ.data?.personnelCompanyId ?? null;
    if (id == null || personnelCompanyId != null) return;
    setPersonnelCompanyId(id);
  }, [workerQ.data, personnelCompanyId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        // EDIT: omit password entirely (backend never resets the Supabase auth pw).
        // Send the managed FK id; the backend mirrors the company name into the
        // legacy free-text column, so we no longer send personnelCompany text.
        const body: UpdateWorkerInput = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          profession,
          level,
          phone: phone.trim() || null,
          country: country.trim() || null,
          personnelCompanyId,
          email: email.trim(),
        };
        const worker = await endpoints.updateWorker(workerId as string, body);
        await maybeUpsertSalary(worker.id);
        return worker;
      }

      // ADD: email + first password (min 8) required by the backend create schema.
      const body: CreateWorkerInput = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        profession,
        level,
        phone: phone.trim() || null,
        country: country.trim() || null,
        personnelCompanyId,
        email: email.trim(),
        password,
      };
      const worker = await endpoints.createWorker(body);
      await maybeUpsertSalary(worker.id);
      // Profile image upload via the signed-URL flow (best-effort; must not fail create).
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
        } catch (e) {
          Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
        }
      }
      return worker;
    },
    onSuccess: async (worker) => {
      // Invalidate the workers list AND this worker's detail so both reflect the change.
      await qc.invalidateQueries({ queryKey: ['workers'] });
      await qc.invalidateQueries({ queryKey: qk.worker(worker.id) });
      navigation.goBack();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        // 409 → duplicate email: surface inline on the email field.
        if (e.status === 409) {
          setEmailError(t('workers.emailDuplicate'));
          return;
        }
        // 400 → validation (most commonly the short password on ADD).
        if (e.status === 400 && !isEdit) {
          setPasswordError(t('workers.passwordTooShort', { min: MIN_PW }));
          return;
        }
      }
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    },
  });

  async function maybeUpsertSalary(id: string) {
    const wage = Number(hourlyWage);
    if (!Number.isNaN(wage) && wage > 0) {
      await endpoints.upsertWorkerSalary(id, {
        hourlyWage: wage,
        rateType: RateType.HOURLY,
        currency: 'ILS',
      });
    }
  }

  async function onCapture() {
    const file = await captureFromCamera();
    if (file) setImage(file);
  }
  async function onPick() {
    const file = await pickFromLibrary();
    if (file) setImage(file);
  }

  const canSubmit = Boolean(
    firstName.trim() &&
      lastName.trim() &&
      email.trim() &&
      (isEdit || password.length >= MIN_PW),
  );

  function onSubmit() {
    const value = email.trim();
    if (!value) {
      setEmailError(t('workers.emailRequired'));
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setEmailError(t('workers.emailInvalid'));
      return;
    }
    setEmailError(null);
    if (!isEdit) {
      if (password.length < MIN_PW) {
        setPasswordError(t('workers.passwordTooShort', { min: MIN_PW }));
        return;
      }
      setPasswordError(null);
    }
    mutation.mutate();
  }

  return (
    <Screen>
      <Title>{isEdit ? t('workers.editIntro') : t('workers.wizardIntro')}</Title>

      {/* Profile photo is captured on ADD only (edit keeps the image flow on details). */}
      {!isEdit ? (
        <Card>
          <SectionHeading>{t('workers.image')}</SectionHeading>
          {image ? (
            <Image
              source={{ uri: image.uri }}
              style={{ width: 96, height: 96, borderRadius: 48, marginBottom: 8 }}
            />
          ) : (
            <Body muted>{t('common.optional')}</Body>
          )}
          <Row>
            <View style={{ flex: 1, marginEnd: 8 }}>
              <Button title={t('workers.takePhoto')} variant="secondary" onPress={onCapture} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('workers.chooseFromLibrary')}
                variant="secondary"
                onPress={onPick}
              />
            </View>
          </Row>
        </Card>
      ) : null}

      {/* Login block FIRST: email (required) → first password (required, add-only). */}
      <Card>
        <SectionHeading>{t('workers.login')}</SectionHeading>
        {/* item 12: role is always WORKER for a worker login — fixed, not a picker. */}
        <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
          <Body muted>{t('workers.role')}</Body>
          <Body>{t('workers.roleWorker')}</Body>
        </Row>
        <Field
          label={`${t('workers.email')} *`}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {emailError ? (
          <Body muted>{emailError}</Body>
        ) : null}

        {/* FIRST PASSWORD — ADD only; omitted on EDIT (PATCH never resets auth pw). */}
        {!isEdit ? (
          <>
            <Field
              label={`${t('workers.initialPassword')} *`}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (passwordError) setPasswordError(null);
              }}
              placeholder={t('workers.passwordHintMin', { min: MIN_PW })}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Body muted>{t('workers.passwordHintMin', { min: MIN_PW })}</Body>
              <Pressable
                onPress={() => setShowPassword((s) => !s)}
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>
                  {showPassword ? t('workers.hidePassword') : t('workers.showPassword')}
                </Text>
              </Pressable>
            </Row>
            {passwordError ? <Body muted>{passwordError}</Body> : null}
          </>
        ) : null}
      </Card>

      <Card>
        <SectionHeading>{t('workers.details')}</SectionHeading>
        <Field label={t('workers.firstName')} value={firstName} onChangeText={setFirstName} />
        <Field label={t('workers.lastName')} value={lastName} onChangeText={setLastName} />

        <SectionHeading>{t('workers.profession')}</SectionHeading>
        <Segmented
          options={professionOptions(t)}
          value={profession}
          onChange={(v) => setProfession(v)}
        />

        <SectionHeading>{t('workers.level')}</SectionHeading>
        <Segmented options={levelOptions(t)} value={level} onChange={(v) => setLevel(v)} />

        <Field label={t('workers.phone')} value={phone} onChangeText={setPhone} />
        <Field label={t('workers.country')} value={country} onChangeText={setCountry} />

        <SectionHeading>{t('workers.personnelCompany')}</SectionHeading>
        {companyOptions.length === 0 ? (
          <Body muted>{t('workers.personnelCompanyEmpty')}</Body>
        ) : (
          <Select
            value={personnelCompanyId}
            options={companyOptions}
            onChange={setPersonnelCompanyId}
            placeholder={t('workers.personnelCompanyPlaceholder')}
          />
        )}
      </Card>

      <Card>
        <SectionHeading>{t('workers.salaryData')}</SectionHeading>
        <Field
          label={t('workers.hourlyWage')}
          value={hourlyWage}
          onChangeText={setHourlyWage}
          keyboardType="numeric"
        />
      </Card>

      <Button
        title={t('common.save')}
        onPress={onSubmit}
        loading={mutation.isPending}
        disabled={!canSubmit}
      />
    </Screen>
  );
}
