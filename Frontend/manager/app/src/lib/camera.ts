/**
 * Camera / image capture (FR-MGR-PARITY-2: the App supports camera capture for
 * worker image + docs; Web uses upload). Wraps expo-image-picker so screens get a
 * simple {uri, fileName, mimeType, sizeBytes} back for the signed-URL upload flow.
 */
import * as ImagePicker from 'expo-image-picker';

export interface PickedFile {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

function guessMime(uri: string, fallback = 'image/jpeg'): string {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return fallback;
}

function toPicked(asset: ImagePicker.ImagePickerAsset): PickedFile {
  const uri = asset.uri;
  return {
    uri,
    fileName: asset.fileName ?? uri.split('/').pop() ?? `capture-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? guessMime(uri),
    sizeBytes: asset.fileSize,
  };
}

/** Launch the device camera (requests permission first). Returns null if cancelled. */
export async function captureFromCamera(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
  });
  if (result.canceled || !result.assets[0]) return null;
  return toPicked(result.assets[0]);
}

/** Pick from the media library (upload-equivalent). Returns null if cancelled. */
export async function pickFromLibrary(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
  });
  if (result.canceled || !result.assets[0]) return null;
  return toPicked(result.assets[0]);
}
