/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DatasetItem, LiveDataPoint, ClassificationResult } from '../types';
import { classifyReadingsClient } from '../ml/svmCore';

export interface BackendHealth {
  status: string;
  service: string;
  port: number;
  esp32Connected: boolean;
  activePort: string | null;
  storage: string;
}

export interface SerialConnectResponse {
  status: string;
  port: string;
  baudRate: number;
  chip: string;
  firmware: string;
  multiplexer: string;
  message: string;
}

export interface LiveDataResponse extends Partial<LiveDataPoint> {
  status: string;
  port?: string | null;
}

async function parseJsonIfValid<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  return (await res.json()) as T;
}

export async function fetchBackendHealth(): Promise<BackendHealth | null> {
  try {
    const res = await fetch('/api/health');
    return await parseJsonIfValid<BackendHealth>(res);
  } catch {
    return null;
  }
}

export async function fetchDatasetsFromApi(): Promise<DatasetItem[] | null> {
  try {
    const res = await fetch('/api/datasets');
    return await parseJsonIfValid<DatasetItem[]>(res);
  } catch {
    return null;
  }
}

export async function createDatasetOnApi(dataset: DatasetItem): Promise<DatasetItem | null> {
  try {
    const res = await fetch('/api/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataset),
    });
    return await parseJsonIfValid<DatasetItem>(res);
  } catch {
    return null;
  }
}

export async function deleteDatasetOnApi(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/datasets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function connectSerialOnApi(
  port: string,
  baudRate = 115200
): Promise<SerialConnectResponse | null> {
  try {
    const res = await fetch('/api/serial/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baudRate }),
    });
    return await parseJsonIfValid<SerialConnectResponse>(res);
  } catch {
    return null;
  }
}

export async function disconnectSerialOnApi(): Promise<boolean> {
  try {
    const res = await fetch('/api/serial/disconnect', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchLiveSensorFromApi(
  elapsed: number,
  diagnosis: 'Healthy' | 'Parkinson'
): Promise<LiveDataResponse | null> {
  try {
    const params = new URLSearchParams({
      elapsed: String(elapsed),
      diagnosis,
    });
    const res = await fetch(`/api/live-data?${params.toString()}`);
    return await parseJsonIfValid<LiveDataResponse>(res);
  } catch {
    return null;
  }
}

export async function classifyReadingsOnApi(
  readings: LiveDataPoint[]
): Promise<ClassificationResult> {
  if (!Array.isArray(readings) || readings.length < 2) {
    throw new Error(
      'Minimal 2 frame pembacaan sensor BME680 diperlukan untuk preprocessing dan klasifikasi SVM.'
    );
  }

  try {
    const res = await fetch('/api/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ readings }),
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.toLowerCase().includes('application/json');

    if (res.ok && isJson) {
      return (await res.json()) as ClassificationResult;
    }

    if (!res.ok && isJson) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.detail || `SVM classification failed (${res.status})`);
    }

    // Non-JSON response (e.g., static HTML preview fallback without Express API):
    // run the identical RBF-SVM + StandardScaler + Platt Scaling pipeline locally.
    return classifyReadingsClient(readings);
  } catch (err: any) {
    if (err instanceof SyntaxError || err?.name === 'TypeError') {
      return classifyReadingsClient(readings);
    }
    throw err;
  }
}
