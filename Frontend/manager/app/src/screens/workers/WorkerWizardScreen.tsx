/**
 * Worker Wizard create (FR-MGR-EMP-2/4/7). Captures Details + optional Salary data,
 * plus a CAMERA-captured profile image (FR-MGR-PARITY-2). Required: firstName,
 * lastName, profession. Image upload uses the signed-URL flow after create (the
 * worker id is needed for the server-chosen storage key).
 */
import React, { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Profession,
  RateType,
  WorkerLevel,
  type CreateWorkerInput,
} from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { captureFromCamera, pickFromLibrary, type PickedFile } from '../../lib/camera';
import { professionOptions, levelOptions } from '../../lib/enumOptions';
import { ApiError, uploadToSignedUrl } from '../../lib/api';
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
  Title,
} from '../../components/ui';

type Props = NativeStackScreenProps<WorkersStackParamList, 'WorkerWizard'>;

export function WorkerWizardScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [profession, setProfession] = useState<Profession>(Profession.GENERAL_LABORER);
  const [level, setLevel] = useState<WorkerLevel>(WorkerLevel.MEDIUM);
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [personnelCompany, setPersonnelCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [hourlyWage, setHourlyWage] = useState('');
  const [image, setImage] = useState<PickedFile | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      const body: CreateWorkerInput = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        profession,
        level,
        phone: phone.trim() || null,
        country: country.trim() || null,
        personnelCompany: personnelCompany.trim() || null,
        // item 12: email is REQUIRED — every new worker is provisioned a WORKER
        // login from this address. Validated (non-empty + format) before submit.
        email: email.trim(),
        ...(password ? { password } : {}),
      };
      const worker = await endpoints.createWorker(body);
      const wage = Number(hourlyWage);
      if (!Number.isNaN(wage) && wage > 0) {
        await endpoints.upsertWorkerSalary(worker.id, {
          hourlyWage: wage,
          rateType: RateType.HOURLY,
          currency: 'ILS',
        });
      }
      // Profile image upload via the signed-URL flow (symmetric to docs):
      // request upload-url -> PUT bytes to Supabase -> confirm. Needs the new
      // worker id for the server-chosen storage key. A failed image upload must
      // not fail worker creation, so it is best-effort with a soft warning.
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
          Alert.alert(
            t('common.error'),
            e instanceof ApiError ? e.message : String(e),
          );
        }
      }
      return worker;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workers'] });
      navigation.goBack();
    },
    onError: (e) => {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    },
  });

  async function onCapture() {
    const file = await captureFromCamera();
    if (file) setImage(file);
  }
  async function onPick() {
    const file = await pickFromLibrary();
    if (file) setImage(file);
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const canSubmit = Boolean(firstName.trim() && lastName.trim() && email.trim());

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
    createMut.mutate();
  }

  return (
    <Screen>
      <Title>{t('workers.wizardIntro')}</Title>

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
        <Field
          label={t('workers.personnelCompany')}
          value={personnelCompany}
          onChangeText={setPersonnelCompany}
        />
      </Card>

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
        />
        {emailError ? <Body muted>{emailError}</Body> : null}
        <Field
          label={t('workers.initialPassword')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('workers.initialPasswordHint')}
          secureTextEntry
          autoCapitalize="none"
        />
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
        loading={createMut.isPending}
        disabled={!canSubmit}
      />
    </Screen>
  );
}
